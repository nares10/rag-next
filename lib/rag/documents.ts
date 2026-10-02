import { prisma } from "../prisma";
import { createEmbedder } from "./embed";
import { ingestDocument } from "./ingest";

/**
 * Shared processing entry point for the POST-time background run and the user's retry.
 *
 * The embedder is constructed here rather than passed in, because both callers are route
 * handlers with no business knowing about embedding configuration — and a missing server
 * key has to surface as a failed document, not a thrown request.
 */
export async function processDocument(documentId: string, raw?: string) {
  try {
    return await ingestDocument({ documentId, raw, embed: createEmbedder() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed.";

    await prisma.document.updateMany({
      where: { id: documentId },
      data: { status: "failed", error: message, chunkCount: 0 },
    });

    return { status: "failed" as const, chunkCount: 0, error: message };
  }
}
