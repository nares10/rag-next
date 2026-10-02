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

export type Message = {
  id: string;
  role: "assistant" | "user";
  text: string;
  conversationId?: string;
  citations?: Citation[];
  grounding?: Grounding;
};

export type Conversation = {
  id: string;
  title: string;
  provider: string;
  collectionId?: string | null;
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
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  chunkCount: number;
  createdAt: string;
};
