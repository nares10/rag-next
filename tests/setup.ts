import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../lib/rag/embed";
import { hashPassword } from "../lib/password";
import { prisma } from "../lib/prisma";
import "dotenv";

export const TEST_BASE_URL = process.env.BASE_URL || "http://localhost:3000";

function assertTestDatabase() {
  // Check the URL the Prisma client actually connects with (see tests/preload.ts).
  const databaseUrl = process.env.DATABASE_URL;
  const databaseName = databaseUrl ? new URL(databaseUrl).pathname : "";

  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error(
      "Refusing to clean the database. DATABASE_URL must point to a database containing 'test'.",
    );
  }
}

export async function resetTestDatabase() {
  assertTestDatabase();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.chunk.deleteMany();
  await prisma.document.deleteMany();
  await prisma.collection.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

export async function createTestUser(email: string, name = "Test User") {
  return prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword("password123"),
    },
  });
}

export async function createSession(userId: string, expiresAt?: Date) {
  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt: expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  return session.id;
}

export async function createExpiredSession(userId: string) {
  return createSession(userId, new Date(Date.now() - 60 * 60 * 1000));
}

export function authHeaders(sessionId: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Cookie: `session_id=${sessionId}`,
  };
}

export async function createAuthedUser(email: string, name = "Test User") {
  const user = await createTestUser(email, name);
  const sessionId = await createSession(user.id);

  return { user, sessionId, headers: authHeaders(sessionId) };
}

export async function createTestConversation(
  userId: string,
  overrides: { title?: string; provider?: string; model?: string } = {},
) {
  return prisma.conversation.create({
    data: {
      userId,
      title: overrides.title ?? "Test conversation",
      provider: overrides.provider ?? "openai",
      model: overrides.model,
    },
  });
}

export async function createTestMessage(
  conversationId: string,
  overrides: { role?: string; content?: string } = {},
) {
  return prisma.message.create({
    data: {
      conversationId,
      role: overrides.role ?? "user",
      content: overrides.content ?? "Test message",
    },
  });
}

export async function createTestApiKey(
  userId: string,
  overrides: { key?: string; name?: string; provider?: string } = {},
) {
  return prisma.apiKey.create({
    data: {
      userId,
      key: overrides.key ?? `test-key-${crypto.randomUUID()}`,
      name: overrides.name ?? "Test key",
      provider: overrides.provider ?? "openai",
    },
  });
}

export async function setFreeMessagesUsed(userId: string, count: number) {
  return prisma.user.update({
    where: { id: userId },
    data: { freeMessagesUsed: count },
  });
}

export async function createTestCollection(
  userId: string,
  overrides: { name?: string; description?: string } = {},
) {
  return prisma.collection.create({
    data: {
      userId,
      name: overrides.name ?? "Test collection",
      description: overrides.description,
    },
  });
}

export async function createTestDocument(
  collection: { id: string; userId: string },
  overrides: {
    title?: string;
    status?: string;
    mimeType?: string;
    sourceType?: string;
    contentHash?: string;
    byteSize?: number;
  } = {},
) {
  return prisma.document.create({
    data: {
      collectionId: collection.id,
      userId: collection.userId,
      title: overrides.title ?? "Test document",
      sourceType: overrides.sourceType ?? "paste",
      mimeType: overrides.mimeType ?? "text/markdown",
      byteSize: overrides.byteSize ?? 128,
      contentHash: overrides.contentHash ?? crypto.randomUUID(),
      status: overrides.status ?? "ready",
    },
  });
}

/**
 * A 1536-dimension unit vector with a single non-zero axis. Two such vectors have cosine
 * similarity 1 when they share an axis and 0 when they don't, which makes expected
 * retrieval orderings exact instead of approximate.
 */
export function axisVector(axis: number, magnitude = 1): number[] {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
  vector[axis] = magnitude;

  return vector;
}

/** A vector that leans mostly on `axis` but is not identical to it, for ordering tests. */
export function blendedVector(axis: number, otherAxis: number, weight = 0.7): number[] {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
  vector[axis] = weight;
  vector[otherAxis] = 1 - weight;

  return vector;
}

export async function insertTestChunk(input: {
  documentId: string;
  collectionId: string;
  ordinal: number;
  content: string;
  embedding: number[];
  embeddingModel?: string;
  page?: number | null;
  heading?: string | null;
}) {
  const id = crypto.randomUUID();

  await prisma.$executeRaw`
    INSERT INTO "Chunk" ("id", "documentId", "collectionId", "ordinal", "content", "tokenCount",
                         "page", "heading", "embedding", "embeddingModel")
    VALUES (${id}, ${input.documentId}, ${input.collectionId}, ${input.ordinal}, ${input.content},
            ${Math.ceil(input.content.length / 4)}, ${input.page ?? null}, ${input.heading ?? null},
            ${JSON.stringify(input.embedding)}::vector, ${input.embeddingModel ?? EMBEDDING_MODEL})
  `;

  return id;
}

/** A fake embedder that answers with a fixed vector, whatever the query text. */
export function fixedEmbedder(vector: number[]) {
  return async (texts: string[]) => texts.map(() => vector);
}
