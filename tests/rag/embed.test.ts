import { describe, expect, it } from "bun:test";
import { EMBEDDING_DIMENSIONS, GEMINI_EMBEDDING_MODEL, createEmbedder } from "../../lib/rag/embed";

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
    apiKey: "test-key",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
    ...overrides,
  });

  return { calls, embed };
};

describe("createEmbedder", () => {
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


const geminiVector = (seed: number) =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === seed ? 2 : 0));

function geminiResponse(count: number, offset = 0) {
  return new Response(
    JSON.stringify({
      embeddings: Array.from({ length: count }, (_, i) => ({ values: geminiVector(offset + i) })),
    }),
    { status: 200 },
  );
}

const geminiEmbedderWith = (responses: Response[], overrides = {}) => {
  const { calls, fetchImpl } = recorder(responses);
  const embed = createEmbedder({
    provider: "gemini",
    apiKey: "gemini-key",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => {},
    ...overrides,
  });

  return { calls, embed };
};

describe("createEmbedder: gemini", () => {
  it("calls the batch endpoint for the configured model", async () => {
    const { calls, embed } = geminiEmbedderWith([geminiResponse(1)]);

    await embed(["first"]);

    expect(calls[0].url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents`,
    );
    expect(calls[0].headers["x-goog-api-key"]).toBe("gemini-key");
  });

  it("sends one request per text, in Gemini's content shape", async () => {
    const { calls, embed } = geminiEmbedderWith([geminiResponse(2)]);

    await embed(["first", "second"]);

    const requests = (calls[0].body as { requests?: unknown[] }).requests as Array<{
      model: string;
      content: { parts: Array<{ text: string }> };
    }>;

    expect(requests).toHaveLength(2);
    expect(requests[0].model).toBe(`models/${GEMINI_EMBEDDING_MODEL}`);
    expect(requests[0].content.parts[0].text).toBe("first");
    expect(requests[1].content.parts[0].text).toBe("second");
  });

  it("asks for 1536 dimensions, matching the database column", async () => {
    const { calls, embed } = geminiEmbedderWith([geminiResponse(1)]);

    await embed(["first"]);

    const requests = (calls[0].body as { requests: Array<{ outputDimensionality: number }> }).requests;
    expect(requests[0].outputDimensionality).toBe(EMBEDDING_DIMENSIONS);
  });

  it("labels passages and questions with different task types", async () => {
    const { calls, embed } = geminiEmbedderWith([geminiResponse(1), geminiResponse(1)]);

    await embed(["a passage"], { kind: "document" });
    await embed(["a question"], { kind: "query" });

    const taskTypeOf = (index: number) =>
      (calls[index].body as { requests: Array<{ taskType: string }> }).requests[0].taskType;

    expect(taskTypeOf(0)).toBe("RETRIEVAL_DOCUMENT");
    expect(taskTypeOf(1)).toBe("RETRIEVAL_QUERY");
  });

  it("treats text as a document when the caller does not say", async () => {
    const { calls, embed } = geminiEmbedderWith([geminiResponse(1)]);

    await embed(["unlabelled"]);

    const requests = (calls[0].body as { requests: Array<{ taskType: string }> }).requests;
    expect(requests[0].taskType).toBe("RETRIEVAL_DOCUMENT");
  });

  it("normalizes the vectors, which Gemini does not do below its full width", async () => {
    const { embed } = geminiEmbedderWith([geminiResponse(1)]);

    const [vector] = await embed(["first"]);
    const magnitude = Math.hypot(...vector);

    expect(magnitude).toBeCloseTo(1, 6);
  });

  it("returns one vector per input, in order", async () => {
    const { embed } = geminiEmbedderWith([geminiResponse(2)]);

    const vectors = await embed(["first", "second"]);

    expect(vectors).toHaveLength(2);
    expect(vectors[0][0]).toBeCloseTo(1, 6);
    expect(vectors[1][1]).toBeCloseTo(1, 6);
  });

  it("batches large inputs", async () => {
    const { calls, embed } = geminiEmbedderWith([geminiResponse(2, 0), geminiResponse(1, 2)], {
      batchSize: 2,
    });

    const vectors = await embed(["a", "b", "c"]);

    expect(calls).toHaveLength(2);
    expect(vectors).toHaveLength(3);
  });

  it("retries a rate-limited batch", async () => {
    const { calls, embed } = geminiEmbedderWith([errorResponse(429, "quota"), geminiResponse(1)]);

    await embed(["a"]);

    expect(calls).toHaveLength(2);
  });

  it("surfaces Gemini's own error message", async () => {
    const body = JSON.stringify({ error: { message: "API key not valid" } });
    const { embed } = geminiEmbedderWith([new Response(body, { status: 400 })]);

    await expect(embed(["a"])).rejects.toThrow(/API key not valid/);
  });

  it("rejects vectors of the wrong width", async () => {
    const body = JSON.stringify({ embeddings: [{ values: [0.1, 0.2] }] });
    const { embed } = geminiEmbedderWith([new Response(body, { status: 200 })]);

    await expect(embed(["a"])).rejects.toThrow(/1536/);
  });

  it("names the key it needs when there is none", () => {
    expect(() => createEmbedder({ provider: "gemini", apiKey: "" })).toThrow(/GEMINI_API_KEY/);
  });

  it("rejects an unknown provider by name", () => {
    expect(() => createEmbedder({ provider: "llama-farm", apiKey: "x" })).toThrow(/llama-farm/);
  });
});
