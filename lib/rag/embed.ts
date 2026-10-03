/**
 * Embedding client.
 *
 * Embeddings always use the server's own key, whichever provider the user chats with: a
 * corpus is only searchable if every vector in it — and the query vector — come from the
 * same model, so this is not a per-user choice.
 *
 * Both providers speak the OpenAI embeddings API. "openrouter" (the default, and the only
 * one the server funds) routes to OpenAI's model through OpenRouter with
 * OPENROUTER_API_KEY, at OPENROUTER_BASE_URL when that is set. "openai" is an explicit
 * opt-in via EMBEDDING_PROVIDER, for calling OpenAI directly or anything compatible with
 * it (a local gateway, the eval runner) through OPENAI_BASE_URL — it is never reached by
 * default, so the server's OpenAI key is not spent unless you ask for it.
 */
export const EMBEDDING_PROVIDERS = ["openrouter", "openai"] as const;
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

/**
 * The model every stored chunk is tagged with. OpenRouter serves the same model under a
 * vendor-prefixed id, so vectors from either provider share one space and one tag.
 */
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const OPENROUTER_EMBEDDING_MODEL = `openai/${EMBEDDING_MODEL}`;
/** Fixed by the `vector(1536)` column on Chunk, which is text-embedding-3-small's width. */
export const EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_BATCH_SIZE = 96;

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_SITE_URL = "http://localhost:3000";
const OPENROUTER_SITE_NAME = "RAG";
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
/**
 * Ceiling on a provider-requested wait. A rate-limit window of tens of seconds is worth
 * waiting out; anything beyond this is a quota that will not reopen in time, and
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
  const provider = (options.provider ?? process.env.EMBEDDING_PROVIDER ?? "openrouter") as EmbeddingProvider;

  if (!EMBEDDING_PROVIDERS.includes(provider)) {
    throw new EmbeddingError(
      `Unknown embedding provider "${provider}". Set EMBEDDING_PROVIDER to one of: ${EMBEDDING_PROVIDERS.join(", ")}.`,
    );
  }

  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const batchSize = options.batchSize ?? EMBEDDING_BATCH_SIZE;
  const requestBatch = provider === "openrouter" ? openRouterRequest(options) : openAiRequest(options);

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
          // Prefer the provider's own figure: a rate-limit window can be tens of seconds,
          // and guessing a sub-second backoff burns every attempt before it reopens.
          // Otherwise exponential backoff with jitter, so a burst of parallel
          // batches doesn't retry in lockstep and trip the limit again.
          await sleep(error.retryAfterMs ?? BASE_DELAY_MS * 2 ** (attempt - 1) * (1 + Math.random()));
        }
      }
    }

    throw lastError ?? new EmbeddingError("Embedding request failed.");
  }
}


/**
 * Only reachable by setting EMBEDDING_PROVIDER=openai (or passing the provider
 * explicitly), which is how the eval runner scores a real model on an OpenAI-compatible
 * endpoint. Nothing on the request path chooses it, so the server's OpenAI key stays
 * unspent unless you opt in.
 */
function openAiRequest(options: EmbedderOptions): BatchRequest {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new EmbeddingError(
      "OPENAI_API_KEY is missing, and EMBEDDING_PROVIDER asks for OpenAI directly. Unset it to embed through OpenRouter instead.",
    );
  }

  return embeddingsRequest({
    apiKey,
    // Not EMBEDDING_MODEL: that names the model for the default OpenRouter path, and
    // OpenRouter's vendor-prefixed id is not something OpenAI's own API accepts.
    model: options.model ?? process.env.OPENAI_EMBEDDING_MODEL ?? EMBEDDING_MODEL,
    // `||` not `??`: an env var set to an empty string is a blank line in a .env file, not
    // a deliberate choice of "" as the base URL.
    baseUrl: options.baseUrl || process.env.OPENAI_BASE_URL || OPENAI_BASE_URL,
    fetchImpl: options.fetchImpl ?? fetch,
  });
}

function openRouterRequest(options: EmbedderOptions): BatchRequest {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new EmbeddingError(
      "OPENROUTER_API_KEY is missing. Embeddings always use the server key, so document search needs it whichever provider the chat uses.",
    );
  }

  return embeddingsRequest({
    apiKey,
    model: options.model ?? process.env.EMBEDDING_MODEL ?? OPENROUTER_EMBEDDING_MODEL,
    baseUrl: options.baseUrl || process.env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL,
    fetchImpl: options.fetchImpl ?? fetch,
    // Optional attribution, shown in OpenRouter's app rankings.
    headers: { "HTTP-Referer": OPENROUTER_SITE_URL, "X-OpenRouter-Title": OPENROUTER_SITE_NAME },
  });
}

function embeddingsRequest(config: {
  apiKey: string;
  model: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
  headers?: Record<string, string>;
}): BatchRequest {
  const { apiKey, model, baseUrl, fetchImpl, headers } = config;
  const endpoint = `${baseUrl}/embeddings`;

  return async function request(batch) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ model, input: batch, encoding_format: "float" }),
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

async function readPayload(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      (body as { error?: { message?: string } })?.error?.message ??
      `${label} failed with status ${response.status}`;

    throw new EmbeddingError(message, response.status, retryAfterMs(response));
  }

  return response.json();
}

/** How long the standard `Retry-After` header asks us to wait, in milliseconds. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  const wait = header ? Number(header) * 1000 : Number.NaN;

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
