import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const collections = await prisma.collection.findMany({
      where: { userId: user.id },
      include: {
        documents: { select: { status: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(
      {
        collections: collections.map(({ documents, ...collection }) => ({
          ...collection,
          documentCount: documents.length,
          // The chat UI only offers a collection once something in it is searchable.
          readyCount: documents.filter((document) => document.status === "ready").length,
        })),
      },
      { status: 200 },
    );
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

    const body = await request.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const description = typeof body?.description === "string" ? body.description.trim() : null;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const collection = await prisma.collection.create({
      data: { userId: user.id, name, description: description || null },
    });

    return NextResponse.json({ collection }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
