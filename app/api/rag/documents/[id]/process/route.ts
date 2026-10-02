import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { processDocument } from "@/lib/rag/documents";

/**
 * Re-runs the pipeline for one document. Used by the retry button on a failed document,
 * and as the trigger a queue or cron would call: a request carrying
 * `x-rag-process-secret` is accepted without a session.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const secret = process.env.RAG_PROCESS_SECRET;
    const presented = request.headers.get("x-rag-process-secret");
    const internal = Boolean(secret) && presented === secret;

    if (!internal) {
      const user = await getCurrentUser();

      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const owned = await prisma.document.findFirst({ where: { id, userId: user.id }, select: { id: true } });

      if (!owned) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
    }

    const existing = await prisma.document.findUnique({ where: { id } });

    if (!existing) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // A pasted document's text only ever existed in the original request body, so there is
    // nothing to re-read: only URL sources can genuinely be retried. Mark it failed on the
    // way out, so a document whose background run never completed stops being polled as
    // "Queued" forever.
    if (existing.sourceType === "paste" && existing.status !== "ready") {
      const error = "Pasted text cannot be reprocessed. Paste it again.";

      await prisma.document.update({
        where: { id },
        data: { status: "failed", error, chunkCount: 0 },
      });

      return NextResponse.json({ error }, { status: 409 });
    }

    const result = await processDocument(id);
    const document = await prisma.document.findUnique({ where: { id } });

    // A duplicate leaves the row failed, so it is not a success either.
    const ok = result.status === "ready";

    return NextResponse.json({ document, result }, { status: ok ? 200 : 422 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
