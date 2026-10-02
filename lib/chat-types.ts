export type Provider = "openrouter" | "openai" | "anthropic";

export type Citation = {
  n: number;
  chunkId: string;
  documentId: string;
  title: string;
  heading: string | null;
  page: number | null;
  score: number;
};

/**
 * How an assistant message relates to the user's documents:
 * "grounded" — answered from retrieved passages; "none" — nothing matched;
 * "degraded" — retrieval was attempted but failed, so the answer is unsourced.
 */
export type Grounding = "grounded" | "none" | "degraded";

/** What document search is doing for an answer that is still streaming. */
export type RetrievalStep =
  | { phase: "searching"; collectionName: string }
  | { phase: "found"; collectionName: string; count: number };

export type Message = {
  id: string;
  role: "assistant" | "user";
  text: string;
  conversationId?: string;
  citations?: Citation[];
  grounding?: Grounding;
  retrieval?: RetrievalStep;
  /**
   * Database id once the answer is saved. `id` stays the client key so a finished
   * stream doesn't remount (and re-animate) its message.
   */
  storedId?: string;
  /** A request that failed; shown differently and never offered for feedback. */
  isError?: boolean;
};

/** A cited passage with its neighbouring chunks, as returned by /api/rag/chunks. */
export type CitedPassage = {
  id: string;
  documentId: string;
  title: string;
  sourceUri: string | null;
  heading: string | null;
  page: number | null;
  content: string;
  before: string | null;
  after: string | null;
};

export type Conversation = {
  id: string;
  title: string;
  provider: string;
  model?: string | null;
  collectionId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    citations?: Citation[] | null;
  }>;
};

export type ChatUser = {
  id: string;
  email: string;
  name: string;
  freeMessagesUsed: number;
};

export type ApiKey = {
  id: string;
  name: string;
  provider: string;
  key: string;
};

export type RagCollection = {
  id: string;
  name: string;
  description: string | null;
  documentCount: number;
  readyCount: number;
};

export type RagDocument = {
  id: string;
  collectionId: string;
  title: string;
  sourceType: string;
  sourceUri: string | null;
  mimeType: string;
  byteSize: number;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  chunkCount: number;
  createdAt: string;
};
