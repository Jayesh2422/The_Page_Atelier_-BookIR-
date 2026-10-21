/**
 * Rank-based evaluation metrics for a single query.
 *
 *   Precision@K = |relevant ∩ top-K| / K
 *   Recall@K    = |relevant ∩ top-K| / |relevant|
 *   RR          = 1 / rank of the first relevant result (0 if none within the depth)
 *   MRR         = mean of RR over all evaluated queries
 *
 * Precision@K divides by K even when fewer than K results are returned: an engine that
 * returns nothing for a slot gains nothing for it.
 */

export function precisionAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  if (k <= 0) throw new RangeError('k must be a positive integer');
  let hits = 0;
  for (const id of ranked.slice(0, k)) if (relevant.has(id)) hits++;
  return hits / k;
}

export function recallAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  if (k <= 0) throw new RangeError('k must be a positive integer');
  if (relevant.size === 0) return 0;
  let hits = 0;
  for (const id of ranked.slice(0, k)) if (relevant.has(id)) hits++;
  return hits / relevant.size;
}

/** 1-based rank of the first relevant document within `depth`, or null. */
export function firstRelevantRank(ranked: readonly string[], relevant: ReadonlySet<string>, depth = Infinity): number | null {
  const limit = Math.min(ranked.length, depth);
  for (let i = 0; i < limit; i++) if (relevant.has(ranked[i]!)) return i + 1;
  return null;
}

export function reciprocalRank(ranked: readonly string[], relevant: ReadonlySet<string>, depth = Infinity): number {
  const rank = firstRelevantRank(ranked, relevant, depth);
  return rank === null ? 0 : 1 / rank;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function meanReciprocalRank(rankings: readonly { ranked: readonly string[]; relevant: ReadonlySet<string> }[], depth = Infinity): number {
  return mean(rankings.map(({ ranked, relevant }) => reciprocalRank(ranked, relevant, depth)));
}
