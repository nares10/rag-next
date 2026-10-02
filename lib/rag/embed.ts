/**
 * Embedding client.
 *
 * Embeddings always use the server's own key, whichever provider the user chats with: a
 * corpus is only searchable if every vector in it — and the query vector — come from the
 * same model, so this is not a per-user choice.
 *
 * Two providers are supported. "openai" speaks the OpenAI embeddings API and therefore
 * also covers anything compatible with it (OpenRouter, a local gateway, the test stub)
 * through OPENAI_BASE_URL. "gemini" speaks Google's own shape and is the one with a free
 * tier that needs no billing account.
 */
export const EMBEDDING_PROVIDERS = ["openai", "gemini"] as const;
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
/**
 * Fixed by the `vector(1536)` column on Chunk. Both supported models can produce exactly
 * this width — Gemini through Matryoshka truncation, which is why 1536 was chosen over
 * its 3072 default.
 */
export const EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_BATCH_SIZE = 96;
/** Gemini's batch endpoint accepts fewer requests per call than OpenAI's. */
export const GEMINI_BATCH_SIZE = 100;

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
/**
 * Ceiling on a provider-requested wait. A free-tier quota window is tens of seconds and
 * worth waiting out; anything beyond this is a quota that will not reopen in time, and
 * blocking on it would hang an ingest run silently.
 */
const MAX_RETRY_AFTER_MS = 90_000;

/**
 * Whether the text is something to be found, or something someone is searching for.
 * Models trained with asymmetric retrieval objectives embed the two differently, and using
 * the wrong one measurably hurts recall. Providers without the distinction ignore it.
 */
export type EmbeddingKind = "document" | "query";

export type Embedder = (
  texts: string[],
  options?: { kind?: EmbeddingKind },
) => Promise<number[][]>;

export type EmbedderOptions = {
  provider?: string;
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
  /** How long the provider asked us to wait, when it said so. */
  readonly retryAfterMs?: number;

  constructor(message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = "EmbeddingError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

type BatchRequest = (texts: string[], kind: EmbeddingKind) => Promise<number[][]>;

export function createEmbedder(options: EmbedderOptions = {}): Embedder {
  const provider = (options.provider ?? process.env.EMBEDDING_PROVIDER ?? "openai") as EmbeddingProvider;

  if (!EMBEDDING_PROVIDERS.includes(provider)) {
    throw new EmbeddingError(
      `Unknown embedding provider "${provider}". Set EMBEDDING_PROVIDER to one of: ${EMBEDDING_PROVIDERS.join(", ")}.`,
    );
  }

  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const isGemini = provider === "gemini";
  const batchSize = options.batchSize ?? (isGemini ? GEMINI_BATCH_SIZE : EMBEDDING_BATCH_SIZE);
  const requestBatch = isGemini ? geminiRequest(options) : openAiRequest(options);

  return async function embed(texts, embedOptions) {
    if (texts.length === 0) return [];

    const kind = embedOptions?.kind ?? "document";
    const vectors: number[][] = [];

    for (let start = 0; start < texts.length; start += batchSize) {
      vectors.push(...(await withRetries(() => requestBatch(texts.slice(start, start + batchSize), kind))));
    }

    return vectors;
  };

  async function withRetries(work: () => Promise<number[][]>): Promise<number[][]> {
    let lastError: EmbeddingError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await work();
      } catch (error) {
        if (!(error instanceof EmbeddingError) || !isRetryable(error.status)) throw error;

        lastError = error;

        if (attempt < maxAttempts) {
          // Prefer the provider's own figure: on a free tier the quota window is tens of
          // seconds, and guessing a sub-second backoff burns every attempt before it
          // reopens. Otherwise exponential backoff with jitter, so a burst of parallel
          // batches doesn't retry in lockstep and trip the limit again.
          await sleep(error.retryAfterMs ?? BASE_DELAY_MS * 2 ** (attempt - 1) * (1 + Math.random()));
        }
      }
    }

    throw lastError ?? new EmbeddingError("Embedding request failed.");
  }
}

