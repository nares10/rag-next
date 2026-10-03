import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { FREE_MESSAGE_LIMIT } from "@/lib/freeMessages";
import { buildChatContext } from "@/lib/rag/chat-context";
import { createCompleter } from "@/lib/rag/complete";
import { lazyEmbedder } from "@/lib/rag/embed";
import { PROVIDER_LABEL, isKnownModel } from "@/lib/models";
import type { Provider } from "@/lib/chat-types";
import type { Citation } from "@/lib/rag/types";

// Overridable so the app can talk to a compatible endpoint (a local gateway, the test
// stub) without changing provider code.
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";

/**
 * The server pays for OpenRouter and nothing else. Every other provider is
 * bring-your-own-key, so there is no server key to fall back to and this returns
 * undefined — which also means the query rewrite is skipped rather than billed elsewhere.
 */
function providerEnvKey(provider: string): string | undefined {
  return provider === "openrouter" ? process.env.OPENROUTER_API_KEY : undefined;
}

/** Whether a request for this provider is only possible with a key the caller supplied. */
function requiresUserKey(provider: Provider): boolean {
  return provider !== "openrouter";
}

/**
 * Resolve whatever the request or AI_PROVIDER said to one of the three providers the app
 * knows. An unrecognised name falls back to the default rather than failing the message —
 * the same leniency the route already applies to an unknown model or collection id, and
 * the difference between a typo in AI_PROVIDER costing nothing and costing every chat.
 */
function normalizeProvider(input: string): Provider {
  const name = input.trim().toLowerCase();

  if (name === "openai") return "openai";
  if (name === "anthropic" || name === "claude") return "anthropic";

  return "openrouter";
}

function streamSSE(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

type ProviderMessage = { role: string; content: string };

async function streamOpenRouter(messages: ProviderMessage[], userApiKey?: string, chosenModel?: string) {
  const apiKey = userApiKey || process.env.OPENROUTER_API_KEY;
  const model = chosenModel || process.env.OPENROUTER_MODEL || "openrouter/free";

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing. Add it to your .env.local file or provide an API key.");
  }

  const upstream = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "rag-2",
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errorData = await upstream.json().catch(() => ({}));
    throw new Error(
      errorData?.error?.message || `OpenRouter request failed with status ${upstream.status}`
    );
  }

  return upstream;
}

async function streamOpenAI(messages: ProviderMessage[], userApiKey?: string, chosenModel?: string) {
  const model = chosenModel || process.env.OPENAI_MODEL || "gpt-4o-mini";

  // No server-key fallback: the free allowance is funded by the OpenRouter key alone.
  if (!userApiKey) {
    throw new Error("OpenAI requires your own API key. Add one in your profile, or switch to OpenRouter.");
  }

  const upstream = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errorData = await upstream.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `OpenAI request failed with status ${upstream.status}`);
  }

  return upstream;
}

