import { createHash } from "node:crypto";
import { prisma as defaultPrisma } from "../prisma";
import { CHUNK_DEFAULTS, type ChunkDraft, type ChunkOptions, chunkText } from "./chunk";
import { EMBEDDING_MODEL, type Embedder } from "./embed";
import { UnsupportedSourceError, extractText } from "./extract";
import { UnsafeUrlError, assertFetchableUrl, type Lookup } from "./url-guard";

/** Per-document ceiling. A runaway source would otherwise burn the user's whole quota. */
export const MAX_CHUNKS_PER_DOCUMENT = 2000;
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
/** Chunks written per statement. Small enough to keep each parameter list sane. */
const UPSERT_BATCH = 50;
const URL_FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

export type IngestStatus = "ready" | "failed" | "duplicate";

export type IngestResult = {
  status: IngestStatus;
  chunkCount: number;
  error?: string;
  duplicateOf?: string;
};

export type IngestOptions = {
  documentId: string;
  /** Source text for pasted documents. URL documents are fetched from `sourceUri` instead. */
  raw?: string;
  embed: Embedder;
  embeddingModel?: string;
  chunkOptions?: ChunkOptions;
  maxChunks?: number;
  fetchImpl?: typeof fetch;
  /** DNS resolver used by the URL safety check; injected by tests. */
  lookup?: Lookup;
  prisma?: typeof defaultPrisma;
};

class IngestError extends Error {}

/**
 * Runs a pending document through the whole write path: extract, normalize, hash, dedupe,
 * chunk, embed, store.
 *
 * Never throws for a bad document — a source this build cannot read, an empty file or a
 * provider outage all end as `status: "failed"` with a message the user can act on, so a
 * caller processing a batch is not derailed by one broken file.
 */
export async function ingestDocument(options: IngestOptions): Promise<IngestResult> {
  const {
    documentId,
    raw,
    embed,
    embeddingModel = EMBEDDING_MODEL,
    chunkOptions,
    maxChunks = MAX_CHUNKS_PER_DOCUMENT,
    fetchImpl = fetch,
    lookup,
    prisma = defaultPrisma,
  } = options;

  const document = await prisma.document.findUnique({ where: { id: documentId } });

  if (!document) {
    return { status: "failed", chunkCount: 0, error: "Document not found." };
  }

  // Already finished. Re-running would re-embed identical text for nothing.
  if (document.status === "ready") {
    return { status: "ready", chunkCount: document.chunkCount };
  }

  try {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "processing", error: null },
    });

    const fetched = raw === undefined ? await fetchSource(document, fetchImpl, lookup) : null;
    const source = raw ?? fetched!.body;
    // For a fetched URL the server's own Content-Type beats the one guessed at submission
    // time: a .txt or .md page run through the HTML extractor loses every <bracketed> word.
    const text = extractText(fetched?.mimeType ?? document.mimeType, source);

    if (!text) throw new IngestError("The source contains no readable text.");

    const contentHash = createHash("sha256").update(text).digest("hex");
    const duplicate = await prisma.document.findFirst({
      where: {
        collectionId: document.collectionId,
        contentHash,
        id: { not: documentId },
      },
      select: { id: true, title: true },
    });

    if (duplicate) {
      await prisma.document.update({
        where: { id: documentId },
        data: { status: "failed", error: `Already in this collection as "${duplicate.title}".` },
      });

      return { status: "duplicate", chunkCount: 0, duplicateOf: duplicate.id };
    }

    const drafts = chunkText(text, { ...CHUNK_DEFAULTS, ...chunkOptions });

    if (drafts.length === 0) throw new IngestError("The source contains no readable text.");
    if (drafts.length > maxChunks) {
      throw new IngestError(
        `The document is too large: it produced ${drafts.length} chunks, and the limit is ${maxChunks}.`,
      );
    }

    const vectors = await embed(drafts.map((draft) => embeddingInput(document.title, draft)));

    // A previous interrupted run may have left chunks at these ordinals. Clearing first is
    // simpler than upserting and leaves no stale rows if this run produced fewer chunks.
    await prisma.chunk.deleteMany({ where: { documentId } });
    await writeChunks(prisma, { documentId, collectionId: document.collectionId, embeddingModel }, drafts, vectors);

    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: "ready",
        error: null,
        chunkCount: drafts.length,
        contentHash,
        byteSize: Buffer.byteLength(source),
      },
    });

    return { status: "ready", chunkCount: drafts.length };
  } catch (error) {
    const message = describe(error);

    await prisma.chunk.deleteMany({ where: { documentId } });
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "failed", error: message, chunkCount: 0 },
    });

    return { status: "failed", chunkCount: 0, error: message };
  }
}

