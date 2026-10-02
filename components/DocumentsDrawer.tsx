"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { COLLAPSE, EASE_OUT, PANEL_SPRING } from "@/components/motion";
import type { RagCollection, RagDocument } from "@/lib/chat-types";
import type { PendingUpload } from "@/hooks/useRagDocuments";
import { useDismiss } from "@/hooks/useDismiss";
import ConfirmModal from "@/components/ConfirmModal";
import { ACCEPTED_FILES } from "@/components/ChatComposer";
import {
  ArrowLeftIcon,
  BookIcon,
  CheckIcon,
  LinkIcon,
  MoreIcon,
  RefreshIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from "@/components/icons";

interface DocumentsDrawerProps {
  isOpen: boolean;
  collections: RagCollection[];
  documents: RagDocument[];
  uploads: PendingUpload[];
  activeCollectionId: string | null;
  attachedCollectionId: string | null;
  isBusy: boolean;
  isLoadingCollections: boolean;
  error: string | null;
  canRetry: (document: RagDocument) => boolean;
  onClose: () => void;
  onSelectCollection: (collectionId: string | null) => void;
  onCreateCollection: (name: string) => void;
  onDeleteCollection: (collectionId: string) => void;
  onAddDocument: (input: { text?: string; sourceUri?: string; title?: string }) => void;
  onUploadFiles: (files: File[]) => void;
  onRetryUpload: (uploadId: string) => void;
  onDismissUpload: (uploadId: string) => void;
  onDeleteDocument: (documentId: string) => void;
  onRetryDocument: (documentId: string) => void;
  onAttach: (collectionId: string | null) => void;
}

type PendingDelete = { kind: "collection" | "document"; id: string; name: string } | null;

const ACCEPTED_EXTENSIONS = ACCEPTED_FILES.split(",");

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKind(mimeType: string, name = ""): { label: string; className: string } {
  const lower = `${mimeType} ${name.toLowerCase()}`;
  if (lower.includes("pdf")) return { label: "PDF", className: "bg-rose-500/15 text-rose-400" };
  if (lower.includes("word") || lower.includes(".docx")) return { label: "DOC", className: "bg-sky-500/15 text-sky-400" };
  if (lower.includes("markdown") || /\.(md|markdown)\b/.test(lower)) return { label: "MD", className: "bg-violet-500/15 text-violet-400" };
  if (lower.includes("html") || /\.html?\b/.test(lower)) return { label: "HTML", className: "bg-amber-500/15 text-amber-400" };
  return { label: "TXT", className: "bg-zinc-500/15 text-zinc-400" };
}

function FileBadge({ document }: { document: Pick<RagDocument, "mimeType" | "sourceType" | "title"> }) {
  if (document.sourceType === "url") {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
        <LinkIcon size={15} />
      </span>
    );
  }

  const kind = fileKind(document.mimeType, document.title);
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${kind.className}`}>
      {kind.label}
    </span>
  );
}

function StatusBadge({ status }: { status: RagDocument["status"] | "uploading" }) {
  const styles = {
    uploading: { label: "Uploading", className: "text-accent-text", spin: true },
    pending: { label: "Queued", className: "text-zinc-400", spin: true },
    processing: { label: "Processing", className: "text-amber-400", spin: true },
    ready: { label: "Ready", className: "text-emerald-400", spin: false },
    failed: { label: "Failed", className: "text-rose-400", spin: false },
  }[status];

  return (
    <motion.span
      key={status}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={EASE_OUT}
      className={`flex items-center gap-1.5 text-xs font-medium ${styles.className}`}
    >
      {styles.spin ? (
        <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-current" />
      ) : (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
          className="flex"
        >
          {status === "ready" ? <CheckIcon size={12} strokeWidth={3} /> : <XIcon size={12} strokeWidth={3} />}
        </motion.span>
      )}
      {styles.label}
    </motion.span>
  );
}

function CollectionMenu({ onDelete }: { onDelete: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(isOpen, () => setIsOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="More actions"
        aria-expanded={isOpen}
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((open) => !open);
        }}
        className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100"
      >
        <MoreIcon />
      </button>
      {isOpen && (
        <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-zinc-800 bg-zinc-900 p-1 shadow-xl">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsOpen(false);
              onDelete();
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs text-rose-300 hover:bg-rose-950/60"
          >
            <TrashIcon size={13} /> Delete collection
          </button>
        </div>
      )}
    </div>
  );
}

function AttachButton({ isAttached, onClick }: { isAttached: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
        isAttached
          ? "border border-accent/50 bg-accent-soft text-accent-text hover:bg-transparent"
          : "bg-accent text-on-accent hover:bg-accent-hover"
      }`}
      title={isAttached ? "Detach from this chat" : "Answer questions in this chat from this collection"}
    >
      {isAttached ? <CheckIcon size={13} /> : null}
      {isAttached ? "Attached" : "Attach to chat"}
    </button>
  );
}

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const accept = (files: File[]) => {
    const ok = files.filter((file) => ACCEPTED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension)));
    setRejected(files.filter((file) => !ok.includes(file)).map((file) => file.name));
    if (ok.length > 0) onFiles(ok);
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          accept(Array.from(event.dataTransfer.files));
        }}
        className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition duration-200 ease-out motion-reduce:transform-none ${
          isDragging
            ? "scale-[1.02] border-accent bg-accent-soft shadow-[0_0_0_4px_var(--color-accent-soft),0_0_32px_var(--color-accent-soft)]"
            : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900/60"
        }`}
      >
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-full ${
            isDragging ? "bg-accent text-on-accent" : "bg-zinc-800 text-zinc-300"
          }`}
        >
          <UploadIcon size={18} />
        </span>
        <span className="mt-3 text-sm font-medium text-zinc-100">
          {isDragging ? "Drop to upload" : "Drag files here or click to browse"}
        </span>
        <span className="mt-1 text-xs text-zinc-500">PDF, Word, Markdown, text or HTML · up to 4 MB each</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILES}
        className="hidden"
        onChange={(event) => {
          accept(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {rejected.length > 0 && (
        <p className="mt-2 text-xs text-rose-300">Not a supported file type: {rejected.join(", ")}</p>
      )}
    </div>
  );
}

function AddFromSource({
  isBusy,
  onAdd,
}: {
  isBusy: boolean;
  onAdd: (input: { text?: string; sourceUri?: string; title?: string }) => void;
}) {
  const [mode, setMode] = useState<"url" | "paste" | null>(null);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");

  const submit = () => {
    if (!value.trim()) return;
    onAdd(mode === "url" ? { sourceUri: value.trim(), title: title.trim() || undefined } : { text: value, title: title.trim() || undefined });
    setValue("");
    setTitle("");
    setMode(null);
  };

  if (!mode) {
    return (
      <div className="mt-2 flex gap-2 text-xs">
        <button type="button" onClick={() => setMode("url")} className="rounded-lg px-2 py-1 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100">
          + Add from URL
        </button>
        <button type="button" onClick={() => setMode("paste")} className="rounded-lg px-2 py-1 text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100">
          + Paste text
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-300">{mode === "url" ? "Add a web page" : "Paste text"}</p>
        <button type="button" aria-label="Cancel" onClick={() => setMode(null)} className="text-zinc-500 hover:text-zinc-200">
          <XIcon size={14} />
        </button>
      </div>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Title (optional)"
        className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-500"
      />
      {mode === "url" ? (
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit()}
          placeholder="https://example.com/handbook"
          className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-500"
        />
      ) : (
        <textarea
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows={5}
          placeholder="Paste markdown or plain text…"
          className="mt-2 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-zinc-500"
        />
      )}
      <button
        type="button"
        disabled={isBusy || !value.trim()}
        onClick={submit}
        className="mt-2 w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
      >
        {isBusy ? "Adding…" : "Add"}
      </button>
    </div>
  );
}

export default function DocumentsDrawer({
  isOpen,
  collections,
  documents,
  uploads,
  activeCollectionId,
  attachedCollectionId,
  isBusy,
  isLoadingCollections,
  error,
  canRetry,
  onClose,
  onSelectCollection,
  onCreateCollection,
  onDeleteCollection,
  onAddDocument,
  onUploadFiles,
  onRetryUpload,
  onDismissUpload,
  onDeleteDocument,
  onRetryDocument,
  onAttach,
}: DocumentsDrawerProps) {
  const [newCollectionName, setNewCollectionName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);

  useEffect(() => {
    if (!isOpen || pendingDelete) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, pendingDelete, onClose]);

  const activeCollection = collections.find((collection) => collection.id === activeCollectionId) ?? null;
  const collectionUploads = uploads.filter((upload) => upload.collectionId === activeCollectionId);

  const createCollection = () => {
    const name = newCollectionName.trim();
    if (!name) return;
    onCreateCollection(name);
    setNewCollectionName("");
  };

  return (
    <AnimatePresence>
    {isOpen && (
    <motion.div key="documents" className="fixed inset-0 z-50 flex justify-end">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={PANEL_SPRING}
        aria-label="Documents"
        className="relative flex h-full w-full max-w-lg flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          {activeCollection ? (
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => onSelectCollection(null)}
                aria-label="Back to collections"
                className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
              >
                <ArrowLeftIcon />
              </button>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-zinc-100">{activeCollection.name}</h2>
                <p className="text-xs text-zinc-500">
                  {activeCollection.documentCount} {activeCollection.documentCount === 1 ? "file" : "files"} ·{" "}
                  {activeCollection.readyCount} ready
                </p>
              </div>
            </div>
          ) : (
            <div>
              <h2 className="text-base font-semibold text-zinc-100">Documents</h2>
              <p className="mt-0.5 text-xs text-zinc-400">Attach a collection to a chat to get answers with citations.</p>
            </div>
          )}
          <div className="flex shrink-0 items-center gap-1">
            {activeCollection && (
              <>
                <AttachButton
                  isAttached={activeCollection.id === attachedCollectionId}
                  onClick={() => onAttach(activeCollection.id === attachedCollectionId ? null : activeCollection.id)}
                />
                <CollectionMenu
                  onDelete={() =>
                    setPendingDelete({ kind: "collection", id: activeCollection.id, name: activeCollection.name })
                  }
                />
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close documents panel"
              className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
            >
              <XIcon />
            </button>
          </div>
        </div>

        <motion.div
          key={activeCollection?.id ?? "collections"}
          initial={{ opacity: 0, x: activeCollection ? 12 : -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={EASE_OUT}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
        >
          {error && (
            <p className="mb-4 rounded-lg border border-rose-900 bg-rose-950/50 px-3 py-2 text-xs text-rose-300">{error}</p>
          )}

          {activeCollection ? (
            <>
              <DropZone onFiles={onUploadFiles} />
              <AddFromSource isBusy={isBusy} onAdd={onAddDocument} />

              <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-zinc-500">Files</h3>
              <ul className="mt-2">
                <AnimatePresence initial={false}>
                {collectionUploads.length === 0 && documents.length === 0 && (
                  <motion.li key="empty" {...COLLAPSE} className="overflow-hidden rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
                    No files yet. Drop some above to get started.
                  </motion.li>
                )}

                {collectionUploads.map((upload) => (
                  <motion.li key={upload.id} {...COLLAPSE} className="overflow-hidden">
                  <div className="mb-1.5 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <FileBadge document={{ mimeType: upload.file.type, sourceType: "file", title: upload.file.name }} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-zinc-100">{upload.file.name}</p>
                        <p className="text-xs text-zinc-500">{formatBytes(upload.file.size)}</p>
                      </div>
                      <StatusBadge status={upload.status === "uploading" ? "uploading" : "failed"} />
                      {upload.status === "failed" && (
                        <>
                          <button
                            type="button"
                            onClick={() => onRetryUpload(upload.id)}
                            aria-label={`Retry ${upload.file.name}`}
                            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                          >
                            <RefreshIcon size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDismissUpload(upload.id)}
                            aria-label={`Dismiss ${upload.file.name}`}
                            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
                          >
                            <XIcon size={14} />
                          </button>
                        </>
                      )}
                    </div>
                    {upload.status === "uploading" && (
                      <div className="mt-2 ml-12 h-1 overflow-hidden rounded-full bg-zinc-800">
                        {/* scaleX rather than width, so the fill animates on the compositor. */}
                        <div
                          className="h-full origin-left rounded-full bg-accent transition-transform duration-300 ease-out"
                          style={{ transform: `scaleX(${Math.max(0.03, upload.progress)})` }}
                        />
                      </div>
                    )}
                    {upload.error && <p className="mt-1.5 pl-12 text-xs text-rose-300">{upload.error}</p>}
                  </div>
                  </motion.li>
                ))}

                {documents.map((document) => (
                  <motion.li key={document.id} {...COLLAPSE} className="group overflow-hidden">
                  <div className="mb-1.5 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <FileBadge document={document} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-zinc-100" title={document.sourceUri ?? document.title}>
                          {document.title}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {formatBytes(document.byteSize)}
                          {document.status === "ready" ? ` · ${document.chunkCount} passages` : ""}
                        </p>
                      </div>
                      <StatusBadge status={document.status} />
                      {document.status === "failed" && canRetry(document) && (
                        <button
                          type="button"
                          onClick={() => onRetryDocument(document.id)}
                          aria-label={`Retry ${document.title}`}
                          title="Retry"
                          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                        >
                          <RefreshIcon size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPendingDelete({ kind: "document", id: document.id, name: document.title })}
                        aria-label={`Remove ${document.title}`}
                        title="Remove"
                        className="rounded-md p-1.5 text-zinc-500 opacity-100 transition hover:bg-zinc-800 hover:text-rose-300 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                      >
                        <TrashIcon size={14} />
                      </button>
                    </div>
                    {document.error && <p className="mt-1.5 pl-12 text-xs text-rose-300">{document.error}</p>}
                  </div>
                  </motion.li>
                ))}
                </AnimatePresence>
              </ul>
            </>
          ) : (
            <>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  createCollection();
                }}
              >
                <input
                  value={newCollectionName}
                  onChange={(event) => setNewCollectionName(event.target.value)}
                  placeholder="New collection name, e.g. Sales playbook"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-accent"
                />
                <button
                  type="submit"
                  disabled={!newCollectionName.trim()}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  Create
                </button>
              </form>

              <ul className="mt-5">
                {isLoadingCollections && collections.length === 0 && (
                  <li className="space-y-2" aria-label="Loading collections">
                    {[0, 1, 2].map((item) => (
                      <div key={item} className="flex items-center gap-3 rounded-xl border border-zinc-800 px-3 py-3">
                        <div className="skeleton h-9 w-9" />
                        <div className="flex-1 space-y-1.5">
                          <div className="skeleton h-3.5 w-2/5" />
                          <div className="skeleton h-3 w-1/4" />
                        </div>
                      </div>
                    ))}
                  </li>
                )}
                <AnimatePresence initial={false}>
                {!isLoadingCollections && collections.length === 0 && (
                  <motion.li key="empty" {...COLLAPSE} className="flex flex-col items-center rounded-xl border border-dashed border-zinc-800 px-6 py-10 text-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-zinc-500">
                      <BookIcon size={18} />
                    </span>
                    <p className="mt-3 text-sm text-zinc-300">No collections yet</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      Create one above, then drop in PDFs, Word docs or web pages.
                    </p>
                  </motion.li>
                )}

                {collections.map((collection) => {
                  const isAttached = collection.id === attachedCollectionId;

                  return (
                    <motion.li key={collection.id} {...COLLAPSE} className="overflow-hidden">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectCollection(collection.id)}
                        onKeyDown={(event) => {
                          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                            event.preventDefault();
                            onSelectCollection(collection.id);
                          }
                        }}
                        className={`mb-2 flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 transition-colors duration-150 hover:bg-zinc-900 ${
                          isAttached ? "border-accent/50 bg-accent-soft" : "border-zinc-800 bg-zinc-900/40"
                        }`}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300">
                          <BookIcon size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-zinc-100">{collection.name}</p>
                          <p className="text-xs text-zinc-500">
                            {collection.documentCount === 0
                              ? "Empty — click to add files"
                              : `${collection.documentCount} ${collection.documentCount === 1 ? "file" : "files"} · ${collection.readyCount} ready`}
                          </p>
                        </div>
                        <AttachButton isAttached={isAttached} onClick={() => onAttach(isAttached ? null : collection.id)} />
                        <CollectionMenu
                          onDelete={() => setPendingDelete({ kind: "collection", id: collection.id, name: collection.name })}
                        />
                      </div>
                    </motion.li>
                  );
                })}
                </AnimatePresence>
              </ul>
            </>
          )}
        </motion.div>
      </motion.aside>

      <ConfirmModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete?.kind === "collection") onDeleteCollection(pendingDelete.id);
          if (pendingDelete?.kind === "document") onDeleteDocument(pendingDelete.id);
          setPendingDelete(null);
        }}
        title={pendingDelete?.kind === "collection" ? "Delete collection" : "Remove file"}
        message={
          pendingDelete?.kind === "collection"
            ? `Delete "${pendingDelete.name}" and all of its files? Chats using it will be detached. This can't be undone.`
            : `Remove "${pendingDelete?.name ?? "this file"}" from the collection? This can't be undone.`
        }
        confirmText={pendingDelete?.kind === "collection" ? "Delete" : "Remove"}
        tone="danger"
      />
    </motion.div>
    )}
    </AnimatePresence>
  );
}
