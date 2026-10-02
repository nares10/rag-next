"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ApiKey, Provider } from "@/lib/chat-types";
import { MODELS, PROVIDER_LABEL, modelLabel } from "@/lib/models";
import { useDismiss } from "@/hooks/useDismiss";
import { CheckIcon, ChevronDownIcon, KeyIcon, LockIcon } from "@/components/icons";

interface ModelPickerProps {
  provider: Provider;
  model: string | null;
  apiKeys: ApiKey[];
  /** The key the current chat is using; null means free messages. */
  hasActiveKey: boolean;
  onSelect: (provider: Provider, model: string | null) => void;
  onManageKeys: () => void;
}

/**
 * Free messages run on OpenRouter's default model. Anything else needs the user's own
 * key for that provider; picking a locked model routes through the key dialog.
 */
export function isFreeChoice(provider: Provider, model: string | null) {
  return provider === "openrouter" && model === null;
}

export default function ModelPicker({
  provider,
  model,
  apiKeys,
  hasActiveKey,
  onSelect,
  onManageKeys,
}: ModelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(isOpen, () => setIsOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
      >
        <span className="text-zinc-500">{PROVIDER_LABEL[provider]}</span>
        <span className="text-zinc-600">·</span>
        <span className="font-medium">{modelLabel(provider, model)}</span>
        {!hasActiveKey && isFreeChoice(provider, model) && (
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-text">Free</span>
        )}
        <ChevronDownIcon size={14} className="text-zinc-500" />
      </button>

      <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 4 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          style={{ transformOrigin: "bottom left" }}
          role="listbox"
          className="absolute bottom-10 left-0 z-40 max-h-[60vh] w-72 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900 p-1.5 shadow-2xl shadow-black/30"
        >
          {(Object.keys(MODELS) as Provider[]).map((option) => {
            const hasSavedKey = apiKeys.some((key) => key.provider === option);

            return (
              <div key={option} className="py-1">
                <p className="flex items-center justify-between px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  {PROVIDER_LABEL[option]}
                  {hasSavedKey && <KeyIcon size={12} aria-label="Saved key" />}
                </p>
                {MODELS[option].map((entry) => {
                  const isSelected = option === provider && entry.id === model;
                  const isLocked = !hasSavedKey && !isFreeChoice(option, entry.id) && !(isSelected && hasActiveKey);

                  return (
                    <button
                      key={entry.id ?? "default"}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setIsOpen(false);
                        onSelect(option, entry.id);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                        isSelected ? "bg-accent-soft text-zinc-100" : "text-zinc-300 hover:bg-zinc-800"
                      }`}
                    >
                      <span className="truncate">{entry.label}</span>
                      {isSelected ? (
                        <CheckIcon size={14} className="shrink-0 text-accent-text" />
                      ) : isLocked ? (
                        <LockIcon size={12} className="shrink-0 text-zinc-600" aria-label="Needs an API key" />
                      ) : isFreeChoice(option, entry.id) ? (
                        <span className="text-[10px] text-zinc-500">Free</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
          <div className="mt-1 border-t border-zinc-800 pt-1.5">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onManageKeys();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              <KeyIcon size={14} /> Use your own API key…
            </button>
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
