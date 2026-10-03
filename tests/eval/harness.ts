import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma as defaultPrisma } from "../../lib/prisma";
import type { Embedder } from "../../lib/rag/embed";
import { ingestDocument } from "../../lib/rag/ingest";
import { retrieveContext } from "../../lib/rag/retrieve";
import { RESULT_LIMIT } from "../../lib/rag/retrieve";

export const CORPORA_DIR = join(import.meta.dir, "corpora");
export const QUESTIONS_PATH = join(import.meta.dir, "questions.json");

export type EvalQuestion = {
  id: string;
  corpus: string;
  question: string;
  /** Absent for out-of-domain questions, where the right answer is to retrieve nothing. */
  document?: string;
  heading?: string;
  answerable?: boolean;
};

export type QuestionResult = {
  id: string;
  corpus: string;
  answerable: boolean;
  /** 1-based rank of the first chunk from the expected document; null if absent. */
  rank: number | null;
  headingHit: boolean;
  retrieved: number;
  /** For out-of-domain questions: true when retrieval correctly returned nothing. */
  abstained: boolean;
  topDocument: string | null;
};

export type Metrics = {
  questions: number;
  answerable: number;
  outOfDomain: number;
  recallAt1: number;
  recallAt3: number;
  recallAt6: number;
  mrr: number;
  headingAccuracy: number;
  abstentionRate: number;
};

export type EvalReport = {
  overall: Metrics;
  byCorpus: Record<string, Metrics>;
  results: QuestionResult[];
};

export async function loadQuestions(): Promise<EvalQuestion[]> {
  return JSON.parse(await readFile(QUESTIONS_PATH, "utf8")) as EvalQuestion[];
}

export async function loadCorpus(corpus: string): Promise<Array<{ name: string; text: string }>> {
  const dir = join(CORPORA_DIR, corpus);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();

  return Promise.all(
    names.map(async (name) => ({ name, text: await readFile(join(dir, name), "utf8") })),
  );
}

/**
 * Ingests both corpora into their own collections for one user, and returns the collection
 * id per corpus. Each run builds the corpora from scratch so a score can never depend on
 * what a previous run happened to leave behind.
 */

export async function buildCorpora(options: {
  embed: Embedder;
  userId: string;
  corpora: string[];
  prisma?: typeof defaultPrisma;
}): Promise<Record<string, string>> {
  const prisma = options.prisma ?? defaultPrisma;
  const collections: Record<string, string> = {};

  for (const corpus of options.corpora) {
    const collection = await prisma.collection.create({
      data: { userId: options.userId, name: `eval:${corpus}` },
    });

    for (const { name, text } of await loadCorpus(corpus)) {
      const document = await prisma.document.create({
        data: {
          collectionId: collection.id,
          userId: options.userId,
          // The file name is the document's identity in questions.json.
          title: name,
          sourceType: "paste",
          mimeType: "text/markdown",
          byteSize: Buffer.byteLength(text),
          contentHash: `eval:${corpus}:${name}`,
          status: "pending",
        },
      });

      const result = await ingestDocument({ documentId: document.id, raw: text, embed: options.embed, prisma });

      if (result.status !== "ready") {
        throw new Error(`Could not ingest ${corpus}/${name}: ${result.error ?? result.status}`);
      }
    }

    collections[corpus] = collection.id;
  }

  return collections;
}

export async function runQuestions(options: {
  questions: EvalQuestion[];
  collections: Record<string, string>;
  embed: Embedder;
  userId: string;
  limit?: number;
  prisma?: typeof defaultPrisma;
}): Promise<QuestionResult[]> {
  const limit = options.limit ?? RESULT_LIMIT;
  const results: QuestionResult[] = [];

  for (const question of options.questions) {
    const chunks = await retrieveContext({
      userId: options.userId,
      collectionId: options.collections[question.corpus],
      query: question.question,
      embed: options.embed,
      limit,
      prisma: options.prisma,
    });

    const answerable = question.answerable !== false;
    const index = chunks.findIndex((chunk) => chunk.title === question.document);

    results.push({
      id: question.id,
      corpus: question.corpus,
      answerable,
      rank: index === -1 ? null : index + 1,
      headingHit:
        question.heading === undefined
          ? false
          : chunks.some((chunk) => chunk.title === question.document && chunk.heading === question.heading),
      retrieved: chunks.length,
      abstained: chunks.length === 0,
      topDocument: chunks[0]?.title ?? null,
    });
  }

  return results;
}

export function score(results: QuestionResult[]): Metrics {
  const answerable = results.filter((result) => result.answerable);
  const outOfDomain = results.filter((result) => !result.answerable);
  const within = (limit: number) =>
    answerable.filter((result) => result.rank !== null && result.rank <= limit).length;

  return {
    questions: results.length,
    answerable: answerable.length,
    outOfDomain: outOfDomain.length,
    recallAt1: ratio(within(1), answerable.length),
    recallAt3: ratio(within(3), answerable.length),
    recallAt6: ratio(within(6), answerable.length),
    // Mean reciprocal rank rewards moving the right passage up, which plain recall cannot see.
    mrr: ratio(
      answerable.reduce((total, result) => total + (result.rank ? 1 / result.rank : 0), 0),
      answerable.length,
    ),
    headingAccuracy: ratio(answerable.filter((result) => result.headingHit).length, answerable.length),
    abstentionRate: ratio(outOfDomain.filter((result) => result.abstained).length, outOfDomain.length),
  };
}

export function report(results: QuestionResult[]): EvalReport {
  const corpora = [...new Set(results.map((result) => result.corpus))].sort();

  return {
    overall: score(results),
    byCorpus: Object.fromEntries(
      corpora.map((corpus) => [corpus, score(results.filter((result) => result.corpus === corpus))]),
    ),
    results,
  };
}

function ratio(part: number, whole: number): number {
  if (whole === 0) return 0;

  return Math.round((part / whole) * 1000) / 1000;
}

/** Metrics where a drop is a regression. */
export const TRACKED_METRICS = [
  "recallAt1",
  "recallAt3",
  "recallAt6",
  "mrr",
  "headingAccuracy",
  "abstentionRate",
] as const;

export type Regression = { metric: string; scope: string; baseline: number; current: number };

/**
 * Compares a run against a recorded baseline. Only drops are reported: an improvement is
 * the point of a tuning change, and is recorded by re-running with --record.
 */
export function compareToBaseline(
  current: EvalReport,
  baseline: { overall: Metrics; byCorpus: Record<string, Metrics> },
  tolerance = 0.001,
): Regression[] {
  const regressions: Regression[] = [];

  const check = (scope: string, now: Metrics, before: Metrics | undefined) => {
    if (!before) return;

    for (const metric of TRACKED_METRICS) {
      if (now[metric] + tolerance < before[metric]) {
        regressions.push({ metric, scope, baseline: before[metric], current: now[metric] });
      }
    }
  };

  check("overall", current.overall, baseline.overall);

  for (const [corpus, metrics] of Object.entries(current.byCorpus)) {
    check(corpus, metrics, baseline.byCorpus[corpus]);
  }

  return regressions;
}
