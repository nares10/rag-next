import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

/** Deletes the account and, through cascades, everything it owns. Requires the password. */
export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const password = typeof body?.password === "string" ? body.password : "";
    const stored = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });

    if (!stored || !password || !(await verifyPassword(password, stored.passwordHash))) {
      return NextResponse.json({ error: "Password is incorrect" }, { status: 403 });
    }

    await prisma.user.delete({ where: { id: user.id } });
    (await cookies()).delete("session_id");

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
