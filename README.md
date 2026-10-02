# ai-chat

A self-hosted AI chat application built with Next.js. Users sign up, bring their own
provider API keys, and chat with OpenAI, Anthropic (Claude), or OpenRouter models with
streaming responses, conversation history, and a profile dashboard.

## Features

- Chat UI with streaming responses across multiple AI providers
- Document Q&A: attach your own documents to a conversation and get answers with citations
- Email/password authentication (Argon2 password hashing, DB-backed sessions)
- Conversation history — create, rename, delete
- Per-user API key management for each provider
- Profile dashboard (account details, usage, conversations, providers)

See `features.md` for the full list and what's still in progress.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19
- [Prisma 6](https://www.prisma.io) + PostgreSQL
- [Bun](https://bun.sh) for scripts and tests
- Tailwind CSS 4
- Argon2 for password hashing

## Prerequisites

- [Bun](https://bun.sh) (used to run scripts and tests; `npm`/`node` also work for `dev`/`build`/`start`)
- A PostgreSQL database

## 1. Clone and install

```bash
git clone https://github.com/nares10/aiChat
cd ai-chat
bun install
```

## 2. Configure environment variables

Create a `.env` file in the project root:

```bash
DATABASE_URL=<your db connection string>
TEST_DATABASE_URL=<your test db connection string>

OPENROUTER_API_KEY=<your openrouter api key>
OPENROUTER_MODEL=<openrouter model>

OPENAI_API_KEY=<your openai api key>
OPENAI_MODEL=<openai model>

AI_PROVIDER=openroute

# Embeddings for document search (see below)
EMBEDDING_PROVIDER=<"gemini" or "openai"; defaults to "openai">
GEMINI_API_KEY=<required when EMBEDDING_PROVIDER=gemini>

# Optional
EMBEDDING_MODEL=<overrides the provider's default embedding model>
OPENAI_BASE_URL=<an OpenAI-compatible endpoint; defaults to https://api.openai.com/v1>
RAG_PROCESS_SECRET=<shared secret allowing a queue or cron to trigger document processing>
```

`.env*` files are git-ignored — never commit real credentials.

AI provider API keys (OpenAI, Anthropic, OpenRouter) are **not** environment variables —
each user adds their own keys after signing in, via the API key management page.

## 3. Set up the database

Generate the Prisma client and apply migrations:

```bash
bunx prisma generate
bunx prisma migrate deploy
```

Optionally seed the database with example users, conversations, and messages:

```bash
bun run db:seed
```

By default the seed script skips databases that already contain users. To wipe and
reseed, set `SEED_FORCE_RESET=true`.

## 4. Document Q&A (RAG)

Create a collection in the **Documents** panel next to the provider picker, paste in some
text (or give a URL), and attach the collection to the conversation. The assistant then
answers from those documents and cites the passages it used.

Two things to know:

- **Embeddings always use the server's own key**, even when you chat through Anthropic or
  OpenRouter — a collection is only searchable if every vector in it came from the same
  model. Without that key, chat still works; document search reports itself as
  unavailable.
- **Two embedding providers.** `EMBEDDING_PROVIDER=gemini` uses `gemini-embedding-001`,
  which has a free tier that needs no billing account, at 1536 dimensions to match the
  database column. The default, `openai`, uses `text-embedding-3-small` and also covers
  any OpenAI-compatible endpoint (OpenRouter, a gateway, a local server) through
  `OPENAI_BASE_URL`.
- **Switching provider invalidates the corpus.** Vectors from different models are not
  comparable, so chunks embedded with the old model stop being searchable the moment
  `EMBEDDING_MODEL` changes — `retrieve.ts` filters them out rather than returning
  nonsense. Re-add the documents after a switch.
- **PDF, Word (.docx), markdown, plain text and HTML** are all read. PDF chunks keep the
  page they came from, so citations can say `(p.12)`.
- **Uploads are limited to 4 MB** by the serverless request-body cap. Larger documents can
  be added by URL, which streams up to 20 MB.

Postgres needs the `pgvector` extension; the migration creates it, so the database role
must be allowed to `CREATE EXTENSION`.

Retrieval quality is measured by a checked-in eval set — `bun run eval`, documented in
`tests/eval/README.md`. Run it before and after changing anything in `lib/rag/`.

See `docs/rag-spec.md` for the pipeline and the current limitations.

## 5. Run the app

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Testing

Tests run against a separate database whose `DATABASE_URL` must contain `test` in the
database name (a safety check to prevent wiping real data). `tests/preload.ts` points the
Prisma client at `TEST_DATABASE_URL`.

Most tests are integration tests over HTTP, so they need two processes running alongside
them:

```bash
# 1. the stub AI provider: deterministic embeddings and a canned streamed reply,
#    so no test ever calls a paid API
bun run stub

# 2. a dev server against the test database, pointed at the stub
DATABASE_URL=$TEST_DATABASE_URL \
OPENAI_API_KEY=stub-key \
OPENAI_BASE_URL=http://localhost:4010/v1 \
OPENROUTER_API_KEY= ANTHROPIC_API_KEY= AI_PROVIDER= \
bun run dev

# 3. then, in a third shell
bun test             # whole suite
bun test tests/rag   # just the RAG tests
bun run test:watch   # watch mode
```

`OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY` must stay empty: `tests/chat.test.ts` asserts
the error path for a provider with no key configured. The pure unit tests
(`tests/rag/{chunk,normalize,fuse,prompt,tokens,extract,embed,rewrite}.test.ts`) need
neither process and run on their own.

## Available scripts

| Script                | Description                                      |
| --------------------- | ------------------------------------------------- |
| `bun run dev`          | Start the dev server                               |
| `bun run build`        | Build for production                               |
| `bun run start`        | Start the production server                        |
| `bun run lint`         | Run ESLint                                         |
| `bun run db:seed`      | Seed the database                                  |
| `bun run stub`         | Start the stub AI provider used by the tests       |
| `bun run eval`         | Score retrieval against the eval set (`tests/eval/`) |
| `bun run db:test:deploy` | Apply migrations to the test database (`.env.test`) |
| `bun run test`         | Run tests                                          |
| `bun run test:db`      | Deploy test DB migrations, then run tests          |
| `bun run test:watch`   | Run tests in watch mode                            |

## Project structure

```
app/          Next.js App Router pages and API routes
components/   React components
hooks/        React hooks
lib/          Server-side helpers (Prisma client, auth/session, password hashing)
lib/rag/      Document ingestion and retrieval pipeline
docs/         Feature specs
prisma/       Prisma schema and generated client
migrations/   Database migrations
tests/        Test suite
```
