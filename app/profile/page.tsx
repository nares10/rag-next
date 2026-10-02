"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { COLLAPSE } from "@/components/motion";
import ConfirmModal from "@/components/ConfirmModal";
import { ArrowLeftIcon, CheckIcon, CopyIcon, KeyIcon, LockIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { useAuth } from "@/hooks/useAuth";
import { FREE_MESSAGE_LIMIT } from "@/lib/freeMessages";
import { PROVIDER_LABEL } from "@/lib/models";
import type { ApiKey, Conversation, Provider } from "@/lib/chat-types";

const INPUT =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-accent";
const PRIMARY =
  "rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500";
const SECONDARY =
  "rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800";
const CARD = "rounded-xl border border-zinc-800 bg-zinc-900/60 p-4";

/** Counts from 0 to `value` once, when the stats arrive. */
function CountUp({ value }: { value: number }) {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;

    const controls = animate(0, value, {
      duration: 0.8,
      ease: "easeOut",
      onUpdate: (latest) => setDisplay(Math.round(latest)),
    });
    return () => controls.stop();
  }, [value, reduceMotion]);

  return <>{reduceMotion ? value : display}</>;
}

function AddKeyForm({ onSaved, onCancel }: { onSaved: (apiKey: ApiKey) => void; onCancel?: () => void }) {
  const [provider, setProvider] = useState<Provider>("openrouter");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    setError("");
    setIsSaving(true);
    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, name: name.trim() || `${PROVIDER_LABEL[provider]} key`, key: key.trim() }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error || "Could not save the key.");
        return;
      }

      onSaved(data.apiKey);
      setKey("");
      setName("");
    } catch {
      setError("Could not save the key. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form
      className="grid gap-3 sm:grid-cols-[10rem_1fr]"
      onSubmit={(event) => {
        event.preventDefault();
        if (key.trim()) void save();
      }}
    >
      <label className="text-xs text-zinc-400">
        Provider
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value as Provider)}
          className={`${INPUT} mt-1`}
        >
          {(Object.keys(PROVIDER_LABEL) as Provider[]).map((option) => (
            <option key={option} value={option}>
              {PROVIDER_LABEL[option]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-zinc-400">
        Name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={`${PROVIDER_LABEL[provider]} key`}
          className={`${INPUT} mt-1`}
        />
      </label>
      <label className="text-xs text-zinc-400 sm:col-span-2">
        API key
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder={provider === "anthropic" ? "sk-ant-…" : provider === "openrouter" ? "sk-or-…" : "sk-…"}
          className={`${INPUT} mt-1 font-mono`}
        />
      </label>
      {error && <p className="text-xs text-rose-300 sm:col-span-2">{error}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className={SECONDARY}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={!key.trim() || isSaving} className={PRIMARY}>
          {isSaving ? "Saving…" : "Save key"}
        </button>
      </div>
    </form>
  );
}

function ChangePasswordForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async () => {
    if (newPassword !== confirmPassword) {
      setStatus({ kind: "error", text: "New passwords don't match." });
      return;
    }

    setIsSaving(true);
    setStatus(null);
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setStatus({ kind: "error", text: data?.error || "Could not change the password." });
        return;
      }

      setStatus({ kind: "success", text: "Password changed. Other devices have been signed out." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setIsOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <LockIcon className="text-zinc-400" />
          <div>
            <p className="text-sm font-medium text-zinc-100">Password</p>
            <p className="text-xs text-zinc-500">Change the password you use to sign in.</p>
          </div>
        </div>
        {!isOpen && (
          <button type="button" onClick={() => setIsOpen(true)} className={SECONDARY}>
            Change
          </button>
        )}
      </div>
      {status && (
        <p className={`mt-3 text-xs ${status.kind === "error" ? "text-rose-300" : "text-emerald-400"}`}>{status.text}</p>
      )}
      {isOpen && (
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            placeholder="Current password"
            className={INPUT}
          />
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="New password (at least 8 characters)"
            className={INPUT}
          />
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Confirm new password"
            className={INPUT}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setStatus(null);
              }}
              className={SECONDARY}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !currentPassword || newPassword.length < 8 || !confirmPassword}
              className={PRIMARY}
            >
              {isSaving ? "Saving…" : "Update password"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function DeleteAccount() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const remove = async () => {
    setIsDeleting(true);
    setError("");
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error || "Could not delete the account.");
        return;
      }

      router.push("/register");
      router.refresh();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="rounded-xl border border-rose-900/60 bg-rose-950/20 p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <TrashIcon className="text-rose-400" />
          <div>
            <p className="text-sm font-medium text-zinc-100">Delete account</p>
            <p className="text-xs text-zinc-500">
              Permanently removes your chats, documents and API keys. This can&apos;t be undone.
            </p>
          </div>
        </div>
        {!isOpen && (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="shrink-0 rounded-lg border border-rose-900 px-4 py-2 text-sm text-rose-300 transition hover:bg-rose-950/60"
          >
            Delete
          </button>
        )}
      </div>
      {isOpen && (
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (password) void remove();
          }}
        >
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password to confirm"
            className={`${INPUT} focus:border-rose-500`}
          />
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => setIsOpen(false)} className={SECONDARY}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!password || isDeleting}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-rose-500 disabled:opacity-50"
            >
              {isDeleting ? "Deleting…" : "Delete forever"}
            </button>
          </div>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, isCheckingAuth } = useAuth();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [isAddingKey, setIsAddingKey] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<ApiKey | null>(null);

  useEffect(() => {
    if (!user) return;

    void Promise.all([
      fetch("/api/keys").then((response) => (response.ok ? response.json() : { apiKeys: [] })),
      fetch("/api/conversations").then((response) =>
        response.ok ? response.json() : { conversations: [] },
      ),
    ])
      .then(([keysData, conversationsData]) => {
        setApiKeys(keysData.apiKeys || []);
        setConversations(conversationsData.conversations || []);
      })
      .finally(() => setIsLoadingStats(false));
  }, [user]);

  if (isCheckingAuth || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <p className="text-sm text-zinc-400">Loading profile...</p>
      </main>
    );
  }

  const initials = user.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase();
  const usagePercent = Math.min(100, (user.freeMessagesUsed / FREE_MESSAGE_LIMIT) * 100);
  const totalMessages = conversations.reduce(
    (total, conversation) => total + conversation.messages.length,
    0,
  );
  const providers = [...new Set(apiKeys.map((apiKey) => apiKey.provider))];

  const maskApiKey = (key: string) => {
    if (key.length <= 5) return key;
    return `${key.slice(0, 5)}••••••••`;
  };

  const copyApiKey = async (apiKey: ApiKey) => {
    try {
      await navigator.clipboard.writeText(apiKey.key);
      setCopiedKeyId(apiKey.id);
      window.setTimeout(() => setCopiedKeyId(null), 1500);
    } catch {
      setCopiedKeyId(null);
    }
  };

  const deleteApiKey = async (apiKey: ApiKey) => {
    const response = await fetch(`/api/keys/${apiKey.id}`, { method: "DELETE" });
    if (response.ok) setApiKeys((current) => current.filter((item) => item.id !== apiKey.id));
  };

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-6 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
            aria-label="Back to chat"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-800 text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            <ArrowLeftIcon />
          </button>
          <h1 className="text-lg font-semibold">Profile</h1>
        </header>

        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-6 shadow-2xl shadow-black/20 sm:p-8">
          <div className="flex items-center gap-4 border-b border-zinc-800 pb-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-xl font-semibold text-on-accent">
              {initials}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-semibold">{user.name || "Your profile"}</h2>
              <p className="mt-1 truncate text-sm text-zinc-400">{user.email}</p>
            </div>
          </div>

          <div className={`mt-8 ${CARD}`}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-500">Free messages</p>
                <p className="mt-2 text-sm text-zinc-100">
                  {user.freeMessagesUsed} of {FREE_MESSAGE_LIMIT} used
                </p>
              </div>
              <p className="text-sm text-zinc-400">
                {Math.max(0, FREE_MESSAGE_LIMIT - user.freeMessagesUsed)} remaining
              </p>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {[
              { label: "Conversations", value: conversations.length },
              { label: "Messages", value: totalMessages },
              { label: "Providers", value: providers.length },
            ].map((stat) => (
              <div key={stat.label} className={CARD}>
                <p className="text-xs uppercase tracking-wide text-zinc-500">{stat.label}</p>
                {isLoadingStats ? (
                  <div className="skeleton mt-3 h-7 w-12" />
                ) : (
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-100">
                    <CountUp value={stat.value} />
                  </p>
                )}
              </div>
            ))}
          </div>

          <div id="api-keys" className="mt-8 scroll-mt-6 border-t border-zinc-800 pt-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-zinc-100">API keys</h2>
                <p className="mt-1 text-sm text-zinc-400">Connected providers for your chats</p>
              </div>
              {apiKeys.length > 0 && !isAddingKey && (
                <button
                  type="button"
                  onClick={() => setIsAddingKey(true)}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover"
                >
                  <PlusIcon size={14} /> Add key
                </button>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {isLoadingStats ? (
                <div className="space-y-3" aria-label="Loading API keys">
                  {[0, 1].map((item) => (
                    <div key={item} className={`flex items-center gap-4 ${CARD}`}>
                      <div className="flex-1 space-y-2">
                        <div className="skeleton h-3.5 w-1/3" />
                        <div className="skeleton h-3 w-1/5" />
                      </div>
                      <div className="skeleton h-7 w-16" />
                    </div>
                  ))}
                </div>
              ) : apiKeys.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-700 p-5">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
                      <KeyIcon size={18} />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-zinc-100">Add your own API key to get unlimited messages</p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Use OpenRouter, OpenAI or Anthropic with your own account and pick any model.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <AddKeyForm onSaved={(apiKey) => setApiKeys((current) => [apiKey, ...current])} />
                  </div>
                </div>
              ) : (
                <>
                  <AnimatePresence initial={false}>
                  {isAddingKey && (
                    <motion.div key="add-key" {...COLLAPSE} className="overflow-hidden">
                    <div className={CARD}>
                      <AddKeyForm
                        onCancel={() => setIsAddingKey(false)}
                        onSaved={(apiKey) => {
                          setApiKeys((current) => [apiKey, ...current]);
                          setIsAddingKey(false);
                        }}
                      />
                    </div>
                    </motion.div>
                  )}
                  {apiKeys.map((apiKey) => (
                    <motion.div key={apiKey.id} {...COLLAPSE} className="overflow-hidden">
                    <div className={`flex items-center gap-4 ${CARD}`}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-100">{apiKey.name}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {PROVIDER_LABEL[apiKey.provider as Provider] ?? apiKey.provider}
                        </p>
                      </div>
                      <code className="hidden text-xs text-zinc-400 sm:block">{maskApiKey(apiKey.key)}</code>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => void copyApiKey(apiKey)}
                          aria-label={`Copy ${apiKey.name}`}
                          className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                        >
                          {copiedKeyId === apiKey.id ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setKeyToDelete(apiKey)}
                          aria-label={`Delete ${apiKey.name}`}
                          className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-rose-300"
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    </div>
                    </motion.div>
                  ))}
                  </AnimatePresence>
                </>
              )}
            </div>
          </div>

          <div className="mt-8 border-t border-zinc-800 pt-6">
            <h2 className="text-lg font-semibold text-zinc-100">Account</h2>
            <div className="mt-4 space-y-3">
              <ChangePasswordForm />
              <DeleteAccount />
            </div>
          </div>
        </section>

      </div>

      <ConfirmModal
        isOpen={keyToDelete !== null}
        onClose={() => setKeyToDelete(null)}
        onConfirm={() => {
          if (keyToDelete) void deleteApiKey(keyToDelete);
          setKeyToDelete(null);
        }}
        title="Delete API key"
        message={`Delete "${keyToDelete?.name ?? "this key"}"? Chats using it will fall back to free messages.`}
        confirmText="Delete"
        tone="danger"
      />
    </main>
  );
}
