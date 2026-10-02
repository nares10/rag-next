/// <reference types="bun" />
import { fakeEmbedding } from "../tests/support/fake-embedder";

/**
 * A deterministic, OpenAI-compatible stub used by the integration tests.
 *
 * It exists so the RAG chat path can be exercised end to end — retrieval, context
 * injection, streamed citations — without calling a real provider. Start it alongside the
 * dev server and point the app at it with OPENAI_BASE_URL (see README).
 *
 *   POST /v1/embeddings        deterministic vectors from tests/support/fake-embedder.ts:
 *                              texts about the same thing embed close together, so
 *                              retrieval behaves like the real thing
 *   POST /v1/chat/completions  streamed: a fixed answer as SSE. Non-streamed (used for
 *                              query rewriting): echoes the prompt's "Final message",
 *                              which is what a sane rewriter would return
 *   GET  /_requests            every request body it has received, for assertions
 *   POST /_reset               clears that log
 */
const PORT = Number(process.env.STUB_PROVIDER_PORT ?? 4010);
const ANSWER = "Receipts must be filed within 30 days [1].";

const received: Array<{ path: string; body: unknown }> = [];

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const { pathname } = new URL(request.url);

    if (pathname === "/_requests") {
      return Response.json({ received });
    }

    if (pathname === "/_reset") {
      received.length = 0;
      return Response.json({ ok: true });
    }

    const body = await request.json().catch(() => ({}));
    received.push({ path: pathname, body });

    if (pathname === "/v1/embeddings") {
      const input: string[] = Array.isArray(body.input) ? body.input : [body.input];

      return Response.json({
        data: input.map((text, index) => ({ index, embedding: fakeEmbedding(String(text)) })),
      });
    }

    if (pathname === "/v1/chat/completions" && body.stream !== true) {
      const messages: Array<{ content?: string }> = Array.isArray(body.messages) ? body.messages : [];
      const prompt = messages.at(-1)?.content ?? "";
      const finalMessage = prompt.match(/^Final message:\s*(.+)$/m)?.[1];

      return Response.json({
        choices: [{ message: { content: finalMessage ?? ANSWER } }],
      });
    }

    if (pathname === "/v1/chat/completions") {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          for (const word of ANSWER.split(" ")) {
            controller.enqueue(encoder.encode(sse({ choices: [{ delta: { content: `${word} ` } }] })));
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });

      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`stub provider listening on http://localhost:${PORT}`);
