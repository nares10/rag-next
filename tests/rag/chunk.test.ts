import { describe, expect, it } from "bun:test";
import { chunkText } from "../../lib/rag/chunk";

describe("chunkText", () => {
  it("returns a single chunk for text below the target size", () => {
    const chunks = chunkText("A short paragraph about invoices.");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].ordinal).toBe(0);
    expect(chunks[0].content).toContain("A short paragraph about invoices.");
  });

  it("returns nothing for empty or whitespace-only text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("numbers chunks consecutively from zero", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${"filler ".repeat(60)}`).join("\n\n");

    const chunks = chunkText(text, { targetTokens: 100 });

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });
});

describe("chunkText headings", () => {
  const doc = [
    "# Employee Handbook",
    "",
    "## Expenses",
    "",
    `Receipts must be filed within 30 days. ${"detail ".repeat(80)}`,
    "",
    "## Travel",
    "",
    `Economy class is the default for flights under six hours. ${"detail ".repeat(80)}`,
  ].join("\n");

  it("tags each chunk with its nearest enclosing heading", () => {
    const chunks = chunkText(doc, { targetTokens: 200 });

    const expenses = chunks.find((c) => c.content.includes("Receipts must be filed"));
    const travel = chunks.find((c) => c.content.includes("Economy class is the default"));

    expect(expenses?.heading).toBe("Expenses");
    expect(travel?.heading).toBe("Travel");
  });

  it("splits at heading boundaries so a chunk never straddles two sections", () => {
    const chunks = chunkText(doc, { targetTokens: 200 });

    for (const chunk of chunks) {
      const straddles =
        chunk.content.includes("Receipts must be filed") &&
        chunk.content.includes("Economy class is the default");
      expect(straddles).toBe(false);
    }
  });

  it("keeps the heading line with the body it introduces", () => {
    const chunks = chunkText(doc, { targetTokens: 200 });
    const expenses = chunks.find((c) => c.content.includes("Receipts must be filed"));

    expect(expenses?.content).toContain("## Expenses");
  });

  it("leaves the heading null for text that precedes any heading", () => {
    const chunks = chunkText("Intro text with no heading at all.", { targetTokens: 200 });

    expect(chunks[0].heading).toBeNull();
  });
});

describe("chunkText sizing and overlap", () => {
  it("overlaps consecutive chunks so a sentence split across them is still retrievable", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} carries its own distinct meaning.`).join(" ");

    const chunks = chunkText(text, { targetTokens: 60, overlapTokens: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      const previousTail = chunks[i - 1].content.slice(-40);
      expect(chunks[i].content).toContain(previousTail);
    }
  });

  it("splits a single oversized paragraph on sentence boundaries", () => {
    const text = Array.from({ length: 20 }, (_, i) => `This is sentence ${i} of one long paragraph.`).join(" ");

    const chunks = chunkText(text, { targetTokens: 40, overlapTokens: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk should start at a sentence start, not mid-word.
    for (const chunk of chunks) {
      expect(chunk.content).toMatch(/^This is sentence \d+/);
    }
  });

  it("hard-cuts text with no sentence or paragraph boundaries at all", () => {
    const chunks = chunkText("x".repeat(4000), { targetTokens: 100, overlapTokens: 0 });

    expect(chunks.length).toBe(10);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(100);
    }
  });

  it("keeps every chunk within the target plus the overlap allowance", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}. ${"content ".repeat(40)}`).join("\n\n");

    const chunks = chunkText(text, { targetTokens: 200, overlapTokens: 50 });

    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(250);
    }
  });

  it("merges a runt trailing chunk into its predecessor", () => {
    const text = `${"filler ".repeat(120)}\n\nTiny tail.`;

    const chunks = chunkText(text, { targetTokens: 200, overlapTokens: 0, minTokens: 50 });

    expect(chunks.at(-1)?.content).toContain("Tiny tail.");
    expect(chunks.every((c) => c.tokenCount >= 50)).toBe(true);
  });
});
