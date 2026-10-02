import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { lazyEmbedder } from "@/lib/rag/embed";
import { retrieveContext } from "@/lib/rag/retrieve";

/**
 * Retrieval preview: the same code path the chat route takes, with no model call. Useful
 * for checking what a question actually matches when an answer looks wrong.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const collectionId = typeof body?.collectionId === "string" ? body.collectionId : "";
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const limit = Number.isInteger(body?.limit) ? Math.min(Math.max(body.limit, 1), 20) : undefined;

    if (!collectionId || !query) {
      return NextResponse.json({ error: "collectionId and query are required" }, { status: 400 });
    }

    const collection = await prisma.collection.findFirst({
      where: { id: collectionId, userId: user.id },
      select: { id: true },
    });

    if (!collection) {
      return NextResponse.json({ error: "Collection not found" }, { status: 404 });
    }

    const chunks = await retrieveContext({
      userId: user.id,
      collectionId: collection.id,
      query,
      limit,
      embed: lazyEmbedder(),
    });

    return NextResponse.json({ chunks }, { status: 200 });
  } catch (error) {
    // Deliberately generic: the underlying message can name database objects or the
    // missing embedding key.
    console.error(error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
