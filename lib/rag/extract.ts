import { normalizeText } from "./normalize";

/**
 * Thrown for a source this build cannot read. Callers surface it as a `failed` document
 * with the message shown to the user.
 */
export class UnsupportedSourceError extends Error {
  constructor(mimeType: string) {
    super(`Cannot read ${mimeType}. Supported types: ${[...SUPPORTED].join(", ")}.`);
    this.name = "UnsupportedSourceError";
  }
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export const PDF_MIME = "application/pdf";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type ExtractedSource = {
  text: string;
  /** Per-page text, for formats that have pages. Chunks made from it carry a page number. */
  pages?: string[];
  pageCount?: number;
};

type Extractor = (data: Uint8Array | string) => Promise<ExtractedSource>;

const EXTRACTORS: Record<string, Extractor> = {
  "text/plain": async (data) => ({ text: asText(data) }),
  "text/markdown": async (data) => ({ text: asText(data) }),
  "text/x-markdown": async (data) => ({ text: asText(data) }),
  "text/html": async (data) => ({ text: htmlToMarkdown(asText(data)) }),
  [PDF_MIME]: extractPdf,
  [DOCX_MIME]: extractDocx,
};

const SUPPORTED = new Set(Object.keys(EXTRACTORS));

export function baseMimeType(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

export function supportsMimeType(mimeType: string): boolean {
  return SUPPORTED.has(baseMimeType(mimeType));
}

/** True for formats that must be handed raw bytes — decoding them as text destroys them. */
export function isBinaryMimeType(mimeType: string): boolean {
  const base = baseMimeType(mimeType);

  return base === PDF_MIME || base === DOCX_MIME;
}

export async function extractSource(
  mimeType: string,
  data: Uint8Array | string,
): Promise<ExtractedSource> {
  const base = baseMimeType(mimeType);
  const extractor = EXTRACTORS[base];

  if (!extractor) throw new UnsupportedSourceError(base);

  const extracted = await extractor(data);

  return {
    ...extracted,
    text: normalizeText(extracted.text),
    pages: extracted.pages?.map(normalizeText),
  };
}

function asText(data: Uint8Array | string): string {
  return typeof data === "string" ? data : new TextDecoder().decode(data);
}

function asBytes(data: Uint8Array | string, label: string): Uint8Array {
  if (typeof data === "string") {
    throw new ExtractionError(`A ${label} must be supplied as binary bytes, not text.`);
  }

  return data;
}

/**
 * unpdf is pdf.js packaged for server runtimes: no native bindings, no worker to
 * configure, and it runs on Vercel's Node runtime as-is.
 */
async function extractPdf(data: Uint8Array | string): Promise<ExtractedSource> {
  const bytes = asBytes(data, "PDF");
  const { extractText, getDocumentProxy } = await import("unpdf");

  try {
    // pdf.js transfers the buffer it is given, leaving the caller's view detached and
    // zero-length. Hand it a copy so extraction never consumes its input.
    const document = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text } = await extractText(document, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];

    return { text: pages.join("\n\n"), pages, pageCount: totalPages };
  } catch (error) {
    throw new ExtractionError(`This PDF could not be read: ${reason(error)}`);
  }
}

/**
 * mammoth converts to HTML rather than flat text, which is what makes Word headings
 * survive as markdown headings — and headings are what the chunker splits on.
 */
async function extractDocx(data: Uint8Array | string): Promise<ExtractedSource> {
  const bytes = asBytes(data, "Word document");
  const mammoth = (await import("mammoth")).default;

  try {
    const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });

    return { text: htmlToMarkdown(value) };
  } catch (error) {
    throw new ExtractionError(`This Word document could not be read: ${reason(error)}`);
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
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
 * no DOM parser in the bundle. Output is markdown so HTML pages and Word documents travel
 * the same path as pasted markdown.
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

const EXTENSION_MIME: Record<string, string> = {
  pdf: PDF_MIME,
  docx: DOCX_MIME,
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  html: "text/html",
  htm: "text/html",
};

/**
 * Best guess at a file's type. Browsers usually set a type on an uploaded file, but it is
 * empty or wrong often enough (notably for .md) that the extension gets the final say when
 * the declared type is one we cannot read.
 */
export function mimeTypeForUpload(fileName: string, declared: string): string {
  if (declared && supportsMimeType(declared)) return baseMimeType(declared);

  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  return EXTENSION_MIME[extension] ?? baseMimeType(declared || "application/octet-stream");
}
