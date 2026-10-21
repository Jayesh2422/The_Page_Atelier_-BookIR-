import { describe, expect, it } from 'vitest';
import {
  applyCorrections,
  buildSuggestions,
  damerauLevenshtein,
  levenshtein,
  maxEditDistance,
  minSharedTrigrams,
  needsCorrection,
  rankCandidates,
  trigrams,
} from '../../lib/ir/spelling.js';

describe('edit distance', () => {
  it('computes Levenshtein distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('poter', 'potter')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
    expect(levenshtein('tolkein', 'tolkien')).toBe(2);
  });

  it('counts an adjacent transposition as one edit in the Damerau variant', () => {
    expect(damerauLevenshtein('tolkein', 'tolkien')).toBe(1);
    expect(damerauLevenshtein('rigns', 'rings')).toBe(1);
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3);
  });

  it('stops early once the limit is exceeded', () => {
    expect(levenshtein('abcdef', 'uvwxyz', 2)).toBe(3);
    expect(damerauLevenshtein('abcdef', 'uvwxyz', 1)).toBe(2);
    expect(levenshtein('a', 'abcdefgh', 2)).toBe(3);
  });
});

describe('thresholds and candidate generation', () => {
  it('never corrects very short words and allows more edits for long words', () => {
    expect(maxEditDistance(3)).toBe(0);
    expect(maxEditDistance(4)).toBe(1);
    expect(maxEditDistance(5)).toBe(1);
    expect(maxEditDistance(6)).toBe(2);
    expect(maxEditDistance(12)).toBe(2);
  });

  it('builds padded character trigrams', () => {
    expect(trigrams('poter')).toEqual(['$po', 'pot', 'ote', 'ter', 'er$']);
  });

  it('uses a lossless shared-trigram lower bound', () => {
    expect(minSharedTrigrams('poter', 1)).toBe(1);
    // every word within one edit of "poter" must pass the filter
    for (const neighbour of ['potter', 'peter', 'poker', 'oter', 'pteor']) {
      const shared = trigrams('poter').filter((g) => trigrams(neighbour).includes(g)).length;
      if (damerauLevenshtein('poter', neighbour) <= 1) expect(shared).toBeGreaterThanOrEqual(minSharedTrigrams('poter', 1));
    }
  });

  it('ranks candidates by distance, then document frequency', () => {
    const ranked = rankCandidates('poter', [
      { term: 'potter', df: 90 },
      { term: 'peter', df: 400 },
      { term: 'poster', df: 30 },
      { term: 'pottery', df: 500 },
      { term: 'poter', df: 1 },
    ]);
    expect(ranked.map((c) => c.term)).toEqual(['peter', 'potter', 'poster']);
    expect(ranked.every((c) => c.distance === 1)).toBe(true);
  });

  it('decides when a term needs correcting', () => {
    const candidates = [{ term: 'potter', df: 100, distance: 1 }];
    expect(needsCorrection(0, candidates)).toBe(true);
    expect(needsCorrection(1, candidates)).toBe(true); // rare and a far more frequent neighbour
    expect(needsCorrection(50, candidates)).toBe(false);
    expect(needsCorrection(0, [])).toBe(false);
  });
});

describe('query suggestions', () => {
  it('keeps the original casing and other words', () => {
    expect(applyCorrections('Harry Poter!', new Map([['poter', { term: 'potter' }]]))).toBe('Harry Potter!');
    expect(applyCorrections('harry poter', new Map([['poter', { term: 'potter' }]]))).toBe('harry potter');
  });

  it('builds a best suggestion plus alternatives', () => {
    const suggestions = buildSuggestions('Hary Poter', [
      { term: 'hary', candidates: [{ term: 'harry', df: 10, distance: 1 }] },
      { term: 'poter', candidates: [{ term: 'potter', df: 9, distance: 1 }, { term: 'peter', df: 5, distance: 1 }] },
    ]);
    expect(suggestions.map((s) => s.query)).toEqual(['Harry Potter', 'Harry Peter']);
    expect(suggestions[0]!.corrections).toHaveLength(2);
  });

  it('returns nothing when there is nothing to correct', () => {
    expect(buildSuggestions('fine', [])).toEqual([]);
  });
});
