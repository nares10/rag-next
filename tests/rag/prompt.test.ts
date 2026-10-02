import { describe, expect, it } from "bun:test";
import { buildGroundedPrompt } from "../../lib/rag/prompt";
import type { RetrievedChunk } from "../../lib/rag/types";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: overrides.id ?? "chunk-1",
    documentId: overrides.documentId ?? "doc-1",
    title: overrides.title ?? "Employee Handbook",
    heading: overrides.heading ?? "Expenses",
    page: overrides.page ?? 4,
    content: overrides.content ?? "Receipts must be filed within 30 days.",
    tokenCount: overrides.tokenCount ?? 10,
    score: overrides.score ?? 0.9,
  };
}

describe("buildGroundedPrompt", () => {
  it("numbers the context blocks from one, in the order given", () => {
    const { system } = buildGroundedPrompt([
      chunk({ id: "a", content: "First passage." }),
      chunk({ id: "b", content: "Second passage." }),
    ]);

    expect(system.indexOf("[1]")).toBeLessThan(system.indexOf("[2]"));
    expect(system.indexOf("First passage.")).toBeLessThan(system.indexOf("Second passage."));
  });

  it("labels each block with its document title, heading and page", () => {
    const { system } = buildGroundedPrompt([chunk({ title: "Travel Policy", heading: "Flights", page: 12 })]);

    expect(system).toContain("Travel Policy");
    expect(system).toContain("Flights");
    expect(system).toContain("p.12");
  });

  it("instructs the model to cite and to refuse outside knowledge", () => {
    const { system } = buildGroundedPrompt([chunk()]);

    expect(system).toMatch(/cite/i);
    expect(system).toMatch(/\[n\]/i);
  });

  it("returns citations aligned with the block numbers", () => {
    const { citations } = buildGroundedPrompt([
      chunk({ id: "a", documentId: "doc-a", title: "A", page: 1, score: 0.8 }),
      chunk({ id: "b", documentId: "doc-b", title: "B", page: 2, score: 0.7 }),
    ]);

    expect(citations).toEqual([
      { n: 1, chunkId: "a", documentId: "doc-a", title: "A", heading: "Expenses", page: 1, score: 0.8 },
      { n: 2, chunkId: "b", documentId: "doc-b", title: "B", heading: "Expenses", page: 2, score: 0.7 },
    ]);
  });

  it("drops the lowest-ranked chunks until the context fits the token budget", () => {
    const chunks = [
      chunk({ id: "a", content: "a".repeat(400), tokenCount: 100 }),
      chunk({ id: "b", content: "b".repeat(400), tokenCount: 100 }),
      chunk({ id: "c", content: "c".repeat(400), tokenCount: 100 }),
    ];

    const { citations, system } = buildGroundedPrompt(chunks, { budgetTokens: 150 });

    expect(citations.map((c) => c.chunkId)).toEqual(["a"]);
    expect(system).not.toContain("b".repeat(400));
  });

  it("keeps the best chunk, truncated, rather than claiming nothing matched", () => {
    const chunks = [chunk({ id: "a", content: "a".repeat(4000), tokenCount: 1000 })];

    const { citations, grounded, system } = buildGroundedPrompt(chunks, { budgetTokens: 50 });

    expect(grounded).toBe(true);
    expect(citations.map((c) => c.chunkId)).toEqual(["a"]);
    expect(system).not.toMatch(/do not know/i);
    expect(system.length).toBeLessThan(1000);
  });

  it("tells the model to say it does not know when nothing was retrieved", () => {
    const { system, citations, grounded } = buildGroundedPrompt([]);

    expect(citations).toEqual([]);
    expect(grounded).toBe(false);
    expect(system).toMatch(/do not know|don't know|no .*document/i);
  });

  it("keeps the conversation's own system prompt ahead of the context", () => {
    const { system } = buildGroundedPrompt([chunk()], { basePrompt: "You are a terse assistant." });

    expect(system.startsWith("You are a terse assistant.")).toBe(true);
    expect(system).toContain("Receipts must be filed");
  });

  it("reports grounded when at least one chunk made it into the context", () => {
    expect(buildGroundedPrompt([chunk()]).grounded).toBe(true);
  });
});