async function streamAnthropic(
  messages: ProviderMessage[],
  userApiKey?: string,
  system?: string,
  chosenModel?: string,
) {
  const model = chosenModel || process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";

  // No server-key fallback: the free allowance is funded by the OpenRouter key alone.
  if (!userApiKey) {
    throw new Error("Anthropic requires your own API key. Add one in your profile, or switch to OpenRouter.");
  }

  const upstream = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": userApiKey,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: 1024,
      // Anthropic takes the system prompt as a top-level parameter, not a message.
      ...(system ? { system } : {}),
      messages,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errorData = await upstream.json().catch(() => ({}));
    throw new Error(
      errorData?.error?.message || `Anthropic request failed with status ${upstream.status}`
    );
  }

  return upstream;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    if (!message) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const providerInput = typeof body?.provider === "string" ? body.provider : "";
    const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey : null;
    const requestedCollectionId = typeof body?.collectionId === "string" ? body.collectionId : null;
    // Opt out of document search for a single message without detaching the collection.
    const useRag = body?.useRag !== false;
    const normalizedProvider = normalizeProvider(providerInput || process.env.AI_PROVIDER || "openrouter");
    // Free messages are paid for with the server's keys, so only a request carrying the
    // user's own key may pick a model; everyone else gets the configured default.
    const model = apiKey && isKnownModel(normalizedProvider, body?.model) ? (body.model as string) : null;
    // Replace the last exchange instead of appending to it. The old pair is only deleted
    // once the new answer has arrived, so a failed regenerate loses nothing.
    const regenerate = body?.regenerate === true;

    // Refuse before touching the free counter: without a key of their own this provider
    // can only fail, and a guaranteed failure must not cost the caller a free message.
    if (!apiKey && requiresUserKey(normalizedProvider)) {
      return NextResponse.json(
        {
          error: `${PROVIDER_LABEL[normalizedProvider]} requires your own API key.`,
          message: "Free messages run on OpenRouter. Add your own key to use another provider.",
          requiresApiKey: true,
        },
        { status: 400 },
      );
    }

    // Check free message limit if no API key provided
    if (!apiKey) {
      if (user.freeMessagesUsed >= FREE_MESSAGE_LIMIT) {
        return NextResponse.json(
          { 
            error: "Free message limit reached",
            message: `You've used your ${FREE_MESSAGE_LIMIT} free messages. Please add an API key to continue.`,
            requiresApiKey: true
          }, 
          { status: 403 }
        );
      }

      // Increment free message counter
      await prisma.user.update({
        where: { id: user.id },
        data: { freeMessagesUsed: { increment: 1 } }
      });
    }

    // Create or get conversation
    let conversation;
    if (conversationId) {
      conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          userId: user.id,
        },
      });
    }

    // Only a collection the caller owns can be attached; an unknown id is ignored rather
    // than failing the message.
    const ownedCollectionId = requestedCollectionId
      ? (
          await prisma.collection.findFirst({
            where: { id: requestedCollectionId, userId: user.id },
            select: { id: true },
          })
        )?.id ?? null
      : null;

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          userId: user.id,
          title: message.substring(0, 50) + (message.length > 50 ? "..." : ""),
          provider: normalizedProvider,
          model,
          collectionId: ownedCollectionId,
        },
      });
    } else if (
      (ownedCollectionId && ownedCollectionId !== conversation.collectionId) ||
      conversation.provider !== normalizedProvider ||
      conversation.model !== model
    ) {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          provider: normalizedProvider,
          model,
          ...(ownedCollectionId ? { collectionId: ownedCollectionId } : {}),
        },
      });
    }

    // Get conversation history for context (user message is saved once the
    // assistant replies, so it isn't in the DB yet — append it below).
    // Newest ten, then put back in chronological order. Ordering ascending and taking ten
    // would hand the model (and the query rewriter) the opening exchange forever.
    const conversationHistory = (
      await prisma.message.findMany({
        where: {
          conversationId: conversation.id,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
      })
    ).reverse();

    // The exchange being regenerated must not be in the model's history.
    const replaced: string[] = [];
    if (regenerate) {
      const [question, answer] = conversationHistory.slice(-2);

      if (question?.role === "user" && answer?.role === "assistant" && question.content === message) {
        replaced.push(question.id, answer.id);
        conversationHistory.splice(-2, 2);
      }
    }

    const history = conversationHistory.map(msg => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));

    // Retrieval runs before the provider call so the context can be injected and the
    // citations streamed ahead of the first token.
    const context = await buildChatContext({
      userId: user.id,
      collectionId: conversation.collectionId,
      message,
      history,
      useRag,
      basePrompt: conversation.systemPrompt,
      embed: lazyEmbedder(),
      // Rewriting a follow-up into a standalone query needs one cheap completion; it is
      // skipped entirely when the chosen provider has no key available.
      complete:
        createCompleter({
          provider: normalizedProvider,
          apiKey: apiKey || providerEnvKey(normalizedProvider),
        }) ?? undefined,
    });

    const isAnthropic = normalizedProvider === "anthropic";
    const messagesForAI = [
      // Anthropic carries the system prompt out of band; the OpenAI-shaped APIs take it
      // as the first message.
      ...(context.system && !isAnthropic ? [{ role: "system", content: context.system }] : []),
      ...history,
      { role: "user" as const, content: message },
    ];

    let upstream: Response;

    if (normalizedProvider === "openai") {
      upstream = await streamOpenAI(messagesForAI, apiKey || undefined, model ?? undefined);
    } else if (isAnthropic) {
      upstream = await streamAnthropic(
        messagesForAI,
        apiKey || undefined,
        context.system ?? undefined,
        model ?? undefined,
      );
    } else {
      upstream = await streamOpenRouter(messagesForAI, apiKey || undefined, model ?? undefined);
    }

    const encoder = new TextEncoder();
    let fullResponse = "";
    let savedMessageId: string | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        const decoder = new TextDecoder();
        const reader = upstream.body!.getReader();

        // Sent before any text so the UI can render citation chips and the grounding
        // notice while the answer is still streaming.
        if (context.retrieved || context.degraded) {
          controller.enqueue(
            encoder.encode(
              streamSSE({
                sources: context.citations,
                grounded: context.grounded,
                degraded: context.degraded,
              }),
            ),
          );
        }

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");

            for (const line of lines) {
              if (!line.startsWith("data:")) continue;

              const raw = line.replace(/^data:\s*/, "").trim();
              if (!raw || raw === "[DONE]") continue;

              try {
                const payload = JSON.parse(raw);

                let textChunk = "";

                if (isAnthropic) {
                  if (payload.type === "content_block_delta") {
                    textChunk = payload.delta?.text || "";
                  }
                } else {
                  textChunk = payload?.choices?.[0]?.delta?.content || "";
                }

                if (textChunk) {
                  fullResponse += textChunk;
                  controller.enqueue(encoder.encode(streamSSE({ text: textChunk })));
                }
              } catch {
                // ignore malformed provider chunks
              }
            }
          }

          // Save the user message and the assistant's reply together, once the
          // reply has actually arrived — an errored/empty reply leaves no
          // orphaned user message in the conversation. Two separate creates
          // (rather than createMany) so their createdAt timestamps stay
          // distinct for ordering.
          if (fullResponse) {
            if (replaced.length > 0) {
              await prisma.message.deleteMany({ where: { id: { in: replaced }, conversationId: conversation.id } });
            }

            await prisma.message.create({
              data: {
                conversationId: conversation.id,
                role: "user",
                content: message,
              },
            });

            const saved = await prisma.message.create({
              data: {
                conversationId: conversation.id,
                role: "assistant",
                content: fullResponse,
                citations: context.citations.length > 0 ? (context.citations as unknown as Citation[]) : undefined,
              },
            });
            savedMessageId = saved.id;
          }

          // Send conversation ID at the end
          controller.enqueue(
            encoder.encode(streamSSE({ conversationId: conversation.id, messageId: savedMessageId, done: true })),
          );
          controller.close();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Streaming error while contacting the AI provider.";

          controller.enqueue(encoder.encode(streamSSE({ error: message })));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Something went wrong while contacting the AI provider.";

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
