/**
 * Reproducible evaluation run: every configured query is executed against the current
 * index in both modes (same candidates, different ranking) and scored against the
 * manually prepared relevance judgments.
 */
import { retrieveBoth } from '../ir/engine.js';
import type { IndexStore } from '../ir/store.js';
import type { EvaluationQueryResult, MetricSummary, QueryMetrics, SearchMode } from '../types.js';
import { firstRelevantRank, mean, precisionAtK, recallAtK } from './metrics.js';

export interface EvaluationQuery {
  id: string;
  query: string;
  informationNeed: string;
  /** Catalogue ids (normalised ISBNs) judged relevant. */
  relevant: string[];
  notes?: string;
}

export interface EvaluationDataset {
  name: string;
  version: number;
  judgmentNote: string;
  k: number;
  mrrDepth: number;
  queries: EvaluationQuery[];
}

export const MODES: SearchMode[] = ['keyword', 'ranked'];
export const TOP_RESULTS_SHOWN = 5;

export interface EvaluationRun {
  queries: EvaluationQueryResult[];
  summary: Record<SearchMode, MetricSummary>;
  queriesEvaluated: number;
}

function scoreRanking(ranked: string[], relevant: Set<string>, k: number, mrrDepth: number): QueryMetrics {
  const first = firstRelevantRank(ranked, relevant, mrrDepth);
  return {
    precisionAtK: precisionAtK(ranked, relevant, k),
    recallAtK: recallAtK(ranked, relevant, k),
    reciprocalRank: first === null ? 0 : 1 / first,
    firstRelevantRank: first,
    retrieved: ranked.length,
  };
}

/**
 * @param inCatalogue  returns the subset of ids that exist in the catalogue. Judged documents
 *                     that were not imported cannot be retrieved, so they are excluded from
 *                     the recall denominator (and reported); queries left with no relevant
 *                     documents are skipped.
 * @param describe     looks up titles/authors for the example result lists.
 */
export async function runEvaluation(
  store: IndexStore,
  dataset: Pick<EvaluationDataset, 'queries' | 'mrrDepth'>,
  k: number,
  inCatalogue: (ids: string[]) => Promise<Set<string>>,
  describe: (ids: string[]) => Promise<Map<string, { title: string; author: string | null }>>,
): Promise<EvaluationRun> {
  const allJudged = [...new Set(dataset.queries.flatMap((q) => q.relevant))];
  const present = await inCatalogue(allJudged);
  const depth = Math.max(k, dataset.mrrDepth);

  const partial: { result: Omit<EvaluationQueryResult, 'topResults'>; tops: Record<SearchMode, string[]>; relevant: Set<string> }[] = [];
  for (const query of dataset.queries) {
    const relevant = new Set(query.relevant.filter((id) => present.has(id)));
    const { ranked, keyword } = await retrieveBoth(store, query.query);
    const lists: Record<SearchMode, string[]> = {
      ranked: ranked.slice(0, depth).map((c) => c.id),
      keyword: keyword.slice(0, depth).map((c) => c.id),
    };
    partial.push({
      relevant,
      tops: { ranked: lists.ranked.slice(0, TOP_RESULTS_SHOWN), keyword: lists.keyword.slice(0, TOP_RESULTS_SHOWN) },
      result: {
        id: query.id,
        query: query.query,
        informationNeed: query.informationNeed,
        relevantJudged: query.relevant.length,
        relevantInCatalogue: relevant.size,
        skipped: relevant.size === 0,
        metrics: {
          ranked: scoreRanking(lists.ranked, relevant, k, dataset.mrrDepth),
          keyword: scoreRanking(lists.keyword, relevant, k, dataset.mrrDepth),
        },
      },
    });
  }

  const descriptions = await describe([...new Set(partial.flatMap((p) => [...p.tops.ranked, ...p.tops.keyword]))]);
  const queries: EvaluationQueryResult[] = partial.map(({ result, tops, relevant }) => ({
    ...result,
    topResults: Object.fromEntries(
      MODES.map((mode) => [
        mode,
        tops[mode].map((id) => ({
          id,
          title: descriptions.get(id)?.title ?? id,
          author: descriptions.get(id)?.author ?? null,
          relevant: relevant.has(id),
        })),
      ]),
    ) as EvaluationQueryResult['topResults'],
  }));

  const evaluated = queries.filter((q) => !q.skipped);
  const summary = Object.fromEntries(
    MODES.map((mode) => [
      mode,
      {
        meanPrecisionAtK: mean(evaluated.map((q) => q.metrics[mode].precisionAtK)),
        meanRecallAtK: mean(evaluated.map((q) => q.metrics[mode].recallAtK)),
        mrr: mean(evaluated.map((q) => q.metrics[mode].reciprocalRank)),
      },
    ]),
  ) as Record<SearchMode, MetricSummary>;

  return { queries, summary, queriesEvaluated: evaluated.length };
}
