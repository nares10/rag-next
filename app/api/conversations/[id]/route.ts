import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        userId: user.id,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ conversation }, { status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const title = body.title?.trim();
    // `collectionId: null` detaches the conversation from its document collection.
    const changesCollection = "collectionId" in body;

    if (!title && !changesCollection) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    let collectionId: string | null = null;

    if (changesCollection && body.collectionId !== null) {
      if (typeof body.collectionId !== "string") {
        return NextResponse.json({ error: "collectionId must be a string or null" }, { status: 400 });
      }

      const collection = await prisma.collection.findFirst({
        where: { id: body.collectionId, userId: user.id },
        select: { id: true },
      });

      if (!collection) {
        return NextResponse.json({ error: "Collection not found" }, { status: 404 });
      }

      collectionId = collection.id;
    }

    const conversation = await prisma.conversation.updateMany({
      where: { id, userId: user.id },
      data: {
        ...(title ? { title } : {}),
        ...(changesCollection ? { collectionId } : {}),
      },
    });

    if (conversation.count === 0) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json(
      { ...(title ? { title } : {}), ...(changesCollection ? { collectionId } : {}) },
      { status: 200 },
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const conversation = await prisma.conversation.deleteMany({
      where: { id, userId: user.id },
    });

    if (conversation.count === 0) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}