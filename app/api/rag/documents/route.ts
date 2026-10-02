import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { processDocument } from "@/lib/rag/documents";
import { isBinaryMimeType, mimeTypeForUpload, supportsMimeType } from "@/lib/rag/extract";
import {
  MAX_CHUNKS_PER_USER,
  MAX_DOCUMENTS_PER_USER,
  MAX_PASTE_BYTES,
  MAX_UPLOAD_BYTES,
} from "@/lib/rag/limits";
import { SOURCE_TYPES, type SourceType } from "@/lib/rag/types";
import { UnsafeUrlError, assertFetchableUrl } from "@/lib/rag/url-guard";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const collectionId = new URL(request.url).searchParams.get("collectionId");

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required" }, { status: 400 });
    }

    const collection = await prisma.collection.findFirst({
      where: { id: collectionId, userId: user.id },
      select: { id: true },
    });

    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    const documents = await prisma.document.findMany({
      where: { collectionId: collection.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ documents }, { status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // A file arrives as multipart/form-data; everything else as JSON.
    const upload = request.headers.get("content-type")?.includes("multipart/form-data")
      ? await readUpload(request)
      : null;

    if (upload && "error" in upload) {
      return NextResponse.json({ error: upload.error }, { status: upload.status });
    }

    const body = upload ? upload.fields : await request.json().catch(() => ({}));
    const collectionId = typeof body?.collectionId === "string" ? body.collectionId : "";
    const sourceType: SourceType = upload
      ? "file"
      : SOURCE_TYPES.includes(body?.sourceType)
        ? body.sourceType
        : "paste";
    const text = typeof body?.text === "string" ? body.text : "";
    const sourceUri = typeof body?.sourceUri === "string" ? body.sourceUri.trim() : "";
    const mimeType = upload
      ? upload.mimeType
      : typeof body?.mimeType === "string"
        ? body.mimeType
        : defaultMimeType(sourceType);

    if (!collectionId) {
      return NextResponse.json({ error: "collectionId is required" }, { status: 400 });
    }

    const collection = await prisma.collection.findFirst({
      where: { id: collectionId, userId: user.id },
      select: { id: true },
    });

    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    if (sourceType === "file" && !upload) {
      return NextResponse.json(
        { error: "Send the file as multipart/form-data." },
        { status: 400 },
      );
    }

    if (sourceType === "paste" && !text.trim()) {
      return NextResponse.json({ error: "text is required for a pasted document" }, { status: 400 });
    }

    if (sourceType === "url") {
      try {
        // Checked here as well as at fetch time, so a bad URL is a 400 the user sees
        // immediately rather than a document that fails in the background.
        await assertFetchableUrl(sourceUri);
      } catch (error) {
        const message =
          error instanceof UnsafeUrlError ? error.message : "sourceUri must be an http(s) URL";

        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    if (Buffer.byteLength(text) > MAX_PASTE_BYTES) {
      return NextResponse.json({ error: "The pasted text is larger than 1 MB" }, { status: 413 });
    }

    if (!supportsMimeType(mimeType)) {
      return NextResponse.json({ error: `Cannot read ${mimeType}` }, { status: 415 });
    }

    // A PDF or Word file cannot survive being pasted into a JSON string; it has to be
    // uploaded as a file. Saying so now beats accepting it and failing in the background.
    if (sourceType === "paste" && isBinaryMimeType(mimeType)) {
      return NextResponse.json(
        { error: `Upload the ${mimeType === "application/pdf" ? "PDF" : "Word document"} as a file instead of pasting it.` },
        { status: 415 },
      );
    }

    const [documentCount, chunkCount] = await Promise.all([
      prisma.document.count({ where: { userId: user.id } }),
      prisma.chunk.count({ where: { document: { userId: user.id } } }),
    ]);

    if (documentCount >= MAX_DOCUMENTS_PER_USER) {
      return NextResponse.json(
        { error: `You have reached the limit of ${MAX_DOCUMENTS_PER_USER} documents.` },
        { status: 403 },
      );
    }

    if (chunkCount >= MAX_CHUNKS_PER_USER) {
      return NextResponse.json(
        { error: `You have reached the limit of ${MAX_CHUNKS_PER_USER} indexed passages.` },
        { status: 403 },
      );
    }

    const title =
      (typeof body?.title === "string" && body.title.trim()) ||
      upload?.fileName ||
      deriveTitle(sourceType, text, sourceUri);

    const document = await prisma.document.create({
      data: {
        collectionId: collection.id,
        userId: user.id,
        title,
        sourceType,
        sourceUri: sourceType === "url" ? sourceUri : null,
        mimeType,
        byteSize: upload ? upload.bytes.byteLength : Buffer.byteLength(text),
        // Replaced with the hash of the normalized text during processing. A random
        // placeholder keeps the unique index usable until then.
        contentHash: `pending:${crypto.randomUUID()}`,
        status: "pending",
      },
    });

    // Extraction and embedding can take a while; the client polls the document for status.
    // `after` keeps it inside this invocation rather than needing a queue to be wired up.
    after(() =>
      processDocument(
        document.id,
        upload ? upload.bytes : sourceType === "paste" ? text : undefined,
      ),
    );

    return NextResponse.json({ document }, { status: 202 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

type Upload = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  fields: Record<string, unknown>;
};

/**
 * Reads an uploaded file and the fields beside it. The whole body is buffered, which is
 * why the size limit sits under the platform's own body cap rather than being enforced by
 * streaming.
 */
async function readUpload(request: Request): Promise<Upload | { error: string; status: number }> {
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return { error: "The upload could not be read.", status: 400 };
  }

  const file = form.get("file");

  if (!(file instanceof File)) {
    return { error: "No file was attached.", status: 400 };
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      error: `That file is larger than the ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB upload limit.`,
      status: 413,
    };
  }

  const fields: Record<string, unknown> = {};

  for (const [key, value] of form.entries()) {
    if (typeof value === "string") fields[key] = value;
  }

  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    fileName: file.name,
    mimeType: mimeTypeForUpload(file.name, file.type),
    fields,
  };
}

function defaultMimeType(sourceType: SourceType): string {
  return sourceType === "url" ? "text/html" : "text/markdown";
}

function deriveTitle(sourceType: SourceType, text: string, sourceUri: string): string {
  if (sourceType === "url") return sourceUri;

  const firstLine = text.trim().split("\n")[0]?.replace(/^#+\s*/, "").trim() ?? "";

  if (!firstLine) return "Untitled document";

  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}
