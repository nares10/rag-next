/**
 * End-to-end RAG chat, against scripts/stub-provider.ts (see README): the document is
 * ingested through the API, embedded by the stub, retrieved by the real pipeline, and the
 * stub's request log is used to assert what actually reached the provider.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "../../lib/prisma";
import { TEST_BASE_URL, createAuthedUser, resetTestDatabase } from "../setup";

const STUB_URL = process.env.STUB_PROVIDER_URL || "http://localhost:4010";

const HANDBOOK = [
  "## Expenses",
  "",
  "Receipts must be filed within 30 days of the purchase date.",
  "",
  "## Travel",
  "",
  "Economy class is the default for flights under six hours.",
].join("\n");

// Tests that make several round trips through the app and the stub (ingest, then more
// than one chat or a rewrite) outgrow bun's 5s default.
const MULTI_TURN_TIMEOUT_MS = 20_000;

type SseFrame = Record<string, unknown>;

async function readFrames(response: Response): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  const text = await response.text();

  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;

    const raw = line.replace(/^data:\s*/, "").trim();

    if (!raw || raw === "[DONE]") continue;

    frames.push(JSON.parse(raw));
  }

  return frames;
}

async function stubRequests(path: string) {
  const { received } = (await (await fetch(`${STUB_URL}/_requests`)).json()) as {
    received: Array<{ path: string; body: Record<string, unknown> }>;
  };

  return received.filter((entry) => entry.path === path);
}

async function readyCollectionWith(email: string, text: string) {
  const { user, headers } = await createAuthedUser(email);

  const collectionResponse = await fetch(`${TEST_BASE_URL}/api/rag/collections`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Handbook" }),
  });
  const { collection } = await collectionResponse.json();

  const documentResponse = await fetch(`${TEST_BASE_URL}/api/rag/documents`, {
    method: "POST",
    headers,
    body: JSON.stringify({ collectionId: collection.id, title: "Employee Handbook", text }),
  });
  const { document } = await documentResponse.json();

  for (let i = 0; i < 50; i++) {
    const stored = await prisma.document.findUnique({ where: { id: document.id } });

    if (stored?.status === "ready") return { user, headers, collection, document: stored };
    if (stored?.status === "failed") throw new Error(`ingestion failed: ${stored.error}`);

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("document never became ready");
}

