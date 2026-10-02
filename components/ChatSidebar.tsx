"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EASE_OUT } from "@/components/motion";
import type { Conversation } from "@/lib/chat-types";
import { useDismiss } from "@/hooks/useDismiss";
import { BookIcon, ChatIcon, MoreIcon, PlusIcon, SearchIcon, XIcon } from "@/components/icons";

interface ChatSidebarProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  isLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
  onNewConversation: () => void;
  onOpenDocuments: () => void;
  onSelectConversation: (conversation: Conversation) => void;
  onRenameConversation: (conversation: Conversation, title: string) => void;
  onDeleteConversation: (conversation: Conversation) => void;
}

const DEFAULT_WIDTH = 272;
const MIN_WIDTH = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

const isMobile = () => window.matchMedia("(max-width: 767px)").matches;

/** Buckets by last activity, newest first; the list arrives already sorted by updatedAt. */
function groupByDate(conversations: Conversation[]) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();

  const groups: Array<{ label: string; items: Conversation[] }> = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Previous 30 days", items: [] },
    { label: "Older", items: [] },
  ];

  for (const conversation of conversations) {
    const stamp = new Date(conversation.updatedAt ?? conversation.createdAt ?? Date.now()).getTime();
    const index =
      stamp >= today ? 0 : stamp >= today - DAY_MS ? 1 : stamp >= today - 7 * DAY_MS ? 2 : stamp >= today - 30 * DAY_MS ? 3 : 4;
    groups[index].items.push(conversation);
  }

  return groups.filter((group) => group.items.length > 0);
}

