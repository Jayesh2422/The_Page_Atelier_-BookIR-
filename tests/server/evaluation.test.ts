import { describe, expect, it } from 'vitest';
import dataset from '../../data/evaluation/queries.json' with { type: 'json' };
import { firstRelevantRank, mean, meanReciprocalRank, precisionAtK, recallAtK, reciprocalRank } from '../../lib/evaluation/metrics.js';
import { runEvaluation, type EvaluationDataset } from '../../lib/evaluation/run.js';
import { buildIndex } from '../../lib/ir/indexer.js';
import { MemoryIndexStore } from '../../lib/ir/memory-store.js';
import { CORPUS } from '../fixtures/corpus.js';

const ranked = ['d1', 'd2', 'd3', 'd4', 'd5'];
const relevant = new Set(['d2', 'd4', 'd9']);

describe('rank metrics', () => {
  it('computes Precision@K', () => {
    expect(precisionAtK(ranked, relevant, 1)).toBe(0);
    expect(precisionAtK(ranked, relevant, 2)).toBe(0.5);
    expect(precisionAtK(ranked, relevant, 5)).toBe(0.4);
    // K larger than the result list: missing slots count as non-relevant
    expect(precisionAtK(ranked, relevant, 10)).toBe(0.2);
  });

  it('computes Recall@K', () => {
    expect(recallAtK(ranked, relevant, 2)).toBeCloseTo(1 / 3, 10);
    expect(recallAtK(ranked, relevant, 5)).toBeCloseTo(2 / 3, 10);
    expect(recallAtK(ranked, new Set(), 5)).toBe(0);
  });

  it('computes reciprocal rank and MRR', () => {
    expect(firstRelevantRank(ranked, relevant)).toBe(2);
    expect(reciprocalRank(ranked, relevant)).toBe(0.5);
    expect(reciprocalRank(ranked, new Set(['zz']))).toBe(0);
    expect(reciprocalRank(ranked, relevant, 1)).toBe(0);
    expect(
      meanReciprocalRank([
        { ranked, relevant },
        { ranked: ['x', 'y', 'd9'], relevant },
        { ranked: ['q'], relevant },
      ]),
    ).toBeCloseTo((0.5 + 1 / 3 + 0) / 3, 10);
  });

  it('rejects invalid K and averages empty lists to zero', () => {
    expect(() => precisionAtK(ranked, relevant, 0)).toThrow(RangeError);
    expect(mean([])).toBe(0);
  });
});

describe('evaluation run', () => {
  const store = new MemoryIndexStore(buildIndex(CORPUS));
  const known = new Set(CORPUS.map((d) => d.id));
  const inCatalogue = async (ids: string[]) => new Set(ids.filter((id) => known.has(id)));
  const describe_ = async (ids: string[]) => new Map(ids.map((id) => [id, { title: `Title ${id}`, author: null }]));

  it('scores both modes on the same queries and skips queries without relevant books', async () => {
    const run = await runEvaluation(
      store,
      {
        mrrDepth: 100,
        queries: [
          { id: 'q1', query: 'harry potter', informationNeed: 'HP novels', relevant: ['A1', 'A2', 'MISSING'] },
          { id: 'q2', query: 'python', informationNeed: 'Python programming', relevant: ['C1', 'C2'] },
          { id: 'q3', query: 'anything', informationNeed: 'none imported', relevant: ['NOT-HERE'] },
        ],
      },
      2,
      inCatalogue,
      describe_,
    );
    expect(run.queriesEvaluated).toBe(2);
    const q1 = run.queries[0]!;
    expect(q1.relevantJudged).toBe(3);
    expect(q1.relevantInCatalogue).toBe(2);
    expect(q1.metrics.ranked.precisionAtK).toBe(1);
    expect(q1.metrics.ranked.recallAtK).toBe(1);
    expect(q1.metrics.ranked.reciprocalRank).toBe(1);
    expect(run.queries[2]!.skipped).toBe(true);
    expect(run.summary.ranked.meanPrecisionAtK).toBe(mean(run.queries.filter((q) => !q.skipped).map((q) => q.metrics.ranked.precisionAtK)));
    expect(q1.topResults.ranked[0]).toMatchObject({ title: 'Title A1', relevant: true });
  });
});

describe('evaluation dataset file', () => {
  const data = dataset as EvaluationDataset;
  it('is well formed', () => {
    expect(data.queries.length).toBeGreaterThanOrEqual(10);
    const ids = new Set<string>();
    for (const query of data.queries) {
      expect(ids.has(query.id)).toBe(false);
      ids.add(query.id);
      expect(query.query.trim()).not.toBe('');
      expect(query.informationNeed.trim()).not.toBe('');
      expect(query.relevant.length).toBeGreaterThan(0);
      expect(new Set(query.relevant).size).toBe(query.relevant.length);
      for (const id of query.relevant) expect(id).toMatch(/^[0-9X]+$/);
    }
    expect(data.judgmentNote).toMatch(/manually/);
  });
});
