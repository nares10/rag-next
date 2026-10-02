import { normalizeText } from "./normalize";

/**
 * Thrown for a source this build cannot read. PDF and DOCX extraction are the obvious
 * next entries in EXTRACTORS; they need parser dependencies, so they are deliberately
 * absent rather than half-working. Callers surface this as a `failed` document with the
 * message shown to the user.
 */
export class UnsupportedSourceError extends Error {
  constructor(mimeType: string) {
    super(`Cannot read ${mimeType}. Supported types: ${[...SUPPORTED].join(", ")}.`);
    this.name = "UnsupportedSourceError";
  }
}

const EXTRACTORS: Record<string, (raw: string) => string> = {
  "text/plain": (raw) => raw,
  "text/markdown": (raw) => raw,
  "text/x-markdown": (raw) => raw,
  "text/html": htmlToMarkdown,
};

const SUPPORTED = new Set(Object.keys(EXTRACTORS));

export function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

export function supportsMimeType(mimeType: string): boolean {
  return SUPPORTED.has(baseMimeType(mimeType));
}

export function extractText(mimeType: string, raw: string): string {
  const extractor = EXTRACTORS[baseMimeType(mimeType)];

  if (!extractor) throw new UnsupportedSourceError(baseMimeType(mimeType));

  return normalizeText(extractor(raw));
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Deliberately small: enough structure for the chunker to find sections and lists, with
 * no DOM parser in the bundle. Output is markdown so it travels the same path as a
 * pasted markdown document.
 */
function htmlToMarkdown(html: string): string {
  const structured = html
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, body: string) => {
      return `\n\n${"#".repeat(Number(level))} ${stripTags(body).trim()}\n\n`;
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, body: string) => `\n- ${stripTags(body).trim()}`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|ul|ol|blockquote|pre|table)>/gi, "\n\n");

  return decodeEntities(stripTags(structured));
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}
