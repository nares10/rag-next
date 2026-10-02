"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ChatUser } from "@/lib/chat-types";
import { useDismiss } from "@/hooks/useDismiss";
import { useTheme } from "@/hooks/useTheme";
import { LogoutIcon, MenuIcon, MoonIcon, SettingsIcon, SunIcon, UserIcon } from "@/components/icons";

interface ChatHeaderProps {
  user: ChatUser | null;
  title: string | null;
  onLogout: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
}

const MENU_ITEM =
  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 transition hover:bg-zinc-800";

export default function ChatHeader({ user, title, onLogout, onOpenSettings, onToggleSidebar }: ChatHeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useDismiss<HTMLDivElement>(isMenuOpen, () => setIsMenuOpen(false));
  const { theme, toggleTheme } = useTheme();
  const initial = user?.name?.charAt(0).toUpperCase() || user?.email?.charAt(0).toUpperCase() || "U";

  return (
    <header className="shrink-0 border-b border-zinc-800 bg-zinc-950/80 px-3 py-2.5 backdrop-blur-sm sm:px-4 lg:px-8">
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label="Toggle conversation sidebar"
            title="Toggle sidebar (Ctrl+B)"
            onClick={onToggleSidebar}
            className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            <MenuIcon size={18} />
          </button>
          <h1 className="truncate text-sm font-medium text-zinc-100">{title ?? "New chat"}</h1>
        </div>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label="Account menu"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((open) => !open)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-on-accent ring-offset-2 ring-offset-zinc-950 transition hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            {initial}
          </button>

          <AnimatePresence>
          {isMenuOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              style={{ transformOrigin: "top right" }}
              role="menu"
              className="absolute right-0 top-10 z-40 w-60 rounded-xl border border-zinc-800 bg-zinc-900 p-1.5 shadow-2xl shadow-black/30"
            >
              {user && (
                <div className="border-b border-zinc-800 px-3 pb-2.5 pt-1.5">
                  <p className="truncate text-sm font-medium text-zinc-100">{user.name}</p>
                  <p className="truncate text-xs text-zinc-500">{user.email}</p>
                </div>
              )}
              <div className="pt-1.5">
                <Link href="/profile" role="menuitem" className={MENU_ITEM} onClick={() => setIsMenuOpen(false)}>
                  <UserIcon className="text-zinc-400" /> Profile
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ITEM}
                  onClick={() => {
                    setIsMenuOpen(false);
                    onOpenSettings();
                  }}
                >
                  <SettingsIcon className="text-zinc-400" /> Settings
                </button>
                <button type="button" role="menuitem" className={MENU_ITEM} onClick={toggleTheme}>
                  {theme === "light" ? (
                    <MoonIcon className="text-zinc-400" />
                  ) : (
                    <SunIcon className="text-zinc-400" />
                  )}
                  {theme === "light" ? "Dark mode" : "Light mode"}
                </button>
              </div>
              <div className="mt-1.5 border-t border-zinc-800 pt-1.5">
                <button
                  type="button"
                  role="menuitem"
                  className={`${MENU_ITEM} hover:text-rose-300`}
                  onClick={() => {
                    setIsMenuOpen(false);
                    onLogout();
                  }}
                >
                  <LogoutIcon className="text-zinc-400" /> Log out
                </button>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