/**
 * What actually gets embedded. The breadcrumb gives an otherwise context-free passage its
 * subject back ("within 30 days" means nothing without "Expenses"), and it is prepended
 * here rather than stored so citations still show the passage itself.
 */
export function embeddingInput(title: string, draft: ChunkDraft): string {
  const breadcrumb = [title, draft.heading].filter(Boolean).join(" › ");

  return `${breadcrumb}\n\n${draft.content}`;
}

async function writeChunks(
  prisma: typeof defaultPrisma,
  context: { documentId: string; collectionId: string; embeddingModel: string },
  drafts: ChunkDraft[],
  vectors: number[][],
): Promise<void> {
  for (let start = 0; start < drafts.length; start += UPSERT_BATCH) {
    const batch = drafts.slice(start, start + UPSERT_BATCH);

    await prisma.$transaction(
      batch.map((draft, offset) => {
        const vector = JSON.stringify(vectors[start + offset] ?? []);

        return prisma.$executeRaw`
          INSERT INTO "Chunk" ("id", "documentId", "collectionId", "ordinal", "content",
                               "tokenCount", "page", "heading", "embedding", "embeddingModel")
          VALUES (${crypto.randomUUID()}, ${context.documentId}, ${context.collectionId},
                  ${draft.ordinal}, ${draft.content}, ${draft.tokenCount}, ${null},
                  ${draft.heading}, ${vector}::vector, ${context.embeddingModel})
          ON CONFLICT ("documentId", "ordinal") DO UPDATE
            SET "content" = EXCLUDED."content",
                "tokenCount" = EXCLUDED."tokenCount",
                "heading" = EXCLUDED."heading",
                "embedding" = EXCLUDED."embedding",
                "embeddingModel" = EXCLUDED."embeddingModel"
        `;
      }),
    );
  }
}

async function fetchSource(
  document: { sourceType: string; sourceUri: string | null; mimeType: string },
  fetchImpl: typeof fetch,
  lookup?: Lookup,
): Promise<{ body: string; mimeType: string }> {
  if (document.sourceType !== "url" || !document.sourceUri) {
    throw new IngestError(
      `Cannot read a ${document.sourceType} source on this server. Paste the text or supply a URL instead.`,
    );
  }

  let target = await assertFetchableUrl(document.sourceUri, { lookup });
  let response: Response | undefined;

  // Redirects are followed by hand so each hop is checked too — otherwise a public URL
  // can simply redirect the server to an internal address.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    response = await fetchImpl(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
    });

    if (response.status < 300 || response.status >= 400) break;

    const location = response.headers.get("location");

    if (!location) break;

    target = await assertFetchableUrl(new URL(location, target).href, { lookup });
    response = undefined;
  }

  if (!response) throw new IngestError(`Fetching ${document.sourceUri} followed too many redirects.`);

  if (!response.ok) {
    throw new IngestError(`Fetching ${document.sourceUri} failed with status ${response.status}.`);
  }

  return {
    body: await readCapped(response),
    mimeType: response.headers.get("content-type") || document.mimeType,
  };
}

/**
 * Reads the body while counting bytes, so an oversized or endless response is abandoned
 * mid-flight. Buffering first and measuring afterwards would let one URL exhaust memory.
 */
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));

  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
    throw new IngestError("The source is larger than the 20 MB limit.");
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      received += value.byteLength;

      if (received > MAX_SOURCE_BYTES) {
        throw new IngestError("The source is larger than the 20 MB limit.");
      }

      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return text + decoder.decode();
}

function describe(error: unknown): string {
  if (
    error instanceof IngestError ||
    error instanceof UnsupportedSourceError ||
    error instanceof UnsafeUrlError
  ) {
    return error.message;
  }
  if (error instanceof Error) return error.message;

  return "Processing failed.";
}
