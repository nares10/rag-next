"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import ConfirmModal from "@/components/ConfirmModal";
import ProviderSelectModal from "@/components/ProviderSelectModal";
import ChatComposer from "@/components/ChatComposer";
import ChatHeader from "@/components/ChatHeader";
import ChatMessages from "@/components/ChatMessages";
import ChatSidebar from "@/components/ChatSidebar";
import CitationPanel from "@/components/CitationPanel";
import DocumentsDrawer from "@/components/DocumentsDrawer";
import { isFreeChoice } from "@/components/ModelPicker";
import SettingsModal from "@/components/SettingsModal";
import { useApiKeys } from "@/hooks/useApiKeys";
import { useAuth } from "@/hooks/useAuth";
import { useChatStream } from "@/hooks/useChatStream";
import { useCitedPassages } from "@/hooks/useCitedPassages";
import { toMessage, useConversations } from "@/hooks/useConversations";
import { useMessageFeedback } from "@/hooks/useMessageFeedback";
import { useRagDocuments } from "@/hooks/useRagDocuments";
import type { Citation, Conversation, Provider } from "@/lib/chat-types";

/** Where files attached from the composer go when the chat has no collection yet. */
const QUICK_UPLOADS_COLLECTION = "My uploads";

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export default function Home({ conversationId }: { conversationId?: string }) {
  const router = useRouter();
  const { user, setUser, isCheckingAuth } = useAuth();
  const { apiKeys, setApiKeys } = useApiKeys(user);
  const conversationsState = useConversations(user, conversationId);
  const rag = useRagDocuments(user);
  const citedPassages = useCitedPassages();
  const { feedback, rate } = useMessageFeedback();
  const [input, setInput] = useState("");
  // The key the chat is using, tied to the provider it belongs to; null means free messages.
  const [activeKey, setActiveKey] = useState<{ provider: Provider; key: string } | null>(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [providerModalTarget, setProviderModalTarget] = useState<{ provider: Provider; model: string | null } | null>(
    null,
  );
  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);
  // The first render on both server and client is the auth check, which doesn't render
  // the sidebar, so reading the viewport here can't cause a hydration mismatch.
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches,
  );
  const [showDocuments, setShowDocuments] = useState(false);
  const [citationView, setCitationView] = useState<{ citations: Citation[]; active: Citation } | null>(null);
  // Per-message opt-out; the collection stays attached to the conversation.
  const [useRag, setUseRag] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const { provider, model, currentConversationId, attachedCollectionId } = conversationsState;
  const selectedApiKey = activeKey?.provider === provider ? activeKey.key : null;
  const attachedCollection = rag.collections.find((collection) => collection.id === attachedCollectionId) ?? null;
  const currentTitle = conversationsState.conversations.find((item) => item.id === currentConversationId)?.title ?? null;

  const updateConversationUrl = (id: string | null, replace = false) => {
    const url = id ? `/c/${id}` : "/";
    window.history[replace ? "replaceState" : "pushState"]({}, "", url);
  };

  const { isLoading, submit, regenerate, stop } = useChatStream({
    input,
    provider,
    model,
    selectedApiKey,
    currentConversationId,
    collectionId: attachedCollectionId,
    collectionName: attachedCollection?.name ?? null,
    useRag,
    setInput,
    setMessages: conversationsState.setMessages,
    setUser,
    setCurrentConversationId: conversationsState.setCurrentConversationId,
    updateConversationUrl,
    onConversationSaved: () => void conversationsState.refreshConversations(),
    setShowProviderModal,
    inputRef,
  });

  // A new message always scrolls into view; streamed tokens only keep the view pinned if
  // the user hasn't scrolled up to read something earlier.
  const messageCount = useRef(0);
  useEffect(() => {
    const bottom = bottomRef.current;
    const container = bottom?.closest<HTMLElement>(".overflow-y-auto");
    const isNewMessage = conversationsState.messages.length !== messageCount.current;
    messageCount.current = conversationsState.messages.length;
    if (!bottom || !container) return;

    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 160;
    if (isNewMessage || nearBottom) bottom.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversationsState.messages]);

  const confirmLogout = async () => {
    setShowLogoutModal(false);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const handleNewConversation = () => {
    conversationsState.setCurrentConversationId(null);
    conversationsState.setMessages(conversationsState.initialMessages);
    setInput("");
    setCitationView(null);
    updateConversationUrl(null);
    inputRef.current?.focus();
  };

  const handleSelectConversation = (conversation: Conversation) => {
    updateConversationUrl(conversation.id);
    setCitationView(null);
    conversationsState.setCurrentConversationId(conversation.id);
    conversationsState.setMessages(conversation.messages.map(toMessage));
    conversationsState.setProvider(conversation.provider as Provider);
    conversationsState.setModel(conversation.model ?? null);
    conversationsState.setAttachedCollectionId(conversation.collectionId ?? null);
  };

  const confirmDeleteConversation = async () => {
    if (!conversationToDelete) return;
    const conversation = conversationToDelete;
    setConversationToDelete(null);
    const deleted = await conversationsState.deleteConversation(conversation);
    if (!deleted || currentConversationId !== conversation.id) return;

    conversationsState.setCurrentConversationId(null);
    conversationsState.setMessages(conversationsState.initialMessages);
    router.push("/");
  };

  const handleAttachCollection = async (collectionId: string | null) => {
    await conversationsState.attachCollection(collectionId);
    if (collectionId) {
      setUseRag(true);
      setShowDocuments(false);
    }
  };

  /** 📎 in the composer: straight into the chat's collection, creating one if there is none. */
  const handleAttachFiles = async (files: File[]) => {
    let collectionId = attachedCollectionId;

    if (!collectionId) {
      collectionId =
        rag.collections.find((collection) => collection.name === QUICK_UPLOADS_COLLECTION)?.id ??
        (await rag.createCollection(QUICK_UPLOADS_COLLECTION));
      if (!collectionId) {
        setShowDocuments(true);
        return;
      }
      await conversationsState.attachCollection(collectionId);
      setUseRag(true);
    }

    rag.selectCollection(collectionId);
    await rag.uploadFiles(collectionId, files);
  };

  const handleSelectModel = (nextProvider: Provider, nextModel: string | null) => {
    const savedKey = apiKeys.find((key) => key.provider === nextProvider)?.key ?? null;
    const key =
      activeKey?.provider === nextProvider
        ? activeKey.key
        : isFreeChoice(nextProvider, nextModel)
          ? null
          : savedKey;

    if (key || isFreeChoice(nextProvider, nextModel)) {
      conversationsState.setProvider(nextProvider);
      conversationsState.setModel(nextModel);
      setActiveKey(key ? { provider: nextProvider, key } : null);
      return;
    }

    // A model that needs a key the user hasn't given yet.
    setProviderModalTarget({ provider: nextProvider, model: nextModel });
    setShowProviderModal(true);
  };

  const handleProviderSelect = (selected: string, apiKey?: string) => {
    const nextProvider = selected as Provider;
    conversationsState.setProvider(nextProvider);
    conversationsState.setModel(providerModalTarget?.provider === nextProvider ? providerModalTarget.model : null);
    setActiveKey(apiKey ? { provider: nextProvider, key: apiKey } : null);
    setProviderModalTarget(null);
    setShowProviderModal(false);
  };

  const handleRegenerate = () => {
    const question = conversationsState.messages.findLast((message) => message.role === "user");
    if (question) void regenerate(question.text);
  };

  const openCitation = (citations: Citation[], citation: Citation) => {
    citedPassages.load(citations.map((item) => item.chunkId));
    setCitationView({ citations, active: citation });
  };

  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (mod && !event.shiftKey && key === "k") {
      event.preventDefault();
      handleNewConversation();
    } else if (mod && !event.shiftKey && key === "b") {
      event.preventDefault();
      setIsSidebarOpen((open) => !open);
    } else if (mod && event.shiftKey && key === "d") {
      event.preventDefault();
      setShowDocuments(true);
    } else if (event.key === "/" && !mod && !isTypingTarget(event.target)) {
      event.preventDefault();
      inputRef.current?.focus();
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  if (isCheckingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="text-zinc-400">Loading...</div>
      </div>
    );
  }

  return (
    <main className="flex h-dvh min-h-0 overflow-hidden bg-zinc-950 text-zinc-100">
      <ChatSidebar
        conversations={conversationsState.conversations}
        currentConversationId={currentConversationId}
        isLoading={conversationsState.isLoadingConversations}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onNewConversation={handleNewConversation}
        onOpenDocuments={() => setShowDocuments(true)}
        onRenameConversation={(conversation, title) => void conversationsState.renameConversation(conversation, title)}
        onDeleteConversation={setConversationToDelete}
        onSelectConversation={handleSelectConversation}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatHeader
          user={user}
          title={currentTitle}
          onLogout={() => setShowLogoutModal(true)}
          onOpenSettings={() => setShowSettings(true)}
          onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
        />
        <ChatMessages
          messages={conversationsState.messages}
          isLoading={isLoading}
          bottomRef={bottomRef}
          attachedCollectionName={attachedCollection?.name ?? null}
          hasCollections={rag.collections.length > 0}
          passages={citedPassages.passages}
          feedback={feedback}
          onLoadPassages={(ids) => void citedPassages.load(ids)}
          onOpenCitation={openCitation}
          onPickPrompt={(prompt) => void submit(prompt)}
          onOpenDocuments={() => setShowDocuments(true)}
          onRegenerate={handleRegenerate}
          onRate={rate}
        />
        <ChatComposer
          user={user}
          input={input}
          isLoading={isLoading}
          inputRef={inputRef}
          provider={provider}
          model={model}
          apiKeys={apiKeys}
          hasActiveKey={selectedApiKey !== null}
          attachedCollection={attachedCollection}
          uploadingCount={rag.uploads.filter((upload) => upload.status === "uploading").length}
          useRag={useRag}
          onInputChange={setInput}
          onSubmit={() => void submit()}
          onStop={stop}
          onSelectModel={handleSelectModel}
          onManageKeys={() => {
            setProviderModalTarget({ provider, model });
            setShowProviderModal(true);
          }}
          onOpenDocuments={() => {
            if (attachedCollectionId) rag.selectCollection(attachedCollectionId);
            setShowDocuments(true);
          }}
          onDetachCollection={() => void conversationsState.attachCollection(null)}
          onToggleUseRag={() => setUseRag((current) => !current)}
          onAttachFiles={(files) => void handleAttachFiles(files)}
        />
      </div>

      <AnimatePresence>
      {citationView && (
        <CitationPanel
          key="citations"
          citations={citationView.citations}
          active={citationView.active}
          passages={citedPassages.passages}
          onSelect={(citation) => setCitationView((current) => (current ? { ...current, active: citation } : current))}
          onClose={() => setCitationView(null)}
        />
      )}
      </AnimatePresence>

      <DocumentsDrawer
        isOpen={showDocuments}
        collections={rag.collections}
        documents={rag.documents}
        uploads={rag.uploads}
        activeCollectionId={rag.activeCollectionId}
        attachedCollectionId={attachedCollectionId}
        isBusy={rag.isLoading}
        isLoadingCollections={!rag.hasLoadedCollections}
        error={rag.error}
        canRetry={rag.canRetry}
        onClose={() => setShowDocuments(false)}
        onSelectCollection={rag.selectCollection}
        onCreateCollection={(name) => void rag.createCollection(name)}
        onDeleteCollection={(collectionId) => {
          void rag.deleteCollection(collectionId);
          if (attachedCollectionId === collectionId) {
            void conversationsState.attachCollection(null);
          }
        }}
        onAddDocument={(document) => {
          if (!rag.activeCollectionId) return;
          void rag.addDocument(rag.activeCollectionId, document);
        }}
        onUploadFiles={(files) => {
          if (!rag.activeCollectionId) return;
          void rag.uploadFiles(rag.activeCollectionId, files);
        }}
        onRetryUpload={(uploadId) => void rag.retryUpload(uploadId)}
        onDismissUpload={rag.dismissUpload}
        onDeleteDocument={(documentId) => void rag.deleteDocument(documentId)}
        onRetryDocument={(documentId) => void rag.retryDocument(documentId)}
        onAttach={(collectionId) => void handleAttachCollection(collectionId)}
      />

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <ConfirmModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={() => void confirmLogout()}
        title="Log out"
        message="Are you sure you want to log out?"
        confirmText="Log out"
        cancelText="Cancel"
      />
      <ProviderSelectModal
        key={providerModalTarget?.provider ?? "none"}
        isOpen={showProviderModal}
        initialProvider={providerModalTarget?.provider ?? null}
        onClose={() => {
          setShowProviderModal(false);
          setProviderModalTarget(null);
        }}
        onSelect={handleProviderSelect}
        apiKeys={apiKeys}
        isLoading={conversationsState.isLoadingConversations}
        onKeySaved={(apiKey) => setApiKeys((current) => [apiKey, ...current])}
      />
      <ConfirmModal
        isOpen={conversationToDelete !== null}
        onClose={() => setConversationToDelete(null)}
        onConfirm={() => void confirmDeleteConversation()}
        title="Delete conversation"
        message={`Are you sure you want to delete "${conversationToDelete?.title ?? "this conversation"}"?`}
        confirmText="Delete"
        cancelText="Cancel"
        tone="danger"
      />
    </main>
  );
}
