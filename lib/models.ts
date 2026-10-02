import type { Provider } from "./chat-types";

export type ModelOption = {
  /** Sent to the provider as-is; null means the server's configured default. */
  id: string | null;
  label: string;
};

export const PROVIDER_LABEL: Record<Provider, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

/**
 * The models offered in the picker. Free messages run on the server's own keys, so the
 * chat route only honours a model choice when the request carries the user's API key;
 * without one it falls back to the default (the first entry). Edit freely — ids are
 * passed straight through to the provider.
 */
export const MODELS: Record<Provider, ModelOption[]> = {
  openrouter: [
    { id: null, label: "Auto" },
    { id: "meta-llama/llama-3.1-8b-instruct", label: "Llama 3.1 8B" },
    { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
  ],
  openai: [
    { id: null, label: "Default" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  ],
  anthropic: [
    { id: null, label: "Default" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  ],
};

export function isKnownModel(provider: string, model: unknown): model is string {
  if (typeof model !== "string") return false;

  return (MODELS[provider as Provider] ?? []).some((option) => option.id === model);
}

export function modelLabel(provider: Provider, model: string | null): string {
  return (
    MODELS[provider]?.find((option) => option.id === model)?.label ??
    model ??
    MODELS[provider]?.[0]?.label ??
    "Default"
  );
}
