/**
 * Cheap token estimate. The providers' real tokenizers differ from each other and
 * pulling one in just to size a prompt isn't worth the dependency: every use here is a
 * budget check where being within ~10% is enough. Four characters per token is the
 * standard heuristic for English prose.
 */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  if (!text) return 0;

  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}
