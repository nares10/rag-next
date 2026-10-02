/**
 * Turns a follow-up question into a standalone one before it is embedded.
 *
 * "What about travel?" embeds to almost nothing useful on its own — the subject lives in
 * the previous turn. This step is strictly best-effort: every failure path returns the
 * original message, because a worse query is far better than a failed chat request.
 */
export const REWRITE_HISTORY_TURNS = 4;
/** A rewrite longer than this means the model answered the question instead of rewriting it. */
const MAX_REWRITE_LENGTH = 400;

export type RewriteTurn = { role: string; content: string };

export type RewriteQueryOptions = {
  message: string;
  history: RewriteTurn[];
  complete: (prompt: string) => Promise<string>;
  historyTurns?: number;
};

export function buildRewritePrompt(message: string, history: RewriteTurn[]): string {
  const transcript = history.map((turn) => `${turn.role}: ${turn.content}`).join("\n");

  return [
    "Rewrite the user's final message as a standalone search query.",
    "Resolve pronouns and implicit references using the conversation. Keep it short.",
    "Reply with the query only — no preamble, no answer to the question.",
    "",
    "Conversation:",
    transcript,
    "",
    `Final message: ${message}`,
  ].join("\n");
}

export async function rewriteQuery(options: RewriteQueryOptions): Promise<string> {
  const { message, history, complete, historyTurns = REWRITE_HISTORY_TURNS } = options;

  if (history.length === 0) return message;

  try {
    const recent = history.slice(-historyTurns);
    const rewritten = (await complete(buildRewritePrompt(message, recent))).trim();

    if (!rewritten || rewritten.length > MAX_REWRITE_LENGTH) return message;

    return rewritten;
  } catch {
    return message;
  }
}
