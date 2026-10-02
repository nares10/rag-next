import { describe, expect, it } from "bun:test";
import { UnsupportedSourceError, extractSource, supportsMimeType } from "../../lib/rag/extract";

const bytes = async (path: string) => new Uint8Array(await Bun.file(path).arrayBuffer());

describe("extractSource: text formats", () => {
  it("passes plain text through unchanged apart from normalization", async () => {
    const { text } = await extractSource("text/plain", "Receipts   must be filed.");

    expect(text).toBe("Receipts must be filed.");
  });

  it("keeps markdown structure intact", async () => {
    const md = "## Expenses\n\nReceipts must be filed within 30 days.";

    expect((await extractSource("text/markdown", md)).text).toBe(md);
  });

  it("decodes raw bytes as utf-8", async () => {
    const encoded = new TextEncoder().encode("Café — naïve");

    expect((await extractSource("text/plain", encoded)).text).toBe("Café — naïve");
  });

  it("converts html headings to markdown headings", async () => {
    const { text } = await extractSource("text/html", "<h2>Expenses</h2><p>Receipts must be filed.</p>");

    expect(text).toBe("## Expenses\n\nReceipts must be filed.");
  });

  it("drops script and style content from html", async () => {
    const { text } = await extractSource("text/html", "<style>p{color:red}</style><p>Visible</p><script>alert(1)</script>");

    expect(text).toBe("Visible");
  });

  it("turns html list items into markdown bullets", async () => {
    const { text } = await extractSource("text/html", "<ul><li>First</li><li>Second</li></ul>");

    expect(text).toBe("- First\n- Second");
  });

  it("decodes html entities", async () => {
    const { text } = await extractSource("text/html", "<p>Terms &amp; conditions&nbsp;apply</p>");

    expect(text).toBe("Terms & conditions apply");
  });

  it("ignores charset parameters on the mime type", async () => {
    expect((await extractSource("text/plain; charset=utf-8", "Body")).text).toBe("Body");
  });

  it("reports no page structure for text formats", async () => {
    expect((await extractSource("text/plain", "Body")).pages).toBeUndefined();
  });
});

describe("extractSource: PDF", () => {
  it("extracts the text of every page", async () => {
    const { text } = await extractSource("application/pdf", await bytes("tests/fixtures/handbook.pdf"));

    expect(text).toContain("Receipts must be filed within 30 days of purchase.");
    expect(text).toContain("Economy class is the default for flights under six hours.");
  });

  it("keeps the pages separate so chunks can cite a page number", async () => {
    const { pages, pageCount } = await extractSource(
      "application/pdf",
      await bytes("tests/fixtures/handbook.pdf"),
    );

    expect(pageCount).toBe(2);
    expect(pages).toHaveLength(2);
    expect(pages?.[0]).toContain("Receipts must be filed");
    expect(pages?.[0]).not.toContain("Economy class");
    expect(pages?.[1]).toContain("Economy class");
  });

  it("does not consume the bytes it was given", async () => {
    // pdf.js transfers the buffer it receives; callers still need theirs afterwards.
    const data = await bytes("tests/fixtures/handbook.pdf");
    const before = data.byteLength;

    await extractSource("application/pdf", data);

    expect(data.byteLength).toBe(before);
  });

  it("fails with a readable message on a corrupt file", async () => {
    await expect(extractSource("application/pdf", new TextEncoder().encode("not a pdf"))).rejects.toThrow(
      /PDF/i,
    );
  });

  it("refuses a PDF handed over as text, rather than parsing mojibake", async () => {
    await expect(extractSource("application/pdf", "%PDF-1.4 pretend")).rejects.toThrow(
      /binary|bytes|PDF/i,
    );
  });
});

describe("extractSource: DOCX", () => {
  it("extracts paragraphs", async () => {
    const { text } = await extractSource(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      await bytes("tests/fixtures/remote-work.docx"),
    );

    expect(text).toContain("The company provides a laptop and one external monitor");
  });

  it("maps Word headings to markdown headings so chunking can see sections", async () => {
    const { text } = await extractSource(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      await bytes("tests/fixtures/remote-work.docx"),
    );

    expect(text).toContain("# Remote Work Policy");
    expect(text).toContain("## Equipment");
    expect(text).toContain("## Working hours");
  });

  it("reports no page structure, because a .docx has none until it is laid out", async () => {
    const { pages } = await extractSource(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      await bytes("tests/fixtures/remote-work.docx"),
    );

    expect(pages).toBeUndefined();
  });

  it("fails with a readable message on a corrupt file", async () => {
    await expect(
      extractSource(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        new TextEncoder().encode("not a docx"),
      ),
    ).rejects.toThrow(/Word|docx|read/i);
  });
});

describe("supportsMimeType", () => {
  it("accepts every format the pipeline can read", () => {
    for (const mimeType of [
      "text/plain",
      "text/markdown",
      "text/html",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]) {
      expect(supportsMimeType(mimeType)).toBe(true);
    }
  });

  it("rejects formats it cannot read, naming the type", async () => {
    expect(supportsMimeType("application/msword")).toBe(false);
    expect(supportsMimeType("image/png")).toBe(false);

    await expect(extractSource("image/png", new Uint8Array([1, 2]))).rejects.toThrow(
      UnsupportedSourceError,
    );
    await expect(extractSource("image/png", new Uint8Array([1, 2]))).rejects.toThrow(/image\/png/);
  });
});
