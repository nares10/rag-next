"use client";

import { useLayoutEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ApiKey, ChatUser, Provider, RagCollection } from "@/lib/chat-types";
import { FREE_MESSAGE_LIMIT } from "@/lib/freeMessages";
import ModelPicker from "@/components/ModelPicker";
import UsageRing from "@/components/UsageRing";
import { ArrowUpIcon, BookIcon, PaperclipIcon, SpinnerIcon, StopIcon, XIcon } from "@/components/icons";

/** Must match what /api/rag/documents accepts. */
export const ACCEPTED_FILES = ".pdf,.docx,.md,.markdown,.txt,.html,.htm";

interface ChatComposerProps {
  user: ChatUser | null;
  input: string;
  isLoading: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  provider: Provider;
  model: string | null;
  apiKeys: ApiKey[];
  hasActiveKey: boolean;
  attachedCollection: RagCollection | null;
  uploadingCount: number;
  useRag: boolean;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onSelectModel: (provider: Provider, model: string | null) => void;
  onManageKeys: () => void;
  onOpenDocuments: () => void;
  onDetachCollection: () => void;
  onToggleUseRag: () => void;
  onAttachFiles: (files: File[]) => void;
}

export default function ChatComposer({
  user,
  input,
  isLoading,
  inputRef,
  provider,
  model,
  apiKeys,
  hasActiveKey,
  attachedCollection,
  uploadingCount,
  useRag,
  onInputChange,
  onSubmit,
  onStop,
  onSelectModel,
  onManageKeys,
  onOpenDocuments,
  onDetachCollection,
  onToggleUseRag,
  onAttachFiles,
}: ChatComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Grow with the content up to the max-height, and shrink back once the input is sent.
  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [input, inputRef]);

  const canSend = input.trim() !== "" && !isLoading;

  return (
    <div className="shrink-0 px-3 pb-3 pt-2 sm:px-4 lg:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <AnimatePresence initial={false}>
        {(attachedCollection || uploadingCount > 0) && (
          <motion.div
            key="context"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="mb-2 flex flex-wrap items-center gap-2"
          >
            {attachedCollection && (
              <div
                className={`flex items-center gap-1 rounded-full border py-1 pl-3 pr-1 text-xs transition ${
                  useRag
                    ? "border-accent/40 bg-accent-soft text-accent-text"
                    : "border-zinc-700 bg-zinc-900 text-zinc-500 line-through decoration-zinc-600"
                }`}
              >
                <button
                  type="button"
                  onClick={onOpenDocuments}
                  title="Answers come from this collection. Click to manage it."
                  className="flex items-center gap-1.5 no-underline"
                >
                  <BookIcon size={13} />
                  <span className="max-w-48 truncate font-medium">{attachedCollection.name}</span>
                  <span className="opacity-70">
                    · {attachedCollection.readyCount} {attachedCollection.readyCount === 1 ? "file" : "files"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onToggleUseRag}
                  title={useRag ? "Answer this message without the documents" : "Use the documents again"}
                  className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide no-underline opacity-80 hover:bg-zinc-800 hover:opacity-100"
                >
                  {useRag ? "On" : "Off"}
                </button>
                <button
                  type="button"
                  onClick={onDetachCollection}
                  aria-label={`Detach ${attachedCollection.name}`}
                  title="Detach from this chat"
                  className="rounded-full p-1 opacity-70 hover:bg-zinc-800 hover:opacity-100"
                >
                  <XIcon size={12} />
                </button>
              </div>
            )}
            {uploadingCount > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                <SpinnerIcon size={12} /> Uploading {uploadingCount} {uploadingCount === 1 ? "file" : "files"}…
              </span>
            )}
          </motion.div>
        )}
        </AnimatePresence>

        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 shadow-lg shadow-black/10 transition focus-within:border-zinc-500">
          <div className="flex items-end gap-1 p-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach files"
              title="Attach files — they are added to the chat's document collection"
              className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
            >
              <PaperclipIcon size={18} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_FILES}
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (files.length > 0) onAttachFiles(files);
              }}
            />

            <textarea
              ref={inputRef}
              autoFocus
              rows={1}
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (canSend) onSubmit();
                }
              }}
              placeholder={attachedCollection && useRag ? `Ask about ${attachedCollection.name}…` : "Ask anything…"}
              aria-label="Message"
              className="max-h-48 min-h-10 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition-[height] duration-150 ease-out motion-reduce:transition-none"
            />

            <motion.button
              type="button"
              whileTap={isLoading || canSend ? { scale: 0.92 } : undefined}
              transition={{ duration: 0.1 }}
              disabled={!isLoading && !canSend}
              onClick={isLoading ? onStop : onSubmit}
              aria-label={isLoading ? "Stop generating" : "Send message"}
              title={isLoading ? "Stop generating" : "Send"}
              className="relative overflow-hidden rounded-xl bg-accent p-2 text-on-accent transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={isLoading ? "stop" : "send"}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="block"
                >
                  {isLoading ? <StopIcon size={18} /> : <ArrowUpIcon size={18} />}
                </motion.span>
              </AnimatePresence>
            </motion.button>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-zinc-800 px-2 py-1">
            <ModelPicker
              provider={provider}
              model={model}
              apiKeys={apiKeys}
              hasActiveKey={hasActiveKey}
              onSelect={onSelectModel}
              onManageKeys={onManageKeys}
            />
            <div className="flex items-center gap-1">
              {!attachedCollection && (
                <button
                  type="button"
                  onClick={onOpenDocuments}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <BookIcon size={14} /> Documents
                </button>
              )}
              {user && !hasActiveKey && <UsageRing used={user.freeMessagesUsed} limit={FREE_MESSAGE_LIMIT} />}
            </div>
          </div>
        </div>
        <p className="mt-1.5 hidden text-center text-[11px] text-zinc-600 sm:block">
          Enter to send · Shift+Enter for a new line · Ctrl+K for a new chat
        </p>
      </div>
    </div>
  );
}
