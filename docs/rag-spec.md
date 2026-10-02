# RAG Feature Spec

Status: implemented (phases 1 & 3, plus PDF/DOCX extraction and file upload) · Owner: @naresh-dewasi · Target: `rag-next`
(Next 16.3.3 App Router, Prisma 6, Postgres + pgvector, Bun)

> **Implementation notes** are collected in §12. Where the shipped code differs from the
> design above, §12 is the accurate description.

## 1. Goal

Let a signed-in user attach their own documents to a conversation so the assistant answers
from those documents instead of (or in addition to) its parametric knowledge, with
inline citations back to the source chunk.

Today `app/api/chat/route.ts` builds `messagesForAI` from the last 10 messages of a
conversation and streams a provider response over SSE. RAG adds one step in front of that:
retrieve relevant chunks, inject them as grounded context, and stream the citations
alongside the answer.

### Non-goals (v1)
- No multi-user / org-shared corpora — documents are private to the owning user.
- No image, audio or OCR-over-scanned-PDF ingestion.
- No agentic multi-hop retrieval, query decomposition or tool loops.
- No fine-tuning, no graph RAG.

### Success criteria
- A user can upload a PDF/MD/TXT/DOCX up to 20 MB and ask about it within ~60s of upload.
- Answers grounded in retrieved context carry `[n]` citations resolvable to a chunk + page.
- Retrieval p95 ≤ 400 ms for a 10k-chunk corpus; first assistant token p95 ≤ 2.5 s.
- "I don't know" rather than a hallucinated answer when nothing relevant is retrieved.

---

## 2. Architecture at a glance

Two pipelines. They share only the database and the embedding function.

```
INGESTION (write path, async)
 ────────────────────────────────────────────────────────────────────────────
  upload ──> store blob ──> extract text ──> normalize ──> chunk ──> embed ──> upsert
  (client)   (Blob/DB)      (per MIME)       (clean)       (split)   (batched) (pgvector)
                                                                                  │
                                                                           Document.status
                                                                   pending→processing→ready|failed

QUERY (read path, per message, inline in the chat request)
 ────────────────────────────────────────────────────────────────────────────
  user message
      │
      ├─> should we retrieve?  (conversation has a ready collection? /no-rag override?)
      │         └─ no ──────────────────────────────────────────────┐
      ├─> query rewrite (resolve pronouns from last 2 turns)        │
      ├─> embed query (same model as corpus)                        │
      ├─> vector search      top 20  (pgvector, cosine)             │
      ├─> keyword search     top 20  (tsvector, websearch_to_tsquery)
      ├─> fuse (RRF) ──> dedupe by chunk ──> top 6                  │
      ├─> token-budget trim (≤ 3000 tokens of context)              │
      └─> assemble prompt: system + numbered context + history + question
                │                                                   │
                └───────────────────> provider stream <─────────────┘
                                            │
                      SSE: {sources:[…]} first, then {text:…}* , then {done:true}
```

---

## 3. Data model

New Prisma models. Postgres `vector` type is not a first-class Prisma 6 type, so the
embedding column is declared `Unsupported` and all similarity queries go through
`$queryRaw`. Everything else stays in the ORM.

```prisma
model Collection {
  id          String   @id @default(uuid())
  userId      String
  name        String
  description String?
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  documents   Document[]
  conversations Conversation[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([userId])
}

model Document {
  id            String   @id @default(uuid())
  collectionId  String
  userId        String            // denormalized for cheap ownership checks in raw SQL
  title         String
  sourceType    String            // "file" | "url" | "paste"
  sourceUri     String?           // blob URL or origin URL
  mimeType      String
  byteSize      Int
  contentHash   String            // sha256 of extracted text — dedupe + re-ingest detection
  status        String   @default("pending") // pending|processing|ready|failed
  error         String?
  pageCount     Int?
  chunkCount    Int      @default(0)
  collection    Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  chunks        Chunk[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([collectionId, contentHash])
  @@index([collectionId, status])
}

model Chunk {
  id             String  @id @default(uuid())
  documentId     String
  collectionId   String            // denormalized so search filters on one column
  ordinal        Int               // position within document, 0-based
  content        String
  tokenCount     Int
  page           Int?
  heading        String?           // nearest enclosing heading, for citation display
  embedding      Unsupported("vector(1536)")?
  embeddingModel String            // e.g. "text-embedding-3-small"
  document       Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  createdAt      DateTime @default(now())
  @@unique([documentId, ordinal])
  @@index([collectionId])
}

// Conversation gains an optional link:
//   collectionId String?
//   collection   Collection? @relation(fields: [collectionId], references: [id], onDelete: SetNull)

// Message gains retrieval provenance so a reply can be re-explained later:
//   citations Json?   // [{ n, chunkId, documentId, title, page, score }]
```

