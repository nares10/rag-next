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
