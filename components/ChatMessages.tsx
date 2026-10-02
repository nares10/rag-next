import type { Citation, Message } from "@/lib/chat-types";
import MarkdownMessage from "@/components/MarkdownMessage";

interface ChatMessagesProps {
  messages: Message[];
  isLoading: boolean;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}

function SourceList({ citations }: { citations: Citation[] }) {
  return (
    <div className="mt-3 border-t border-zinc-700 pt-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Sources</p>
      <ol className="mt-1 flex flex-col gap-0.5">
        {citations.map((citation) => (
          <li key={citation.chunkId} className="text-xs text-zinc-400">
            <span className="text-zinc-500">[{citation.n}]</span>{" "}
            {[citation.title, citation.heading].filter(Boolean).join(" › ")}
            {citation.page === null ? "" : ` (p.${citation.page})`}
          </li>
        ))}
      </ol>
    </div>
  );
}

function GroundingNotice({ grounding }: { grounding: Message["grounding"] }) {
  if (grounding === "none") {
    return (
      <p className="mb-2 text-xs text-zinc-500">No matching passages in your documents.</p>
    );
  }

  if (grounding === "degraded") {
    return (
      <p className="mb-2 text-xs text-amber-400">
        Document search was unavailable — answered without your documents.
      </p>
    );
  }

  return null;
}

export default function ChatMessages({ messages, isLoading, bottomRef }: ChatMessagesProps) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8 xl:px-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 2xl:max-w-7xl">
        {messages.map((message) => (
          <div
            key={message.id}
            className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                message.role === "user"
                  ? "max-w-[80%] rounded-2xl rounded-br-md bg-white px-4 py-3 text-sm text-zinc-900"
                  : "max-w-[80%] rounded-2xl rounded-bl-md bg-zinc-800 px-4 py-3 text-sm text-zinc-100"
              }
            >
              {message.role === "assistant" && <GroundingNotice grounding={message.grounding} />}
              <MarkdownMessage text={message.text} citations={message.citations} />
              {message.role === "assistant" && message.citations?.length ? (
                <SourceList citations={message.citations} />
              ) : null}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-zinc-800 px-4 py-3 text-sm text-zinc-300">
              Thinking...
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
