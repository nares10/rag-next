import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "../../lib/prisma";
import { EMBEDDING_MODEL } from "../../lib/rag/embed";
import { ingestDocument } from "../../lib/rag/ingest";
import {
  axisVector,
  createAuthedUser,
  createTestCollection,
  createTestDocument,
  insertTestChunk,
  resetTestDatabase,
} from "../setup";

const HANDBOOK = [
  "## Expenses",
  "",
  `Receipts must be filed within 30 days. ${"expense detail ".repeat(60)}`,
  "",
  "## Travel",
  "",
  `Economy class is the default for flights under six hours. ${"travel detail ".repeat(60)}`,
].join("\n");

// Resolving example.com for real would make the URL tests depend on DNS.
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

function spyEmbedder() {
  const seen: string[] = [];
  const embed = async (texts: string[]) => {
    seen.push(...texts);
    return texts.map((_, i) => axisVector(i % 1536));
  };

  return { seen, embed };
}

async function pendingDocument(email: string, overrides = {}) {
  const { user } = await createAuthedUser(email);
  const collection = await createTestCollection(user.id);
  const document = await createTestDocument(collection, {
    title: "Employee Handbook",
    status: "pending",
    ...overrides,
  });

  return { user, collection, document };
}

describe("ingestDocument", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await resetTestDatabase();
    await prisma.$disconnect();
  });

  it("chunks, embeds and stores the document, then marks it ready", async () => {
    const { document } = await pendingDocument("ingest-happy@example.com");
    const { embed } = spyEmbedder();

    const result = await ingestDocument({ documentId: document.id, raw: HANDBOOK, embed });

    expect(result.status).toBe("ready");
    expect(result.chunkCount).toBeGreaterThan(0);

    const stored = await prisma.document.findUnique({ where: { id: document.id } });
    expect(stored?.status).toBe("ready");
    expect(stored?.chunkCount).toBe(result.chunkCount);
    expect(stored?.error).toBeNull();

    const chunks = await prisma.chunk.findMany({
      where: { documentId: document.id },
      orderBy: { ordinal: "asc" },
    });
    expect(chunks).toHaveLength(result.chunkCount);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
    expect(chunks[0].collectionId).toBe(document.collectionId);
    expect(chunks[0].embeddingModel).toBe(EMBEDDING_MODEL);
    expect(chunks[0].heading).toBe("Expenses");
  });

  it("writes a vector for every chunk", async () => {
    const { document } = await pendingDocument("ingest-vectors@example.com");
    const { embed } = spyEmbedder();

    await ingestDocument({ documentId: document.id, raw: HANDBOOK, embed });

    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM "Chunk"
      WHERE "documentId" = ${document.id} AND "embedding" IS NOT NULL
    `;
    const stored = await prisma.document.findUnique({ where: { id: document.id } });

    expect(Number(count)).toBe(stored?.chunkCount);
  });

  it("gives the embedding model the document title and heading as context", async () => {
    const { document } = await pendingDocument("ingest-prefix@example.com");
    const { seen, embed } = spyEmbedder();

    await ingestDocument({ documentId: document.id, raw: HANDBOOK, embed });

    expect(seen[0]).toContain("Employee Handbook");
    expect(seen[0]).toContain("Expenses");
    // The stored content stays clean so citations show the passage, not the breadcrumb.
    const chunk = await prisma.chunk.findFirst({ where: { documentId: document.id, ordinal: 0 } });
    expect(chunk?.content.startsWith("Employee Handbook")).toBe(false);
  });

  it("records the content hash so an identical re-upload can be detected", async () => {
    const { document } = await pendingDocument("ingest-hash@example.com");
    const { embed } = spyEmbedder();

    await ingestDocument({ documentId: document.id, raw: HANDBOOK, embed });

    const stored = await prisma.document.findUnique({ where: { id: document.id } });
    expect(stored?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports a duplicate instead of embedding the same text twice in one collection", async () => {
    const { collection, document } = await pendingDocument("ingest-dupe@example.com");
    const { embed } = spyEmbedder();
    await ingestDocument({ documentId: document.id, raw: HANDBOOK, embed });

    const second = await createTestDocument(collection, { title: "Handbook copy", status: "pending" });
    const spy = spyEmbedder();

    const result = await ingestDocument({ documentId: second.id, raw: HANDBOOK, embed: spy.embed });

    expect(result.status).toBe("duplicate");
    expect(result.duplicateOf).toBe(document.id);
    expect(spy.seen).toHaveLength(0);
    expect(await prisma.chunk.count({ where: { documentId: second.id } })).toBe(0);
  });

  it("allows the same text in a different collection", async () => {
    const { user, document } = await pendingDocument("ingest-dupe-scope@example.com");
    const { embed } = spyEmbedder();
    await ingestDocument({ documentId: document.id, raw: HANDBOOK, embed });

    const otherCollection = await createTestCollection(user.id, { name: "Other" });
    const other = await createTestDocument(otherCollection, { status: "pending" });

    const result = await ingestDocument({ documentId: other.id, raw: HANDBOOK, embed });

    expect(result.status).toBe("ready");
  });

  it("fails the document when the source has no readable text", async () => {
    const { document } = await pendingDocument("ingest-empty@example.com");
    const { embed } = spyEmbedder();

    const result = await ingestDocument({ documentId: document.id, raw: "   \n\n ", embed });

    expect(result.status).toBe("failed");
    const stored = await prisma.document.findUnique({ where: { id: document.id } });
    expect(stored?.status).toBe("failed");
    expect(stored?.error).toMatch(/no (readable )?text/i);
  });

  it("fails the document for a source type it cannot read, without throwing", async () => {
    const { document } = await pendingDocument("ingest-pdf@example.com", { mimeType: "application/pdf" });
    const { embed } = spyEmbedder();

    const result = await ingestDocument({ documentId: document.id, raw: "%PDF-1.4", embed });

    expect(result.status).toBe("failed");
    const stored = await prisma.document.findUnique({ where: { id: document.id } });
    expect(stored?.error).toMatch(/application\/pdf/);
  });

  it("leaves no partial chunks behind when embedding fails", async () => {
    const { document } = await pendingDocument("ingest-embed-fail@example.com");
    const embed = async () => {
      throw new Error("provider is down");
    };

    const result = await ingestDocument({ documentId: document.id, raw: HANDBOOK, embed });

    expect(result.status).toBe("failed");
    const stored = await prisma.document.findUnique({ where: { id: document.id } });
    expect(stored?.error).toMatch(/provider is down/);
    expect(stored?.chunkCount).toBe(0);
    expect(await prisma.chunk.count({ where: { documentId: document.id } })).toBe(0);
  });

  it("replaces chunks left by an interrupted earlier run instead of colliding with them", async () => {
    const { collection, document } = await pendingDocument("ingest-resume@example.com");
    await insertTestChunk({
      documentId: document.id,
      collectionId: collection.id,
      ordinal: 0,
      content: "Stale content from an interrupted run.",
      embedding: axisVector(5),
    });
    const { embed } = spyEmbedder();

    const result = await ingestDocument({ documentId: document.id, raw: HANDBOOK, embed });

    expect(result.status).toBe("ready");
    const chunks = await prisma.chunk.findMany({ where: { documentId: document.id } });
    expect(chunks).toHaveLength(result.chunkCount);
    expect(chunks.some((c) => c.content.includes("Stale content"))).toBe(false);
  });

  it("refuses a document that would exceed the chunk ceiling", async () => {
    const { document } = await pendingDocument("ingest-ceiling@example.com");
    const { embed } = spyEmbedder();

    const result = await ingestDocument({
      documentId: document.id,
      raw: HANDBOOK,
      embed,
      maxChunks: 1,
    });

    expect(result.status).toBe("failed");
    const stored = await prisma.document.findUnique({ where: { id: document.id } });
    expect(stored?.error).toMatch(/too large|chunk/i);
  });

  it("stores a document that spans several write batches", async () => {
    const { document } = await pendingDocument("ingest-batches@example.com");
    const { embed } = spyEmbedder();
    // 120 sections at ~40 tokens each: more than the 50-chunk write batch, so the
    // batching loop and its ordinal bookkeeping are exercised.
    const long = Array.from(
      { length: 120 },
      (_, i) => `## Section ${i}\n\nParagraph ${i} about policy ${i}. ${"detail ".repeat(20)}`,
    ).join("\n\n");

    const result = await ingestDocument({ documentId: document.id, raw: long, embed });

    expect(result.status).toBe("ready");
    expect(result.chunkCount).toBeGreaterThan(50);

    const chunks = await prisma.chunk.findMany({
      where: { documentId: document.id },
      orderBy: { ordinal: "asc" },
    });
    expect(chunks).toHaveLength(result.chunkCount);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
    expect(new Set(chunks.map((c) => c.heading)).size).toBe(120);

    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM "Chunk"
      WHERE "documentId" = ${document.id} AND "embedding" IS NOT NULL
    `;
    expect(Number(count)).toBe(result.chunkCount);
  });

  it("is a no-op for a document that is already ready", async () => {
    const { document } = await pendingDocument("ingest-idempotent@example.com");
    const first = spyEmbedder();
    await ingestDocument({ documentId: document.id, raw: HANDBOOK, embed: first.embed });

    const second = spyEmbedder();
    const result = await ingestDocument({ documentId: document.id, raw: HANDBOOK, embed: second.embed });

    expect(result.status).toBe("ready");
    expect(second.seen).toHaveLength(0);
  });

  it("fetches the source itself for a url document", async () => {
    const { collection } = await pendingDocument("ingest-url@example.com");
    const urlDocument = await prisma.document.create({
      data: {
        collectionId: collection.id,
        userId: collection.userId,
        title: "Docs page",
        sourceType: "url",
        sourceUri: "https://example.com/handbook",
        mimeType: "text/html",
        byteSize: 0,
        contentHash: crypto.randomUUID(),
        status: "pending",
      },
    });
    const { embed } = spyEmbedder();
    const fetchImpl = async () =>
      new Response("<h2>Expenses</h2><p>Receipts must be filed within 30 days.</p>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });

    const result = await ingestDocument({
      documentId: urlDocument.id,
      embed,
      lookup: publicLookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.status).toBe("ready");
    const chunk = await prisma.chunk.findFirst({ where: { documentId: urlDocument.id } });
    expect(chunk?.content).toContain("Receipts must be filed");
  });

  it("fails cleanly when the document no longer exists", async () => {
    const { embed } = spyEmbedder();

    const result = await ingestDocument({ documentId: crypto.randomUUID(), raw: HANDBOOK, embed });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/not found/i);
  });
});

describe("ingestDocument from a URL", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function urlDocument(email: string, sourceUri: string, mimeType = "text/html") {
    const { user } = await createAuthedUser(email);
    const collection = await createTestCollection(user.id);

    return prisma.document.create({
      data: {
        collectionId: collection.id,
        userId: user.id,
        title: "Fetched page",
        sourceType: "url",
        sourceUri,
        mimeType,
        byteSize: 0,
        contentHash: crypto.randomUUID(),
        status: "pending",
      },
    });
  }

  it("refuses to fetch a private address", async () => {
    const document = await urlDocument("ingest-ssrf@example.com", "http://169.254.169.254/latest/meta-data/");
    const { embed } = spyEmbedder();
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return new Response("secrets", { status: 200 });
    };

    const result = await ingestDocument({
      documentId: document.id,
      embed,
      lookup: publicLookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(called).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/private|internal/i);
  });

  it("refuses a redirect that lands on a private address", async () => {
    const document = await urlDocument("ingest-ssrf-redirect@example.com", "https://example.com/start");
    const { embed } = spyEmbedder();
    const seen: string[] = [];
    const fetchImpl = async (input: string | URL) => {
      seen.push(String(input));
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:5432/" } });
    };

    const result = await ingestDocument({
      documentId: document.id,
      embed,
      lookup: publicLookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(seen).toHaveLength(1);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/private|internal/i);
  });

  it("abandons a response that exceeds the size limit while it streams", async () => {
    const document = await urlDocument("ingest-huge@example.com", "https://example.com/huge");
    const { embed } = spyEmbedder();
    let chunksServed = 0;
    const fetchImpl = async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            chunksServed += 1;
            controller.enqueue(new Uint8Array(1024 * 1024));
          },
        }),
        { status: 200, headers: { "Content-Type": "text/plain" } },
      );

    const result = await ingestDocument({
      documentId: document.id,
      embed,
      lookup: publicLookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/20 MB/);
    // Stopped mid-stream rather than buffering an unbounded body.
    expect(chunksServed).toBeLessThan(30);
  });

  it("rejects a response whose declared content-length exceeds the limit", async () => {
    const document = await urlDocument("ingest-huge-declared@example.com", "https://example.com/huge");
    const { embed } = spyEmbedder();
    // A tiny body, so only the declared length can be what rejects it.
    const fetchImpl = async () =>
      new Response("small", {
        status: 200,
        headers: { "Content-Type": "text/plain", "Content-Length": String(50 * 1024 * 1024) },
      });

    const result = await ingestDocument({
      documentId: document.id,
      embed,
      lookup: publicLookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/20 MB/);
  });

  it("extracts using the content type the server actually returned", async () => {
    // Submitted as text/html (the default for a URL), but served as plain text: the
    // angle-bracketed term must survive instead of being stripped as a tag.
    const document = await urlDocument("ingest-ctype@example.com", "https://example.com/notes.txt");
    const { embed } = spyEmbedder();
    const fetchImpl = async () =>
      new Response("Use <placeholder> for the customer name in every invoice template.", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });

    const result = await ingestDocument({
      documentId: document.id,
      embed,
      lookup: publicLookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.status).toBe("ready");
    const chunk = await prisma.chunk.findFirst({ where: { documentId: document.id } });
    expect(chunk?.content).toContain("<placeholder>");
  });

  it("fails a fetched document whose content type cannot be read", async () => {
    const document = await urlDocument("ingest-ctype-bad@example.com", "https://example.com/report.pdf");
    const { embed } = spyEmbedder();
    const fetchImpl = async () =>
      new Response("%PDF-1.4 binary", { status: 200, headers: { "Content-Type": "application/pdf" } });

    const result = await ingestDocument({
      documentId: document.id,
      embed,
      lookup: publicLookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/application\/pdf/);
  });
});
