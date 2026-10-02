/**
 * Canonicalizes extracted text before it is hashed, chunked and embedded.
 *
 * Two reasons this runs before the content hash: the same document re-exported by a
 * different tool should dedupe to one entry, and whitespace noise otherwise burns
 * embedding tokens and dilutes the vector.
 */
// Zero-width space, ZWNJ, ZWJ, BOM. These survive copy-paste from PDFs and silently
// break both keyword matching and tokenization.
const ZERO_WIDTH = /[​-‍﻿]/g;

export function normalizeText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A line must appear on at least this share of pages to count as a header or footer.
 * Set high deliberately: deleting a sentence that merely recurs in the body loses real
 * content, while leaving a header in place only costs a few tokens per chunk.
 */
const REPEAT_THRESHOLD = 0.8;
/** Below this, "appears on most pages" is indistinguishable from "the document is short". */
const MIN_PAGES_FOR_STRIPPING = 3;

/**
 * Drops running headers and footers from paginated text.
 *
 * Every page of a PDF repeats its header, and that text would otherwise be embedded into
 * each chunk, diluting the vector and giving the model the company name over and over
 * where the passage should be. Only the first and last few lines of a page are considered,
 * so a sentence that legitimately recurs in the body is kept.
 */
export function stripRepeatedPageLines(pages: string[]): string[] {
  if (pages.length < MIN_PAGES_FOR_STRIPPING) return pages;

  const EDGE_LINES = 3;
  const counts = new Map<string, number>();

  for (const page of pages) {
    const lines = page.split("\n").map((line) => line.trim());
    const edges = new Set([...lines.slice(0, EDGE_LINES), ...lines.slice(-EDGE_LINES)]);

    for (const line of edges) {
      if (line) counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }

  const repeated = new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= pages.length * REPEAT_THRESHOLD)
      .map(([line]) => line),
  );

  if (repeated.size === 0) return pages;

  return pages.map((page) => {
    const lines = page.split("\n");
    const kept = lines.filter((line, index) => {
      const isEdge = index < EDGE_LINES || index >= lines.length - EDGE_LINES;

      return !(isEdge && repeated.has(line.trim()));
    });

    return kept.join("\n").trim();
  });
}
