/**
 * These assume the server under test is pointed at scripts/stub-provider.ts via
 * OPENAI_BASE_URL (see README), so background processing really embeds and stores chunks
 * without calling a paid API.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "../../lib/prisma";
import {
  TEST_BASE_URL,
  axisVector,
  createAuthedUser,
  createTestCollection,
  createTestDocument,
  insertTestChunk,
  resetTestDatabase,
} from "../setup";

const url = (path = "") => `${TEST_BASE_URL}/api/rag/documents${path}`;

async function waitForTerminalStatus(documentId: string, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    const document = await prisma.document.findUnique({ where: { id: documentId } });

    if (document && document.status !== "pending" && document.status !== "processing") return document;

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return prisma.document.findUnique({ where: { id: documentId } });
}

describe("POST /api/rag/documents", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await resetTestDatabase();
    await prisma.$disconnect();
  });

  it("401s without a session", async () => {
    const response = await fetch(url(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collectionId: "x", text: "hello" }),
    });

    expect(response.status).toBe(401);
  });

  it("400s without a collectionId", async () => {
    const { headers } = await createAuthedUser("doc-no-coll@example.com");

    const response = await fetch(url(), { method: "POST", headers, body: JSON.stringify({ text: "hi" }) });

    expect(response.status).toBe(400);
  });

  it("404s for a collection owned by another user, creating nothing", async () => {
    const { user: owner } = await createAuthedUser("doc-victim@example.com");
    const { headers } = await createAuthedUser("doc-attacker@example.com");
    const collection = await createTestCollection(owner.id);

    const response = await fetch(url(), {
      method: "POST",
      headers,
      body: JSON.stringify({ collectionId: collection.id, text: "Injected content" }),
    });

    expect(response.status).toBe(404);
    expect(await prisma.document.count()).toBe(0);
  });

  it("400s on blank pasted text", async () => {
    const { user, headers } = await createAuthedUser("doc-blank@example.com");
    const collection = await createTestCollection(user.id);

    const response = await fetch(url(), {
      method: "POST",
      headers,
      body: JSON.stringify({ collectionId: collection.id, text: "   \n " }),
    });

    expect(response.status).toBe(400);
  });

  it("rejects a file source, pointing at the supported alternatives", async () => {
    const { user, headers } = await createAuthedUser("doc-file@example.com");
    const collection = await createTestCollection(user.id);

    const response = await fetch(url(), {
      method: "POST",
      headers,
      body: JSON.stringify({ collectionId: collection.id, sourceType: "file", text: "x" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toMatch(/paste|URL/i);
  });

  it("415s on a mime type it cannot read", async () => {
    const { user, headers } = await createAuthedUser("doc-mime@example.com");
    const collection = await createTestCollection(user.id);

    const response = await fetch(url(), {
      method: "POST",
      headers,
      body: JSON.stringify({ collectionId: collection.id, text: "%PDF", mimeType: "application/pdf" }),
    });

    expect(response.status).toBe(415);
  });

  it("400s on a sourceUri that is not an http url", async () => {
    const { user, headers } = await createAuthedUser("doc-url@example.com");
    const collection = await createTestCollection(user.id);

    const response = await fetch(url(), {
      method: "POST",
      headers,
      body: JSON.stringify({ collectionId: collection.id, sourceType: "url", sourceUri: "file:///etc/passwd" }),
    });

    expect(response.status).toBe(400);
  });

  it("400s on a sourceUri pointing at a private or internal address", async () => {
    const { user, headers } = await createAuthedUser("doc-ssrf@example.com");
    const collection = await createTestCollection(user.id);

    for (const sourceUri of [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:5432/",
      "http://localhost/admin",
    ]) {
      const response = await fetch(url(), {
        method: "POST",
        headers,
        body: JSON.stringify({ collectionId: collection.id, sourceType: "url", sourceUri }),
      });

      expect(response.status).toBe(400);
    }

    expect(await prisma.document.count()).toBe(0);
  });

  it("accepts a pasted document, returns it pending, and derives a title from the first line", async () => {
    const { user, headers } = await createAuthedUser("doc-accept@example.com");
    const collection = await createTestCollection(user.id);

    const response = await fetch(url(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        collectionId: collection.id,
        text: "# Employee Handbook\n\nReceipts must be filed within 30 days.",
      }),
    });
    const data = await response.json();

    expect(response.status).toBe(202);
    expect(data.document.status).toBe("pending");
    expect(data.document.title).toBe("Employee Handbook");
    expect(data.document.collectionId).toBe(collection.id);
    expect(data.document.userId).toBe(user.id);
  });

  it("processes the document in the background after responding", async () => {
    const { user, headers } = await createAuthedUser("doc-background@example.com");
    const collection = await createTestCollection(user.id);

    const response = await fetch(url(), {
      method: "POST",
      headers,
      body: JSON.stringify({ collectionId: collection.id, text: "Receipts must be filed within 30 days." }),
    });
    const { document } = await response.json();

    const processed = await waitForTerminalStatus(document.id);

    expect(processed?.status).toBe("ready");
    expect(processed?.chunkCount).toBeGreaterThan(0);
    expect(await prisma.chunk.count({ where: { documentId: document.id } })).toBe(processed?.chunkCount);
  });
});

describe("GET /api/rag/documents", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("401s without a session", async () => {
    expect((await fetch(url("?collectionId=x"))).status).toBe(401);
  });

  it("400s without a collectionId", async () => {
    const { headers } = await createAuthedUser("doc-list-no-coll@example.com");

    expect((await fetch(url(), { headers })).status).toBe(400);
  });

  it("404s for another user's collection", async () => {
    const { user: owner } = await createAuthedUser("doc-list-victim@example.com");
    const { headers } = await createAuthedUser("doc-list-attacker@example.com");
    const collection = await createTestCollection(owner.id);
    await createTestDocument(collection, { title: "Private" });

    const response = await fetch(url(`?collectionId=${collection.id}`), { headers });

    expect(response.status).toBe(404);
  });

  it("lists the collection's documents, newest first", async () => {
    const { user, headers } = await createAuthedUser("doc-list@example.com");
    const collection = await createTestCollection(user.id);
    await createTestDocument(collection, { title: "Older" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createTestDocument(collection, { title: "Newer" });

    const response = await fetch(url(`?collectionId=${collection.id}`), { headers });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.documents.map((d: { title: string }) => d.title)).toEqual(["Newer", "Older"]);
  });
});

describe("GET and DELETE /api/rag/documents/[id]", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("reports the processing status of the caller's document", async () => {
    const { user, headers } = await createAuthedUser("doc-status@example.com");
    const collection = await createTestCollection(user.id);
    const document = await createTestDocument(collection, { status: "processing" });

    const response = await fetch(url(`/${document.id}`), { headers });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.document.status).toBe("processing");
  });

  it("404s for another user's document", async () => {
    const { user: owner } = await createAuthedUser("doc-get-victim@example.com");
    const { headers } = await createAuthedUser("doc-get-attacker@example.com");
    const collection = await createTestCollection(owner.id);
    const document = await createTestDocument(collection);

    expect((await fetch(url(`/${document.id}`), { headers })).status).toBe(404);
  });

  it("deletes the document and its chunks", async () => {
    const { user, headers } = await createAuthedUser("doc-delete@example.com");
    const collection = await createTestCollection(user.id);
    const document = await createTestDocument(collection);
    await insertTestChunk({
      documentId: document.id,
      collectionId: collection.id,
      ordinal: 0,
      content: "Receipts must be filed within 30 days.",
      embedding: axisVector(3),
    });

    const response = await fetch(url(`/${document.id}`), { method: "DELETE", headers });

    expect(response.status).toBe(200);
    expect(await prisma.document.findUnique({ where: { id: document.id } })).toBeNull();
    expect(await prisma.chunk.count({ where: { documentId: document.id } })).toBe(0);
  });

  it("404s when deleting another user's document, leaving it in place", async () => {
    const { user: owner } = await createAuthedUser("doc-del-victim@example.com");
    const { headers } = await createAuthedUser("doc-del-attacker@example.com");
    const collection = await createTestCollection(owner.id);
    const document = await createTestDocument(collection);

    const response = await fetch(url(`/${document.id}`), { method: "DELETE", headers });

    expect(response.status).toBe(404);
    expect(await prisma.document.findUnique({ where: { id: document.id } })).not.toBeNull();
  });
});

describe("POST /api/rag/documents/[id]/process", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("401s without a session or secret", async () => {
    const response = await fetch(url("/some-id/process"), { method: "POST" });

    expect(response.status).toBe(401);
  });

  it("404s for another user's document", async () => {
    const { user: owner } = await createAuthedUser("proc-victim@example.com");
    const { headers } = await createAuthedUser("proc-attacker@example.com");
    const collection = await createTestCollection(owner.id);
    const document = await createTestDocument(collection, { status: "failed" });

    const response = await fetch(url(`/${document.id}/process`), { method: "POST", headers });

    expect(response.status).toBe(404);
  });

  it("refuses to reprocess a pasted document, whose text was never stored", async () => {
    const { user, headers } = await createAuthedUser("proc-paste@example.com");
    const collection = await createTestCollection(user.id);
    const document = await createTestDocument(collection, { status: "failed", sourceType: "paste" });

    const response = await fetch(url(`/${document.id}/process`), { method: "POST", headers });
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.error).toMatch(/paste/i);
  });

  it("gives a pasted document stuck in pending a terminal status, so polling stops", async () => {
    const { user, headers } = await createAuthedUser("proc-stuck@example.com");
    const collection = await createTestCollection(user.id);
    const document = await createTestDocument(collection, { status: "pending", sourceType: "paste" });

    const response = await fetch(url(`/${document.id}/process`), { method: "POST", headers });

    expect(response.status).toBe(409);
    const stored = await prisma.document.findUnique({ where: { id: document.id } });
    expect(stored?.status).toBe("failed");
    expect(stored?.error).toMatch(/paste/i);
  });
});
