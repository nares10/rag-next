import { describe, expect, it } from "bun:test";
import { createCompleter } from "../../lib/rag/complete";

type Recorded = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function recorder(response: Response) {
  const calls: Recorded[] = [];
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      headers: init?.headers as Record<string, string>,
    });
    return response;
  };

  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const openAiReply = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

const anthropicReply = (text: string) =>
  new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });

describe("createCompleter", () => {
  it("returns the assistant text from an OpenAI-shaped reply", async () => {
    const { calls, fetchImpl } = recorder(openAiReply("standalone query"));
    const complete = createCompleter({ provider: "openai", apiKey: "k", fetchImpl });

    expect(await complete("rewrite this")).toBe("standalone query");
    expect(calls[0].url).toContain("/chat/completions");
    expect(calls[0].body.stream).toBeUndefined();
  });

  it("returns the text from an Anthropic-shaped reply", async () => {
    const { calls, fetchImpl } = recorder(anthropicReply("standalone query"));
    const complete = createCompleter({ provider: "anthropic", apiKey: "k", fetchImpl });

    expect(await complete("rewrite this")).toBe("standalone query");
    expect(calls[0].url).toContain("api.anthropic.com");
    expect(calls[0].headers["x-api-key"]).toBe("k");
  });

  it("caps the output so a rewrite cannot turn into an answer", async () => {
    const { calls, fetchImpl } = recorder(openAiReply("short"));
    const complete = createCompleter({ provider: "openai", apiKey: "k", fetchImpl });

    await complete("rewrite this");

    expect(calls[0].body.max_tokens).toBe(64);
  });

  it("throws on a provider error so the caller can fall back", async () => {
    const { fetchImpl } = recorder(new Response("nope", { status: 500 }));
    const complete = createCompleter({ provider: "openai", apiKey: "k", fetchImpl });

    await expect(complete("rewrite this")).rejects.toThrow();
  });

  it("returns null when no key is available for the provider", () => {
    expect(createCompleter({ provider: "openai", apiKey: undefined })).toBeNull();
  });
});
