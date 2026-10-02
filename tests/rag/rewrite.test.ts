import { describe, expect, it } from "bun:test";
import { rewriteQuery } from "../../lib/rag/rewrite";

const history = [
  { role: "user", content: "What does the handbook say about expenses?" },
  { role: "assistant", content: "Receipts must be filed within 30 days." },
];

describe("rewriteQuery", () => {
  it("returns the message unchanged when there is no history to resolve against", async () => {
    const complete = async () => "should not be called";

    expect(await rewriteQuery({ message: "What about travel?", history: [], complete })).toBe(
      "What about travel?",
    );
  });

  it("resolves a follow-up into a standalone query", async () => {
    const complete = async () => "What does the handbook say about travel?";

    const result = await rewriteQuery({ message: "What about travel?", history, complete });

    expect(result).toBe("What does the handbook say about travel?");
  });

  it("passes the recent turns and the message to the completion", async () => {
    let seen = "";
    const complete = async (prompt: string) => {
      seen = prompt;
      return "rewritten";
    };

    await rewriteQuery({ message: "What about travel?", history, complete });

    expect(seen).toContain("What does the handbook say about expenses?");
    expect(seen).toContain("What about travel?");
  });

  it("falls back to the original message when the rewrite fails", async () => {
    const complete = async () => {
      throw new Error("provider timeout");
    };

    expect(await rewriteQuery({ message: "What about travel?", history, complete })).toBe(
      "What about travel?",
    );
  });

  it("falls back to the original message when the rewrite comes back empty", async () => {
    const complete = async () => "   ";

    expect(await rewriteQuery({ message: "What about travel?", history, complete })).toBe(
      "What about travel?",
    );
  });

  it("ignores a rewrite that is suspiciously long, which means the model answered instead", async () => {
    const complete = async () => "x".repeat(2000);

    expect(await rewriteQuery({ message: "What about travel?", history, complete })).toBe(
      "What about travel?",
    );
  });

  it("only shows the completion the most recent turns", async () => {
    let seen = "";
    const long = Array.from({ length: 10 }, (_, i) => ({ role: "user", content: `turn ${i}` }));
    const complete = async (prompt: string) => {
      seen = prompt;
      return "rewritten";
    };

    await rewriteQuery({ message: "and then?", history: long, complete, historyTurns: 2 });

    expect(seen).toContain("turn 9");
    expect(seen).not.toContain("turn 0");
  });
});
