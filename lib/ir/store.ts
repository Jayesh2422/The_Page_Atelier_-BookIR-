import type { FieldName } from '../types.js';
import type { DocVector, Posting } from './indexer.js';
import type { VocabularyTerm } from './spelling.js';

export interface TermStats {
  term: string;
  df: number;
  idf: number;
}

export interface IndexInfo {
  version: string;
  totalDocuments: number;
  vocabularySize: number;
  postings: number;
  builtAt: string;
  fieldWeights: Record<FieldName, number>;
}

/**
 * Read access to a built inverted index. Implemented by the MongoDB store (production) and
 * by an in-memory store (tests, evaluation of a local corpus).
 */
export interface IndexStore {
  info(): Promise<IndexInfo | null>;
  termStats(terms: readonly string[]): Promise<Map<string, TermStats>>;
  /** Highest-impact postings for each term, at most `maxPerTerm` per term. */
  postings(terms: readonly string[], maxPerTerm: number): Promise<Map<string, Posting[]>>;
  docVector(id: string): Promise<DocVector | null>;
  /** Vocabulary terms that share at least `minShared` trigrams with `term`. */
  spellingCandidates(term: string, minShared: number, maxLengthDifference: number): Promise<VocabularyTerm[]>;
}
