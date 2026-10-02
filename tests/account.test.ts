import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "../lib/prisma";
import { verifyPassword } from "../lib/password";
import { TEST_BASE_URL, authHeaders, createAuthedUser, createSession, resetTestDatabase } from "./setup";

describe("account routes", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await resetTestDatabase();
    await prisma.$disconnect();
  });

  const changePassword = (headers: HeadersInit, body: unknown) =>
    fetch(`${TEST_BASE_URL}/api/account/password`, { method: "POST", headers, body: JSON.stringify(body) });

  it("changes the password and signs out other sessions only", async () => {
    const { user, sessionId, headers } = await createAuthedUser("pw-change@example.com");
    const otherSession = await createSession(user.id);

    const response = await changePassword(headers, { currentPassword: "password123", newPassword: "new-password-1" });
    expect(response.status).toBe(200);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword("new-password-1", stored.passwordHash)).toBe(true);

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions.map((session) => session.id)).toEqual([sessionId]);
    expect(sessions.some((session) => session.id === otherSession)).toBe(false);
  });

  it("refuses a wrong current password", async () => {
    const { headers } = await createAuthedUser("pw-wrong@example.com");

    const response = await changePassword(headers, { currentPassword: "nope", newPassword: "new-password-1" });
    expect(response.status).toBe(403);
  });

  it("refuses a short new password", async () => {
    const { headers } = await createAuthedUser("pw-short@example.com");

    const response = await changePassword(headers, { currentPassword: "password123", newPassword: "short" });
    expect(response.status).toBe(400);
  });

  it("deletes the account with the right password, and only then", async () => {
    const { user, headers } = await createAuthedUser("delete-me@example.com");

    const wrong = await fetch(`${TEST_BASE_URL}/api/account`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ password: "nope" }),
    });
    expect(wrong.status).toBe(403);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();

    const right = await fetch(`${TEST_BASE_URL}/api/account`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ password: "password123" }),
    });
    expect(right.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it("401s without a session", async () => {
    const response = await changePassword(authHeaders("missing"), { currentPassword: "a", newPassword: "bbbbbbbb" });
    expect(response.status).toBe(401);
  });
});
