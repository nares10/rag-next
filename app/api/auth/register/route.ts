import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { isValidEmail } from "@/lib/auth-input"

export async function POST(request: Request) {
	try {
		const body = request.headers.get("content-type")?.includes("application/json")
			? await request.json()
			: Object.fromEntries((await request.formData()).entries());

		const email = body.email?.trim().toLowerCase();
		const password = body.password;
		const confirmPassword = body.confirmPassword;
		const name = body.name?.trim();

		if (!email || !password || !name) {
			return NextResponse.json(
				{ error: "Email, password, and name are required" },
				{ status: 400 }
			);
		}
		

		if (name.length < 2) {
			return NextResponse.json(
				{ error: "Name must be at least 2 characters" },
				{ status: 400 }
			);
		}

		if (password.length < 8) {
			return NextResponse.json(
				{ error: "Password must be at least 8 characters" },
				{ status: 400 }
			);
		}
		if (!isValidEmail(email)) {
			return NextResponse.json(
				{ error: "Invalid Email" },
				{ status: 400 }
			);
		}

		if (confirmPassword !== undefined && password !== confirmPassword) {
			return NextResponse.json(
				{ error: "Passwords do not match" },
				{ status: 400 }
			);
		}

		const existingUser = await prisma.user.findUnique({
			where: { email },
		});

		if (existingUser) {
			return NextResponse.json(
				{ error: "User already exists" },
				{ status: 409 }
			);
		}


		const user = await prisma.user.create({
			data: {
				email,
				name,
				passwordHash: await hashPassword(password),
			},
			select: {
				id: true,
				email: true,
				name: true,
			},
		});


		return NextResponse.json({ user }, { status: 201 });
	} catch (error) {
		console.error(error);

		return NextResponse.json(
			{ error: "Something went wrong in registration Flow" },
			{ status: 500 }
		);
	}
}
