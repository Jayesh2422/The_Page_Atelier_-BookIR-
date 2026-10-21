/**
 * Spelling correction over the indexed vocabulary (isolated-term correction).
 *
 * 1. Vocabulary: every term in the inverted index, with its document frequency (df).
 *    Because the vocabulary is built from the catalogue itself, corrections always point to
 *    words that actually occur in some book record.
 * 2. Which query terms are corrected:
 *      - unseen terms (df = 0), and
 *      - very rare terms (df ≤ RARE_TERM_DF) when a close candidate is at least
 *        RARE_TERM_RATIO times more frequent (catches typos that also occur as typos in the data).
 *    Terms shorter than MIN_CORRECTABLE_LENGTH are never corrected.
 * 3. Candidate generation with a character trigram (k-gram) index: the term is padded as
 *    "$term$" and split into trigrams. By the q-gram lemma, two strings within edit distance k
 *    share at least |G(q)| − 3k trigrams, so vocabulary terms sharing fewer can be skipped
 *    without missing any valid correction.
 * 4. Candidates are verified with the edit distance — Levenshtein (insert, delete,
 *    substitute, each cost 1) extended with adjacent transpositions (Damerau, optimal string
 *    alignment) — and kept only if the distance is within the length-dependent threshold:
 *        length 4–5 → at most 1 edit,   length ≥ 6 → at most 2 edits.
 *    A transposition can destroy up to 4 trigrams, so the candidate filter in step 3 uses
 *    4 trigrams per edit to stay lossless.
 * 5. Ranking: smaller edit distance first, then higher df, then alphabetical. The query
 *    engine refines ties using co-occurrence with the other query terms (engine.ts).
 */

export const MIN_CORRECTABLE_LENGTH = 4;
export const RARE_TERM_DF = 2;
export const RARE_TERM_RATIO = 20;
export const MAX_CANDIDATES_PER_TERM = 3;
export const MAX_SUGGESTIONS = 3;

export function maxEditDistance(length: number): number {
  if (length < MIN_CORRECTABLE_LENGTH) return 0;
  if (length <= 5) return 1;
  return 2;
}

/**
 * Levenshtein distance with a two-row dynamic programme. When `limit` is given the function
 * stops early and returns `limit + 1` once every cell of a row exceeds the limit.
 */
export function levenshtein(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return limit + 1;
    [previous, current] = [current, previous];
  }
  return previous[b.length]!;
}

/**
 * Damerau–Levenshtein distance in its "optimal string alignment" form: Levenshtein plus the
 * transposition of two adjacent characters at cost 1 ("tolkein" → "tolkien" is 1 edit, not 2).
 * Transpositions are among the most common typing errors, so this is the distance used to
 * verify spelling candidates.
 */
export function damerauLevenshtein(a: string, b: string, limit = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let beforePrevious = new Array<number>(b.length + 1).fill(0);
  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      if (i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        value = Math.min(value, beforePrevious[j - 2]! + 1);
      }
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return limit + 1;
    [beforePrevious, previous, current] = [previous, current, beforePrevious];
  }
  return previous[b.length]!;
}

/** Padded character trigrams, e.g. "poter" → $po, pot, ote, ter, er$. */
export function trigrams(term: string): string[] {
  const padded = `$${term}$`;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) grams.add(padded.slice(i, i + 3));
  return [...grams];
}

/**
 * Minimum number of shared trigrams required for a candidate within `maxDistance` edits.
 * An insertion, deletion or substitution changes at most 3 padded trigrams and an adjacent
 * transposition at most 4, so 4 per edit is a safe (lossless) lower bound.
 */
export function minSharedTrigrams(term: string, maxDistance: number): number {
  return Math.max(1, trigrams(term).length - 4 * maxDistance);
}

export interface VocabularyTerm {
  term: string;
  df: number;
}

export interface RankedCandidate extends VocabularyTerm {
  distance: number;
}

/** Verify candidates with edit distance and rank them. */
export function rankCandidates(
  term: string,
  candidates: readonly VocabularyTerm[],
  maxDistance = maxEditDistance(term.length),
): RankedCandidate[] {
  if (maxDistance === 0) return [];
  const ranked: RankedCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.term === term || seen.has(candidate.term)) continue;
    seen.add(candidate.term);
    // Do not "correct" a word into a much shorter word (avoids "poter" → "po").
    if (candidate.term.length < MIN_CORRECTABLE_LENGTH - 1) continue;
    const distance = damerauLevenshtein(term, candidate.term, maxDistance);
    if (distance <= maxDistance) ranked.push({ ...candidate, distance });
  }
  ranked.sort((a, b) => a.distance - b.distance || b.df - a.df || (a.term < b.term ? -1 : 1));
  return ranked;
}

/** Decide whether a query term needs correction, given its df and its ranked candidates. */
export function needsCorrection(df: number, candidates: readonly RankedCandidate[]): boolean {
  if (candidates.length === 0) return false;
  if (df === 0) return true;
  if (df > RARE_TERM_DF) return false;
  return candidates[0]!.df >= df * RARE_TERM_RATIO;
}

export interface TermCorrection {
  term: string;
  candidates: RankedCandidate[];
}

/**
 * Combine per-term corrections into whole-query suggestions. The first suggestion uses the
 * best candidate for every corrected term; further suggestions swap in the runner-up
 * candidates of the first corrected term that has alternatives.
 */
export function buildSuggestions(
  originalQuery: string,
  corrections: readonly TermCorrection[],
): { query: string; corrections: { from: string; to: string; distance: number }[] }[] {
  const usable = corrections.filter((c) => c.candidates.length > 0);
  if (usable.length === 0) return [];

  const variants: Map<string, RankedCandidate>[] = [];
  const best = new Map(usable.map((c) => [c.term, c.candidates[0]!] as const));
  variants.push(best);
  const pivot = usable.find((c) => c.candidates.length > 1);
  if (pivot) {
    for (const alternative of pivot.candidates.slice(1, MAX_SUGGESTIONS)) {
      const variant = new Map(best);
      variant.set(pivot.term, alternative);
      variants.push(variant);
    }
  }

  return variants.slice(0, MAX_SUGGESTIONS).map((variant) => ({
    query: applyCorrections(originalQuery, variant),
    corrections: [...variant].map(([from, candidate]) => ({ from, to: candidate.term, distance: candidate.distance })),
  }));
}

/**
 * Rewrite the user's original query, replacing only the words whose normalised form was
 * corrected, so capitalisation and the other words are preserved ("Harry Poter" →
 * "Harry Potter").
 */
export function applyCorrections(originalQuery: string, replacements: ReadonlyMap<string, { term: string }>): string {
  return originalQuery
    .split(/(\s+)/)
    .map((piece) => {
      const key = piece
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '');
      const replacement = replacements.get(key);
      if (!replacement) return piece;
      const leading = piece.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? '';
      const trailing = piece.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? '';
      const core = piece.slice(leading.length, piece.length - trailing.length);
      const capitalised = /^\p{Lu}/u.test(core)
        ? replacement.term.charAt(0).toUpperCase() + replacement.term.slice(1)
        : replacement.term;
      return leading + capitalised + trailing;
    })
    .join('')
    .trim();
}
