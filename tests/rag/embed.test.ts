import { describe, expect, it } from "bun:test";
import { EMBEDDING_DIMENSIONS, OPENROUTER_EMBEDDING_MODEL, createEmbedder } from "../../lib/rag/embed";

const vector = (seed: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === seed ? 1 : 0));

function okResponse(count: number, offset = 0) {
  return new Response(
    JSON.stringify({ data: Array.from({ length: count }, (_, i) => ({ index: i, embedding: vector(offset + i) })) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function errorResponse(status: number, message = "boom") {
  return new Response(JSON.stringify({ error: { message } }), { status });
}

type Call = { url: string; body: { model?: string; input?: string[] }; headers: Record<string, string> };

function recorder(responses: Response[]) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      headers: init?.headers as Record<string, string>,
    });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    return next;
  };

  return { calls, fetchImpl };
}

const embedderWith = (responses: Response[], overrides = {}) => {
  const { calls, fetchImpl } = recorder(responses);
  const embed = createEmbedder({
    provider: "openai",
    apiKey: "test-key",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
    ...overrides,
  });

  return { calls, embed };
};

describe("createEmbedder: openai", () => {
  it("does not call the provider for an empty input list", async () => {
    const { calls, embed } = embedderWith([]);

    expect(await embed([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("sends the texts to the embeddings endpoint with the configured model", async () => {
    const { calls, embed } = embedderWith([okResponse(2)]);

    await embed(["first", "second"]);

    expect(calls[0].url).toBe("https://api.openai.com/v1/embeddings");
    expect(calls[0].body.input).toEqual(["first", "second"]);
    expect(calls[0].body.model).toBe("text-embedding-3-small");
    expect(calls[0].headers.Authorization).toBe("Bearer test-key");
  });

  it("returns one vector per input, in input order", async () => {
    const { embed } = embedderWith([okResponse(2)]);

    const vectors = await embed(["first", "second"]);

    expect(vectors).toHaveLength(2);
    expect(vectors[0][0]).toBe(1);
    expect(vectors[1][1]).toBe(1);
  });

  it("reorders vectors when the provider returns them out of order", async () => {
    const body = JSON.stringify({
      data: [
        { index: 1, embedding: vector(1) },
        { index: 0, embedding: vector(0) },
      ],
    });
    const { embed } = embedderWith([new Response(body, { status: 200 })]);

    const vectors = await embed(["first", "second"]);

    expect(vectors[0][0]).toBe(1);
    expect(vectors[1][1]).toBe(1);
  });

  it("splits input into batches and concatenates the results in order", async () => {
    const { calls, embed } = embedderWith([okResponse(2, 0), okResponse(1, 2)], { batchSize: 2 });

    const vectors = await embed(["a", "b", "c"]);

    expect(calls).toHaveLength(2);
    expect(calls[0].body.input).toEqual(["a", "b"]);
    expect(calls[1].body.input).toEqual(["c"]);
    expect(vectors).toHaveLength(3);
    expect(vectors[2][2]).toBe(1);
  });

  it("retries a rate-limited batch and succeeds", async () => {
    const { calls, embed } = embedderWith([errorResponse(429), okResponse(1)]);

    const vectors = await embed(["a"]);

    expect(calls).toHaveLength(2);
    expect(vectors).toHaveLength(1);
  });

  it("gives up after the attempt limit and surfaces the provider message", async () => {
    const { calls, embed } = embedderWith([errorResponse(500, "upstream down"), errorResponse(500, "upstream down"), errorResponse(500, "upstream down")]);

    await expect(embed(["a"])).rejects.toThrow(/upstream down/);
    expect(calls).toHaveLength(3);
  });

  it("does not retry a client error", async () => {
    const { calls, embed } = embedderWith([errorResponse(400, "bad input")]);

    await expect(embed(["a"])).rejects.toThrow(/bad input/);
    expect(calls).toHaveLength(1);
  });

  it("rejects vectors whose width does not match the database column", async () => {
    const body = JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] });
    const { embed } = embedderWith([new Response(body, { status: 200 })]);

    await expect(embed(["a"])).rejects.toThrow(/1536/);
  });

  it("falls back to the default endpoint when the base url is set to an empty string", async () => {
    const { calls, embed } = embedderWith([okResponse(1)], { baseUrl: "" });

    await embed(["a"]);

    expect(calls[0].url).toBe("https://api.openai.com/v1/embeddings");
  });

  it("refuses to run without an api key", () => {
    expect(() => createEmbedder({ apiKey: "" })).toThrow(/key/i);
  });
});

const openRouterEmbedderWith = (responses: Response[], overrides = {}) =>
  embedderWith(responses, { provider: "openrouter", apiKey: "openrouter-key", ...overrides });

describe("createEmbedder: openrouter", () => {
  it("is the default provider", async () => {
    const { calls, embed } = embedderWith([okResponse(1)], { provider: undefined });

    await embed(["a"]);

    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/embeddings");
  });

  it("calls OpenRouter's embeddings endpoint with the vendor-prefixed model", async () => {
    const { calls, embed } = openRouterEmbedderWith([okResponse(2)]);

    await embed(["first", "second"]);

    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(calls[0].body.model).toBe(OPENROUTER_EMBEDDING_MODEL);
    expect(calls[0].body.input).toEqual(["first", "second"]);
    expect(calls[0].headers.Authorization).toBe("Bearer openrouter-key");
    expect(calls[0].headers["X-OpenRouter-Title"]).toBe("RAG");
  });

  it("waits as long as the Retry-After header asks before retrying", async () => {
    const slept: number[] = [];
    const limited = new Response(JSON.stringify({ error: { message: "slow down" } }), {
      status: 429,
      headers: { "Retry-After": "30" },
    });
    const { embed } = openRouterEmbedderWith([limited, okResponse(1)], {
      sleep: async (ms: number) => {
        slept.push(ms);
      },
    });

    await embed(["a"]);

    expect(slept[0]).toBe(30_000);
  });

  it("ignores an absurd retry delay rather than hanging for it", async () => {
    const slept: number[] = [];
    const limited = new Response(JSON.stringify({ error: { message: "later" } }), {
      status: 429,
      headers: { "Retry-After": "86400" },
    });
    const { embed } = openRouterEmbedderWith([limited, okResponse(1)], {
      sleep: async (ms: number) => {
        slept.push(ms);
      },
    });

    await embed(["a"]);

    expect(slept[0]).toBeLessThanOrEqual(90_000);
  });

  it("names the key it needs when there is none", () => {
    expect(() => createEmbedder({ provider: "openrouter", apiKey: "" })).toThrow(/OPENROUTER_API_KEY/);
  });

  it("rejects an unknown provider by name", () => {
    expect(() => createEmbedder({ provider: "gemini", apiKey: "x" })).toThrow(/gemini/);
  });
});
