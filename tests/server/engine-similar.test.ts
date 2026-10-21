import { describe, expect, it } from 'vitest';
import { analyzeQuery, retrieve, retrieveBoth, suggestSpelling } from '../../lib/ir/engine.js';
import { buildIndex } from '../../lib/ir/indexer.js';
import { MemoryIndexStore } from '../../lib/ir/memory-store.js';
import { explainSimilarity, findSimilar } from '../../lib/ir/similar.js';
import { buildQueryVector, cosineSimilarity, idf, tfWeight } from '../../lib/ir/vsm.js';
import { CORPUS } from '../fixtures/corpus.js';

const index = buildIndex(CORPUS);
const store = new MemoryIndexStore(index);

describe('ranked retrieval', () => {
  it('ranks documents by TF-IDF cosine similarity', async () => {
    const result = await retrieve(store, 'python programming', 'ranked');
    expect(result.candidates.map((c) => c.id)).toEqual(['C1', 'C2', 'D1']);
    const scores = result.candidates.map((c) => c.cosine);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(scores.every((s) => s > 0 && s <= 1 + 1e-9)).toBe(true);
  });

  it('agrees with a brute-force cosine computation', async () => {
    const { candidates } = await retrieve(store, 'harry potter', 'ranked');
    const dfs = new Map([...index.terms.values()].map((t) => [t.term, t.df]));
    const q = buildQueryVector(['harry', 'potter'], dfs, index.totalDocuments);
    for (const candidate of candidates) {
      const docVector = new Map(index.docs.get(candidate.id)!.terms.map((t) => [t.t, t.w]));
      expect(candidate.cosine).toBeCloseTo(cosineSimilarity(q.weights, docVector), 10);
    }
  });

  it('puts documents matching all query terms above partial matches', async () => {
    const { candidates } = await retrieve(store, 'harry potter', 'ranked');
    expect(candidates.slice(0, 2).map((c) => c.id).sort()).toEqual(['A1', 'A2']);
    expect(new Set(candidates.map((c) => c.id))).toEqual(new Set(['A1', 'A2', 'B1', 'F1']));
  });

  it('breaks score ties deterministically by id', async () => {
    const first = await retrieve(store, 'tolkien', 'ranked');
    const second = await retrieve(store, 'tolkien', 'ranked');
    expect(first.candidates.map((c) => c.id)).toEqual(second.candidates.map((c) => c.id));
    expect(first.candidates.map((c) => c.id)).toEqual(['E1', 'E2']);
  });

  it('records the matched terms and fields of each candidate', async () => {
    const { candidates } = await retrieve(store, 'harry potter', 'ranked');
    const b1 = candidates.find((c) => c.id === 'B1')!;
    expect(b1.terms).toEqual(['harry']);
    expect(b1.matchedTerms).toBe(1);
  });
});

describe('keyword baseline', () => {
  it('orders by number of matched terms, then by id', async () => {
    const { candidates } = await retrieve(store, 'harry potter', 'keyword');
    expect(candidates.map((c) => [c.id, c.matchedTerms])).toEqual([
      ['A1', 2],
      ['A2', 2],
      ['B1', 1],
      ['F1', 1],
    ]);
  });

  it('ranks exactly the same candidate set as the ranked mode', async () => {
    const { ranked, keyword } = await retrieveBoth(store, 'python lutz monty');
    expect(new Set(ranked.map((c) => c.id))).toEqual(new Set(keyword.map((c) => c.id)));
  });
});

describe('empty and unseen queries', () => {
  it('returns nothing for stop-word-only queries', async () => {
    const result = await retrieve(store, 'the of and', 'ranked');
    expect(result.terms).toEqual([]);
    expect(result.candidates).toEqual([]);
  });

  it('reports unseen terms and still uses the known ones', async () => {
    const result = await retrieve(store, 'python xylophone', 'ranked');
    expect(result.unseenTerms).toEqual(['xylophone']);
    expect(result.candidates.length).toBe(3);
  });

  it('returns no candidates when every term is unseen', async () => {
    const result = await retrieve(store, 'qwertyuiop', 'ranked');
    expect(result.candidates).toEqual([]);
    expect(result.unseenTerms).toEqual(['qwertyuiop']);
  });

  it('limits the number of query terms', () => {
    const many = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ');
    const { terms, ignored } = analyzeQuery(many);
    expect(terms).toHaveLength(12);
    expect(ignored).toHaveLength(8);
  });
});

describe('spelling suggestions through the engine', () => {
  it('suggests corrections from the indexed vocabulary', async () => {
    const suggestions = await suggestSpelling(store, 'Harry Poter');
    expect(suggestions[0]?.query).toBe('Harry Potter');
    expect(suggestions[0]?.corrections).toEqual([{ from: 'poter', to: 'potter', distance: 1 }]);
  });

  it('handles transpositions', async () => {
    const suggestions = await suggestSpelling(store, 'tolkein');
    expect(suggestions[0]?.query).toBe('tolkien');
  });

  it('does not suggest anything for correctly spelled queries', async () => {
    expect(await suggestSpelling(store, 'python programming')).toEqual([]);
  });
});

describe('similar-book retrieval', () => {
  it('excludes the source book and ranks by cosine similarity', async () => {
    const { candidates } = await findSimilar(store, index.docs.get('A1')!);
    expect(candidates.map((c) => c.id)).not.toContain('A1');
    expect(candidates[0]!.id).toBe('A2');
    const a1 = new Map(index.docs.get('A1')!.terms.map((t) => [t.t, t.w]));
    const a2 = new Map(index.docs.get('A2')!.terms.map((t) => [t.t, t.w]));
    expect(candidates[0]!.similarity).toBeCloseTo(cosineSimilarity(a1, a2), 10);
  });

  it('honours explicit exclusions (e.g. other editions)', async () => {
    const { candidates } = await findSimilar(store, index.docs.get('A1')!, { exclude: new Set(['A2']) });
    expect(candidates.map((c) => c.id)).not.toContain('A2');
  });

  it('works for books without descriptions', async () => {
    const { candidates } = await findSimilar(store, index.docs.get('E1')!);
    expect(candidates[0]!.id).toBe('E2');
  });

  it('explains similarity by shared fields', async () => {
    const { candidates } = await findSimilar(store, index.docs.get('A1')!);
    const reasons = explainSimilarity(candidates[0]!);
    expect(reasons.map((r) => r.kind)).toEqual(['author', 'title', 'publisher']);
    expect(reasons.find((r) => r.kind === 'title')!.terms).toEqual(expect.arrayContaining(['harry', 'potter']));
  });

  it('returns nothing for an empty vector', async () => {
    const result = await findSimilar(store, { id: 'X', length: 0, distinctTerms: 0, terms: [] });
    expect(result).toEqual({ candidates: [], termsUsed: 0 });
  });

  it('uses the same weighting as search', () => {
    const entry = index.terms.get('tolkien')!;
    expect(entry.idf).toBeCloseTo(idf(entry.df, index.totalDocuments), 12);
    expect(tfWeight(entry.postings[0]!.tf)).toBeGreaterThan(0);
  });
});
