import { EMBEDDING_DIMENSIONS } from "../../lib/rag/embed";

/**
 * A deterministic stand-in for a real embedding model.
 *
 * Texts about the same thing land close together and unrelated texts land far apart,
 * which is enough for the retrieval tests and the eval harness to exercise real ranking
 * behaviour without calling a paid API. It is not a quality model: it only knows exact
 * vocabulary overlap, so eval scores produced with it measure the pipeline's ranking
 * logic, not how good retrieval actually is. See tests/eval/README.md.
 */

// Function words carry no topic signal; keeping them would make every pair of English
// sentences look similar, which is exactly what a real embedding model avoids.
const STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "do", "does", "did", "i", "you", "we", "it", "is", "are",
  "was", "were", "be", "been", "have", "has", "had", "how", "what", "when", "where", "who",
  "why", "for", "on", "at", "by", "and", "or", "but", "if", "my", "our", "their", "this",
  "that", "these", "those", "there", "with", "from", "as", "can", "will", "would", "should",
  "about", "any", "all", "long", "much", "many", "get", "got", "need", "just",
]);

function hashWord(word: string): number {
  let hash = 2166136261;

  for (const char of word) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash) % EMBEDDING_DIMENSIONS;
}

/** Crude stemmer: enough that "filed" and "file" land on the same axis. */
function stem(word: string): string {
  const trimmed = word.replace(/(ing|ed|es|s)$/, "");

  return (trimmed.length >= 3 ? trimmed : word).replace(/e$/, "");
}

/** Unit-length bag-of-content-words vector. Shared topic means high cosine similarity. */
export function fakeEmbedding(text: string): number[] {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);

  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (STOPWORDS.has(word) || word.length < 2) continue;

    vector[hashWord(stem(word))] += 1;
  }

  const magnitude = Math.hypot(...vector) || 1;

  return vector.map((value) => value / magnitude);
}

export async function fakeEmbedder(texts: string[]): Promise<number[][]> {
  return texts.map(fakeEmbedding);
}
