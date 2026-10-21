/** Evaluation service: runs the configured queries against the live index. */
import type { Db } from 'mongodb';
import bundledDataset from '../../data/evaluation/queries.json' with { type: 'json' };
import { collections } from '../db/collections.js';
import { runEvaluation, type EvaluationDataset } from '../evaluation/run.js';
import type { EvaluationResponse } from '../types.js';
import { requireIndex } from './catalogue.js';

export const BUNDLED_DATASET = bundledDataset as EvaluationDataset;

/** Queries stored in MongoDB (seeded by `npm run seed:evaluation`), else the bundled file. */
export async function loadEvaluationDataset(db: Db): Promise<{ dataset: EvaluationDataset; source: EvaluationResponse['source'] }> {
  const stored = await collections(db).evaluationQueries.find({ dataset: BUNDLED_DATASET.name }).sort({ order: 1 }).toArray();
  if (stored.length === 0) return { dataset: BUNDLED_DATASET, source: 'bundled-file' };
  return {
    dataset: {
      ...BUNDLED_DATASET,
      queries: stored.map(({ id, query, informationNeed, relevant, notes }) => ({ id, query, informationNeed, relevant, ...(notes ? { notes } : {}) })),
    },
    source: 'database',
  };
}

export async function evaluate(db: Db, k: number): Promise<EvaluationResponse> {
  const started = Date.now();
  const store = await requireIndex(db);
  const { dataset, source } = await loadEvaluationDataset(db);
  const books = collections(db).books;

  const run = await runEvaluation(
    store,
    dataset,
    k,
    async (ids) => new Set((await books.find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map((d) => d._id)),
    async (ids) =>
      new Map(
        (await books.find({ _id: { $in: ids } }, { projection: { title: 1, author: 1 } }).toArray()).map((d) => [d._id, { title: d.title, author: d.author }]),
      ),
  );

  return {
    k,
    mrrDepth: dataset.mrrDepth,
    datasetName: dataset.name,
    judgmentNote: dataset.judgmentNote,
    source,
    queriesTotal: dataset.queries.length,
    queriesEvaluated: run.queriesEvaluated,
    summary: run.summary,
    queries: run.queries,
    index: { books: store.metadata.totalDocuments, builtAt: store.metadata.builtAt.toISOString(), fieldWeights: store.metadata.fieldWeights },
    computedAt: new Date().toISOString(),
    tookMs: Date.now() - started,
  };
}