function ConversationRow({
  conversation,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useDismiss<HTMLDivElement>(isMenuOpen, () => setIsMenuOpen(false));

  if (isEditing) {
    return (
      <form
        className="px-1 py-1"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = title.trim();
          if (!trimmed) return;
          onRename(trimmed);
          setIsEditing(false);
        }}
      >
        <input
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && setIsEditing(false)}
          onBlur={() => setIsEditing(false)}
          className="w-full rounded-md border border-accent bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none"
          aria-label="Conversation name"
        />
      </form>
    );
  }

  return (
    <div
      ref={menuRef}
      className={`group relative flex items-center rounded-lg text-sm transition ${
        isActive ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
      }`}
    >
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate px-3 py-2 text-left">
        {conversation.title}
      </button>
      <button
        type="button"
        aria-label={`Actions for ${conversation.title}`}
        aria-expanded={isMenuOpen}
        onClick={() => setIsMenuOpen((open) => !open)}
        className={`mr-1 rounded-md p-1 text-zinc-500 transition hover:bg-zinc-700 hover:text-zinc-100 ${
          isMenuOpen || isActive ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
        }`}
      >
        <MoreIcon size={14} />
      </button>
      {isMenuOpen && (
        <div className="absolute right-1 top-9 z-20 w-32 rounded-lg border border-zinc-800 bg-zinc-900 p-1 shadow-xl">
          <button
            type="button"
            onClick={() => {
              setIsMenuOpen(false);
              setTitle(conversation.title);
              setIsEditing(true);
            }}
            className="block w-full rounded-md px-3 py-1.5 text-left text-xs text-zinc-200 hover:bg-zinc-800"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              setIsMenuOpen(false);
              onDelete();
            }}
            className="block w-full rounded-md px-3 py-1.5 text-left text-xs text-rose-300 hover:bg-rose-950/60"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export default function ChatSidebar({
  conversations,
  currentConversationId,
  isLoading,
  isOpen,
  onClose,
  onNewConversation,
  onOpenDocuments,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
}: ChatSidebarProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [query, setQuery] = useState("");
  // State rather than a ref: the width transition has to be off while dragging.
  const [isResizing, setIsResizing] = useState(false);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? conversations.filter((conversation) => conversation.title.toLowerCase().includes(needle))
      : conversations;

    return groupByDate(matching);
  }, [conversations, query]);

  const closeOnMobile = () => {
    if (isMobile()) onClose();
  };

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/60 transition-opacity duration-300 md:hidden ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        aria-label="Conversations"
        style={{ "--sidebar-w": `${width}px` } as React.CSSProperties}
        className={`fixed inset-y-0 left-0 z-40 w-72 shrink-0 overflow-hidden border-r border-zinc-800 bg-zinc-950 transition-[transform,width] duration-300 ease-in-out md:relative md:z-auto md:bg-zinc-950/60 ${isResizing ? "transition-none" : ""} ${
          isOpen
            ? "translate-x-0 md:w-[var(--sidebar-w)]"
            : "-translate-x-full md:w-0 md:translate-x-0 md:border-r-0"
        }`}
      >
        {/* Fixed inner width so the content slides instead of squashing while the panel collapses. */}
        <div className="flex h-full w-72 flex-col md:w-[var(--sidebar-w)]">
          <div className="flex items-center gap-2 p-3">
            <button
              onClick={() => {
                onNewConversation();
                closeOnMobile();
              }}
              title="New chat (Ctrl+K)"
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover"
            >
              <PlusIcon /> New chat
            </button>
            <button
              type="button"
              aria-label="Close sidebar"
              onClick={onClose}
              className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 md:hidden"
            >
              <XIcon />
            </button>
          </div>

          <div className="px-3">
            <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-zinc-500 focus-within:border-zinc-600">
              <SearchIcon size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search chats"
                aria-label="Search chats"
                className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
              />
              {query && (
                <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="hover:text-zinc-200">
                  <XIcon size={12} />
                </button>
              )}
            </label>
            <button
              type="button"
              onClick={() => {
                onOpenDocuments();
                closeOnMobile();
              }}
              className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-200"
            >
              <BookIcon size={15} /> Documents
            </button>
          </div>

          <nav className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {isLoading && conversations.length === 0 ? (
              <div className="space-y-2 px-1 pt-2" aria-label="Loading conversations">
                {[80, 65, 90, 55, 70].map((width) => (
                  <div key={width} className="skeleton h-7" style={{ width: `${width}%` }} />
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={EASE_OUT}
                className="flex flex-col items-center px-4 pt-10 text-center"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-zinc-500">
                  <ChatIcon size={18} />
                </span>
                <p className="mt-3 text-sm text-zinc-400">Your chats will appear here</p>
              </motion.div>
            ) : groups.length === 0 ? (
              <p className="px-3 pt-4 text-sm text-zinc-500">No chats match “{query.trim()}”.</p>
            ) : (
              groups.map((group) => (
                <div key={group.label} className="mt-3 first:mt-1">
                  <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{group.label}</p>
                  <div>
                    {/* `layout` slides the rest of the list down when a new chat arrives on top. */}
                    <AnimatePresence initial={false}>
                    {group.items.map((conversation) => (
                      <motion.div
                        key={conversation.id}
                        layout="position"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={EASE_OUT}
                        className="pb-0.5"
                      >
                      <ConversationRow
                        conversation={conversation}
                        isActive={currentConversationId === conversation.id}
                        onSelect={() => {
                          onSelectConversation(conversation);
                          closeOnMobile();
                        }}
                        onRename={(title) => onRenameConversation(conversation, title)}
                        onDelete={() => onDeleteConversation(conversation)}
                      />
                      </motion.div>
                    ))}
                    </AnimatePresence>
                  </div>
                </div>
              ))
            )}
          </nav>
        </div>

        {isOpen && (
          <div
            role="separator"
            aria-label="Resize conversation sidebar"
            aria-orientation="vertical"
            onPointerDown={(event) => {
              event.preventDefault();
              setIsResizing(true);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!isResizing) return;
              const maxWidth = Math.min(480, Math.floor(window.innerWidth * 0.4));
              setWidth(Math.min(Math.max(event.clientX, MIN_WIDTH), maxWidth));
            }}
            onPointerUp={(event) => {
              setIsResizing(false);
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => setIsResizing(false)}
            className="absolute inset-y-0 right-0 hidden w-1.5 cursor-col-resize touch-none select-none transition-colors hover:bg-accent/50 md:block"
          />
        )}
      </aside>
    </>
  );
}
