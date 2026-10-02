"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "@/hooks/useTheme";
import { KeyIcon, MoonIcon, SunIcon, XIcon } from "@/components/icons";

export const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["Ctrl", "K"], label: "New chat" },
  { keys: ["Ctrl", "B"], label: "Toggle sidebar" },
  { keys: ["Ctrl", "Shift", "D"], label: "Open documents" },
  { keys: ["/"], label: "Focus the message box" },
  { keys: ["Esc"], label: "Close panels and menus" },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (!isOpen) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
    {isOpen && (
    <motion.div key="settings" className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Settings">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-100">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            <XIcon />
          </button>
        </div>

        <div className="space-y-6 px-5 py-5">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Appearance</h3>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["dark", "light"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTheme(option)}
                  aria-pressed={theme === option}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition ${
                    theme === option
                      ? "border-accent bg-accent-soft text-accent-text"
                      : "border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  {option === "dark" ? <MoonIcon /> : <SunIcon />}
                  {option === "dark" ? "Dark" : "Light"}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Keyboard shortcuts</h3>
            <ul className="mt-2 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
              {SHORTCUTS.map((shortcut) => (
                <li key={shortcut.label} className="flex items-center justify-between px-3 py-2 text-sm text-zinc-300">
                  {shortcut.label}
                  <span className="flex gap-1">
                    {shortcut.keys.map((key) => (
                      <kbd
                        key={key}
                        className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-zinc-500">On a Mac, use ⌘ in place of Ctrl.</p>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">API keys</h3>
            <Link
              href="/profile#api-keys"
              className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2.5 text-sm text-zinc-300 transition hover:bg-zinc-800"
            >
              <KeyIcon className="text-zinc-400" /> Manage your API keys
            </Link>
          </section>
        </div>
      </motion.div>
    </motion.div>
    )}
    </AnimatePresence>
  );
}
