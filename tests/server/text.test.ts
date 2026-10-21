import { describe, expect, it } from 'vitest';
import { decodeEntities, normalizeKey, normalizeText, STOP_WORDS, termFrequencies, tokenize } from '../../lib/ir/text.js';

describe('text normalisation and tokenisation', () => {
  it('lower-cases and splits on punctuation and whitespace', () => {
    expect(tokenize('Programming PYTHON: Web-Development, 2nd Edition!')).toEqual(['programming', 'python', 'web', 'development', '2nd', 'edition']);
  });

  it('removes diacritics with Unicode normalisation', () => {
    expect(tokenize('Gabriel García Márquez')).toEqual(['gabriel', 'garcia', 'marquez']);
    expect(tokenize('Der König in Gelb')).toContain('konig');
  });

  it('drops possessive s and inner apostrophes consistently', () => {
    expect(tokenize("Harry Potter and the Sorcerer's Stone")).toEqual(['harry', 'potter', 'sorcerer', 'stone']);
    expect(tokenize('O’Brien')).toEqual(['obrien']);
  });

  it('removes stop words and single letters but keeps numbers', () => {
    expect(tokenize('The Lord of the Rings')).toEqual(['lord', 'rings']);
    expect(tokenize('J. K. Rowling')).toEqual(['rowling']);
    expect(tokenize('1984 by George Orwell')).toEqual(['1984', 'george', 'orwell']);
    expect(tokenize('Book 4')).toEqual(['book', '4']);
  });

  it('keeps meaningful short words such as "it"', () => {
    expect(STOP_WORDS.has('it')).toBe(false);
    expect(tokenize('It')).toEqual(['it']);
  });

  it('returns no tokens for empty or stop-word-only input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize('the and of')).toEqual([]);
  });

  it('decodes the HTML entities found in Book-Crossing records', () => {
    expect(decodeEntities('Simon &amp; Schuster &#39;99 &#x41;')).toBe("Simon & Schuster '99 A");
    expect(tokenize('Henry Holt &amp; Company')).toEqual(['henry', 'holt', 'company']);
  });

  it('builds exact-match keys that keep every word', () => {
    expect(normalizeKey('J. K. Rowling')).toBe('j k rowling');
    expect(normalizeKey('  The  Hobbit ')).toBe('the hobbit');
    expect(normalizeText('ÉCOLE')).toBe('ecole');
  });

  it('counts term frequencies', () => {
    expect([...termFrequencies(['a', 'b', 'a'])]).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });
});
