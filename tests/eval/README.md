# Retrieval eval set

A fixed set of questions with known answers, used to tell whether a change to retrieval
made it better or worse. Without it, tuning the chunk size, the similarity floor or the
fusion constant is guesswork: every change looks fine on the one question you tried.

```bash
bun run eval                     # fake embedder, compared against the recorded baseline
bun run eval --embedder=openai   # the real model — calls the embeddings API and costs money
bun run eval --record            # overwrite the baseline for the chosen embedder
bun run eval --limit=10          # score a different top-k
```

`DATABASE_URL` must name a test or eval database; the runner refuses to touch anything
else. It creates its own user and collections and deletes them at the end.

## What is in here

- `corpora/handbook/` — ten short policy documents (expenses, travel, leave, security…).
- `corpora/platform/` — ten short service documents (deploys, rate limits, queues…).
- `questions.json` — 42 questions: 36 with an expected document and heading, and 6
  out-of-domain questions where the right behaviour is to retrieve **nothing**.
- `harness.ts` — ingestion, scoring and baseline comparison, shared by the runner and
  `tests/rag/eval.test.ts`.
- `baseline.fake.json` — the recorded scores for the deterministic embedder.

Questions are deliberately phrased in words the documents do not use ("How long do I have
to send in a receipt?" against "Receipts must be filed within 30 days"). A question that
repeats the passage's own vocabulary is answered by keyword search alone and tells you
nothing about retrieval.

## The metrics

| Metric | Meaning |
|--------|---------|
| `recallAt1/3/6` | Share of answerable questions where a chunk from the expected document is in the top 1 / 3 / 6. |
| `mrr` | Mean reciprocal rank of the first correct chunk. Moves when a passage shifts from rank 3 to rank 1, which recall@6 cannot see. |
| `headingAccuracy` | Share where the expected *section* was retrieved, not just the right document. This is what makes a citation land on the right paragraph. |
| `abstentionRate` | Share of out-of-domain questions that retrieved nothing. Guards the similarity floor: a low number means the floor is too permissive and the model is being handed irrelevant context to cite. |

## Two baselines, measuring different things

**`--embedder=fake` (the default, and what CI runs.)** The embedder in
`tests/support/fake-embedder.ts` is deterministic and knows only vocabulary overlap. Its
absolute scores are *low and not meaningful as quality*: a paraphrased question has little
vocabulary in common with its passage, so it retrieves nothing. What it does measure,
because the embedder never changes, is the ranking logic around it — chunking, hybrid
fusion, the floor, the token budget. If a change to any of those makes things worse, this
number drops. That is why `tests/rag/eval.test.ts` asserts against it on every test run.

A consequence worth knowing: `abstentionRate` is near-free with the fake embedder, because
so little is retrieved for anything. It only becomes a real test under a model that
produces plausible-looking near-matches.

**`--embedder=openai`.** This is the one that answers "is retrieval any good?". It calls
the embeddings API, so it costs money (cents, for this corpus) and needs an
`OPENAI_API_KEY` with credit on it. **No baseline is recorded for it yet** — the attempt
made at the time of writing was rejected with "You have no credits remaining", so
`baseline.openai.json` does not exist and `bun run eval --embedder=openai` will simply
print its scores and tell you to record one. Record a baseline before a tuning change and
re-run after:

```bash
DATABASE_URL=$TEST_DATABASE_URL bun run eval --embedder=openai --record   # before
# ...change lib/rag/chunk.ts, retrieve.ts, prompt.ts...
DATABASE_URL=$TEST_DATABASE_URL bun run eval --embedder=openai            # after
```

A non-zero exit means a tracked metric fell below the baseline. Improvements never fail;
record them with `--record` so the bar moves up.

## Adding to the set

Add a document to a corpus directory and questions to `questions.json`
(`{ id, corpus, question, document, heading }`; omit `document` for an out-of-domain
question). Then re-record the baselines — the metrics are shares, so adding questions
changes them even if nothing about retrieval changed.

Prefer questions that one document answers unambiguously, and that a near-miss document
could plausibly steal. A question no document answers belongs in the out-of-domain group,
not as an answerable one nobody expects to pass.
