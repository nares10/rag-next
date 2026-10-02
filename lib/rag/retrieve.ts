import { Prisma } from "../../prisma/generated/client";
import { prisma as defaultPrisma } from "../prisma";
import { EMBEDDING_MODEL, type Embedder } from "./embed";
import { reciprocalRankFusion } from "./fuse";
import type { RetrievedChunk } from "./types";

/** How many candidates each leg contributes before fusion. */
export const CANDIDATE_LIMIT = 20;
/** How many chunks reach the prompt. */
export const RESULT_LIMIT = 6;
/**
 * Cosine similarity below which a vector match is treated as noise. Embeddings of
 * unrelated English prose still land around 0.1-0.2, so without a floor an empty-handed
 * query returns six irrelevant chunks and the model dutifully cites them.
 */
export const MIN_SIMILARITY = 0.25;

type PrismaLike = Pick<typeof defaultPrisma, "$queryRaw">;

export type RetrieveOptions = {
  userId: string;
  collectionId: string;
  query: string;
  embed: Embedder;
  limit?: number;
  candidateLimit?: number;
  minSimilarity?: number;
  embeddingModel?: string;
  prisma?: PrismaLike;
};

type Row = {
  id: string;
  documentId: string;
  title: string;
  heading: string | null;
  page: number | null;
  content: string;
  tokenCount: number;
};

export async function retrieveContext(options: RetrieveOptions): Promise<RetrievedChunk[]> {
  const {
    userId,
    collectionId,
    query,
    embed,
    limit = RESULT_LIMIT,
    candidateLimit = CANDIDATE_LIMIT,
    minSimilarity = MIN_SIMILARITY,
    embeddingModel = EMBEDDING_MODEL,
    prisma = defaultPrisma,
  } = options;

  const trimmedQuery = query.trim();

  if (!trimmedQuery) return [];

  // Embedded as a question, not as a passage: models with asymmetric retrieval training
  // place the two in different parts of the space.
  const [queryVector] = await embed([trimmedQuery], { kind: "query" });

  // Both legs are independent reads; running them together halves the retrieval latency
  // that sits in front of the user's first streamed token.
  const [vectorHits, keywordHits] = await Promise.all([
    vectorSearch({ prisma, userId, collectionId, queryVector, embeddingModel, minSimilarity, candidateLimit }),
    keywordSearch({ prisma, userId, collectionId, query: trimmedQuery, embeddingModel, candidateLimit }),
  ]);

  return reciprocalRankFusion([vectorHits, keywordHits])
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      documentId: row.documentId,
      title: row.title,
      heading: row.heading,
      page: row.page,
      content: row.content,
      tokenCount: Number(row.tokenCount),
      // The fused rank score, not a cosine similarity: the two legs are not on a
      // comparable scale, so only the ordering within one result set is meaningful.
      score: row.fusedScore,
    }));
}

/** Shared predicate: scope to the collection, its owner, ready documents and the live model. */
function scope(userId: string, collectionId: string, embeddingModel: string) {
  return Prisma.sql`
    c."collectionId" = ${collectionId}
    AND d."userId" = ${userId}
    AND d."status" = 'ready'
    AND c."embeddingModel" = ${embeddingModel}
  `;
}

async function vectorSearch(input: {
  prisma: PrismaLike;
  userId: string;
  collectionId: string;
  queryVector: number[];
  embeddingModel: string;
  minSimilarity: number;
  candidateLimit: number;
}): Promise<Row[]> {
  // pgvector has no Prisma type, so the vector is passed as a JSON array literal and cast
  // in SQL. `<=>` is cosine distance, hence the 1 - distance for similarity.
  const vector = JSON.stringify(input.queryVector);

  return input.prisma.$queryRaw<Row[]>`
    SELECT c."id", c."documentId", c."content", c."tokenCount", c."page", c."heading", d."title"
    FROM "Chunk" c
    JOIN "Document" d ON d."id" = c."documentId"
    WHERE ${scope(input.userId, input.collectionId, input.embeddingModel)}
      AND c."embedding" IS NOT NULL
      AND 1 - (c."embedding" <=> ${vector}::vector) >= ${input.minSimilarity}
    ORDER BY c."embedding" <=> ${vector}::vector
    LIMIT ${input.candidateLimit}
  `;
}

async function keywordSearch(input: {
  prisma: PrismaLike;
  userId: string;
  collectionId: string;
  query: string;
  embeddingModel: string;
  candidateLimit: number;
}): Promise<Row[]> {
  // websearch_to_tsquery never throws on user input (unlike to_tsquery), so a question
  // with quotes or operators in it degrades instead of erroring the whole request.
  return input.prisma.$queryRaw<Row[]>`
    SELECT c."id", c."documentId", c."content", c."tokenCount", c."page", c."heading", d."title"
    FROM "Chunk" c
    JOIN "Document" d ON d."id" = c."documentId",
         websearch_to_tsquery('english', ${input.query}) AS q
    WHERE ${scope(input.userId, input.collectionId, input.embeddingModel)}
      AND c."contentTsv" @@ q
    ORDER BY ts_rank_cd(c."contentTsv", q) DESC
    LIMIT ${input.candidateLimit}
  `;
}
