import { describe, expect, it } from "bun:test";
import { UnsupportedSourceError, extractText, supportsMimeType } from "../../lib/rag/extract";

describe("extractText", () => {
  it("passes plain text through unchanged apart from normalization", () => {
    expect(extractText("text/plain", "Receipts   must be filed.")).toBe("Receipts must be filed.");
  });

  it("keeps markdown structure intact", () => {
    const md = "## Expenses\n\nReceipts must be filed within 30 days.";

    expect(extractText("text/markdown", md)).toBe(md);
  });

  it("converts html headings to markdown headings so chunking can see sections", () => {
    const html = "<h2>Expenses</h2><p>Receipts must be filed.</p>";

    expect(extractText("text/html", html)).toBe("## Expenses\n\nReceipts must be filed.");
  });

  it("drops script and style content from html", () => {
    const html = "<style>p{color:red}</style><p>Visible</p><script>alert(1)</script>";

    const text = extractText("text/html", html);

    expect(text).toBe("Visible");
  });

  it("turns html list items into markdown bullets", () => {
    const text = extractText("text/html", "<ul><li>First</li><li>Second</li></ul>");

    expect(text).toBe("- First\n- Second");
  });

  it("decodes html entities", () => {
    expect(extractText("text/html", "<p>Terms &amp; conditions&nbsp;apply</p>")).toBe(
      "Terms & conditions apply",
    );
  });

  it("rejects a source type it cannot read, naming the type", () => {
    expect(() => extractText("application/pdf", "%PDF-1.4")).toThrow(UnsupportedSourceError);
    expect(() => extractText("application/pdf", "%PDF-1.4")).toThrow(/application\/pdf/);
  });

  it("reports which mime types it supports", () => {
    expect(supportsMimeType("text/plain")).toBe(true);
    expect(supportsMimeType("text/markdown")).toBe(true);
    expect(supportsMimeType("text/html")).toBe(true);
    expect(supportsMimeType("application/pdf")).toBe(false);
  });

  it("ignores charset parameters on the mime type", () => {
    expect(extractText("text/plain; charset=utf-8", "Body")).toBe("Body");
  });
});
