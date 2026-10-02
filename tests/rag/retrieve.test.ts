import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "../../lib/prisma";
import { retrieveContext } from "../../lib/rag/retrieve";
import {
  axisVector,
  blendedVector,
  createAuthedUser,
  createTestCollection,
  createTestDocument,
  fixedEmbedder,
  insertTestChunk,
  resetTestDatabase,
} from "../setup";

const INVOICE_AXIS = 7;
const TRAVEL_AXIS = 99;

async function seedCollection(email: string) {
  const { user } = await createAuthedUser(email);
  const collection = await createTestCollection(user.id);
  const document = await createTestDocument(collection, { title: "Employee Handbook" });

  return { user, collection, document };
}

describe("retrieveContext", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await resetTestDatabase();
    await prisma.$disconnect();
  });

  it("embeds the question as a query, not as a passage", async () => {
    const { user, collection } = await seedCollection("retrieve-kind@example.com");
    const kinds: Array<string | undefined> = [];

    await retrieveContext({
      userId: user.id,
      collectionId: collection.id,
      query: "expense receipts",
      embed: async (texts, options) => {
        kinds.push(options?.kind);
        return texts.map(() => axisVector(INVOICE_AXIS));
      },
    });

    expect(kinds).toEqual(["query"]);
  });

  it("returns the nearest chunk first", async () => {
    const { user, collection, document } = await seedCollection("retrieve-order@example.com");

    await insertTestChunk({
      documentId: document.id,
      collectionId: collection.id,
      ordinal: 0,
      content: "Receipts must be filed within 30 days.",
      embedding: axisVector(INVOICE_AXIS),
    });
    await insertTestChunk({
      documentId: document.id,
      collectionId: collection.id,
      ordinal: 1,
      content: "Economy class is the default for short flights.",
      embedding: blendedVector(INVOICE_AXIS, TRAVEL_AXIS, 0.3),
    });

    const results = await retrieveContext({
      userId: user.id,
      collectionId: collection.id,
      query: "expense receipts",
      embed: fixedEmbedder(axisVector(INVOICE_AXIS)),
    });

    expect(results[0].content).toContain("Receipts must be filed");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("carries the document title, heading and page for citation display", async () => {
    const { user, collection, document } = await seedCollection("retrieve-citation@example.com");

    await insertTestChunk({
      documentId: document.id,
      collectionId: collection.id,
      ordinal: 0,
      content: "Receipts must be filed within 30 days.",
      embedding: axisVector(INVOICE_AXIS),
      heading: "Expenses",
      page: 4,
    });

    const [result] = await retrieveContext({
      userId: user.id,
      collectionId: collection.id,
      query: "receipts",
      embed: fixedEmbedder(axisVector(INVOICE_AXIS)),
    });

    expect(result.title).toBe("Employee Handbook");
    expect(result.heading).toBe("Expenses");
    expect(result.page).toBe(4);
    expect(result.documentId).toBe(document.id);
  });

  it("never returns chunks from another collection", async () => {
    const { user, collection } = await seedCollection("retrieve-scope@example.com");
    const other = await createTestCollection(user.id, { name: "Other" });
    const otherDocument = await createTestDocument(other);

    await insertTestChunk({
      documentId: otherDocument.id,
      collectionId: other.id,
      ordinal: 0,
      content: "Receipts must be filed within 30 days.",
      embedding: axisVector(INVOICE_AXIS),
    });

    const results = await retrieveContext({
      userId: user.id,
      collectionId: collection.id,
      query: "receipts",
      embed: fixedEmbedder(axisVector(INVOICE_AXIS)),
    });

    expect(results).toEqual([]);
  });

  it("never returns another user's chunks even when given their collection id", async () => {
    const owner = await seedCollection("retrieve-owner@example.com");
    const { user: attacker } = await createAuthedUser("retrieve-attacker@example.com");

    await insertTestChunk({
      documentId: owner.document.id,
      collectionId: owner.collection.id,
      ordinal: 0,
      content: "Salary bands for 2026.",
      embedding: axisVector(INVOICE_AXIS),
    });

    const results = await retrieveContext({
      userId: attacker.id,
      collectionId: owner.collection.id,
      query: "salary",
      embed: fixedEmbedder(axisVector(INVOICE_AXIS)),
    });

    expect(results).toEqual([]);
  });

  it("ignores chunks embedded with a different model", async () => {
    const { user, collection, document } = await seedCollection("retrieve-model@example.com");

    await insertTestChunk({
      documentId: document.id,
      collectionId: collection.id,
      ordinal: 0,
      content: "Receipts must be filed within 30 days.",
      embedding: axisVector(INVOICE_AXIS),
      embeddingModel: "text-embedding-ada-002",
    });

    const results = await retrieveContext({
      userId: user.id,
      collectionId: collection.id,
      query: "receipts",
      embed: fixedEmbedder(axisVector(INVOICE_AXIS)),
    });

    expect(results).toEqual([]);
  });

  it("ignores chunks belonging to a document that is not ready", async () => {
    const { user, collection } = await seedCollection("retrieve-pending@example.com");
    const pending = await createTestDocument(collection, { status: "processing" });

    await insertTestChunk({
      documentId: pending.id,
      collectionId: collection.id,
      ordinal: 0,
      content: "Receipts must be filed within 30 days.",
      embedding: axisVector(INVOICE_AXIS),
    });

    const results = await retrieveContext({
      userId: user.id,
      collectionId: collection.id,
      query: "receipts",
      embed: fixedEmbedder(axisVector(INVOICE_AXIS)),
    });

    expect(results).toEqual([]);
  });

  it("returns nothing for an empty collection", async () => {
    const { user, collection } = await seedCollection("retrieve-empty@example.com");

    const results = await retrieveContext({
      userId: user.id,
      collectionId: collection.id,
      query: "anything",
      embed: fixedEmbedder(axisVector(INVOICE_AXIS)),
    });

    expect(results).toEqual([]);
  });

  it("honours the requested result limit", async () => {
    const { user, collection, document } = await seedCollection("retrieve-limit@example.com");

    for (let i = 0; i < 5; i++) {
      await insertTestChunk({
        documentId: document.id,
        collectionId: collection.id,
        ordinal: i,
        content: `Passage ${i} about receipts and expenses.`,
        embedding: blendedVector(INVOICE_AXIS, TRAVEL_AXIS, 1 - i / 10),
      });
    }

    const results = await retrieveContext({
      userId: user.id,
      collectionId: collection.id,
      query: "receipts",
      embed: fixedEmbedder(axisVector(INVOICE_AXIS)),
      limit: 2,
    });

    expect(results).toHaveLength(2);
  });

  it("finds an exact term through the keyword leg when the vector is unrelated", async () => {
    const { user, collection, document } = await seedCollection("retrieve-keyword@example.com");

    await insertTestChunk({
      documentId: document.id,
      collectionId: collection.id,
      ordinal: 0,
      content: "The pgvector extension stores embeddings inside Postgres.",
      embedding: axisVector(TRAVEL_AXIS),
    });

    const results = await retrieveContext({
      userId: user.id,
      collectionId: collection.id,
      // Orthogonal to every stored vector, so the vector leg contributes nothing.
      embed: fixedEmbedder(axisVector(1200)),
      query: "pgvector",
    });

    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("pgvector");
  });

  it("drops vector matches below the similarity floor", async () => {
    const { user, collection, document } = await seedCollection("retrieve-floor@example.com");

    await insertTestChunk({
      documentId: document.id,
      collectionId: collection.id,
      ordinal: 0,
      content: "Entirely unrelated prose about gardening.",
      embedding: axisVector(TRAVEL_AXIS),
    });

    const results = await retrieveContext({
      userId: user.id,
      collectionId: collection.id,
      query: "quarterly revenue",
      embed: fixedEmbedder(axisVector(INVOICE_AXIS)),
    });

    expect(results).toEqual([]);
  });
});
