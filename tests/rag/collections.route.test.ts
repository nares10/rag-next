import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "../../lib/prisma";
import {
  TEST_BASE_URL,
  authHeaders,
  createAuthedUser,
  createTestCollection,
  createTestConversation,
  resetTestDatabase,
} from "../setup";

const url = (path = "") => `${TEST_BASE_URL}/api/rag/collections${path}`;

describe("/api/rag/collections", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await resetTestDatabase();
    await prisma.$disconnect();
  });

  it("401s without a session", async () => {
    expect((await fetch(url())).status).toBe(401);
    expect(
      (
        await fetch(url(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Handbook" }),
        })
      ).status,
    ).toBe(401);
  });

  it("creates a collection owned by the caller", async () => {
    const { user, headers } = await createAuthedUser("coll-create@example.com");

    const response = await fetch(url(), {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Handbook", description: "HR policies" }),
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.collection.name).toBe("Handbook");
    expect(data.collection.description).toBe("HR policies");

    const stored = await prisma.collection.findMany({ where: { userId: user.id } });
    expect(stored).toHaveLength(1);
  });

  it("400s on a missing or blank name", async () => {
    const { headers } = await createAuthedUser("coll-blank@example.com");

    const response = await fetch(url(), { method: "POST", headers, body: JSON.stringify({ name: "  " }) });

    expect(response.status).toBe(400);
  });

  it("lists only the caller's collections, with document counts", async () => {
    const { user, headers } = await createAuthedUser("coll-list@example.com");
    const { user: other } = await createAuthedUser("coll-other@example.com");
    await createTestCollection(user.id, { name: "Mine" });
    await createTestCollection(other.id, { name: "Theirs" });

    const response = await fetch(url(), { headers });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.collections).toHaveLength(1);
    expect(data.collections[0].name).toBe("Mine");
    expect(data.collections[0].documentCount).toBe(0);
    expect(data.collections[0].readyCount).toBe(0);
  });

  it("renames a collection", async () => {
    const { user, headers } = await createAuthedUser("coll-rename@example.com");
    const collection = await createTestCollection(user.id);

    const response = await fetch(url(`/${collection.id}`), {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: "Renamed" }),
    });

    expect(response.status).toBe(200);
    const stored = await prisma.collection.findUnique({ where: { id: collection.id } });
    expect(stored?.name).toBe("Renamed");
  });

  it("404s when renaming another user's collection, leaving it untouched", async () => {
    const { user: owner } = await createAuthedUser("coll-victim@example.com");
    const { headers: attacker } = await createAuthedUser("coll-attacker@example.com");
    const collection = await createTestCollection(owner.id, { name: "Private" });

    const response = await fetch(url(`/${collection.id}`), {
      method: "PATCH",
      headers: attacker,
      body: JSON.stringify({ name: "Hijacked" }),
    });

    expect(response.status).toBe(404);
    const stored = await prisma.collection.findUnique({ where: { id: collection.id } });
    expect(stored?.name).toBe("Private");
  });

  it("deletes a collection and detaches it from conversations", async () => {
    const { user, headers } = await createAuthedUser("coll-delete@example.com");
    const collection = await createTestCollection(user.id);
    const conversation = await createTestConversation(user.id);
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { collectionId: collection.id },
    });

    const response = await fetch(url(`/${collection.id}`), { method: "DELETE", headers });

    expect(response.status).toBe(200);
    expect(await prisma.collection.findUnique({ where: { id: collection.id } })).toBeNull();
    const stored = await prisma.conversation.findUnique({ where: { id: conversation.id } });
    expect(stored?.collectionId).toBeNull();
  });

  it("404s when deleting another user's collection", async () => {
    const { user: owner } = await createAuthedUser("coll-del-victim@example.com");
    const { headers: attacker } = await createAuthedUser("coll-del-attacker@example.com");
    const collection = await createTestCollection(owner.id);

    const response = await fetch(url(`/${collection.id}`), { method: "DELETE", headers: attacker });

    expect(response.status).toBe(404);
    expect(await prisma.collection.findUnique({ where: { id: collection.id } })).not.toBeNull();
  });

  it("401s with an expired session", async () => {
    const { user } = await createAuthedUser("coll-expired@example.com");
    const expired = await prisma.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await fetch(url(), { headers: authHeaders(expired.id) });

    expect(response.status).toBe(401);
  });
});

describe("attaching a collection to a conversation", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("attaches and then detaches a collection", async () => {
    const { user, headers } = await createAuthedUser("attach@example.com");
    const collection = await createTestCollection(user.id);
    const conversation = await createTestConversation(user.id);
    const conversationUrl = `${TEST_BASE_URL}/api/conversations/${conversation.id}`;

    const attached = await fetch(conversationUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ collectionId: collection.id }),
    });

    expect(attached.status).toBe(200);
    expect((await prisma.conversation.findUnique({ where: { id: conversation.id } }))?.collectionId).toBe(
      collection.id,
    );

    const detached = await fetch(conversationUrl, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ collectionId: null }),
    });

    expect(detached.status).toBe(200);
    expect((await prisma.conversation.findUnique({ where: { id: conversation.id } }))?.collectionId).toBeNull();
  });

  it("404s when attaching a collection owned by someone else", async () => {
    const { user: owner } = await createAuthedUser("attach-victim@example.com");
    const { user: attacker, headers } = await createAuthedUser("attach-attacker@example.com");
    const collection = await createTestCollection(owner.id);
    const conversation = await createTestConversation(attacker.id);

    const response = await fetch(`${TEST_BASE_URL}/api/conversations/${conversation.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ collectionId: collection.id }),
    });

    expect(response.status).toBe(404);
    expect((await prisma.conversation.findUnique({ where: { id: conversation.id } }))?.collectionId).toBeNull();
  });

  it("still requires a title when renaming", async () => {
    const { user, headers } = await createAuthedUser("attach-rename@example.com");
    const conversation = await createTestConversation(user.id);

    const response = await fetch(`${TEST_BASE_URL}/api/conversations/${conversation.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "   " }),
    });

    expect(response.status).toBe(400);
  });
});
