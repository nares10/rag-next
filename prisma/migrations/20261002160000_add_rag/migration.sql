-- pgvector must exist before the Chunk.embedding column is created.
CREATE EXTENSION IF NOT EXISTS vector;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "collectionId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "citations" JSONB;

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUri" TEXT,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "pageCount" INTEGER,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "page" INTEGER,
    "heading" TEXT,
    "embedding" vector(1536),
    "embeddingModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Collection_userId_idx" ON "Collection"("userId");

-- CreateIndex
CREATE INDEX "Document_collectionId_status_idx" ON "Document"("collectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Document_collectionId_contentHash_key" ON "Document"("collectionId", "contentHash");

-- CreateIndex
CREATE INDEX "Chunk_collectionId_idx" ON "Chunk"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Chunk_documentId_ordinal_key" ON "Chunk"("documentId", "ordinal");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- NOTE: `prisma migrate dev` will try to DROP the two objects created below, because PSL
-- cannot express an HNSW index or a GENERATED column. Delete those statements from any
-- migration it generates for "Chunk" (see the comment on the model in schema.prisma).

-- HNSW over cosine distance: no training step (unlike IVFFlat) and good recall at the
-- corpus sizes this app targets.
CREATE INDEX "Chunk_embedding_hnsw_idx" ON "Chunk"
  USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- Lexical half of hybrid retrieval. Generated column so it can never drift from content.
ALTER TABLE "Chunk" ADD COLUMN "contentTsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;
CREATE INDEX "Chunk_contentTsv_idx" ON "Chunk" USING gin ("contentTsv");