describe("POST /api/chat with a collection attached", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await fetch(`${STUB_URL}/_reset`, { method: "POST" });
  });

  afterAll(async () => {
    await resetTestDatabase();
    await prisma.$disconnect();
  });

  it("streams the citations before any answer text", async () => {
    const { headers, collection } = await readyCollectionWith("rag-chat-sources@example.com", HANDBOOK);

    const response = await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: "How long do I have to file receipts?",
        provider: "openrouter",
        collectionId: collection.id,
      }),
    });
    const frames = await readFrames(response);

    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const sourcesIndex = frames.findIndex((frame) => "sources" in frame);
    const firstTextIndex = frames.findIndex((frame) => "text" in frame);

    expect(sourcesIndex).toBe(0);
    expect(sourcesIndex).toBeLessThan(firstTextIndex);

    const sources = frames[sourcesIndex].sources as Array<Record<string, unknown>>;
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0]).toMatchObject({ n: 1, title: "Employee Handbook" });
    expect(frames[sourcesIndex].grounded).toBe(true);
  });

  it("puts the retrieved passage in the system prompt sent to the provider", async () => {
    const { headers, collection } = await readyCollectionWith("rag-chat-upstream@example.com", HANDBOOK);

    await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: "How long do I have to file receipts?",
        provider: "openrouter",
        collectionId: collection.id,
      }),
    });

    const [completion] = await stubRequests("/v1/chat/completions");
    const messages = completion.body.messages as Array<{ role: string; content: string }>;

    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Receipts must be filed within 30 days");
    expect(messages[0].content).toMatch(/cite/i);
    expect(messages.at(-1)).toMatchObject({ role: "user", content: "How long do I have to file receipts?" });
  });

  it("persists the citations alongside the assistant message", async () => {
    const { user, headers, collection } = await readyCollectionWith("rag-chat-persist@example.com", HANDBOOK);

    // The messages are written when the stream ends, so it has to be drained first.
    await readFrames(
      await fetch(`${TEST_BASE_URL}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: "How long do I have to file receipts?",
          provider: "openrouter",
          collectionId: collection.id,
        }),
      }),
    );

    const conversation = await prisma.conversation.findFirst({ where: { userId: user.id } });
    const assistant = await prisma.message.findFirst({
      where: { conversationId: conversation!.id, role: "assistant" },
    });

    expect(conversation?.collectionId).toBe(collection.id);
    expect(Array.isArray(assistant?.citations)).toBe(true);
    expect((assistant?.citations as unknown[]).length).toBeGreaterThan(0);
  });

  it("skips retrieval entirely when the caller opts out", async () => {
    const { headers, collection } = await readyCollectionWith("rag-chat-optout@example.com", HANDBOOK);
    await fetch(`${STUB_URL}/_reset`, { method: "POST" });

    const response = await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: "How long do I have to file receipts?",
        provider: "openrouter",
        collectionId: collection.id,
        useRag: false,
      }),
    });
    const frames = await readFrames(response);

    expect(frames.some((frame) => "sources" in frame)).toBe(false);
    expect(await stubRequests("/v1/embeddings")).toHaveLength(0);

    const [completion] = await stubRequests("/v1/chat/completions");
    const messages = completion.body.messages as Array<{ role: string }>;
    expect(messages.some((m) => m.role === "system")).toBe(false);
  });

  it("tells the model to decline when the collection has nothing relevant", async () => {
    const { headers, collection } = await readyCollectionWith(
      "rag-chat-nomatch@example.com",
      "## Gardening\n\nTomatoes need full sun and regular watering.",
    );

    const response = await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: "What is our quarterly revenue forecast?",
        provider: "openrouter",
        collectionId: collection.id,
      }),
    });
    const frames = await readFrames(response);
    const sourcesFrame = frames.find((frame) => "sources" in frame);

    expect(sourcesFrame?.grounded).toBe(false);
    expect(sourcesFrame?.sources).toEqual([]);

    const [completion] = await stubRequests("/v1/chat/completions");
    const messages = completion.body.messages as Array<{ role: string; content: string }>;
    expect(messages[0].content).toMatch(/do not know/i);
  });

  it("sends no context frame at all for a conversation with no collection", async () => {
    const { headers } = await createAuthedUser("rag-chat-plain@example.com");

    const response = await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "Hello", provider: "openrouter" }),
    });
    const frames = await readFrames(response);

    expect(frames.some((frame) => "sources" in frame)).toBe(false);
    expect(frames.some((frame) => "text" in frame)).toBe(true);
  });

  it("rewrites a follow-up question before retrieving for it", async () => {
    const { headers, collection } = await readyCollectionWith("rag-chat-rewrite@example.com", HANDBOOK);

    const first = await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: "What does the handbook say about expenses?",
        provider: "openrouter",
        collectionId: collection.id,
      }),
    });
    const firstFrames = await readFrames(first);
    const conversationId = firstFrames.find((frame) => "conversationId" in frame)?.conversationId;
    await fetch(`${STUB_URL}/_reset`, { method: "POST" });

    await readFrames(
      await fetch(`${TEST_BASE_URL}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message: "And what about travel?",
          provider: "openrouter",
          conversationId,
          collectionId: collection.id,
        }),
      }),
    );

    // One non-streaming completion for the rewrite, then the streamed answer.
    const completions = await stubRequests("/v1/chat/completions");
    const rewrite = completions.find((entry) => entry.body.stream !== true);
    const rewritePrompt = (rewrite?.body.messages as Array<{ content: string }>)[0].content;

    expect(rewrite).toBeDefined();
    expect(rewritePrompt).toContain("What does the handbook say about expenses?");
    expect(rewritePrompt).toContain("And what about travel?");

    // ...and the query that was embedded is the rewrite's output, not the raw message.
    const [embedding] = await stubRequests("/v1/embeddings");
    expect(embedding.body.input).toEqual(["And what about travel?"]);
  }, MULTI_TURN_TIMEOUT_MS);

  it("sends the most recent turns to the provider, not the first ten", async () => {
    const { user, headers, collection } = await readyCollectionWith("rag-chat-window@example.com", HANDBOOK);
    const conversation = await prisma.conversation.create({
      data: { userId: user.id, title: "Long one", provider: "openrouter", collectionId: collection.id },
    });

    // Twelve stored turns: anything that takes the oldest ten never sees the last two.
    for (let i = 0; i < 12; i++) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `turn number ${i}`,
          createdAt: new Date(Date.now() - (12 - i) * 60_000),
        },
      });
    }
    await fetch(`${STUB_URL}/_reset`, { method: "POST" });

    await readFrames(
      await fetch(`${TEST_BASE_URL}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: "and finally?", provider: "openrouter", conversationId: conversation.id }),
      }),
    );

    const completion = (await stubRequests("/v1/chat/completions")).find(
      (entry) => entry.body.stream === true,
    );
    const contents = (completion!.body.messages as Array<{ content: string }>).map((m) => m.content);

    expect(contents.some((c) => c.includes("turn number 11"))).toBe(true);
    expect(contents.some((c) => c.includes("turn number 0"))).toBe(false);
  }, MULTI_TURN_TIMEOUT_MS);

  it("ignores a collection id belonging to another user", async () => {
    const owner = await readyCollectionWith("rag-chat-owner@example.com", HANDBOOK);
    const { headers: attacker } = await createAuthedUser("rag-chat-attacker@example.com");
    await fetch(`${STUB_URL}/_reset`, { method: "POST" });

    const response = await fetch(`${TEST_BASE_URL}/api/chat`, {
      method: "POST",
      headers: attacker,
      body: JSON.stringify({
        message: "How long do I have to file receipts?",
        provider: "openrouter",
        collectionId: owner.collection.id,
      }),
    });
    const frames = await readFrames(response);

    expect(frames.some((frame) => "sources" in frame)).toBe(false);

    const [completion] = await stubRequests("/v1/chat/completions");
    const messages = completion.body.messages as Array<{ role: string; content: string }>;
    expect(messages.some((m) => m.content.includes("Receipts must be filed"))).toBe(false);
  });
});