### Raw-SQL migration tail
`prisma migrate dev` generates the tables; append by hand to the generated migration:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "Chunk" ADD COLUMN "embedding" vector(1536);

-- HNSW beats IVFFlat here: no training step, good recall at our corpus size.
CREATE INDEX "Chunk_embedding_hnsw_idx" ON "Chunk"
  USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Lexical half of hybrid search.
ALTER TABLE "Chunk" ADD COLUMN "contentTsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;
CREATE INDEX "Chunk_contentTsv_idx" ON "Chunk" USING gin ("contentTsv");
```

Neon supports `pgvector`; confirm the extension is allow-listed on the project before
the migration ships. `prisma migrate deploy` already runs in the Vercel build
(`package.json` → `build`), so no extra deploy step.

---

## 4. Ingestion pipeline

### 4.1 Upload
Vercel caps function request bodies at 4.5 MB, so files do **not** stream through a route
handler. Client requests a direct-upload token, uploads to Vercel Blob (private), then
POSTs the resulting blob URL as metadata.

- `POST /api/rag/uploads` → `{ uploadUrl, token }` (ownership + quota checked here)
- `POST /api/rag/documents` → `{ collectionId, blobUrl, title, mimeType, byteSize }`
  Creates `Document{status:"pending"}` and enqueues processing. Returns `202` + document id.

Also accepted: `sourceType:"paste"` (raw text in body, ≤ 1 MB) and `sourceType:"url"`
(server fetches, HTML only, 10 s timeout, 5 MB cap) — both skip Blob.

### 4.2 Processing (`lib/rag/ingest.ts`)
Runs in a Node.js runtime function (not Edge — needs the parser libraries and up to
several minutes). Triggered by Vercel Queues; a `POST /api/rag/documents/[id]/process`
handler with a shared-secret header is the fallback if Queues isn't wired yet.

Stages, each idempotent and restartable from `Document.status`:

| # | Stage | Detail |
|---|-------|--------|
| 1 | Fetch | Download blob to memory. Reject if `byteSize > 20 MB`. |
| 2 | Extract | By MIME: `pdf` → `unpdf` (per-page text + `pageCount`); `docx` → `mammoth` to HTML, so Word headings survive as markdown headings; `md`/`txt` → as-is; `html` → markdown. |
| 3 | Normalize | Collapse runs of whitespace, strip repeated page headers/footers, drop pages with < 20 non-whitespace chars, normalize unicode (NFKC). |
| 4 | Hash & dedupe | `sha256(normalizedText)`. If `(collectionId, contentHash)` exists, mark this document `ready` pointing at the existing chunks' document and stop. |
| 5 | Chunk | Recursive split on `\n## ` → `\n### ` → `\n\n` → sentence → hard character cut. Target **800 tokens**, **100-token overlap**, minimum 80 tokens (merge forward if smaller). Each chunk carries the nearest enclosing heading and its page. Prefix the stored `content` with `"{title} › {heading}\n\n"` so the embedding sees document context. |
| 6 | Embed | Batch 96 chunks per request to `/v1/embeddings`, `text-embedding-3-small`, 1536 dims. Concurrency 3. Retry 429/5xx with exponential backoff (3 attempts, jitter). |
| 7 | Upsert | Per batch: `INSERT … ON CONFLICT (documentId, ordinal) DO UPDATE`, embedding cast `$1::vector`. Commit per batch so a failure mid-document resumes from `max(ordinal)`. |
| 8 | Finalize | Set `chunkCount`, `status:"ready"`. Any thrown error → `status:"failed"`, `error` = sanitized message; partial chunks are deleted. |

