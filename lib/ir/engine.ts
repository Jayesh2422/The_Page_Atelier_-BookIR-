/**
 * Query processing over the inverted index.
 *
 * Candidate retrieval (shared by both modes): every document that appears in the postings
 * of at least one query term (Boolean OR). The two modes then rank the *same* candidates:
 *
 *  - keyword (baseline): coordination-level matching — documents are ordered by the number
 *    of distinct query terms they contain; documents matching the same number of terms are
 *    left in catalogue-id order, i.e. effectively unranked within a level.
 *  - ranked: TF-IDF cosine similarity between the query vector and each document vector,
 *    accumulated term-at-a-time from the postings. Ties fall back to the number of matched
 *    terms and then the catalogue id, so the order is deterministic.
 */
import type { FieldName, SearchMode, SpellingSuggestion } from '../types.js';
import { fieldsFromMask, QUERY_LIMITS } from './config.js';
import {
  buildSuggestions,
  maxEditDistance,
  MAX_CANDIDATES_PER_TERM,
  MIN_CORRECTABLE_LENGTH,
  minSharedTrigrams,
  needsCorrection,
  rankCandidates,
  type TermCorrection,
} from './spelling.js';
import type { IndexStore } from './store.js';
import { tokenize } from './text.js';
import { buildQueryVector } from './vsm.js';

export interface Candidate {
  id: string;
  cosine: number;
  matchedTerms: number;
  fieldMask: number;
  terms: string[];
}

export interface RankedRetrieval {
  terms: string[];
  /** Query terms ignored because the query exceeded the maximum term count. */
  ignoredTerms: string[];
  unseenTerms: string[];
  /** Candidates ordered according to `mode`. */
  candidates: Candidate[];
  totalCandidates: number;
}

export function compareRanked(a: Candidate, b: Candidate): number {
  return b.cosine - a.cosine || b.matchedTerms - a.matchedTerms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function compareKeyword(a: Candidate, b: Candidate): number {
  return b.matchedTerms - a.matchedTerms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function analyzeQuery(query: string): { terms: string[]; ignored: string[] } {
  const unique = [...new Set(tokenize(query))];
  return { terms: unique.slice(0, QUERY_LIMITS.maxQueryTerms), ignored: unique.slice(QUERY_LIMITS.maxQueryTerms) };
}

/** Retrieve candidates once and return them ranked for both modes. */
export async function retrieveBoth(
  store: IndexStore,
  query: string,
  options: { maxPostingsPerTerm?: number } = {},
): Promise<{ base: Omit<RankedRetrieval, 'candidates'>; ranked: Candidate[]; keyword: Candidate[] }> {
  const { terms, ignored } = analyzeQuery(query);
  const info = await store.info();
  if (!info || terms.length === 0) {
    return { base: { terms, ignoredTerms: ignored, unseenTerms: [], totalCandidates: 0 }, ranked: [], keyword: [] };
  }

  const stats = await store.termStats(terms);
  const dfs = new Map([...stats.values()].map((s) => [s.term, s.df]));
  const queryVector = buildQueryVector(terms, dfs, info.totalDocuments);
  const knownTerms = [...queryVector.weights.keys()];
  const postings = await store.postings(knownTerms, options.maxPostingsPerTerm ?? QUERY_LIMITS.maxPostingsPerTerm);

  const accumulators = new Map<string, Candidate>();
  for (const term of knownTerms) {
    const queryWeight = queryVector.weights.get(term)!;
    for (const posting of postings.get(term) ?? []) {
      let candidate = accumulators.get(posting.d);
      if (!candidate) {
        candidate = { id: posting.d, cosine: 0, matchedTerms: 0, fieldMask: 0, terms: [] };
        accumulators.set(posting.d, candidate);
      }
      candidate.cosine += queryWeight * posting.w;
      candidate.matchedTerms += 1;
      candidate.fieldMask |= posting.m;
      candidate.terms.push(term);
    }
  }

  const all = [...accumulators.values()];
  if (queryVector.norm > 0) for (const candidate of all) candidate.cosine /= queryVector.norm;

  const ranked = [...all].sort(compareRanked);
  const keyword = [...all].sort(compareKeyword);
  return {
    base: { terms, ignoredTerms: ignored, unseenTerms: queryVector.unseen, totalCandidates: all.length },
    ranked,
    keyword,
  };
}

export async function retrieve(store: IndexStore, query: string, mode: SearchMode): Promise<RankedRetrieval> {
  const { base, ranked, keyword } = await retrieveBoth(store, query);
  return { ...base, candidates: mode === 'ranked' ? ranked : keyword };
}

export function candidateFields(candidate: Candidate): FieldName[] {
  return fieldsFromMask(candidate.fieldMask);
}

/** Candidates per corrected term that are re-ranked by context (bounded postings reads). */
const CONTEXT_CANDIDATES = 6;
const CONTEXT_POSTINGS = 5000;

/**
 * Spelling suggestions for a query, using the vocabulary held by the index store.
 *
 * Context-sensitive step (IIR §3.3.5): when the query has other, correctly spelled terms,
 * candidates at the same edit distance are re-ranked by how many books contain both the
 * candidate and at least one of those terms. "harry poter" therefore prefers "potter"
 * (co-occurs with "harry" in many records) over the more frequent but unrelated "peter".
 */
export async function suggestSpelling(store: IndexStore, query: string): Promise<SpellingSuggestion[]> {
  const { terms } = analyzeQuery(query);
  const correctable = terms.filter((t) => t.length >= MIN_CORRECTABLE_LENGTH && !/^\d+$/.test(t));
  if (correctable.length === 0) return [];
  const stats = await store.termStats(terms);

  const corrections: TermCorrection[] = [];
  for (const term of correctable) {
    const df = stats.get(term)?.df ?? 0;
    const maxDistance = maxEditDistance(term.length);
    const raw = await store.spellingCandidates(term, minSharedTrigrams(term, maxDistance), maxDistance);
    const candidates = rankCandidates(term, raw, maxDistance);
    if (needsCorrection(df, candidates)) corrections.push({ term, candidates: candidates.slice(0, CONTEXT_CANDIDATES) });
  }
  if (corrections.length === 0) return [];

  const corrected = new Set(corrections.map((c) => c.term));
  const contextTerms = terms.filter((t) => !corrected.has(t) && (stats.get(t)?.df ?? 0) > 0);
  if (contextTerms.length > 0) {
    const candidateTerms = [...new Set(corrections.flatMap((c) => c.candidates.map((x) => x.term)))];
    const postings = await store.postings([...contextTerms, ...candidateTerms], CONTEXT_POSTINGS);
    const contextDocs = new Set(contextTerms.flatMap((t) => (postings.get(t) ?? []).map((p) => p.d)));
    const cooccurrence = new Map(
      candidateTerms.map((t) => [t, (postings.get(t) ?? []).reduce((n, p) => n + (contextDocs.has(p.d) ? 1 : 0), 0)]),
    );
    for (const correction of corrections) {
      correction.candidates.sort(
        (a, b) => a.distance - b.distance || cooccurrence.get(b.term)! - cooccurrence.get(a.term)! || b.df - a.df || (a.term < b.term ? -1 : 1),
      );
    }
  }
  for (const correction of corrections) correction.candidates = correction.candidates.slice(0, MAX_CANDIDATES_PER_TERM);
  return buildSuggestions(query, corrections);
}
