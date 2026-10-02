import { prisma as defaultPrisma } from "../prisma";
import type { Embedder } from "./embed";
import { buildGroundedPrompt } from "./prompt";
import { retrieveContext } from "./retrieve";
import { type RewriteTurn, rewriteQuery } from "./rewrite";
import type { Citation } from "./types";

/**
 * Retrieval sits directly in front of the user's first streamed token, so it gets a hard
 * deadline. Past it the answer goes out ungrounded with a notice rather than keeping the
 * user waiting on a slow index.
 */
export const RETRIEVAL_TIMEOUT_MS = 1500;

export type ChatContext = {
  /** System prompt to send to the provider, or null to leave the provider's default. */
  system: string | null;
  citations: Citation[];
  /** Retrieval ran (as opposed to being skipped because there is nothing to search). */
  retrieved: boolean;
  /** At least one passage made it into the prompt. */
  grounded: boolean;
  /** Retrieval was attempted and failed; the answer is not grounded in the documents. */
  degraded: boolean;
};

export type BuildChatContextOptions = {
  userId: string;
  collectionId: string | null;
  message: string;
  history: RewriteTurn[];
  embed: Embedder;
  /** Cheap completion used to turn a follow-up into a standalone query. Optional. */
  complete?: (prompt: string) => Promise<string>;
  useRag?: boolean;
  basePrompt?: string | null;
  timeoutMs?: number;
  limit?: number;
  prisma?: typeof defaultPrisma;
};

export async function buildChatContext(options: BuildChatContextOptions): Promise<ChatContext> {
  const {
    userId,
    collectionId,
    message,
    history,
    embed,
    complete,
    useRag = true,
    basePrompt = null,
    timeoutMs = RETRIEVAL_TIMEOUT_MS,
    limit,
    prisma = defaultPrisma,
  } = options;

  const ungrounded = (degraded: boolean): ChatContext => ({
    system: basePrompt?.trim() || null,
    citations: [],
    retrieved: false,
    grounded: false,
    degraded,
  });

  if (!useRag || !collectionId) return ungrounded(false);

  try {
    // One deadline over rewrite *and* retrieval: they both sit in front of the user's
    // first streamed token, so the budget that matters is their total.
    const chunks = await withDeadline(
      (async () => {
        const query = complete ? await rewriteQuery({ message, history, complete }) : message;

        return retrieveContext({ userId, collectionId, query, embed, limit, prisma });
      })(),
      timeoutMs,
    );

    const { system, citations, grounded } = buildGroundedPrompt(chunks, { basePrompt });

    return { system, citations, retrieved: true, grounded, degraded: false };
  } catch (error) {
    // Retrieval is an enhancement: a failure here degrades the answer, it does not fail
    // the chat request.
    console.error("RAG retrieval failed", error);

    return ungrounded(true);
  }
}

function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Retrieval exceeded ${timeoutMs}ms`)), timeoutMs);

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
