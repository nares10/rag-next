export type RetrievedChunk = {
  id: string;
  documentId: string;
  title: string;
  heading: string | null;
  page: number | null;
  content: string;
  tokenCount: number;
  /** Normalized relevance of this chunk to the query; comparable only within one result set. */
  score: number;
};

export type Citation = {
  n: number;
  chunkId: string;
  documentId: string;
  title: string;
  heading: string | null;
  page: number | null;
  score: number;
};

export const DOCUMENT_STATUS = {
  pending: "pending",
  processing: "processing",
  ready: "ready",
  failed: "failed",
} as const;

export type DocumentStatus = (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];

export const SOURCE_TYPES = ["paste", "url", "file"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