### 4.3 Re-ingest and delete
- Re-upload of the same `contentHash` is a no-op (stage 4).
- Changing the embedding model invalidates the corpus: a chunk whose `embeddingModel`
  differs from the configured model is excluded from search, and a backfill script
  (`scripts/reembed.ts`) re-embeds in place.
- `DELETE /api/rag/documents/[id]` cascades chunks and deletes the blob.

---

## 5. Query pipeline

### 5.1 Trigger
Retrieval runs when `conversation.collectionId` is set and that collection has ≥ 1 `ready`
document. The client may pass `useRag: false` to skip it for one message. There is no
LLM-based "do I need retrieval?" classifier in v1 — explicit attachment is the signal.

### 5.2 Query rewrite
Follow-ups like "what about section 3?" embed poorly alone. Before embedding, if the
conversation has ≥ 1 prior turn, rewrite the question into a standalone query with a
single cheap non-streaming completion (≤ 64 output tokens, 2 s timeout). On timeout or
error, fall back to the raw message — never fail the request on rewrite.

### 5.3 Retrieval (`lib/rag/retrieve.ts`)

Vector leg:
```sql
SELECT id, "documentId", content, "tokenCount", page, heading,
       1 - (embedding <=> $1::vector) AS score
FROM "Chunk"
WHERE "collectionId" = $2 AND "embeddingModel" = $3 AND embedding IS NOT NULL
ORDER BY embedding <=> $1::vector
LIMIT 20;
```

Keyword leg: same filter, `ORDER BY ts_rank_cd("contentTsv", websearch_to_tsquery('english', $1)) DESC LIMIT 20`.

Fusion: reciprocal rank fusion, `score = Σ 1/(60 + rank)` over both lists. Take top 6.

Guards:
- Drop chunks whose cosine similarity < **0.25** (noise floor; tune against the eval set).
- If the fused set is empty, skip context injection entirely and set a flag that makes the
  system prompt say "no documents matched — say you don't know".
- Neighbour expansion: for each kept chunk also pull `ordinal ± 1` from the same document
  when the budget allows, so quotes aren't cut mid-sentence.
- Token budget: 3000 tokens of context total; drop lowest-scoring chunks until it fits.

Both legs run as one `Promise.all`. Ownership is enforced by resolving `collectionId`
from the conversation row (already scoped to `userId`) — never from client input.

### 5.4 Prompt assembly
```
system:
  You answer strictly from the CONTEXT below. Cite the source of every claim as [n],
  matching the numbered context blocks. If the context does not contain the answer,
  say so plainly — do not use outside knowledge. Quote exact figures verbatim.

  CONTEXT
  [1] {title} › {heading} (p.{page})
  {content}

  [2] …

(then the existing last-10-message history, then the user message)
```

The context goes in the system message, not the user turn, so it stays out of the
displayed transcript and is not re-sent on later turns (each turn retrieves afresh).
Existing per-provider shaping stays: Anthropic takes `system` as a top-level parameter,
OpenAI/OpenRouter as a leading `system` message.

### 5.5 Streaming contract
`app/api/chat/route.ts` keeps its SSE shape and gains one frame, emitted **before** the
first text chunk so the UI can render citation chips immediately:

```
data: {"sources":[{"n":1,"chunkId":"…","documentId":"…","title":"…","page":12,"score":0.81}]}
data: {"text":"According to "}
…
data: {"conversationId":"…","done":true}
```

Persistence unchanged in spirit: user + assistant messages are written only once a
non-empty reply arrives, and the assistant row additionally stores `citations`.

---

