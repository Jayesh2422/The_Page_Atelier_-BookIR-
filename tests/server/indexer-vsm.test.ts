import { describe, expect, it } from 'vitest';
import { DEFAULT_INDEX_CONFIG, FIELD_BITS, fieldsFromMask } from '../../lib/ir/config.js';
import { analyzeDocument, buildIndex } from '../../lib/ir/indexer.js';
import { buildQueryVector, cosineSimilarity, idf, normalizeVector, tfWeight, vectorNorm } from '../../lib/ir/vsm.js';
import { CORPUS } from '../fixtures/corpus.js';

const index = buildIndex(CORPUS);

describe('inverted index construction', () => {
  it('counts indexed documents and skips documents without terms', () => {
    expect(index.totalDocuments).toBe(9);
    expect(index.stats.skippedEmpty).toBe(1);
  });

  it('maps each term to the documents that contain it', () => {
    const potter = index.terms.get('potter')!;
    expect(potter.df).toBe(3);
    expect(potter.postings.map((p) => p.d).sort()).toEqual(['A1', 'A2', 'F1']);
    expect(index.terms.get('python')!.df).toBe(3);
    expect(index.terms.get('the')).toBeUndefined();
  });

  it('records field-weighted term frequency and the fields containing the term', () => {
    const harryInB1 = index.terms.get('harry')!.postings.find((p) => p.d === 'B1')!;
    expect(harryInB1.tf).toBe(DEFAULT_INDEX_CONFIG.fieldWeights.author);
    expect(fieldsFromMask(harryInB1.m)).toEqual(['author']);
    const pythonInC1 = index.terms.get('python')!.postings.find((p) => p.d === 'C1')!;
    // once in the title and once in the description
    const w = DEFAULT_INDEX_CONFIG.fieldWeights;
    expect(pythonInC1.tf).toBeCloseTo(w.title + w.description, 10);
    expect(pythonInC1.m).toBe(FIELD_BITS.title | FIELD_BITS.description);
  });

  it('orders postings by weight (impact order) with a stable tie-break', () => {
    for (const entry of index.terms.values()) {
      for (let i = 1; i < entry.postings.length; i++) {
        const [a, b] = [entry.postings[i - 1]!, entry.postings[i]!];
        expect(a.w > b.w || (a.w === b.w && a.d < b.d)).toBe(true);
      }
    }
  });

  it('stores unit-length document vectors', () => {
    for (const doc of index.docs.values()) {
      expect(vectorNorm(doc.terms.map((t) => t.w))).toBeCloseTo(1, 6);
    }
  });

  it('rejects duplicate ids and negative field weights', () => {
    expect(() => buildIndex([CORPUS[0]!, CORPUS[0]!])).toThrow(/Duplicate/);
    expect(() => buildIndex(CORPUS, { ...DEFAULT_INDEX_CONFIG, fieldWeights: { ...DEFAULT_INDEX_CONFIG.fieldWeights, title: -1 } })).toThrow(/non-negative/);
  });

  it('ignores fields whose weight is zero', () => {
    const { counts } = analyzeDocument(CORPUS[0]!, { ...DEFAULT_INDEX_CONFIG.fieldWeights, publisher: 0 });
    expect(counts.has('scholastic')).toBe(false);
  });
});

describe('TF-IDF weighting', () => {
  it('uses smoothed idf that is always ≥ 1 and decreases with df', () => {
    expect(idf(1, 100)).toBeCloseTo(Math.log(101 / 2) + 1, 10);
    expect(idf(100, 100)).toBeCloseTo(1, 10);
    expect(idf(1, 100)).toBeGreaterThan(idf(10, 100));
    expect(idf(0, 0)).toBe(0);
  });

  it('uses sub-linear term frequency', () => {
    expect(tfWeight(0)).toBe(0);
    expect(tfWeight(1)).toBe(1);
    expect(tfWeight(3)).toBe(2);
    expect(tfWeight(7)).toBe(3);
  });

  it('stores w(t,d)/|d| in the postings', () => {
    const doc = index.docs.get('E2')!;
    const raw = doc.terms.map((t) => tfWeight(index.terms.get(t.t)!.postings.find((p) => p.d === 'E2')!.tf) * index.terms.get(t.t)!.idf);
    const norm = vectorNorm(raw);
    doc.terms.forEach((t, i) => expect(t.w).toBeCloseTo(raw[i]! / norm, 10));
  });
});

describe('cosine similarity', () => {
  it('is 1 for identical direction, 0 for disjoint vectors and 0 for zero vectors', () => {
    const a = new Map([['x', 1], ['y', 2]]);
    expect(cosineSimilarity(a, new Map([['x', 2], ['y', 4]]))).toBeCloseTo(1, 10);
    expect(cosineSimilarity(a, new Map([['z', 3]]))).toBe(0);
    expect(cosineSimilarity(a, new Map())).toBe(0);
  });

  it('matches the textbook formula', () => {
    const a = new Map([['x', 1], ['y', 0], ['z', 1]]);
    const b = new Map([['x', 1], ['y', 1]]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1 / (Math.SQRT2 * Math.SQRT2), 10);
  });

  it('normalises vectors to unit length', () => {
    expect(vectorNorm(normalizeVector(new Map([['a', 3], ['b', 4]])).values())).toBeCloseTo(1, 10);
  });

  it('drops unseen terms from the query vector and reports them', () => {
    const dfs = new Map([['python', 3]]);
    const q = buildQueryVector(['python', 'zzzz', 'python'], dfs, 9);
    expect([...q.weights.keys()]).toEqual(['python']);
    expect(q.weights.get('python')).toBeCloseTo(tfWeight(2) * idf(3, 9), 10);
    expect(q.unseen).toEqual(['zzzz']);
    expect(buildQueryVector(['zzzz'], dfs, 9).norm).toBe(0);
  });
});
