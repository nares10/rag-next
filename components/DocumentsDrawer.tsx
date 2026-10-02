"use client";

import { useState } from "react";
import type { RagCollection, RagDocument } from "@/lib/chat-types";

interface DocumentsDrawerProps {
  isOpen: boolean;
  collections: RagCollection[];
  documents: RagDocument[];
  activeCollectionId: string | null;
  attachedCollectionId: string | null;
  isBusy: boolean;
  error: string | null;
  onClose: () => void;
  onSelectCollection: (collectionId: string | null) => void;
  onCreateCollection: (name: string) => void;
  onDeleteCollection: (collectionId: string) => void;
  onAddDocument: (input: { text?: string; sourceUri?: string; title?: string }) => void;
  onDeleteDocument: (documentId: string) => void;
  onRetryDocument: (documentId: string) => void;
  onAttach: (collectionId: string | null) => void;
}

const STATUS_LABEL: Record<RagDocument["status"], string> = {
  pending: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

const STATUS_CLASS: Record<RagDocument["status"], string> = {
  pending: "text-zinc-400",
  processing: "text-amber-400",
  ready: "text-emerald-400",
  failed: "text-rose-400",
};

export default function DocumentsDrawer({
  isOpen,
  collections,
  documents,
  activeCollectionId,
  attachedCollectionId,
  isBusy,
  error,
  onClose,
  onSelectCollection,
  onCreateCollection,
  onDeleteCollection,
  onAddDocument,
  onDeleteDocument,
  onRetryDocument,
  onAttach,
}: DocumentsDrawerProps) {
  const [newCollectionName, setNewCollectionName] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [sourceUri, setSourceUri] = useState("");
  const [mode, setMode] = useState<"paste" | "url">("paste");

  if (!isOpen) return null;

  const activeCollection = collections.find((collection) => collection.id === activeCollectionId) ?? null;
  const isAttached = attachedCollectionId !== null && attachedCollectionId === activeCollectionId;

  const submitDocument = () => {
    if (!activeCollectionId) return;

    if (mode === "url") {
      if (!sourceUri.trim()) return;
      onAddDocument({ sourceUri: sourceUri.trim(), title: title.trim() || undefined });
      setSourceUri("");
    } else {
      if (!text.trim()) return;
      onAddDocument({ text, title: title.trim() || undefined });
      setText("");
    }

    setTitle("");
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <aside className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Documents</h2>
            <p className="mt-1 text-xs text-zinc-400">
              Attach a collection to the conversation and the assistant answers from it, with citations.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close documents panel"
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200 transition hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-rose-900 bg-rose-950/50 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}

        <section className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Collections</h3>

          <div className="mt-2 flex flex-col gap-1">
            {collections.length === 0 && (
              <p className="text-xs text-zinc-500">No collections yet. Create one to add documents.</p>
            )}

            {collections.map((collection) => (
              <div
                key={collection.id}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                  collection.id === activeCollectionId
                    ? "border-zinc-600 bg-zinc-900"
                    : "border-zinc-800 bg-zinc-900/40"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectCollection(collection.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm text-zinc-100">{collection.name}</p>
                  <p className="text-xs text-zinc-500">
                    {collection.readyCount}/{collection.documentCount} ready
                    {collection.id === attachedCollectionId ? " · attached" : ""}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteCollection(collection.id)}
                  className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-rose-300"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={newCollectionName}
              onChange={(event) => setNewCollectionName(event.target.value)}
              placeholder="New collection name"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none"
            />
            <button
              type="button"
              disabled={!newCollectionName.trim()}
              onClick={() => {
                onCreateCollection(newCollectionName.trim());
                setNewCollectionName("");
              }}
              className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </section>

        {activeCollection && (
          <>
            <section className="mt-6">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {activeCollection.name}
                </h3>
                <button
                  type="button"
                  onClick={() => onAttach(isAttached ? null : activeCollection.id)}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 transition hover:bg-zinc-800"
                >
                  {isAttached ? "Detach from conversation" : "Attach to conversation"}
                </button>
              </div>

              <div className="mt-2 flex flex-col gap-1">
                {documents.length === 0 && (
                  <p className="text-xs text-zinc-500">Nothing here yet. Paste some text or add a URL below.</p>
                )}

                {documents.map((document) => (
                  <div
                    key={document.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm text-zinc-100">{document.title}</p>
                      <span className={`text-xs ${STATUS_CLASS[document.status]}`}>
                        {STATUS_LABEL[document.status]}
                        {document.status === "ready" ? ` · ${document.chunkCount} chunks` : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => onDeleteDocument(document.id)}
                        className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-rose-300"
                      >
                        Remove
                      </button>
                    </div>

                    {document.error && (
                      <div className="mt-1 flex items-start justify-between gap-2">
                        <p className="text-xs text-rose-300">{document.error}</p>
                        {document.sourceType === "url" && (
                          <button
                            type="button"
                            onClick={() => onRetryDocument(document.id)}
                            className="shrink-0 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-6">
              <div className="flex gap-2">
                {(["paste", "url"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMode(option)}
                    className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                      mode === option
                        ? "border-zinc-500 bg-zinc-800 text-white"
                        : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                    }`}
                  >
                    {option === "paste" ? "Paste text" : "From URL"}
                  </button>
                ))}
              </div>

              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Title (optional)"
                className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none"
              />

              {mode === "paste" ? (
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  rows={6}
                  placeholder="Paste markdown or plain text..."
                  className="mt-2 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none"
                />
              ) : (
                <input
                  value={sourceUri}
                  onChange={(event) => setSourceUri(event.target.value)}
                  placeholder="https://example.com/handbook"
                  className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500 outline-none"
                />
              )}

              <button
                type="button"
                disabled={isBusy}
                onClick={submitDocument}
                className="mt-2 w-full rounded-lg bg-white px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-50"
              >
                {isBusy ? "Adding..." : "Add document"}
              </button>

              <p className="mt-2 text-xs text-zinc-500">
                Plain text, markdown and HTML pages are supported. PDF and Word files are not read by this
                server yet.
              </p>
            </section>
          </>
        )}
      </aside>
    </div>
  );
}
