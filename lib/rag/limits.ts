/** Per-user ceilings for the free tier, mirroring FREE_MESSAGE_LIMIT in lib/freeMessages.ts. */
export const MAX_DOCUMENTS_PER_USER = 50;
export const MAX_CHUNKS_PER_USER = 20_000;
/** Pasted text is held in the request body, so it has to stay well inside the 4.5 MB body cap. */
export const MAX_PASTE_BYTES = 1024 * 1024;
/**
 * Uploaded files travel in the request body too. Vercel caps that at 4.5 MB, so this sits
 * just under it; anything larger needs a direct-to-storage upload (see docs/rag-spec.md).
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
