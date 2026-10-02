import { FREE_MESSAGE_LIMIT } from "@/lib/freeMessages";
import type { Provider, ChatUser } from "@/lib/chat-types";

interface ChatComposerProps {
  provider: Provider;
  user: ChatUser | null;
  input: string;
  isLoading: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  attachedCollectionName: string | null;
  useRag: boolean;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onOpenProviderModal: () => void;
  onOpenDocuments: () => void;
  onToggleUseRag: () => void;
}

export default function ChatComposer({
  provider,
  user,
  input,
  isLoading,
  inputRef,
  attachedCollectionName,
  useRag,
  onInputChange,
  onSubmit,
  onOpenProviderModal,
  onOpenDocuments,
  onToggleUseRag,
}: ChatComposerProps) {
  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-950/80 px-4 py-4 backdrop-blur-sm lg:px-8 xl:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 2xl:max-w-7xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenProviderModal}
              className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-800"
            >
              <span>{provider === "openrouter" ? "🌐" : provider === "openai" ? "🤖" : "🧠"}</span>
              <span className="font-medium">
                {provider === "openrouter" ? "OpenRouter" : provider === "openai" ? "OpenAI" : "Claude"}
              </span>
            </button>

            <button
              onClick={onOpenDocuments}
              className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-800"
            >
              <span>📄</span>
              <span className="font-medium">{attachedCollectionName ?? "No documents"}</span>
            </button>

            {attachedCollectionName && (
              <button
                onClick={onToggleUseRag}
                title="Answer from the attached documents"
                className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                  useRag
                    ? "border-emerald-700 bg-emerald-950/60 text-emerald-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {useRag ? "Using documents" : "Documents off"}
              </button>
            )}

            {user && (
              <div className="text-xs text-zinc-400">
                {user.freeMessagesUsed}/{FREE_MESSAGE_LIMIT} free messages used
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-zinc-700 bg-zinc-900 p-2 shadow-lg shadow-black/20">
          <textarea
            ref={inputRef}
            autoFocus
            rows={1}
            value={input}
            disabled={isLoading}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
            placeholder={isLoading ? "Waiting for response..." : "Message Assistant..."}
            className="max-h-40 min-h-10 flex-1 resize-none overflow-y-auto bg-transparent px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none disabled:cursor-not-allowed disabled:opacity-60"
          />

          <button
            type="button"
            disabled={isLoading || !provider}
            onClick={onSubmit}
            className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
