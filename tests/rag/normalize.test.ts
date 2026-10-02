import { describe, expect, it } from "bun:test";
import { normalizeText, stripRepeatedPageLines } from "../../lib/rag/normalize";

describe("normalizeText", () => {
  it("normalizes windows line endings to unix", () => {
    expect(normalizeText("one\r\ntwo")).toBe("one\ntwo");
  });

  it("collapses runs of spaces and tabs within a line", () => {
    expect(normalizeText("too     many \t spaces")).toBe("too many spaces");
  });

  it("keeps paragraph breaks but collapses longer runs of blank lines", () => {
    expect(normalizeText("one\n\ntwo\n\n\n\n\nthree")).toBe("one\n\ntwo\n\nthree");
  });

  it("strips trailing whitespace from each line", () => {
    expect(normalizeText("heading   \nbody")).toBe("heading\nbody");
  });

  it("applies unicode NFKC so ligatures and full-width forms match plain text", () => {
    expect(normalizeText("ﬁle")).toBe("file");
    expect(normalizeText("ＡＢ")).toBe("AB");
  });

  it("removes zero-width characters that break word matching", () => {
    expect(normalizeText("in​voice")).toBe("invoice");
  });

  it("trims leading and trailing blank space from the whole document", () => {
    expect(normalizeText("\n\n  body  \n\n")).toBe("body");
  });

  it("preserves markdown heading markers", () => {
    expect(normalizeText("## Section  \n\nBody text")).toBe("## Section\n\nBody text");
  });
});

describe("stripRepeatedPageLines", () => {
  const pages = (bodies: string[]) => bodies.map((body) => body.trim());

  it("removes a running header that appears on every page", () => {
    const input = pages([
      "ACME Internal\nExpenses\nReceipts within 30 days.",
      "ACME Internal\nTravel\nEconomy by default.",
      "ACME Internal\nLeave\nTwenty five days a year.",
    ]);

    const result = stripRepeatedPageLines(input);

    expect(result.every((page) => !page.includes("ACME Internal"))).toBe(true);
    expect(result[0]).toContain("Receipts within 30 days.");
  });

  it("removes a running footer too", () => {
    const input = pages([
      "Expenses\nReceipts within 30 days.\nConfidential",
      "Travel\nEconomy by default.\nConfidential",
      "Leave\nTwenty five days a year.\nConfidential",
    ]);

    expect(stripRepeatedPageLines(input).every((page) => !page.includes("Confidential"))).toBe(true);
  });

  it("keeps a line that only appears on some pages", () => {
    const input = pages([
      "Expenses\nReceipts within 30 days.",
      "Travel\nReceipts within 30 days.",
      "Leave\nTwenty five days a year.",
    ]);

    const result = stripRepeatedPageLines(input);

    expect(result[0]).toContain("Receipts within 30 days.");
  });

  it("leaves a two-page document alone, where every line looks repeated", () => {
    const input = pages(["Shared\nFirst", "Shared\nSecond"]);

    expect(stripRepeatedPageLines(input)).toEqual(input);
  });

  it("ignores page numbers that differ, which is what makes them hard to strip", () => {
    const input = pages(["Body one\nPage 1", "Body two\nPage 2", "Body three\nPage 3"]);

    const result = stripRepeatedPageLines(input);

    expect(result[0]).toContain("Body one");
  });

  it("returns a single page untouched", () => {
    expect(stripRepeatedPageLines(["Only page"])).toEqual(["Only page"]);
  });
});
