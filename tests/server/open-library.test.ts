import { describe, expect, it, vi } from 'vitest';
import { cleanDescription, cleanSubjects, fetchJson, lookupOpenLibrary, OpenLibraryError, titlesAgree } from '../../lib/metadata/open-library.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const book = { isbn: '0345272579', isbnValid: true, title: 'The Hobbit' };

describe('Open Library text cleaning', () => {
  it('accepts plain and typed descriptions and strips Markdown and notes', () => {
    expect(cleanDescription('A hobbit goes on an unexpected journey.')).toBe('A hobbit goes on an unexpected journey.');
    expect(cleanDescription({ type: '/type/text', value: 'Bilbo meets [Gandalf](https://x.org) and dwarves on an adventure.\n\n----------\nAlso contained in:\n- [Tales](/works/OL1W)' })).toBe(
      'Bilbo meets Gandalf and dwarves on an adventure.',
    );
    expect(cleanDescription('Too short')).toBeNull();
    expect(cleanDescription(42)).toBeNull();
  });

  it('drops machine tags and duplicates from subjects', () => {
    expect(cleanSubjects(['Fantasy', 'fantasy', 'nyt:hardcover-fiction=2007-01-01', 'Dwarves', 7, ''])).toEqual(['Fantasy', 'Dwarves']);
  });

  it('checks that edition and catalogue titles share a word', () => {
    expect(titlesAgree('The Hobbit (Illustrated)', 'Hobbit, or There and Back Again')).toBe(true);
    expect(titlesAgree('The Hobbit', 'Cooking for Beginners')).toBe(false);
  });
});

describe('Open Library lookup (mocked HTTP)', () => {
  it('reads the edition by ISBN and the description and subjects from its work', async () => {
    const fetchImpl = vi.fn(async (url: URL | string | Request) => {
      const path = new URL(String(url)).pathname;
      if (path === '/isbn/0345272579.json') return json({ key: '/books/OL1M', title: 'The Hobbit', works: [{ key: '/works/OL27482W' }], covers: [-1, 8291598], number_of_pages: 287, publish_date: '1979' });
      if (path === '/works/OL27482W.json') return json({ key: '/works/OL27482W', description: 'Bilbo Baggins is swept into a quest for treasure.', subjects: ['Fantasy', 'Dragons'] });
      return json({}, 404);
    });
    const outcome = await lookupOpenLibrary(null, book, { fetchImpl });
    expect(outcome.status).toBe('matched');
    if (outcome.status !== 'matched') return;
    expect(outcome.metadata).toMatchObject({
      editionKey: '/books/OL1M',
      workKey: '/works/OL27482W',
      description: 'Bilbo Baggins is swept into a quest for treasure.',
      subjects: ['Fantasy', 'Dragons'],
      pageCount: 287,
      publishDate: '1979',
      coverId: 8291598,
    });
    const headers = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1].headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/PageAtelier/);
  });

  it('reports a missing ISBN as not found and a title mismatch as rejected', async () => {
    expect((await lookupOpenLibrary(null, book, { fetchImpl: vi.fn(async () => json({ error: 'notfound' }, 404)) })).status).toBe('not_found');
    expect((await lookupOpenLibrary(null, { ...book, isbnValid: false }, { fetchImpl: vi.fn() })).status).toBe('not_found');
    const wrong = vi.fn(async () => json({ key: '/books/OL2M', title: 'Cooking for Beginners' }));
    expect((await lookupOpenLibrary(null, book, { fetchImpl: wrong })).status).toBe('rejected');
  });

  it('marks rate limits and outages as retryable', async () => {
    await expect(fetchJson('/isbn/1.json', { fetchImpl: vi.fn(async () => json({}, 503)) })).rejects.toMatchObject({ retryable: true, status: 503 });
    await expect(fetchJson('/isbn/1.json', { fetchImpl: vi.fn(async () => json({}, 403)) })).rejects.toMatchObject({ retryable: false });
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(fetchJson('/isbn/1.json', { fetchImpl: offline })).rejects.toBeInstanceOf(OpenLibraryError);
  });
});
