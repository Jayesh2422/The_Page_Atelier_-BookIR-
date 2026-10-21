import { describe, expect, it, vi } from 'vitest';
import {
  authorMatches,
  fetchVolumes,
  GoogleBooksError,
  htmlToText,
  parseVolumesResponse,
  selectMatch,
  titleAuthorQuery,
  titleSimilarity,
  type GoogleVolume,
} from '../../lib/metadata/google-books.js';

const volume = (id: string, info: GoogleVolume['volumeInfo']): GoogleVolume => ({ id, volumeInfo: info });
const book = { isbn: '0439139597', isbnValid: true, title: 'Harry Potter and the Goblet of Fire (Book 4)', author: 'J. K. Rowling' };

describe('Google Books matching', () => {
  it('accepts an ISBN match only when the identifiers contain the ISBN', () => {
    const match = selectMatch(book, [volume('v1', { title: 'Something else', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780439139595' }], description: '<p>A <b>great</b> book.</p>' })], null);
    expect(match.status).toBe('matched');
    if (match.status !== 'matched') return;
    expect(match.metadata).toMatchObject({ volumeId: 'v1', matchedBy: 'isbn', confidence: 1, description: 'A great book.' });
  });

  it('rejects ISBN search results that do not contain the ISBN', () => {
    const match = selectMatch(book, [volume('v2', { title: 'Harry Potter', industryIdentifiers: [{ type: 'ISBN_10', identifier: '0000000000' }] })], null);
    expect(match.status).toBe('rejected');
  });

  it('accepts a title/author fallback only when both title and author agree', () => {
    const good = volume('v3', { title: 'Harry Potter and the Goblet of Fire', authors: ['J.K. Rowling'] });
    const wrongAuthor = volume('v4', { title: 'Harry Potter and the Goblet of Fire', authors: ['Somebody Else'] });
    const wrongTitle = volume('v5', { title: 'The Ultimate Unofficial Guide to Harry Potter', authors: ['J.K. Rowling'] });
    expect(selectMatch(book, [], [wrongAuthor, wrongTitle]).status).toBe('rejected');
    const match = selectMatch(book, [], [wrongTitle, good]);
    expect(match.status === 'matched' && match.metadata.volumeId).toBe('v3');
    expect(match.status === 'matched' && match.metadata.matchedBy).toBe('title-author');
  });

  it('confirms an ISBN from the plain-text search results', () => {
    const other = volume('o', { title: 'Harry Potter Trivia', authors: ['Someone'] });
    const right = volume('r', { title: 'Goblet of Fire', authors: ['J.K. Rowling'], industryIdentifiers: [{ type: 'ISBN_10', identifier: '0439139597' }] });
    const match = selectMatch(book, [], [other, right]);
    expect(match.status === 'matched' && match.metadata.volumeId).toBe('r');
    expect(match.status === 'matched' && match.metadata.matchedBy).toBe('isbn');
  });

  it('reports not found when there are no results', () => {
    expect(selectMatch(book, [], []).status).toBe('not_found');
  });

  it('computes title similarity and author agreement', () => {
    expect(titleSimilarity(book.title, volume('x', { title: 'Harry Potter and the Goblet of Fire' }))).toBe(1);
    expect(authorMatches('J. K. Rowling', volume('x', { authors: ['Joanne Rowling'] }))).toBe(true);
    expect(authorMatches(null, volume('x', { authors: ['Joanne Rowling'] }))).toBe(false);
    expect(titleAuthorQuery(book)).toBe('harry potter goblet fire rowling');
  });

  it('ignores malformed API responses', () => {
    expect(parseVolumesResponse(null)).toEqual([]);
    expect(parseVolumesResponse({ items: 'nope' })).toEqual([]);
    expect(parseVolumesResponse({ items: [{ id: 3 }, { id: 'ok' }, null] })).toEqual([{ id: 'ok' }]);
  });

  it('converts description HTML to text', () => {
    expect(htmlToText('<p>One &amp; two</p><p>Three<br>four</p>')).toBe('One & two\n\nThree\nfour');
  });
});

describe('Google Books HTTP client', () => {
  it('sends the API key and parses JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }));
    await expect(fetchVolumes('isbn:1', { apiKey: 'secret', fetchImpl })).resolves.toEqual({ items: [] });
    const url = (fetchImpl.mock.calls[0] as unknown as [URL])[0];
    expect(url.searchParams.get('key')).toBe('secret');
    expect(url.searchParams.get('q')).toBe('isbn:1');
  });

  it('marks rate limits and server errors as retryable', async () => {
    const limited = vi.fn(async () => new Response('slow down', { status: 429 }));
    await expect(fetchVolumes('q', { fetchImpl: limited })).rejects.toMatchObject({ retryable: true, status: 429 });
    const forbidden = vi.fn(async () => new Response('no', { status: 403 }));
    await expect(fetchVolumes('q', { fetchImpl: forbidden })).rejects.toMatchObject({ retryable: false, status: 403 });
  });

  it('reports network failures and invalid JSON', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(fetchVolumes('q', { fetchImpl: offline })).rejects.toBeInstanceOf(GoogleBooksError);
    const garbage = vi.fn(async () => new Response('<html>', { status: 200 }));
    await expect(fetchVolumes('q', { fetchImpl: garbage })).rejects.toThrow(/invalid JSON/);
  });
});