## 6. API surface

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/rag/collections` | list / create collections |
| PATCH/DELETE | `/api/rag/collections/[id]` | rename / delete (cascades) |
| POST | `/api/rag/uploads` | issue a direct Blob upload token |
| GET/POST | `/api/rag/documents` | list (by collection) / register + enqueue |
| GET | `/api/rag/documents/[id]` | status poll: `{status, chunkCount, error}` |
| DELETE | `/api/rag/documents/[id]` | delete document + chunks + blob |
| POST | `/api/rag/documents/[id]/process` | internal; shared-secret; runs the pipeline |
| POST | `/api/rag/search` | debug-only retrieval preview (same code path, no LLM) |

Every handler calls `getCurrentUser()` first and 401s without a session, matching the
existing routes. All ownership filters are `WHERE userId = session.user.id`.

---

## 7. UI

- **Collection picker** in `ChatHeader` beside the provider selector: "No documents" /
  "{collection name} · {n} docs".
- **Upload drawer**: drag-drop, per-file progress, status badge (`processing` spinner,
  `ready` check, `failed` with the error and a retry button). Polls
  `/api/rag/documents/[id]` every 2 s while any document is not terminal.
- **Citations** in `MarkdownMessage`: `[n]` renders as a superscript chip; click opens a
  side panel with the chunk text, document title and page. Chips come from the
  `sources` SSE frame, so they appear before the answer finishes streaming.
- **Grounding notice** when retrieval returned nothing: a muted line above the reply,
  "No matching passages — answered without your documents."
- New hook `hooks/useRagDocuments.ts` mirroring `useApiKeys`/`useConversations`;
  `useChatStream` learns to handle the `sources` frame.

---

## 8. Limits, cost, failure modes

| Concern | Decision |
|---------|----------|
| Server-side request forgery | A user-supplied URL is checked before every fetch and on every redirect hop (`lib/rag/url-guard.ts`): http(s) only, no internal hostnames, and the resolved addresses must all be public. Without it, "fetch this URL" reads cloud metadata or an internal port and hands the body back in a cited answer. |
| File size | 4 MB by upload (request-body limit), 20 MB by URL (enforced while the response streams, plus an up-front `content-length` check); 2000 chunks per document |
| Quota | 50 documents / 20k chunks per user (free tier), surfaced in the profile page next to `freeMessagesUsed` |
| Embedding cost | ~$0.02 per 1M tokens at `text-embedding-3-small`; a 200-page PDF ≈ 120k tokens ≈ $0.0025. Query embeddings are one per message. |
| Embedding key | Server's `OPENAI_API_KEY` is used for embeddings even when the chat provider is Anthropic/OpenRouter — the corpus must stay in one vector space. Document this; it means RAG requires an OpenAI key server-side. |
| Provider down (embeddings) | Ingestion → `failed` with retry; query → fall back to keyword-only retrieval rather than erroring. |
| Retrieval slow | Hard 1.5 s timeout on the retrieval step; on timeout answer without context and show the grounding notice. |
| Prompt injection in documents | Context is clearly delimited and the system prompt states that context is data, never instructions. Chunks are never executed or fetched from. |
| PII | Blobs are private; documents are deleted on account deletion via `onDelete: Cascade` plus a blob sweep. |

---

## 9. Phasing

1. **Phase 1 — vertical slice.** pgvector migration, text/markdown paste ingestion only,
   vector-only retrieval, context injection, citations in the stream. No Blob, no PDF.
2. **Phase 2 — real files.** Blob direct upload, PDF + DOCX extraction, async processing
   with status polling, upload drawer UI.
3. **Phase 3 — retrieval quality.** Keyword leg + RRF, query rewrite, neighbour expansion,
   eval set and tuning of `k` / threshold / chunk size.
4. **Phase 4 — polish.** Quotas, re-embed script, debug search page, citation side panel.

Each phase is independently shippable and leaves the non-RAG chat path untouched.

---

## 10. Testing

Bun tests under `tests/`, following the existing `tests/setup.ts` DB harness:

- `tests/rag/chunk.test.ts` — pure: heading preservation, overlap, min/max size, unicode.
- `tests/rag/ingest.test.ts` — fixture PDF/DOCX/MD → expected chunk counts; dedupe by
  hash; resume after a simulated mid-document failure; `failed` on a corrupt file.
- `tests/rag/retrieve.test.ts` — seeded chunks with hand-written embeddings; asserts
  ordering, the collection filter, the `embeddingModel` filter, cross-user isolation
  (user B never retrieves user A's chunks), and the empty-result path.
- `tests/rag/chat.test.ts` — the chat route with a mocked provider: context present in the
  upstream request body, `sources` frame emitted first, citations persisted, and
  `useRag:false` bypassing retrieval entirely.

**Retrieval eval**: `tests/eval/` — two fixture corpora of ten documents each, 42
questions (36 answerable with an expected document and heading, 6 out-of-domain), scored
for recall@1/3/6, MRR, heading accuracy and abstention. `bun run eval` runs it with the
deterministic embedder and compares against `baseline.fake.json`;
`bun run eval --embedder=openai` measures real retrieval quality. A regression below the
baseline exits non-zero, and `tests/rag/eval.test.ts` asserts the fake-embedder baseline on
every test run. See `tests/eval/README.md`.

---

## 11. Open decisions

1. **Vector store** — pgvector in the existing Neon database (recommended: no new
   infrastructure, transactional with the rest of the schema, fine to ~1M chunks) vs. a
   dedicated store (Upstash Vector / Pinecone via the Vercel Marketplace) if the corpus
   outgrows it. Spec assumes pgvector.
2. **Embedding provider** — server-held OpenAI key (assumed) vs. routing embeddings
   through Vercel AI Gateway so the model can be swapped without a code change. The
   Gateway option is cheap to adopt and worth doing in Phase 1 if a gateway key exists.
3. **Collection granularity** — explicit user-managed collections (assumed) vs. documents
   attached directly to a single conversation. Collections cost one extra model but let a
   corpus be reused across conversations.
4. **Reranker** — not in v1. If recall@6 is good but precision is poor, add a cross-encoder
   rerank over the fused top 20 before truncating to 6.
5. **Background execution** — Vercel Queues (recommended) vs. a self-called route handler
   with a shared secret. Queues gives retries and at-least-once delivery for free.

---

## 12. Implementation notes

What shipped, and where it departs from the design above. This section is authoritative
where the two disagree.

### Shipped

| Area | Where |
|------|-------|
| Schema + pgvector migration | `prisma/schema.prisma`, `prisma/migrations/20261002160000_add_rag/` |
| Chunking, normalization, token budget | `lib/rag/{chunk,normalize,tokens}.ts` |
| Extraction (text, markdown, html, PDF, DOCX) | `lib/rag/extract.ts` |
| Embeddings (batching, retry, dimension check) | `lib/rag/embed.ts` |
| Ingestion pipeline | `lib/rag/ingest.ts`, `lib/rag/documents.ts` |
| Hybrid retrieval (vector + keyword + RRF) | `lib/rag/{retrieve,fuse}.ts` |
| Query rewrite | `lib/rag/rewrite.ts` |
| Prompt assembly + citations | `lib/rag/prompt.ts` |
| Chat-side orchestration | `lib/rag/chat-context.ts`, `app/api/chat/route.ts` |
| API | `app/api/rag/{collections,documents,search}/`, `PATCH /api/conversations/[id]` |
| UI | `components/DocumentsDrawer.tsx`, `ChatComposer`, `ChatMessages`, `MarkdownMessage`, `hooks/useRagDocuments.ts` |
| Tests | `tests/rag/*`, `scripts/stub-provider.ts` |
| Retrieval eval | `tests/eval/`, `scripts/eval-retrieval.ts` |

### Deliberate departures

1. **Upload goes through the request body, not Vercel Blob.** `POST /api/rag/documents`
   accepts `multipart/form-data` and holds the bytes in the `after()` closure, exactly as
   pasted text is held. That caps a file at 4 MB (`MAX_UPLOAD_BYTES`), under the
   platform's 4.5 MB body limit — §4.1's direct-to-Blob upload is what lifts it to the
   20 MB the pipeline otherwise supports. Larger documents can still be added by URL,
   which streams and is capped at 20 MB.
2. **Background work uses `after()`, not Queues.** `POST /api/rag/documents` responds 202
   and processes the document in the same invocation via `after()` from `next/server`.
   `POST /api/rag/documents/[id]/process` exists for the retry button and as the trigger a
   queue or cron would call (`x-rag-process-secret`, or a session that owns the document).
3. **Pasted text is never stored**, so it cannot be reprocessed: the process route answers
   409 for a paste source, and the retry button only appears for URL documents. Storing
   the raw text would mean a new column and a second copy of the user's data.
4. **The breadcrumb is embedded, not stored.** `Chunk.content` holds the passage alone;
   `ingest.embeddingInput()` prepends `"{title} › {heading}"` to what the embedding model
   sees. §4.2 stage 5 described storing the prefix, which would have put it in citations.
5. **Duplicates fail loudly.** A re-ingested document with an existing `contentHash` in the
   collection is marked `failed` with `Already in this collection as "<title>"`, and
   `ingestDocument` returns `status: "duplicate"` with `duplicateOf`. §4.2 stage 4 wanted
   it marked ready and pointed at the original, which the model has no field for.
6. **`Citation.score` is the fused RRF score**, not a cosine similarity — the two legs are
   not on a comparable scale, so only the ordering within one result set means anything.
7. **Neighbour expansion (ordinal ± 1) is not implemented.** Chunk overlap already covers
   the boundary case it was there for.
8. **`page` is populated for PDFs only.** A PDF is chunked page by page, so each chunk can
   name the page it came from and citations read `(p.12)`. A `.docx` has no pagination
   until it is laid out, and pasted or fetched text has none at all, so `page` stays null
   for those — the citation then shows just the title and heading.
9. **Citations render as a tooltip chip plus a Sources list** under the message, not a side
   panel with the passage text. A panel needs a `GET /api/rag/chunks/[id]` endpoint;
   nothing else is missing.
10. **Fetched URLs are extracted by the response's `Content-Type`**, not the type declared
    at submission: a `.txt` page submitted as a URL would otherwise go through the HTML
    extractor, which strips every `<bracketed>` word.
11. **The eval set's only recorded baseline is measured with a fake embedder.** No
    `baseline.openai.json` exists yet: recording one needs an `OPENAI_API_KEY` with credit
    (the attempt made while building the set was rejected for billing). It guards the
    ranking logic, not retrieval quality: the deterministic embedder knows only vocabulary
    overlap, so its absolute scores are low by construction. Recording a baseline with
    `--embedder=openai` is one command and is what any real tuning of `k`, the 0.25 floor
    or the chunk size should be judged against. `tests/eval/README.md` spells out the
    difference.

### Operational notes

- **A PDF or Word file cannot be pasted**: the route answers 415 telling the user to
  upload it, rather than accepting bytes mangled by JSON string decoding.
- **pdf.js detaches the buffer it is handed.** `extractPdf` passes it a copy, so callers
  still hold their bytes afterwards; a test pins this.
- **Embeddings need `OPENAI_API_KEY` on the server**, whichever provider the user chats
  with (§8). Without it, retrieval degrades: the answer still streams, with the
  "document search was unavailable" notice.
- **`OPENAI_BASE_URL`** (new, optional) points both chat completions and embeddings at an
  OpenAI-compatible endpoint. The tests use it to reach `scripts/stub-provider.ts`.
- **`RAG_PROCESS_SECRET`** (new, optional) enables sessionless calls to the process route.
- The pgvector extension is created by the migration; the database role needs rights to
  `CREATE EXTENSION`.
- **`prisma migrate dev` needs hand-editing after any change to `Chunk`.** PSL cannot
  express the HNSW index or the `contentTsv` generated column, so Prisma emits statements
  that drop or break them. Both are called out in a comment on the model; delete those
  statements from the generated migration. Losing `contentTsv` silently disables the
  keyword half of retrieval.
