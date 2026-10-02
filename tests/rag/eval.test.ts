/**
 * Runs the retrieval eval with the deterministic fake embedder and fails if any tracked
 * metric has dropped below tests/eval/baseline.fake.json.
 *
 * Holding the embedder constant turns the eval into a regression test for the pipeline's
 * ranking logic — chunking, hybrid fusion, the similarity floor, the token budget. It says
 * nothing about retrieval quality with a real model; `bun run eval --embedder=openai` is
 * what measures that.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { prisma } from "../../lib/prisma";
import {
  type EvalReport,
  compareToBaseline,
  buildCorpora,
  loadQuestions,
  report,
  runQuestions,
} from "../eval/harness";
import baseline from "../eval/baseline.fake.json";
import { fakeEmbedder } from "../support/fake-embedder";
import { createTestUser, resetTestDatabase } from "../setup";

let result: EvalReport;
let userId: string;

describe("retrieval eval", () => {
  beforeAll(async () => {
    await resetTestDatabase();

    const user = await createTestUser("eval-harness@example.com", "Eval");
    userId = user.id;

    const questions = await loadQuestions();
    const corpora = [...new Set(questions.map((question) => question.corpus))];
    const collections = await buildCorpora({ embed: fakeEmbedder, userId, corpora });

    result = report(await runQuestions({ questions, collections, embed: fakeEmbedder, userId }));
  });

  afterAll(async () => {
    await resetTestDatabase();
    await prisma.$disconnect();
  });

  it("indexes both corpora", async () => {
    const documents = await prisma.document.count({ where: { userId } });
    const chunks = await prisma.chunk.count({ where: { document: { userId } } });

    expect(documents).toBe(20);
    expect(chunks).toBeGreaterThan(documents);
  });

  it("scores every question in the set", () => {
    expect(result.overall.questions).toBe(42);
    expect(result.overall.answerable).toBe(36);
    expect(result.overall.outOfDomain).toBe(6);
  });

  it("does not regress against the recorded baseline", () => {
    const regressions = compareToBaseline(result, baseline);

    expect(regressions).toEqual([]);
  });

  it("retrieves nothing for questions the corpus cannot answer", () => {
    const leaked = result.results.filter((entry) => !entry.answerable && !entry.abstained);

    expect(leaked).toEqual([]);
  });

  it("never retrieves across corpus boundaries", () => {
    // Every question is asked against its own corpus, so a hit from the other one would
    // mean the collection filter leaked.
    const handbookDocuments = result.results
      .filter((entry) => entry.corpus === "handbook" && entry.topDocument)
      .map((entry) => entry.topDocument);

    expect(handbookDocuments.some((title) => title?.startsWith("runbook"))).toBe(false);
  });
});
