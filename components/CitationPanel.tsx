"use client";

import { useEffect } from "react";
import { motion } from "motion/react";
import { PANEL_SPRING } from "@/components/motion";
import type { Citation, CitedPassage } from "@/lib/chat-types";
import { FileIcon, LinkIcon, SpinnerIcon, XIcon } from "@/components/icons";

interface CitationPanelProps {
  citations: Citation[];
  active: Citation;
  passages: Record<string, CitedPassage | null>;
  onSelect: (citation: Citation) => void;
  onClose: () => void;
}

export function citationLabel(citation: Pick<Citation, "title" | "page">) {
  return citation.page === null ? citation.title : `${citation.title} p.${citation.page}`;
}

/** The passages an answer was grounded in, with the cited one highlighted in context. */
export default function CitationPanel({ citations, active, passages, onSelect, onClose }: CitationPanelProps) {
  const passage = passages[active.chunkId];
  const isLoading = passage === undefined;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        type="button"
        aria-label="Close sources"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50 lg:hidden"
      />
      <motion.aside
        initial={{ x: "100%", opacity: 0.5 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: "100%", opacity: 0 }}
        transition={PANEL_SPRING}
        aria-label="Sources"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl lg:static lg:z-auto lg:w-[26rem] lg:max-w-none lg:shrink-0 lg:shadow-none"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Sources</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sources"
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            <XIcon />
          </button>
        </div>

        <div className="flex gap-1.5 overflow-x-auto border-b border-zinc-800 px-4 py-2.5">
          {citations.map((citation) => (
            <button
              key={citation.chunkId}
              type="button"
              onClick={() => onSelect(citation)}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-xs transition ${
                citation.chunkId === active.chunkId
                  ? "border-accent bg-accent-soft text-accent-text"
                  : "border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              [{citation.n}]
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 rounded-md bg-zinc-900 p-1.5 text-zinc-400">
              {passage?.sourceUri ? <LinkIcon size={14} /> : <FileIcon size={14} />}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-100">{active.title}</p>
              <p className="text-xs text-zinc-500">
                {[active.heading, active.page === null ? null : `Page ${active.page}`].filter(Boolean).join(" · ") ||
                  "Passage"}
              </p>
              {passage?.sourceUri && (
                <a
                  href={passage.sourceUri}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 block truncate text-xs text-accent-text hover:underline"
                >
                  {passage.sourceUri}
                </a>
              )}
            </div>
          </div>

          <motion.div
            key={active.chunkId + (isLoading ? ":loading" : "")}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="mt-4 text-sm leading-relaxed"
          >
            {isLoading ? (
              <p className="flex items-center gap-2 text-zinc-500">
                <SpinnerIcon size={14} /> Loading passage…
              </p>
            ) : passage === null ? (
              <p className="rounded-lg border border-dashed border-zinc-800 p-3 text-zinc-500">
                This passage is no longer available — the document may have been removed or re-processed.
              </p>
            ) : (
              <>
                {passage.before && <p className="whitespace-pre-wrap text-zinc-500 line-clamp-6">{passage.before}</p>}
                <p className="my-3 whitespace-pre-wrap rounded-r-lg border-l-2 border-accent bg-accent-soft px-3 py-2 text-zinc-100">
                  {passage.content}
                </p>
                {passage.after && <p className="whitespace-pre-wrap text-zinc-500 line-clamp-6">{passage.after}</p>}
              </>
            )}
          </motion.div>
        </div>
      </motion.aside>
    </>
  );
}
