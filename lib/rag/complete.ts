/**
 * A single, short, non-streaming completion. Used only to rewrite a follow-up question
 * into a standalone search query, so it is deliberately capped and unadorned — every
 * caller treats a failure as "use the original message".
 */
const MAX_TOKENS = 64;
const TIMEOUT_MS = 2000;

export type Completer = (prompt: string) => Promise<string>;

export type CompleterOptions = {
  provider: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

/** Returns null when the provider has no usable key, which means "skip the rewrite". */
export function createCompleter(options: CompleterOptions): Completer | null {
  const { provider, apiKey, fetchImpl = fetch } = options;

  if (!apiKey) return null;

  const isAnthropic = provider === "anthropic" || provider === "claude";

  return async function complete(prompt) {
    const response = isAnthropic
      ? await fetchImpl(`${anthropicBaseUrl(options.baseUrl)}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: options.model || process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
            max_tokens: MAX_TOKENS,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      : await fetchImpl(`${baseUrl(provider, options.baseUrl)}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: options.model || defaultModel(provider),
            max_tokens: MAX_TOKENS,
            messages: [{ role: "user", content: prompt }],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

    if (!response.ok) {
      throw new Error(`Rewrite completion failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      content?: Array<{ type?: string; text?: string }>;
    };

    if (isAnthropic) {
      return payload.content?.find((block) => block.type === "text")?.text ?? "";
    }

    return payload.choices?.[0]?.message?.content ?? "";
  };
}

/**
 * Kept in step with the chat route's ANTHROPIC_BASE_URL: pointing streaming at a local
 * gateway while the rewrite still called api.anthropic.com would send the user's key off
 * the machine on every follow-up, and stall on the 2s timeout where egress is blocked.
 */
function anthropicBaseUrl(override?: string): string {
  return override || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
}

function baseUrl(provider: string, override?: string): string {
  if (override) return override;
  if (provider === "openrouter") return process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

  return process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
}

function defaultModel(provider: string): string {
  if (provider === "openrouter") return process.env.OPENROUTER_MODEL || "openrouter/free";

  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}
