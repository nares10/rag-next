"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EASE_OUT } from "@/components/motion";
import type { Citation, CitedPassage, Message } from "@/lib/chat-types";
import type { Feedback } from "@/hooks/useMessageFeedback";
import MarkdownMessage from "@/components/MarkdownMessage";
import { citationLabel } from "@/components/CitationPanel";
import {
  BookIcon,
  CheckIcon,
  CopyIcon,
  RefreshIcon,
  SearchIcon,
  SparkleIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  UploadIcon,
} from "@/components/icons";

interface ChatMessagesProps {
  messages: Message[];
  isLoading: boolean;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  attachedCollectionName: string | null;
  hasCollections: boolean;
  passages: Record<string, CitedPassage | null>;
  feedback: Record<string, Feedback>;
  onLoadPassages: (chunkIds: string[]) => void;
  onOpenCitation: (citations: Citation[], citation: Citation) => void;
  onPickPrompt: (prompt: string) => void;
  onOpenDocuments: () => void;
  onRegenerate: () => void;
  onRate: (messageId: string, value: Feedback) => void;
}

const GENERAL_PROMPTS = [
  "Explain retrieval-augmented generation in simple terms",
  "Draft a friendly follow-up email after a sales call",
  "Give me a 5-day plan to learn SQL basics",
  "What makes a good product requirements doc?",
];

const documentPrompts = (name: string) => [
  `Summarize the key points in ${name}`,
  "What dates, deadlines or figures are mentioned?",
  "What are the most important takeaways, with sources?",
  "What questions do these documents leave unanswered?",
];

function Welcome({
  attachedCollectionName,
  hasCollections,
  onPickPrompt,
  onOpenDocuments,
}: Pick<ChatMessagesProps, "attachedCollectionName" | "hasCollections" | "onPickPrompt" | "onOpenDocuments">) {
  const prompts = attachedCollectionName ? documentPrompts(attachedCollectionName) : GENERAL_PROMPTS;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-1 py-10"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
        <SparkleIcon size={24} />
      </div>
      <h2 className="mt-5 text-center text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">
        {attachedCollectionName ? `Chat with ${attachedCollectionName}` : "Ask anything, or chat with your documents"}
      </h2>
      <p className="mt-2 max-w-md text-center text-sm text-zinc-400">
        {attachedCollectionName
          ? "Answers come from your documents, with citations you can click to check."
          : "Ask a general question, or attach a document collection to get answers grounded in your own files."}
      </p>

      <div className="mt-8 grid w-full gap-2 sm:grid-cols-2">
        {prompts.map((prompt, index) => (
          <motion.button
            key={prompt}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...EASE_OUT, delay: 0.1 + index * 0.05 }}
            type="button"
            onClick={() => onPickPrompt(prompt)}
            className="group rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-left text-sm text-zinc-300 transition hover:border-accent/50 hover:bg-zinc-900 hover:text-zinc-100"
          >
            {prompt}
            <span className="ml-1 text-accent-text opacity-0 transition group-hover:opacity-100">→</span>
          </motion.button>
        ))}
      </div>

      {!hasCollections && (
        <motion.button
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...EASE_OUT, delay: 0.1 + prompts.length * 0.05 }}
          type="button"
          onClick={onOpenDocuments}
          className="mt-4 flex w-full items-center gap-4 rounded-xl border border-dashed border-zinc-700 p-5 text-left transition hover:border-accent hover:bg-accent-soft"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-on-accent">
            <UploadIcon size={20} />
          </span>
          <span>
            <span className="block text-sm font-semibold text-zinc-100">Upload documents</span>
            <span className="mt-0.5 block text-xs text-zinc-400">
              PDFs, Word docs, markdown or web pages — then ask questions and get answers with citations.
            </span>
          </span>
        </motion.button>
      )}
    </motion.div>
  );
}

