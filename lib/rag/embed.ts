/**
 * Embedding client.
 *
 * Embeddings always use the server's own OpenAI key, even when the user chats through
 * Anthropic or OpenRouter: a corpus is only searchable if every vector in it — and the
 * query vector — come from the same model, so this is not a per-user choice.
 */
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_BATCH_SIZE = 96;

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

export type Embedder = (texts: string[]) => Promise<number[][]>;

export type EmbedderOptions = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  batchSize?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export class EmbeddingError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "EmbeddingError";
    this.status = status;
  }
}

export function createEmbedder(options: EmbedderOptions = {}): Embedder {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? EMBEDDING_MODEL;
  const batchSize = options.batchSize ?? EMBEDDING_BATCH_SIZE;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const fetchImpl = options.fetchImpl ?? fetch;
  // `||` not `??`: an env var set to an empty string is a blank line in a .env file, not
  // a deliberate choice of "" as the base URL.
  const endpoint = `${options.baseUrl || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL}/embeddings`;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  if (!apiKey) {
    throw new EmbeddingError(
      "OPENAI_API_KEY is missing. Embeddings always use the server key, so document search needs it even when chatting with another provider.",
    );
  }

  return async function embed(texts) {
    if (texts.length === 0) return [];

    const vectors: number[][] = [];

    for (let start = 0; start < texts.length; start += batchSize) {
      vectors.push(...(await embedBatch(texts.slice(start, start + batchSize))));
    }

    return vectors;
  };

  async function embedBatch(batch: string[]): Promise<number[][]> {
    let lastError: EmbeddingError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await requestBatch(batch);
      } catch (error) {
        if (!(error instanceof EmbeddingError) || !isRetryable(error.status)) throw error;

        lastError = error;

        if (attempt < maxAttempts) {
          // Exponential backoff with jitter so a burst of parallel batches doesn't
          // retry in lockstep and trip the rate limit again.
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1) * (1 + Math.random()));
        }
      }
    }

    throw lastError ?? new EmbeddingError("Embedding request failed.");
  }

  async function requestBatch(batch: string[]): Promise<number[][]> {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: batch }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const message =
        (payload as { error?: { message?: string } })?.error?.message ??
        `Embedding request failed with status ${response.status}`;

      throw new EmbeddingError(message, response.status);
    }

    const payload = (await response.json()) as { data?: Array<{ index?: number; embedding?: number[] }> };
    const data = payload.data ?? [];

    if (data.length !== batch.length) {
      throw new EmbeddingError(`Expected ${batch.length} embeddings, received ${data.length}.`);
    }

    const ordered: number[][] = new Array(batch.length);

    for (const [position, entry] of data.entries()) {
      const embedding = entry.embedding ?? [];

      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new EmbeddingError(
          `Embedding has ${embedding.length} dimensions, but the Chunk.embedding column is vector(${EMBEDDING_DIMENSIONS}).`,
        );
      }

      ordered[entry.index ?? position] = embedding;
    }

    return ordered;
  }
}

function isRetryable(status?: number): boolean {
  return status === 429 || (status !== undefined && status >= 500);
}

/**
 * An embedder that is configured on first use. Callers on the chat path need a value they
 * can hand to retrieval without knowing whether embeddings are configured at all: a
 * missing key then fails inside the retrieval try/catch and degrades the answer, instead
 * of throwing while the request is still being set up.
 */
export function lazyEmbedder(options: EmbedderOptions = {}): Embedder {
  let embedder: Embedder | undefined;

  return async (texts) => {
    embedder ??= createEmbedder(options);

    return embedder(texts);
  };
}
