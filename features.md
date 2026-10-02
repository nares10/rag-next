
# Features

## Implemented:
- **Basic Chat UI**: Clean, modern interface with message composer
- **Multiple AI Providers**: Support for OpenRouter, OpenAI, and Anthropic/Claude
- **Streaming Responses**: Real-time streaming of AI responses
- **Provider Selection**: Dropdown to switch between AI providers
- **Database Schema**: Complete schema with User, Session, Conversation, Message, and ApiKey models
- **Traditional Prisma Setup**: Migrated from Prisma Next to traditional Prisma 6.x
- **Seed Data**: Realistic seed data with users, sessions, conversations, messages, and API keys
- **Password Hashing**: Argon2 integration for secure password storage
- **Authentication UI**: Login and registration pages with form validation
- **Conversation History**: List of conversations with provider information
- **API Key Management**: Save, list, and manage provider API keys
- **Profile Dashboard**: View account details, usage, conversations, and providers
- **Conversation Management**: Rename and delete conversations

- **Document Q&A (RAG)**: Attach a collection of pasted or fetched documents to a
  conversation and the assistant answers from them, with `[n]` citations streamed ahead of
  the answer. Hybrid retrieval (pgvector cosine + Postgres full-text, fused with RRF),
  heading-aware chunking with overlap, follow-up query rewriting, per-message opt-out, and
  a grounding notice when nothing matched. Upload PDF and Word (.docx) files, paste text
  or markdown, or point it at a URL; PDF chunks cite the page they came from. See
  `docs/rag-spec.md`.

- **Citations you can check**: Inline `[n]` markers preview their source passage on
  hover; `[1] pricing.md p.4` chips under each answer open a side panel with the exact
  passage highlighted in its surrounding text (`/api/rag/chunks`).
- **Retrieval steps**: While an answer streams, the chat shows "Searching Outbound…" and
  then "Found 5 sources" (or that nothing matched).
- **Answer actions**: Copy, 👍/👎 feedback and regenerate on each answer. Regenerate
  replaces the last exchange, and the old one is only deleted once the new answer
  arrives. A Stop button cancels an answer mid-stream.
- **Model picker**: Choose provider and model (e.g. "OpenRouter · Auto"). Free messages
  always use the server's default model; any other model needs the user's own key.
  The catalogue lives in `lib/models.ts`.
- **Active context chip**: The attached collection shows above the input with its file
  count, an on/off toggle for the next message, and ✕ to detach.
- **Quick upload**: 📎 in the composer uploads straight into the chat's collection,
  creating and attaching "My uploads" if the chat has none.
- **Documents panel**: Collection list, then a collection view with a drag-and-drop zone.
  Each file shows its type, size and status: Uploading (with progress), Queued,
  Processing, Ready or Failed with retry. "Attach to chat" on every collection; deletes
  sit behind ⋯ and always ask for confirmation.
- **Welcome screen**: Example prompts, plus an "Upload documents" card for users with no
  collections.
- **Sidebar**: Search, chats grouped by Today, Yesterday, Previous 7 days and so on, an
  empty state, and a slide-in drawer on mobile.
- **Header and settings**: Conversation title in the header; the avatar menu holds
  Profile, Settings, the theme toggle and Log out. Settings lists the keyboard shortcuts.
- **Usage ring**: Free-message usage next to the input, highlighted only when close to the
  20-message limit.
- **Profile and account**: Back arrow, an "Add key" call to action with a provider
  dropdown, deletable API keys, change password (signs out other sessions) and delete
  account, both confirmed by password.
- **Theming**: Indigo accent colour, and a light mode that follows the system setting by
  default.
- **Keyboard shortcuts**: Ctrl+K new chat, Ctrl+B sidebar, Ctrl+Shift+D documents, `/`
  focuses the input, Esc closes panels.
- **Animations** (Motion): Messages fade and slide in, a caret blinks while an answer
  streams, citation chips pop in staggered, and the retrieval status shimmers. Panels,
  dialogs and menus animate open and closed, removed items collapse, and there are
  skeleton loaders and count-up profile stats. All of it respects reduced motion.

## Next:
- Store 👍/👎 feedback in the database (it's kept per browser for now)
- Save the partial answer when a reply is stopped mid-stream
- Keep uploaded files (or upload straight to storage) so a failed file can be retried from
  any device, not only the tab that uploaded it
- RAG: direct-to-storage upload, to lift the 4 MB file limit to the pipeline's 20 MB
- RAG: record an eval baseline with real embeddings, then tune chunk size and the
  similarity floor against it (`bun run eval --embedder=gemini --record`)
- Add message search functionality
- i w
- Containerise the application using Docker
- Add export conversation feature

## Fixed
