import type { BuiltIndex, DocVector, Posting } from './indexer.js';
import { trigrams, type VocabularyTerm } from './spelling.js';
import type { IndexInfo, IndexStore, TermStats } from './store.js';

/** An IndexStore backed by a BuiltIndex held in memory (tests and offline tooling). */
export class MemoryIndexStore implements IndexStore {
  private readonly gramIndex = new Map<string, string[]>();
  private readonly builtAt = new Date().toISOString();

  constructor(private readonly index: BuiltIndex) {
    for (const term of index.terms.keys()) {
      for (const gram of trigrams(term)) {
        const list = this.gramIndex.get(gram) ?? [];
        list.push(term);
        this.gramIndex.set(gram, list);
      }
    }
  }

  async info(): Promise<IndexInfo | null> {
    return {
      version: 'memory',
      totalDocuments: this.index.totalDocuments,
      vocabularySize: this.index.terms.size,
      postings: this.index.stats.postings,
      builtAt: this.builtAt,
      fieldWeights: { ...this.index.config.fieldWeights },
    };
  }

  async termStats(terms: readonly string[]): Promise<Map<string, TermStats>> {
    const result = new Map<string, TermStats>();
    for (const term of terms) {
      const entry = this.index.terms.get(term);
      if (entry) result.set(term, { term, df: entry.df, idf: entry.idf });
    }
    return result;
  }

  async postings(terms: readonly string[], maxPerTerm: number): Promise<Map<string, Posting[]>> {
    const result = new Map<string, Posting[]>();
    for (const term of terms) {
      const entry = this.index.terms.get(term);
      if (entry) result.set(term, entry.postings.slice(0, maxPerTerm));
    }
    return result;
  }

  async docVector(id: string): Promise<DocVector | null> {
    return this.index.docs.get(id) ?? null;
  }

  async spellingCandidates(term: string, minShared: number, maxLengthDifference: number): Promise<VocabularyTerm[]> {
    const shared = new Map<string, number>();
    for (const gram of trigrams(term)) {
      for (const candidate of this.gramIndex.get(gram) ?? []) shared.set(candidate, (shared.get(candidate) ?? 0) + 1);
    }
    const result: VocabularyTerm[] = [];
    for (const [candidate, count] of shared) {
      if (count < minShared || Math.abs(candidate.length - term.length) > maxLengthDifference) continue;
      result.push({ term: candidate, df: this.index.terms.get(candidate)!.df });
    }
    return result;
  }
}
