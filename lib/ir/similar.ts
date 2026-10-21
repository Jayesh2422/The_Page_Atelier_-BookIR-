/**
 * Similar-book retrieval with the same Vector Space Model as the search engine.
 *
 * The selected book's stored, unit-length TF-IDF vector is used as the query. Its
 * `QUERY_LIMITS.similarTerms` highest-weighted terms are looked up in the inverted index and
 * the cosine similarity
 *      sim(s, d) = Σ_t ŵ(t, s) · ŵ(t, d)
 * is accumulated over those terms (ŵ are the normalised weights stored in the postings).
 * Restricting the source vector to its strongest terms is an approximation: it keeps the
 * number of postings read bounded and only drops terms with small weights.
 *
 * Similarity is purely textual — shared title words, authors, publishers, description and
 * category terms. It says nothing about whether a reader would enjoy the other book.
 */
import type { FieldName, SimilarReason } from '../types.js';
import { FIELD_BITS, QUERY_LIMITS } from './config.js';
import type { DocVector } from './indexer.js';
import type { IndexStore } from './store.js';

export interface SimilarCandidate {
  id: string;
  similarity: number;
  /** Shared terms with their contribution and the fields they appear in on both sides. */
  shared: { term: string; contribution: number; sourceMask: number; targetMask: number }[];
}

export async function findSimilar(
  store: IndexStore,
  source: DocVector,
  options: { limit?: number; terms?: number; postingsPerTerm?: number; exclude?: ReadonlySet<string> } = {},
): Promise<{ candidates: SimilarCandidate[]; termsUsed: number }> {
  const queryTerms = source.terms.slice(0, options.terms ?? QUERY_LIMITS.similarTerms);
  if (queryTerms.length === 0) return { candidates: [], termsUsed: 0 };

  const postings = await store.postings(
    queryTerms.map((t) => t.t),
    options.postingsPerTerm ?? QUERY_LIMITS.similarPostingsPerTerm,
  );
  const accumulators = new Map<string, SimilarCandidate>();
  for (const { t, w, m } of queryTerms) {
    for (const posting of postings.get(t) ?? []) {
      if (posting.d === source.id || options.exclude?.has(posting.d)) continue;
      let candidate = accumulators.get(posting.d);
      if (!candidate) {
        candidate = { id: posting.d, similarity: 0, shared: [] };
        accumulators.set(posting.d, candidate);
      }
      const contribution = w * posting.w;
      candidate.similarity += contribution;
      candidate.shared.push({ term: t, contribution, sourceMask: m, targetMask: posting.m });
    }
  }

  const candidates = [...accumulators.values()].sort(
    (a, b) => b.similarity - a.similarity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const candidate of candidates) candidate.shared.sort((a, b) => b.contribution - a.contribution);
  return { candidates: candidates.slice(0, options.limit ?? QUERY_LIMITS.maxSimilarResults), termsUsed: queryTerms.length };
}

const REASON_ORDER: { kind: SimilarReason['kind']; field: FieldName; label: string }[] = [
  { kind: 'author', field: 'author', label: 'Shared author' },
  { kind: 'title', field: 'title', label: 'Similar title terms' },
  { kind: 'categories', field: 'categories', label: 'Shared categories' },
  { kind: 'description', field: 'description', label: 'Overlapping description terms' },
  { kind: 'publisher', field: 'publisher', label: 'Same publisher terms' },
];

/**
 * Explain a similarity score: group the shared terms by a field that contains the term in
 * both books (author first, because a shared author name is the most specific signal).
 */
export function explainSimilarity(candidate: SimilarCandidate, maxTermsPerReason = 4): SimilarReason[] {
  const groups = new Map<SimilarReason['kind'], string[]>();
  for (const shared of candidate.shared) {
    const common = shared.sourceMask & shared.targetMask;
    const reason = REASON_ORDER.find((r) => (common & FIELD_BITS[r.field]) !== 0);
    if (!reason) continue;
    const list = groups.get(reason.kind) ?? [];
    if (!list.includes(shared.term)) list.push(shared.term);
    groups.set(reason.kind, list);
  }
  const reasons: SimilarReason[] = [];
  for (const { kind, label } of REASON_ORDER) {
    const terms = groups.get(kind);
    if (terms?.length) reasons.push({ kind, label, terms: terms.slice(0, maxTermsPerReason) });
  }
  if (reasons.length === 0 && candidate.shared.length > 0) {
    reasons.push({
      kind: 'description',
      label: 'Related textual metadata',
      terms: candidate.shared.slice(0, maxTermsPerReason).map((s) => s.term),
    });
  }
  return reasons;
}
