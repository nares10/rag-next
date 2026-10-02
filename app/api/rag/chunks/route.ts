import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/** A citation panel never shows more than a message's worth of sources. */
const MAX_IDS = 20;

/**
 * The cited passages behind an answer, for the citation panel and hover previews.
 * Each chunk comes with its neighbours so the passage can be shown in context.
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ids = (new URL(request.url).searchParams.get("ids") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, MAX_IDS);

    if (ids.length === 0) {
      return NextResponse.json({ error: "ids is required" }, { status: 400 });
    }

    const chunks = await prisma.chunk.findMany({
      where: { id: { in: ids }, document: { userId: user.id } },
      select: {
        id: true,
        documentId: true,
        ordinal: true,
        content: true,
        page: true,
        heading: true,
        document: { select: { title: true, sourceUri: true } },
      },
    });

    const neighbours = await prisma.chunk.findMany({
      where: {
        OR: chunks.map((chunk) => ({
          documentId: chunk.documentId,
          ordinal: { in: [chunk.ordinal - 1, chunk.ordinal + 1] },
        })),
      },
      select: { documentId: true, ordinal: true, content: true },
    });

    const neighbour = (documentId: string, ordinal: number) =>
      neighbours.find((item) => item.documentId === documentId && item.ordinal === ordinal)?.content ?? null;

    return NextResponse.json(
      {
        chunks: chunks.map(({ document, ...chunk }) => ({
          id: chunk.id,
          documentId: chunk.documentId,
          title: document.title,
          sourceUri: document.sourceUri,
          heading: chunk.heading,
          page: chunk.page,
          content: chunk.content,
          before: neighbour(chunk.documentId, chunk.ordinal - 1),
          after: neighbour(chunk.documentId, chunk.ordinal + 1),
        })),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
