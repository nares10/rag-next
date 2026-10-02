import { estimateTokens } from "./tokens";

export type ChunkDraft = {
  ordinal: number;
  content: string;
  tokenCount: number;
  heading: string | null;
};

export type ChunkOptions = {
  targetTokens?: number;
  overlapTokens?: number;
  minTokens?: number;
};

export const CHUNK_DEFAULTS = {
  targetTokens: 800,
  overlapTokens: 100,
  minTokens: 80,
} as const;

type Section = { heading: string | null; body: string };

// A markdown ATX heading line. Setext headings (underlined with === / ---) are rare in
// the sources this app ingests and are left to the paragraph splitter.
const HEADING_LINE = /^(#{1,6})\s+(.+?)\s*$/;

export function chunkText(text: string, options: ChunkOptions = {}): ChunkDraft[] {
  const { targetTokens, overlapTokens, minTokens } = { ...CHUNK_DEFAULTS, ...options };
  const trimmed = text.trim();

  if (!trimmed) return [];

  const drafts: Omit<ChunkDraft, "ordinal">[] = [];

  for (const section of splitIntoSections(trimmed)) {
    const pieces = applyOverlap(
      mergeRunts(splitToTarget(section.body, targetTokens, 0), minTokens, targetTokens),
      overlapTokens,
    );

    for (const content of pieces) {
      drafts.push({ content, tokenCount: estimateTokens(content), heading: section.heading });
    }
  }

  return drafts.map((draft, ordinal) => ({ ordinal, ...draft }));
}

/**
 * Cuts the document at every heading line. A chunk therefore never straddles two
 * sections, which keeps the citation heading honest, and the heading line itself stays
 * at the top of the section's first chunk so the embedding sees what the text is about.
 */
function splitIntoSections(text: string): Section[] {
  const sections: Section[] = [];
  let heading: string | null = null;
  let lines: string[] = [];

  const flush = () => {
    const body = lines.join("\n").trim();
    if (body) sections.push({ heading, body });
  };

  for (const line of text.split("\n")) {
    const match = line.match(HEADING_LINE);

    if (!match) {
      lines.push(line);
      continue;
    }

    flush();
    heading = match[2];
    lines = [line];
  }

  flush();

  return sections;
}

/**
 * Recursive split: paragraphs first, then sentences, then a hard character cut. Each
 * level is only reached when the level above left a unit that is still too big, so
 * natural boundaries are always preferred and the hard cut is a last resort.
 */
const SEPARATORS = [/\n{2,}/, /(?<=[.!?])\s+/] as const;

function splitToTarget(text: string, targetTokens: number, level: number): string[] {
  if (estimateTokens(text) <= targetTokens) return [text];
  if (level >= SEPARATORS.length) return hardCut(text, targetTokens);

  const units = text.split(SEPARATORS[level]).filter((unit) => unit.trim());

  if (units.length <= 1) return splitToTarget(text, targetTokens, level + 1);

  const joiner = level === 0 ? "\n\n" : " ";
  const out: string[] = [];
  let current = "";

  for (const unit of units) {
    const candidate = current ? `${current}${joiner}${unit}` : unit;

    if (estimateTokens(candidate) <= targetTokens) {
      current = candidate;
      continue;
    }

    if (current) {
      out.push(current);
      current = "";
    }

    if (estimateTokens(unit) > targetTokens) {
      out.push(...splitToTarget(unit, targetTokens, level + 1));
    } else {
      current = unit;
    }
  }

  if (current) out.push(current);

  return out;
}

/**
 * Splits into the fewest pieces that respect the target, sized evenly. Cutting at a fixed
 * stride instead would leave a remainder piece that is often only a few tokens long and
 * can no longer be merged back without breaking the target.
 */
function hardCut(text: string, targetTokens: number): string[] {
  const pieceCount = Math.ceil(text.length / (targetTokens * 4));
  const size = Math.ceil(text.length / pieceCount);
  const out: string[] = [];

  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size));
  }

  return out;
}

/**
 * A chunk of a dozen tokens embeds to noise and pollutes the result list, so undersized
 * pieces are folded into a neighbour — but never past the target, which would break the
 * size guarantee the prompt budget relies on.
 */
function mergeRunts(pieces: string[], minTokens: number, targetTokens: number): string[] {
  const out: string[] = [];

  for (const piece of pieces) {
    const previous = out.at(-1);
    const isRunt = estimateTokens(piece) < minTokens;
    const fits = previous !== undefined && estimateTokens(`${previous} ${piece}`) <= targetTokens;

    if (isRunt && previous !== undefined && fits) {
      out[out.length - 1] = joinPieces(previous, piece);
      continue;
    }

    out.push(piece);
  }

  return out;
}

function joinPieces(left: string, right: string): string {
  return left.includes("\n") || right.includes("\n") ? `${left}\n\n${right}` : `${left} ${right}`;
}

/**
 * Prefixes each chunk with the tail of its predecessor. A fact stated across a chunk
 * boundary ("...the limit is" | "30 days") is otherwise unretrievable from either side.
 * The tail is an exact character slice: snapping it to a word boundary would cost a few
 * tokens of context and buys nothing, since the embedding sees the whole chunk anyway.
 */
function applyOverlap(pieces: string[], overlapTokens: number): string[] {
  if (overlapTokens <= 0 || pieces.length < 2) return pieces;

  const size = overlapTokens * 4;
  const out: string[] = [];

  for (const [index, piece] of pieces.entries()) {
    if (index === 0) {
      out.push(piece);
      continue;
    }

    out.push(`${out[index - 1].slice(-size)}${piece}`);
  }

  return out;
}
