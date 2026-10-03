/// <reference types="bun" />
/**
 * Retrieval eval runner.
 *
 *   bun run eval                     # fake embedder, compared against the recorded baseline
 *   bun run eval --embedder=openrouter   # a real model through OpenRouter
 *   bun run eval --embedder=openai       # a real model on an OpenAI-compatible endpoint
 *   bun run eval --record            # overwrite the baseline for the chosen embedder
 *   bun run eval --limit=10          # score a different top-k
 *
 * Ingests tests/eval/corpora into throwaway collections, runs every question in
 * tests/eval/questions.json through the real retrieval path, and scores the rankings.
 * Exits non-zero if any tracked metric is below the baseline, so a tuning change that
 * makes retrieval worse is visible before it ships.
 *
 * The fake embedder only knows vocabulary overlap, so its scores measure the pipeline's
 * ranking logic — chunking, fusion, the similarity floor, the token budget — and not how
 * good retrieval actually is. For that, record a baseline with a real provider.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../lib/prisma";
import { createEmbedder, type Embedder } from "../lib/rag/embed";
import { fakeEmbedder } from "../tests/support/fake-embedder";
import {
  type EvalReport,
  TRACKED_METRICS,
  buildCorpora,
  compareToBaseline,
  loadQuestions,
  report,
  runQuestions,
} from "../tests/eval/harness";

const args = new Set(Bun.argv.slice(2));
const valueOf = (name: string) =>
  [...args].find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];

const embedderName = valueOf("embedder") ?? "fake";
const limit = Number(valueOf("limit") ?? 6);
const shouldRecord = args.has("--record");
const baselinePath = join(import.meta.dir, "..", "tests", "eval", `baseline.${embedderName}.json`);

function assertEvalDatabase() {
  // The run creates and deletes collections, so point it at a scratch database only.
  const url = process.env.DATABASE_URL;
  const name = url ? new URL(url).pathname : "";

  if (!name.toLowerCase().includes("test") && !name.toLowerCase().includes("eval")) {
    throw new Error("Refusing to run: DATABASE_URL must name a test or eval database.");
  }
}

function embedderFor(name: string): Embedder {
  if (name === "fake") return fakeEmbedder;

  // Anything else is a real provider; createEmbedder rejects a name it does not know.
  return createEmbedder({ provider: name });
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1).padStart(5)}%`;
}

function printReport(result: EvalReport) {
  const rows = [["scope", ...TRACKED_METRICS] as string[]];

  for (const [scope, metrics] of [
    ["overall", result.overall],
    ...Object.entries(result.byCorpus),
  ] as const) {
    rows.push([scope, ...TRACKED_METRICS.map((metric) => formatPercent(metrics[metric]))]);
  }

  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));

  for (const [index, row] of rows.entries()) {
    console.log(row.map((cell, column) => cell.padEnd(widths[column])).join("  "));
    if (index === 0) console.log(widths.map((width) => "-".repeat(width)).join("  "));
  }

  const misses = result.results.filter((entry) => entry.answerable && entry.rank !== 1);

  if (misses.length > 0) {
    console.log(`\n${misses.length} question(s) did not rank the expected document first:`);
    for (const miss of misses) {
      const where = miss.rank === null ? "not retrieved" : `rank ${miss.rank}`;
      console.log(`  ${miss.id.padEnd(22)} ${where.padEnd(14)} top hit: ${miss.topDocument ?? "—"}`);
    }
  }

  const leaked = result.results.filter((entry) => !entry.answerable && !entry.abstained);

  if (leaked.length > 0) {
    console.log(`\n${leaked.length} out-of-domain question(s) retrieved something:`);
    for (const entry of leaked) {
      console.log(`  ${entry.id.padEnd(22)} ${entry.retrieved} chunk(s), top hit: ${entry.topDocument}`);
    }
  }
}

async function main() {
  assertEvalDatabase();

  const embed = embedderFor(embedderName);
  const questions = await loadQuestions();
  const corpora = [...new Set(questions.map((question) => question.corpus))];

  const user = await prisma.user.create({
    data: {
      email: `eval-${crypto.randomUUID()}@example.invalid`,
      name: "Retrieval eval",
      // Never signed in to; the eval only needs a row to own the collections.
      passwordHash: "eval-run-not-a-login",
    },
  });

  try {
    console.log(`embedder: ${embedderName}   corpora: ${corpora.join(", ")}   top-k: ${limit}\n`);

    const collections = await buildCorpora({ embed, userId: user.id, corpora });
    const chunks = await prisma.chunk.count({ where: { document: { userId: user.id } } });
    const results = await runQuestions({ questions, collections, embed, userId: user.id, limit });
    const current = report(results);

    console.log(`indexed ${chunks} chunks across ${corpora.length} corpora\n`);
    printReport(current);

    if (shouldRecord) {
      await writeFile(
        baselinePath,
        `${JSON.stringify({ embedder: embedderName, limit, recordedAt: new Date().toISOString(), overall: current.overall, byCorpus: current.byCorpus }, null, 2)}\n`,
      );
      console.log(`\nbaseline written to ${baselinePath}`);
      return;
    }

    const baselineFile = Bun.file(baselinePath);

    if (!(await baselineFile.exists())) {
      console.log(`\nNo baseline for "${embedderName}" yet. Record one with --record.`);
      return;
    }

    const regressions = compareToBaseline(current, await baselineFile.json());

    if (regressions.length === 0) {
      console.log("\nNo regression against the baseline.");
      return;
    }

    console.log("\nRegressions against the baseline:");
    for (const regression of regressions) {
      console.log(
        `  ${regression.scope}/${regression.metric}: ${formatPercent(regression.baseline)} -> ${formatPercent(regression.current)}`,
      );
    }
    process.exitCode = 1;
  } finally {
    // Cascades through collections, documents and chunks.
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}

await main();
