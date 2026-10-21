/**
 * Vector Space Model: TF-IDF weighting and cosine similarity.
 *
 *   Sub-linear term frequency     tfw(t, d) = log2(1 + tf_w(t, d))
 *                                 (equals 1 for a single unweighted occurrence and grows
 *                                 logarithmically, so repeated words do not dominate)
 *   Smoothed inverse doc. freq.   idf(t)    = ln((1 + N) / (1 + df(t))) + 1
 *                                 (always ≥ 1, finite for every term; the "+1" terms act as
 *                                 if one extra document contained every term)
 *   Document weight               w(t, d)   = tfw(t, d) · idf(t)
 *   Query weight                  w(t, q)   = log2(1 + tf(t, q)) · idf(t)
 *   Cosine similarity             cos(q, d) = Σ_t w(t,q)·w(t,d) / (|q| · |d|)
 *
 * Document vectors are L2-normalised at index time, so postings store w(t,d)/|d| and the
 * query-time score is a sparse dot product divided by |q|.
 */

export function idf(documentFrequency: number, totalDocuments: number): number {
  if (totalDocuments <= 0) return 0;
  return Math.log((1 + totalDocuments) / (1 + Math.max(0, documentFrequency))) + 1;
}

export function tfWeight(termFrequency: number): number {
  return termFrequency > 0 ? Math.log2(1 + termFrequency) : 0;
}

export function vectorNorm(weights: Iterable<number>): number {
  let sum = 0;
  for (const w of weights) sum += w * w;
  return Math.sqrt(sum);
}

/** Normalise a sparse vector to unit length. A zero vector is returned unchanged. */
export function normalizeVector(vector: Map<string, number>): Map<string, number> {
  const norm = vectorNorm(vector.values());
  if (norm === 0) return new Map(vector);
  const result = new Map<string, number>();
  for (const [term, weight] of vector) result.set(term, weight / norm);
  return result;
}

/** Cosine similarity of two sparse vectors. Returns 0 if either vector has zero length. */
export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  const normA = vectorNorm(a.values());
  const normB = vectorNorm(b.values());
  if (normA === 0 || normB === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other !== undefined) dot += weight * other;
  }
  return dot / (normA * normB);
}

export interface QueryVector {
  /** Term → TF-IDF weight, only for terms present in the vocabulary. */
  weights: Map<string, number>;
  norm: number;
  /** Query terms absent from the vocabulary (they cannot match any document). */
  unseen: string[];
}

/**
 * Build the query vector. Unseen terms have no postings, so they are dropped from the
 * vector (and from |q|) and reported separately — the spelling corrector handles them.
 */
export function buildQueryVector(
  queryTerms: readonly string[],
  documentFrequencies: ReadonlyMap<string, number>,
  totalDocuments: number,
): QueryVector {
  const counts = new Map<string, number>();
  for (const term of queryTerms) counts.set(term, (counts.get(term) ?? 0) + 1);
  const weights = new Map<string, number>();
  const unseen: string[] = [];
  for (const [term, count] of counts) {
    const df = documentFrequencies.get(term) ?? 0;
    if (df === 0) {
      unseen.push(term);
      continue;
    }
    weights.set(term, tfWeight(count) * idf(df, totalDocuments));
  }
  return { weights, norm: vectorNorm(weights.values()), unseen };
}
