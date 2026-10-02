
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
  a grounding notice when nothing matched. Text, markdown and HTML sources; see
  `docs/rag-spec.md`.

## Next:
- RAG: PDF and DOCX extraction, and file upload via Vercel Blob
- RAG: build the retrieval eval set before tuning chunk size or the similarity floor
- Add message search functionality
- i w
- Containerise the application using Docker
- Add export conversation feature

## Fixed
