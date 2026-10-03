/**
 * Regenerate, model choice and the cited-passage lookup behind the chat UI. Needs the
 * stub provider and a dev server pointed at it (see README › Testing).
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "../../lib/prisma";
import { TEST_BASE_URL, createAuthedUser, resetTestDatabase } from "../setup";

const STUB_URL = process.env.STUB_PROVIDER_URL || "http://localhost:4010";

type SseFrame = Record<string, unknown>;

async function readFrames(response: Response): Promise<SseFrame[]> {
  const text = await response.text();

  return text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, "").trim())
    .filter((raw) => raw && raw !== "[DONE]")
    .map((raw) => JSON.parse(raw));
}

async function stubRequests(path: string) {
  const { received } = (await (await fetch(`${STUB_URL}/_requests`)).json()) as {
    received: Array<{ path: string; body: Record<string, unknown> }>;
  };

  return received.filter((entry) => entry.path === path);
}

const chat = (headers: HeadersInit, body: Record<string, unknown>) =>
  fetch(`${TEST_BASE_URL}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ provider: "openrouter", ...body }),
  });

describe("chat UI features", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await fetch(`${STUB_URL}/_reset`, { method: "POST" });
  });

  afterAll(async () => {
    await resetTestDatabase();
    await prisma.$disconnect();
  });

  it("ends the stream with the stored assistant message id", async () => {
    const { headers } = await createAuthedUser("chat-message-id@example.com");

    const frames = await readFrames(await chat(headers, { message: "Hello" }));
    const done = frames.find((frame) => frame.done === true);
    const stored = await prisma.message.findFirst({ where: { role: "assistant" } });

    expect(stored).not.toBeNull();
    expect(done?.messageId).toBe(stored!.id);
  });

  it("regenerate replaces the last exchange instead of appending to it", async () => {
    const { headers } = await createAuthedUser("chat-regenerate@example.com");

    const first = await readFrames(await chat(headers, { message: "Tell me a fact" }));
    const conversationId = first.find((frame) => frame.done)?.conversationId as string;
    const original = await prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });

    await readFrames(await chat(headers, { message: "Tell me a fact", conversationId, regenerate: true }));
    const after = await prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });

    expect(after.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(after.some((message) => original.some((old) => old.id === message.id))).toBe(false);

    // The replaced exchange is not sent to the model as history.
    const [, regenerateRequest] = await stubRequests("/v1/chat/completions");
    const sent = regenerateRequest.body.messages as Array<{ role: string; content: string }>;
    expect(sent.filter((message) => message.role !== "system")).toEqual([{ role: "user", content: "Tell me a fact" }]);
  });

  it("honours a known model only when the request carries the user's key", async () => {
    const { headers } = await createAuthedUser("chat-model@example.com");

    const free = await readFrames(await chat(headers, { message: "Hi", model: "openai/gpt-4o-mini" }));
    const freeConversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: free.find((frame) => frame.done)?.conversationId as string },
    });
    expect(freeConversation.model).toBeNull();

    const keyed = await readFrames(await chat(headers, { message: "Hi", model: "openai/gpt-4o-mini", apiKey: "stub-key" }));
    const keyedConversation = await prisma.conversation.findUniqueOrThrow({
      where: { id: keyed.find((frame) => frame.done)?.conversationId as string },
    });
    expect(keyedConversation.model).toBe("openai/gpt-4o-mini");

    const requests = await stubRequests("/v1/chat/completions");
    expect(requests.at(-1)?.body.model).toBe("openai/gpt-4o-mini");
  });

  it("ignores a model that is not in the catalogue", async () => {
    const { headers } = await createAuthedUser("chat-unknown-model@example.com");

    await readFrames(await chat(headers, { message: "Hi", model: "o9-ultra", apiKey: "stub-key" }));

    const requests = await stubRequests("/v1/chat/completions");
    expect(requests.at(-1)?.body.model).not.toBe("o9-ultra");
  });
});

describe("GET /api/rag/chunks", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await resetTestDatabase();
    await prisma.$disconnect();
  });

  async function seedChunks(email: string) {
    const { user, headers } = await createAuthedUser(email);
    const collection = await prisma.collection.create({ data: { userId: user.id, name: "Docs" } });
    const document = await prisma.document.create({
      data: {
        collectionId: collection.id,
        userId: user.id,
        title: "Pricing",
        sourceType: "paste",
        mimeType: "text/markdown",
        byteSize: 10,
        contentHash: `hash-${email}`,
        status: "ready",
      },
    });
    const chunks = await Promise.all(
      ["first", "second", "third"].map((content, ordinal) =>
        prisma.chunk.create({
          data: {
            documentId: document.id,
            collectionId: collection.id,
            ordinal,
            content,
            tokenCount: 1,
            page: 4,
            embeddingModel: "test",
          },
        }),
      ),
    );

    return { headers, chunks };
  }

  it("returns the passage with its neighbours", async () => {
    const { headers, chunks } = await seedChunks("chunks-owner@example.com");

    const response = await fetch(`${TEST_BASE_URL}/api/rag/chunks?ids=${chunks[1].id}`, { headers });
    expect(response.status).toBe(200);

    const { chunks: passages } = await response.json();
    expect(passages).toEqual([
      expect.objectContaining({ id: chunks[1].id, title: "Pricing", page: 4, content: "second", before: "first", after: "third" }),
    ]);
  });

  it("does not reveal another user's passages", async () => {
    const { chunks } = await seedChunks("chunks-victim@example.com");
    const { headers } = await createAuthedUser("chunks-intruder@example.com");

    const response = await fetch(`${TEST_BASE_URL}/api/rag/chunks?ids=${chunks[0].id}`, { headers });
    expect((await response.json()).chunks).toEqual([]);
  });

  it("400s without ids", async () => {
    const { headers } = await createAuthedUser("chunks-noids@example.com");

    const response = await fetch(`${TEST_BASE_URL}/api/rag/chunks`, { headers });
    expect(response.status).toBe(400);
  });
});
