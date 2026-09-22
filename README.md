# ai-chat

A self-hosted AI chat application built with Next.js. Users sign up, bring their own
provider API keys, and chat with OpenAI, Anthropic (Claude), or OpenRouter models with
streaming responses, conversation history, and a profile dashboard.

## Features

- Chat UI with streaming responses across multiple AI providers
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
- Argon2 for password hashing, Resend for transactional email

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

## 4. Run the app

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Testing

Tests run against a separate database whose `DATABASE_URL` must contain `test` in the
database name (a safety check to prevent wiping real data).

```bash
bun test             # run tests without the migration step
bun run test:watch   # watch mode
```

## Available scripts

| Script                | Description                                      |
| --------------------- | ------------------------------------------------- |
| `bun run dev`          | Start the dev server                               |
| `bun run build`        | Build for production                               |
| `bun run start`        | Start the production server                        |
| `bun run lint`         | Run ESLint                                         |
| `bun run db:seed`      | Seed the database                                  |
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
prisma/       Prisma schema and generated client
migrations/   Database migrations
tests/        Test suite
```
