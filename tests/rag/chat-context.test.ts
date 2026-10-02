import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "../../lib/prisma";
import { buildChatContext } from "../../lib/rag/chat-context";
import {
  axisVector,
  createAuthedUser,
  createTestCollection,
  createTestDocument,
  insertTestChunk,
  resetTestDatabase,
} from "../setup";

const AXIS = 11;

function spyEmbedder(vector = axisVector(AXIS)) {
  const queries: string[] = [];
  const embed = async (texts: string[]) => {
    queries.push(...texts);
    return texts.map(() => vector);
  };

  return { queries, embed };
}

async function seeded(email: string) {
  const { user } = await createAuthedUser(email);
  const collection = await createTestCollection(user.id);
  const document = await createTestDocument(collection, { title: "Employee Handbook" });
  await insertTestChunk({
    documentId: document.id,
    collectionId: collection.id,
    ordinal: 0,
    content: "Receipts must be filed within 30 days.",
    embedding: axisVector(AXIS),
    heading: "Expenses",
  });

  return { user, collection, document };
}

describe("buildChatContext", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await resetTestDatabase();
    await prisma.$disconnect();
  });

  it("does not retrieve when the conversation has no collection", async () => {
    const { user } = await createAuthedUser("ctx-none@example.com");
    const { queries, embed } = spyEmbedder();

    const context = await buildChatContext({
      userId: user.id,
      collectionId: null,
      message: "What about expenses?",
      history: [],
      embed,
    });

    expect(context.retrieved).toBe(false);
    expect(context.citations).toEqual([]);
    expect(context.system).toBeNull();
    expect(queries).toHaveLength(0);
  });

  it("does not retrieve when the caller opts out for this message", async () => {
    const { user, collection } = await seeded("ctx-optout@example.com");
    const { queries, embed } = spyEmbedder();

    const context = await buildChatContext({
      userId: user.id,
      collectionId: collection.id,
      message: "Ignore my documents for this one",
      history: [],
      useRag: false,
      embed,
    });

    expect(context.retrieved).toBe(false);
    expect(queries).toHaveLength(0);
  });

  it("grounds the prompt in the retrieved passage and returns its citation", async () => {
    const { user, collection, document } = await seeded("ctx-grounded@example.com");
    const { embed } = spyEmbedder();

    const context = await buildChatContext({
      userId: user.id,
      collectionId: collection.id,
      message: "How long do I have to file receipts?",
      history: [],
      embed,
    });

    expect(context.grounded).toBe(true);
    expect(context.system).toContain("Receipts must be filed within 30 days.");
    expect(context.citations).toHaveLength(1);
    expect(context.citations[0]).toMatchObject({ n: 1, documentId: document.id, title: "Employee Handbook" });
  });

  it("asks the model to decline when the collection holds nothing relevant", async () => {
    const { user } = await createAuthedUser("ctx-nomatch@example.com");
    const collection = await createTestCollection(user.id);
    const { embed } = spyEmbedder();

    const context = await buildChatContext({
      userId: user.id,
      collectionId: collection.id,
      message: "What about expenses?",
      history: [],
      embed,
    });

    expect(context.retrieved).toBe(true);
    expect(context.grounded).toBe(false);
    expect(context.citations).toEqual([]);
    expect(context.system).toMatch(/do not know/i);
  });

  it("keeps the conversation's own system prompt when grounding", async () => {
    const { user, collection } = await seeded("ctx-base@example.com");
    const { embed } = spyEmbedder();

    const context = await buildChatContext({
      userId: user.id,
      collectionId: collection.id,
      message: "receipts",
      history: [],
      basePrompt: "You are a terse assistant.",
      embed,
    });

    expect(context.system?.startsWith("You are a terse assistant.")).toBe(true);
  });

  it("rewrites a follow-up question before embedding it", async () => {
    const { user, collection } = await seeded("ctx-rewrite@example.com");
    const { queries, embed } = spyEmbedder();

    await buildChatContext({
      userId: user.id,
      collectionId: collection.id,
      message: "What about travel?",
      history: [{ role: "user", content: "What does the handbook say about expenses?" }],
      embed,
      complete: async () => "What does the handbook say about travel?",
    });

    expect(queries).toEqual(["What does the handbook say about travel?"]);
  });

  it("answers ungrounded, and says so, when retrieval fails", async () => {
    const { user, collection } = await seeded("ctx-degraded@example.com");

    const context = await buildChatContext({
      userId: user.id,
      collectionId: collection.id,
      message: "receipts",
      history: [],
      embed: async () => {
        throw new Error("embedding provider down");
      },
    });

    expect(context.degraded).toBe(true);
    expect(context.grounded).toBe(false);
    expect(context.citations).toEqual([]);
    expect(context.system).toBeNull();
  });

  it("gives up on retrieval that overruns its deadline", async () => {
    const { user, collection } = await seeded("ctx-timeout@example.com");

    const context = await buildChatContext({
      userId: user.id,
      collectionId: collection.id,
      message: "receipts",
      history: [],
      timeoutMs: 10,
      embed: async (texts) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return texts.map(() => axisVector(AXIS));
      },
    });

    expect(context.degraded).toBe(true);
    expect(context.grounded).toBe(false);
  });

  it("retrieves nothing from a collection the caller does not own", async () => {
    const owner = await seeded("ctx-owner@example.com");
    const { user: attacker } = await createAuthedUser("ctx-attacker@example.com");
    const { embed } = spyEmbedder();

    const context = await buildChatContext({
      userId: attacker.id,
      collectionId: owner.collection.id,
      message: "receipts",
      history: [],
      embed,
    });

    expect(context.citations).toEqual([]);
    expect(context.grounded).toBe(false);
  });
});