function openAiRequest(options: EmbedderOptions): BatchRequest {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? process.env.EMBEDDING_MODEL ?? EMBEDDING_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  // `||` not `??`: an env var set to an empty string is a blank line in a .env file, not
  // a deliberate choice of "" as the base URL.
  const endpoint = `${options.baseUrl || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL}/embeddings`;

  if (!apiKey) {
    throw new EmbeddingError(
      "OPENAI_API_KEY is missing. Embeddings always use the server key, so document search needs it even when chatting with another provider.",
    );
  }

  return async function request(batch) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: batch }),
    });

    const payload = await readPayload(response, "Embedding request");
    const data = (payload as { data?: Array<{ index?: number; embedding?: number[] }> }).data ?? [];

    if (data.length !== batch.length) {
      throw new EmbeddingError(`Expected ${batch.length} embeddings, received ${data.length}.`);
    }

    const ordered: number[][] = new Array(batch.length);

    for (const [position, entry] of data.entries()) {
      ordered[entry.index ?? position] = checkWidth(entry.embedding ?? []);
    }

    return ordered;
  };
}

function geminiRequest(options: EmbedderOptions): BatchRequest {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const model = options.model ?? process.env.EMBEDDING_MODEL ?? GEMINI_EMBEDDING_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${options.baseUrl || GEMINI_BASE_URL}/models/${model}:batchEmbedContents`;

  if (!apiKey) {
    throw new EmbeddingError(
      "GEMINI_API_KEY is missing. Document search needs it whichever provider the chat uses.",
    );
  }

  return async function request(batch, kind) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: batch.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      }),
    });

    const payload = await readPayload(response, "Embedding request");
    const embeddings = (payload as { embeddings?: Array<{ values?: number[] }> }).embeddings ?? [];

    if (embeddings.length !== batch.length) {
      throw new EmbeddingError(`Expected ${batch.length} embeddings, received ${embeddings.length}.`);
    }

    // Gemini only returns unit vectors at its full 3072 width; truncated ones have to be
    // normalized before they are stored, or similarity scores are not comparable.
    return embeddings.map((entry) => normalize(checkWidth(entry.values ?? [])));
  };
}

async function readPayload(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      (body as { error?: { message?: string } })?.error?.message ??
      `${label} failed with status ${response.status}`;

    throw new EmbeddingError(message, response.status, retryAfterMs(response, body));
  }

  return response.json();
}

type RetryInfo = { retryDelay?: string };

/**
 * How long to wait, in the two forms providers express it: the standard `Retry-After`
 * header, and Google's RetryInfo detail carrying a duration like "45.6s".
 */
function retryAfterMs(response: Response, body: unknown): number | undefined {
  const details = (body as { error?: { details?: RetryInfo[] } })?.error?.details ?? [];
  const retryDelay = details.find((detail) => detail?.retryDelay)?.retryDelay;
  const fromBody = retryDelay ? Number.parseFloat(retryDelay) * 1000 : Number.NaN;
  const header = response.headers.get("retry-after");
  const fromHeader = header ? Number(header) * 1000 : Number.NaN;
  const wait = Number.isFinite(fromBody) ? fromBody : fromHeader;

  if (!Number.isFinite(wait) || wait <= 0) return undefined;

  return Math.min(wait, MAX_RETRY_AFTER_MS);
}

function checkWidth(embedding: number[]): number[] {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingError(
      `Embedding has ${embedding.length} dimensions, but the Chunk.embedding column is vector(${EMBEDDING_DIMENSIONS}).`,
    );
  }

  return embedding;
}

function normalize(vector: number[]): number[] {
  const magnitude = Math.hypot(...vector);

  if (magnitude === 0) return vector;

  return vector.map((value) => value / magnitude);
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

  return async (texts, embedOptions) => {
    embedder ??= createEmbedder(options);

    return embedder(texts, embedOptions);
  };
}
