/** Per-user ceilings for the free tier, mirroring FREE_MESSAGE_LIMIT in lib/freeMessages.ts. */
export const MAX_DOCUMENTS_PER_USER = 50;
export const MAX_CHUNKS_PER_USER = 20_000;
/** Pasted text is held in the request body, so it has to stay well inside the 4.5 MB body cap. */
export const MAX_PASTE_BYTES = 1024 * 1024;
