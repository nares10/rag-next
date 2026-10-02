import { describe, expect, it } from "bun:test";
import { normalizeText } from "../../lib/rag/normalize";

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
