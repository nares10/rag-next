import { describe, expect, it } from "bun:test";
import { estimateTokens } from "../../lib/rag/tokens";

describe("estimateTokens", () => {
  it("is zero for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("approximates four characters per token", () => {
    // 400 characters of a single repeated letter is ~100 BPE tokens.
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("never reports zero tokens for non-empty input", () => {
    expect(estimateTokens("hi")).toBe(1);
  });

  it("grows with length", () => {
    expect(estimateTokens("word ".repeat(100))).toBeGreaterThan(estimateTokens("word ".repeat(10)));
  });
});