function RetrievalStatus({ retrieval }: { retrieval: NonNullable<Message["retrieval"]> }) {
  if (retrieval.phase === "searching") {
    return (
      <p className="mb-2 flex items-center gap-2 text-xs">
        <SearchIcon size={12} className="text-zinc-500" />
        <span className="shimmer-text font-medium">Searching {retrieval.collectionName}…</span>
      </p>
    );
  }

  return (
    <motion.p
      initial={{ opacity: 0.6 }}
      animate={{ opacity: 1 }}
      transition={EASE_OUT}
      className="mb-2 flex items-center gap-2 text-xs text-zinc-500"
    >
      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 25 }}
        className={`flex h-4 w-4 items-center justify-center rounded-full ${
          retrieval.count === 0 ? "bg-zinc-800 text-zinc-400" : "bg-emerald-500/15 text-emerald-400"
        }`}
      >
        <CheckIcon size={10} strokeWidth={3} />
      </motion.span>
      <span>
        {retrieval.count === 0
          ? `No relevant passages in ${retrieval.collectionName}`
          : `Found ${retrieval.count} ${retrieval.count === 1 ? "source" : "sources"} in ${retrieval.collectionName}`}
      </span>
    </motion.p>
  );
}

function GroundingNotice({ grounding }: { grounding: Message["grounding"] }) {
  if (grounding === "degraded") {
    return (
      <p className="mb-2 text-xs text-amber-400">
        Document search was unavailable — answered without your documents.
      </p>
    );
  }

  return null;
}

