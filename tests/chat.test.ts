/**
 * These tests only exercise the deterministic, networkless branches of POST /api/chat.
 * The real successful-completion path (provider dispatch -> streamed text -> final
 * `done:true` chunk) requires live AI provider credentials that aren't available in this
 * environment, so it is intentionally not tested here. These tests assume the server under
 * test was started with no AI_PROVIDER/OPENAI_API_KEY/ANTHROPIC_API_KEY/OPENROUTER_API_KEY
 * env vars set (matching this repo's .env/.env.test, which only set DATABASE_URL).
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "../lib/prisma";
import { FREE_MESSAGE_LIMIT } from "../lib/freeMessages";
import {
  TEST_BASE_URL,
  authHeaders,
  createAuthedUser,
  createTestConversation,
  resetTestDatabase,
  setFreeMessagesUsed,
} from "./setup";

describe("POST /api/chat", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await resetTestDatabase();
    await prisma.$disconnect();
  });

  it("401s with no session cookie", async () => {
    const response = await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello" }),
    });

    expect(response.status).toBe(401);
  });

  it("401s with an invalid/nonexistent session id", async () => {
    const response = await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers: authHeaders("not-a-real-session-id"),
      body: JSON.stringify({ message: "Hello" }),
    });

    expect(response.status).toBe(401);
  });

  it("400s on an empty/whitespace-only message", async () => {
    const { headers } = await createAuthedUser("chat-empty@example.com");

    const response = await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "   " }),
    });

    expect(response.status).toBe(400);
  });

  it("400s on a non-string message", async () => {
    const { headers } = await createAuthedUser("chat-non-string@example.com");

    const response = await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: 12345 }),
    });

    expect(response.status).toBe(400);
  });

  it("403s once the free message limit is reached, with no side effects", async () => {
    const { user, headers } = await createAuthedUser("chat-limit@example.com");
    await setFreeMessagesUsed(user.id, FREE_MESSAGE_LIMIT);

    const response = await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "One more message" }),
    });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.requiresApiKey).toBe(true);

    expect(await prisma.conversation.findMany({ where: { userId: user.id } })).toHaveLength(0);
    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser?.freeMessagesUsed).toBe(FREE_MESSAGE_LIMIT);
  });

  it("500s when under the limit but no provider API key is configured, leaving no orphaned message", async () => {
    const { user, headers } = await createAuthedUser("chat-no-key@example.com");

    const response = await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "Hello there" }),
    });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).not.toContain("text/event-stream");
    expect(String(data.error)).toMatch(/API_KEY/);

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(dbUser?.freeMessagesUsed).toBe(1);

    const conversations = await prisma.conversation.findMany({ where: { userId: user.id } });
    expect(conversations).toHaveLength(1);

    // The route persists the user message and the reply together, once a reply has
    // actually arrived, so a failed provider call leaves the conversation empty.
    const messages = await prisma.message.findMany({ where: { conversationId: conversations[0].id } });
    expect(messages).toHaveLength(0);
  });

  it("reuses an existing conversation owned by the caller instead of creating a new one", async () => {
    const { user, headers } = await createAuthedUser("chat-reuse@example.com");
    const conversation = await createTestConversation(user.id);

    await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "Continuing", conversationId: conversation.id }),
    });

    const conversations = await prisma.conversation.findMany({ where: { userId: user.id } });
    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe(conversation.id);
  });

  it("falls back to creating a new conversation when the given conversationId belongs to another user", async () => {
    const { user: owner } = await createAuthedUser("chat-victim@example.com");
    const { user: attacker, headers: attackerHeaders } = await createAuthedUser(
      "chat-attacker@example.com",
    );
    const othersConversation = await createTestConversation(owner.id);

    await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers: attackerHeaders,
      body: JSON.stringify({ message: "Hijack attempt", conversationId: othersConversation.id }),
    });

    const attackerConversations = await prisma.conversation.findMany({ where: { userId: attacker.id } });
    expect(attackerConversations).toHaveLength(1);
    expect(attackerConversations[0].id).not.toBe(othersConversation.id);

    const ownerConversations = await prisma.conversation.findMany({ where: { userId: owner.id } });
    expect(ownerConversations).toHaveLength(1);
  });
});
