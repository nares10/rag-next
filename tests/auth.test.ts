import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "../lib/prisma";

import {
  TEST_BASE_URL,
  authHeaders,
  createExpiredSession,
  createSession,
  createTestUser,
  resetTestDatabase,
} from "./setup";

describe("auth", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await resetTestDatabase();
    await prisma.$disconnect();
  });

  describe("POST /api/auth/register", () => {
    const register = (body: Record<string, unknown>) =>
      fetch(`${TEST_BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    it("400s when name, email, or password is missing", async () => {
      const response = await register({ email: "missing-fields@example.com", name: "Test User" });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("required");
    });

    it("400s on a short name", async () => {
      const response = await register({ email: "short-name@example.com", name: "A", password: "password123" });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("Name");
    });

    it("400s on a short password", async () => {
      const response = await register({ email: "short-pw@example.com", name: "Test User", password: "short" });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("8 characters");
    });

    it("400s on an invalid email", async () => {
      const response = await register({ email: "not-an-email", name: "Test User", password: "password123" });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("Invalid Email");
    });

    it("400s when passwords do not match", async () => {
      const response = await register({
        email: "mismatch@example.com",
        name: "Test User",
        password: "password123",
        confirmPassword: "password456",
      });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("Passwords do not match");
    });

    it("409s when the email is already registered", async () => {
      await createTestUser("duplicate@example.com");

      const response = await register({ email: "duplicate@example.com", name: "Duplicate", password: "password123" });

      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe("User already exists");
    });

    it("creates a user without returning the password hash", async () => {
      const response = await register({
        email: "  New-User@Example.com ",
        name: "New User",
        password: "password123",
        confirmPassword: "password123",
      });

      expect(response.status).toBe(201);
      const { user } = await response.json();
      expect(user.email).toBe("new-user@example.com");
      expect(user.name).toBe("New User");
      expect(user.passwordHash).toBeUndefined();

      const stored = await prisma.user.findUnique({ where: { email: "new-user@example.com" } });
      expect(stored?.passwordHash).not.toBe("password123");
    });
  });

  describe("registration flow end to end", () => {
    it("registers with a password and can log in straight away", async () => {
      const email = "flow@example.com";

      const registerResponse = await fetch(`${TEST_BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: "Flow User", password: "password123" }),
      });
      expect(registerResponse.status).toBe(201);

      const loginResponse = await fetch(`${TEST_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "password123" }),
      });

      expect(loginResponse.status).toBe(200);
    });
  });

  describe("POST /api/auth/login", () => {
    it("logs in with correct credentials and sets a session cookie", async () => {
      const user = await createTestUser("login@example.com", "Login User");

      const response = await fetch(`${TEST_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "login@example.com", password: "password123" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.user).toMatchObject({ email: "login@example.com", name: "Login User" });
      expect(response.headers.get("set-cookie")).toContain("session_id=");

      const sessions = await prisma.session.findMany({ where: { userId: user.id } });
      expect(sessions).toHaveLength(1);
    });

    it("logs in with a form-data body", async () => {
      await createTestUser("login-form@example.com");

      const form = new FormData();
      form.set("email", "login-form@example.com");
      form.set("password", "password123");

      const response = await fetch(`${TEST_BASE_URL}/api/auth/login`, {
        method: "POST",
        body: form,
      });

      expect(response.status).toBe(200);
    });

    it("401s on wrong password", async () => {
      await createTestUser("wrong-pass@example.com");

      const response = await fetch(`${TEST_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "wrong-pass@example.com", password: "incorrect" }),
      });

      expect(response.status).toBe(401);
    });

    it("401s on unknown email", async () => {
      const response = await fetch(`${TEST_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "unknown@example.com", password: "password123" }),
      });

      expect(response.status).toBe(401);
    });

    it("400s when email is missing", async () => {
      const response = await fetch(`${TEST_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "password123" }),
      });

      expect(response.status).toBe(400);
    });

    it("400s when password is missing", async () => {
      const response = await fetch(`${TEST_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "someone@example.com" }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("deletes the session and clears the cookie", async () => {
      const user = await createTestUser("logout@example.com");
      const sessionId = await createSession(user.id);

      const response = await fetch(`${TEST_BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: authHeaders(sessionId),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(await prisma.session.findUnique({ where: { id: sessionId } })).toBeNull();
    });

    it("is a no-op with no cookie", async () => {
      const response = await fetch(`${TEST_BASE_URL}/api/auth/logout`, { method: "POST" });

      expect(response.status).toBe(200);
    });

    it("is idempotent when called twice with an already-invalidated cookie", async () => {
      const user = await createTestUser("logout-twice@example.com");
      const sessionId = await createSession(user.id);

      await fetch(`${TEST_BASE_URL}/api/auth/logout`, { method: "POST", headers: authHeaders(sessionId) });
      const secondResponse = await fetch(`${TEST_BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: authHeaders(sessionId),
      });

      expect(secondResponse.status).toBe(200);
    });
  });

  describe("GET /api/auth/me", () => {
    it("401s with no cookie", async () => {
      const response = await fetch(`${TEST_BASE_URL}/api/auth/me`);

      expect(response.status).toBe(401);
    });

    it("401s with a garbage session id", async () => {
      const response = await fetch(`${TEST_BASE_URL}/api/auth/me`, {
        headers: authHeaders("not-a-real-session-id"),
      });

      expect(response.status).toBe(401);
    });

    it("401s with an expired session", async () => {
      const user = await createTestUser("expired@example.com");
      const sessionId = await createExpiredSession(user.id);

      const response = await fetch(`${TEST_BASE_URL}/api/auth/me`, {
        headers: authHeaders(sessionId),
      });

      expect(response.status).toBe(401);
    });

    it("returns the current user without the password hash", async () => {
      const user = await createTestUser("me@example.com", "Me User");
      const sessionId = await createSession(user.id);

      const response = await fetch(`${TEST_BASE_URL}/api/auth/me`, {
        headers: authHeaders(sessionId),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.user).toMatchObject({ email: "me@example.com", name: "Me User" });
      expect(data.user.passwordHash).toBeUndefined();
    });
  });
});