function ActionButton({
  label,
  isActive = false,
  onClick,
  children,
}: {
  label: string;
  isActive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isActive}
      title={label}
      onClick={onClick}
      className={`rounded-md p-1.5 transition hover:bg-zinc-800 ${
        isActive ? "text-accent-text" : "text-zinc-500 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <ActionButton
      label={copied ? "Copied" : "Copy"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked (insecure context): nothing useful to show.
        }
      }}
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
    </ActionButton>
  );
}

type HoverState = { citation: Citation; anchor: DOMRect } | null;

function CitationPreview({ hover, passage }: { hover: NonNullable<HoverState>; passage: CitedPassage | null | undefined }) {
  const width = 320;
  const left = Math.max(8, Math.min(hover.anchor.left - 12, window.innerWidth - width - 8));
  const placeBelow = hover.anchor.top < 220;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      role="tooltip"
      style={{
        left,
        width,
        top: placeBelow ? hover.anchor.bottom + 8 : hover.anchor.top - 8,
        transform: placeBelow ? undefined : "translateY(-100%)",
      }}
      className="pointer-events-none fixed z-50 rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-xs shadow-2xl shadow-black/40"
    >
      <p className="truncate font-medium text-zinc-100">
        [{hover.citation.n}] {citationLabel(hover.citation)}
      </p>
      {hover.citation.heading && <p className="truncate text-zinc-500">{hover.citation.heading}</p>}
      <p className="mt-2 line-clamp-5 leading-relaxed text-zinc-400">
        {passage === undefined ? "Loading passage…" : passage === null ? "Passage no longer available." : passage.content}
      </p>
      <p className="mt-2 text-[10px] text-zinc-600">Click to open in the sources panel</p>
    </motion.div>
  );
}

function TypingDots() {
  return (
    <p className="flex h-6 items-center gap-1" aria-label="Thinking">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="typing-dot h-1.5 w-1.5 rounded-full bg-zinc-500"
          style={{ animationDelay: `${dot * 0.15}s` }}
        />
      ))}
    </p>
  );
}

interface AssistantMessageProps {
  message: Message;
  isStreaming: boolean;
  isLast: boolean;
  isLoading: boolean;
  rating: Feedback | undefined;
  onHover: (hover: HoverState) => void;
  onLoadPassages: (chunkIds: string[]) => void;
  onOpenCitation: (citations: Citation[], citation: Citation) => void;
  onRegenerate: () => void;
  onRate: (value: Feedback) => void;
}

function AssistantMessage({
  message,
  isStreaming,
  isLast,
  isLoading,
  rating,
  onHover,
  onLoadPassages,
  onOpenCitation,
  onRegenerate,
  onRate,
}: AssistantMessageProps) {
  // Only an answer that streamed in this session fades its caret out; history has none.
  const [hasStreamed, setHasStreamed] = useState(isStreaming);
  if (isStreaming && !hasStreamed) setHasStreamed(true);

  const citations = message.citations ?? [];
  const caretClass = isStreaming ? "stream-cursor" : hasStreamed ? "stream-cursor-done" : "";

  return (
    <div className="group flex gap-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-text">
        <SparkleIcon size={14} />
      </div>
      <div className="min-w-0 flex-1 text-sm text-zinc-100">
        {message.retrieval && <RetrievalStatus retrieval={message.retrieval} />}
        <GroundingNotice grounding={message.grounding} />

        {message.isError ? (
          <div className="rounded-xl border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            {message.text}
          </div>
        ) : message.text ? (
          <div className={caretClass}>
            <MarkdownMessage
              text={message.text}
              citations={citations}
              onCitationHover={(citation, anchor) => {
                if (citation && anchor) {
                  onLoadPassages([citation.chunkId]);
                  onHover({ citation, anchor });
                } else {
                  onHover(null);
                }
              }}
              onCitationClick={(citation) => {
                onHover(null);
                onOpenCitation(citations, citation);
              }}
            />
          </div>
        ) : (
          isStreaming && message.retrieval?.phase !== "searching" && <TypingDots />
        )}

        {/* Sources pop in once the answer is complete, not while it is still being written. */}
        {!isStreaming && citations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {citations.map((citation, index) => (
              <motion.button
                key={citation.chunkId}
                initial={{ opacity: 0, scale: 0.9, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ ...EASE_OUT, delay: index * 0.05 }}
                type="button"
                onClick={() => onOpenCitation(citations, citation)}
                onMouseEnter={() => onLoadPassages([citation.chunkId])}
                title={[citation.title, citation.heading].filter(Boolean).join(" › ")}
                className="flex max-w-64 items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400 transition-colors duration-150 hover:border-accent/60 hover:text-zinc-100"
              >
                <span className="font-semibold text-accent-text">[{citation.n}]</span>
                <span className="truncate">{citationLabel(citation)}</span>
              </motion.button>
            ))}
          </div>
        )}

        {!isStreaming && (
          <div
            className={`mt-2 flex items-center gap-0.5 transition-opacity duration-150 ${
              isLast ? "" : "sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
            }`}
          >
            {!message.isError && (
              <>
                <CopyButton text={message.text} />
                <ActionButton label="Good response" isActive={rating === "up"} onClick={() => onRate("up")}>
                  <ThumbsUpIcon size={14} />
                </ActionButton>
                <ActionButton label="Bad response" isActive={rating === "down"} onClick={() => onRate("down")}>
                  <ThumbsDownIcon size={14} />
                </ActionButton>
              </>
            )}
            {isLast && !isLoading && (
              <ActionButton label={message.isError ? "Try again" : "Regenerate"} onClick={onRegenerate}>
                <RefreshIcon size={14} />
              </ActionButton>
            )}
            {message.grounding === "none" && (
              <span className="ml-2 flex items-center gap-1 text-xs text-zinc-500">
                <BookIcon size={12} /> Not found in your documents
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatMessages({
  messages,
  isLoading,
  bottomRef,
  attachedCollectionName,
  hasCollections,
  passages,
  feedback,
  onLoadPassages,
  onOpenCitation,
  onPickPrompt,
  onOpenDocuments,
  onRegenerate,
  onRate,
}: ChatMessagesProps) {
  const [hover, setHover] = useState<HoverState>(null);
  const lastAssistantIndex = messages.findLastIndex((message) => message.role === "assistant");

  if (messages.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 lg:px-8">
        <Welcome
          attachedCollectionName={attachedCollectionName}
          hasCollections={hasCollections}
          onPickPrompt={onPickPrompt}
          onOpenDocuments={onOpenDocuments}
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8" onScroll={() => hover && setHover(null)}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {/* initial={false}: a conversation opened from history appears at once; only new messages animate in. */}
        <AnimatePresence initial={false}>
          {messages.map((message, index) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={EASE_OUT}
            >
              {message.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100">
                    {message.text}
                  </div>
                </div>
              ) : (
                <AssistantMessage
                  message={message}
                  isStreaming={isLoading && index === messages.length - 1}
                  isLast={index === lastAssistantIndex}
                  isLoading={isLoading}
                  rating={feedback[message.storedId ?? message.id]}
                  onHover={setHover}
                  onLoadPassages={onLoadPassages}
                  onOpenCitation={onOpenCitation}
                  onRegenerate={onRegenerate}
                  onRate={(value) => onRate(message.storedId ?? message.id, value)}
                />
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        <div ref={bottomRef} />
      </div>

      {hover && <CitationPreview hover={hover} passage={passages[hover.citation.chunkId]} />}
    </div>
  );
}
