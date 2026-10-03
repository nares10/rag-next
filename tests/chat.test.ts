/**
 * Auth, validation and quota branches of POST /api/chat. The streamed success path is
 * covered in tests/rag/chat-features.route.test.ts, which drives the OpenRouter default
 * against the stub provider.
 *
 * OpenAI and Anthropic are bring-your-own-key, so they reject before any network call and
 * are the right providers to assert a missing key with — no credentials needed, whatever
 * the server under test has configured.
 *
 * The conversation-bookkeeping tests at the bottom send no provider, so they take the
 * OpenRouter default and do reach the provider. Run them against the stub (see README ›
 * Testing); against a server holding a real key they bill a completion each.
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

  it.each(["openai", "anthropic"])(
    "400s for %s without the caller's own key, and charges no free message",
    async (provider) => {
      const { user, headers } = await createAuthedUser(`chat-byok-${provider}@example.com`);

      const response = await fetch(`${TEST_BASE_URL}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: "Hello there", provider }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).not.toContain("text/event-stream");
      expect(data.requiresApiKey).toBe(true);
      expect(String(data.error)).toMatch(/your own API key/i);

      // The free allowance is funded by the server's OpenRouter key alone, so a request
      // that could only ever fail must not cost one — nor leave a conversation behind.
      const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(dbUser?.freeMessagesUsed).toBe(0);
      expect(await prisma.conversation.findMany({ where: { userId: user.id } })).toHaveLength(0);
    },
  );

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
