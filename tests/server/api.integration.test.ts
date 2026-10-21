/**
 * End-to-end tests of the serverless API handlers against a real (local, in-memory) MongoDB:
 * CSV import → index build → HTTP handlers.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { Db } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET as bookHandler } from '../../api/book.js';
import { GET as discoverHandler } from '../../api/discover.js';
import { GET as evaluationHandler } from '../../api/evaluation.js';
import { GET as healthHandler } from '../../api/health.js';
import { GET as searchHandler } from '../../api/search.js';
import { GET as similarHandler } from '../../api/similar.js';
import { collections } from '../../lib/db/collections.js';
import { closeDb, getDb } from '../../lib/db/mongo.js';
import { clearIndexMetaCache } from '../../lib/db/mongo-store.js';
import { importBooks } from '../../lib/dataset/import.js';
import { buildAndStoreIndex } from '../../lib/indexing/build.js';
import { enrichBook } from '../../lib/metadata/google-books.js';
import { enrichFromOpenLibrary } from '../../lib/metadata/open-library.js';
import type { BookDetailsResponse, EvaluationResponse, HealthResponse, SearchResponse, SimilarResponse } from '../../lib/types.js';

const FIXTURE = 'tests/fixtures/sample-books.csv';
let server: MongoMemoryServer;
let db: Db;

async function call<T>(handler: (r: Request) => Promise<Response>, path: string): Promise<{ status: number; body: T }> {
  const response = await handler(new Request(`http://localhost${path}`));
  return { status: response.status, body: (await response.json()) as T };
}

function useDatabase(uri: string | undefined, name = 'page_atelier_test') {
  if (uri) process.env.MONGODB_URI = uri;
  else delete process.env.MONGODB_URI;
  process.env.MONGODB_DATABASE = name;
  clearIndexMetaCache();
}

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  useDatabase(server.getUri());
  db = await getDb();
  await importBooks(db, FIXTURE);
  await buildAndStoreIndex(db);
});

afterAll(async () => {
  await closeDb();
  await server?.stop();
});

describe('import', () => {
  it('imports valid records once and reports the rest', async () => {
    expect(await collections(db).books.countDocuments()).toBe(14);
    const report = await importBooks(db, FIXTURE);
    expect(report).toMatchObject({ inserted: 0, updated: 0, unchanged: 14, skippedDuplicates: 1, rejected: { 'missing-isbn': 1 } });
    expect(await collections(db).books.countDocuments()).toBe(14);
  });

  it('repairs encoding damage and HTML entities', async () => {
    expect((await collections(db).books.findOne({ _id: '3257207522' }))?.title).toBe('Der König in Gelb.');
    expect((await collections(db).books.findOne({ _id: '1565924649' }))?.publisher).toBe("O'Reilly & Associates");
  });

  it('preserves enrichment when the dataset is re-imported', async () => {
    await collections(db).books.updateOne({ _id: '0345272579' }, { $set: { enrichment: { status: 'not_found', attemptedAt: 'x', attempts: 1 } } });
    await importBooks(db, FIXTURE);
    expect((await collections(db).books.findOne({ _id: '0345272579' }))?.enrichment?.status).toBe('not_found');
  });
});

describe('index build', () => {
  it('keeps exactly one index version after a rebuild', async () => {
    const before = (await collections(db).indexMeta.findOne({ _id: 'active' }))!.version;
    const report = await buildAndStoreIndex(db);
    expect(report.version).not.toBe(before);
    expect(await collections(db).vocabulary.distinct('v')).toEqual([report.version]);
    expect(await collections(db).postings.distinct('v')).toEqual([report.version]);
    expect(report.documents).toBe(14);
  });
});

describe('GET /api/search', () => {
  it('returns ranked results with scores and matched fields', async () => {
    const { status, body } = await call<SearchResponse>(searchHandler, '/api/search?q=python%20programming');
    expect(status).toBe(200);
    expect(body.results[0]!.book.title).toBe('Programming Python');
    expect(body.results[0]!.matchedFields).toContain('title');
    expect(body.total).toBe(3);
  });

  it('suggests spelling corrections from the catalogue vocabulary', async () => {
    const { body } = await call<SearchResponse>(searchHandler, '/api/search?q=Harry%20Poter');
    expect(body.unknownTerms).toEqual(['poter']);
    expect(body.suggestions[0]!.query).toBe('Harry Potter');
    const corrected = await call<SearchResponse>(searchHandler, `/api/search?q=${encodeURIComponent(body.suggestions[0]!.query)}`);
    expect(corrected.body.results[0]!.book.author).toBe('J. K. Rowling');
  });

  it('applies author, publisher and year filters to the real results', async () => {
    const byAuthor = await call<SearchResponse>(searchHandler, '/api/search?q=harry&author=Eric%20L.%20Harry');
    expect(byAuthor.body.results.map((r) => r.book.id)).toEqual(['0886775914']);
    const byYear = await call<SearchResponse>(searchHandler, '/api/search?q=harry%20potter&yearFrom=2001');
    expect(byYear.body.results.map((r) => r.book.id)).toEqual(['0439139600']);
    const byPublisher = await call<SearchResponse>(searchHandler, '/api/search?q=harry%20potter&publisher=scholastic');
    expect(byPublisher.body.results.every((r) => r.book.publisher === 'Scholastic')).toBe(true);
  });

  it('paginates on the server and caps the page size', async () => {
    const first = await call<SearchResponse>(searchHandler, '/api/search?q=harry%20potter&pageSize=2');
    const second = await call<SearchResponse>(searchHandler, '/api/search?q=harry%20potter&pageSize=2&page=2');
    expect(first.body.results).toHaveLength(2);
    expect(first.body.totalPages).toBe(Math.ceil(first.body.total / 2));
    expect(second.body.results.map((r) => r.book.id)).not.toEqual(first.body.results.map((r) => r.book.id));
    expect((await call(searchHandler, '/api/search?q=x&pageSize=1000')).status).toBe(400);
  });

  it('sorts by title when asked', async () => {
    const { body } = await call<SearchResponse>(searchHandler, '/api/search?q=tolkien&sort=title');
    const titles = body.results.map((r) => r.book.title.toLowerCase());
    expect(titles).toEqual([...titles].sort());
  });

  it('browses the catalogue without a query', async () => {
    const { body } = await call<SearchResponse>(searchHandler, '/api/search?author=J.%20K.%20Rowling');
    expect(body.total).toBe(4);
  });

  it('returns an empty result with a notice for stop-word-only queries', async () => {
    const { status, body } = await call<SearchResponse>(searchHandler, '/api/search?q=the');
    expect(status).toBe(200);
    expect(body.results).toEqual([]);
    expect(body.notice).toMatch(/common words/);
  });
});

describe('GET /api/book and /api/similar', () => {
  it('returns book details and other editions', async () => {
    const { status, body } = await call<BookDetailsResponse>(bookHandler, '/api/book?id=0439139597');
    expect(status).toBe(200);
    expect(body.book).toMatchObject({ title: 'Harry Potter and the Goblet of Fire (Book 4)', isbn13: '9780439139595', description: null });
    expect(body.otherEditions.map((b) => b.id)).toEqual(['0439139600']);
  });

  it('returns 404 for unknown books and 400 for invalid ids', async () => {
    expect((await call(bookHandler, '/api/book?id=0000000000')).status).toBe(404);
    expect((await call(bookHandler, '/api/book?id=%7B%7D')).status).toBe(400);
    expect((await call(bookHandler, '/api/book')).status).toBe(400);
    expect((await call(similarHandler, '/api/similar?id=0000000000')).status).toBe(404);
  });

  it('finds similar books, excluding the book itself and its other editions', async () => {
    const { status, body } = await call<SimilarResponse>(similarHandler, '/api/similar?id=0439139597&limit=3');
    expect(status).toBe(200);
    const ids = body.results.map((r) => r.book.id);
    expect(ids).not.toContain('0439139597');
    expect(ids).not.toContain('0439139600');
    expect(body.results.length).toBeLessThanOrEqual(3);
    expect(body.results[0]!.reasons[0]!.label).toBe('Same author: J. K. Rowling');
  });
});

describe('GET /api/discover, /api/evaluation and /api/health', () => {
  it('builds discovery sections from real records', async () => {
    const { status, body } = await call<{ discover: unknown[]; authors: { name: string }[]; stats: { books: number } }>(discoverHandler, '/api/discover');
    expect(status).toBe(200);
    expect(body.stats.books).toBe(14);
    expect(body.authors[0]!.name).toBe('J. K. Rowling');
  });

  it('computes evaluation metrics and skips queries without imported relevant books', async () => {
    const { status, body } = await call<EvaluationResponse>(evaluationHandler, '/api/evaluation?k=5');
    expect(status).toBe(200);
    expect(body.k).toBe(5);
    expect(body.source).toBe('bundled-file');
    const hp = body.queries.find((q) => q.query === 'harry potter')!;
    expect(hp.skipped).toBe(false);
    expect(hp.relevantInCatalogue).toBe(4);
    expect(hp.metrics.ranked.reciprocalRank).toBe(1);
    expect(body.queriesEvaluated).toBeLessThan(body.queriesTotal);
    expect((await call(evaluationHandler, '/api/evaluation?k=99')).status).toBe(400);
  });

  it('reports a healthy, indexed database', async () => {
    const { status, body } = await call<HealthResponse>(healthHandler, '/api/health');
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', database: 'connected', index: 'ready' });
    expect(JSON.stringify(body)).not.toContain('mongodb://');
  });
});

describe('Google Books enrichment (mocked HTTP)', () => {
  it('stores validated metadata, caches the response and makes the description searchable', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'gb-goblet',
              volumeInfo: {
                title: 'Harry Potter and the Goblet of Fire',
                authors: ['J.K. Rowling'],
                description: '<p>A dangerous <b>Triwizard</b> tournament.</p>',
                categories: ['Juvenile Fiction'],
                pageCount: 734,
                industryIdentifiers: [{ type: 'ISBN_10', identifier: '0439139597' }],
                imageLinks: { thumbnail: 'http://books.google.com/books/content?id=gb&img=1&edge=curl' },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const record = (await collections(db).books.findOne({ _id: '0439139597' }))!;
    const state = await enrichBook(db, record, { fetchImpl });
    expect(state.status).toBe('matched');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // A second lookup is served from the MongoDB cache.
    await enrichBook(db, record, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const details = await call<BookDetailsResponse>(bookHandler, '/api/book?id=0439139597');
    expect(details.body.book).toMatchObject({
      description: 'A dangerous Triwizard tournament.',
      descriptionSource: 'google-books',
      categories: ['Juvenile Fiction'],
      pageCount: 734,
      enriched: true,
      // Book-Crossing fields stay primary
      title: 'Harry Potter and the Goblet of Fire (Book 4)',
      publisher: 'Scholastic',
    });
    // Amazon first, then Google Books, then Open Library.
    expect(details.body.book.covers.slice(-2)).toEqual(['https://books.google.com/books/content?id=gb&img=1', 'https://covers.openlibrary.org/b/isbn/0439139597-L.jpg?default=false']);

    await buildAndStoreIndex(db);
    const search = await call<SearchResponse>(searchHandler, '/api/search?q=triwizard%20tournament');
    expect(search.body.results[0]!.book.id).toBe('0439139597');
    expect(search.body.results[0]!.matchedFields).toEqual(['description']);
  });

  it('never downgrades an existing match after a failed retry', async () => {
    const record = (await collections(db).books.findOne({ _id: '0439139597' }))!;
    expect(record.enrichment?.status).toBe('matched');
    const failing = vi.fn(async () => new Response('busy', { status: 503 }));
    // Fresh request keys, so the cached response of the earlier match is not reused.
    await expect(enrichBook(db, { ...record, isbnValid: false, title: 'Timeout Probe', author: 'Nobody' }, { fetchImpl: failing })).rejects.toThrow();
    expect(failing).toHaveBeenCalled();
    const notFound = vi.fn(async () => new Response(JSON.stringify({ totalItems: 0 }), { status: 200 }));
    await enrichBook(db, { ...record, isbnValid: false, title: 'Unrelated', author: 'Nobody' }, { fetchImpl: notFound });
    const after = (await collections(db).books.findOne({ _id: '0439139597' }))!;
    expect(after.enrichment?.status).toBe('matched');
    expect(after.google?.description).toBe('A dangerous Triwizard tournament.');
  });

  it('does not attach unvalidated results', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: 'other', volumeInfo: { title: 'Unrelated Cookbook', authors: ['Someone'] } }] }), { status: 200 }));
    const record = (await collections(db).books.findOne({ _id: '0345272579' }))!;
    const state = await enrichBook(db, record, { fetchImpl });
    expect(state.status).toBe('rejected');
    expect((await collections(db).books.findOne({ _id: '0345272579' }))?.google).toBeUndefined();
  });
});

describe('Open Library enrichment (mocked HTTP)', () => {
  it('fills description, subjects and cover when Google Books has none, and indexes them', async () => {
    const fetchImpl = vi.fn(async (url: URL | string | Request) => {
      const path = new URL(String(url)).pathname;
      const body =
        path === '/isbn/0345339703.json'
          ? { key: '/books/OL9M', title: 'The Fellowship of the Ring', works: [{ key: '/works/OL27513W' }], covers: [123456], number_of_pages: 458 }
          : path === '/works/OL27513W.json'
            ? { key: '/works/OL27513W', description: 'Frodo inherits a ring of terrible power and leaves the Shire.', subjects: ['Elves', 'Quests (Expeditions)'] }
            : null;
      return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
    });
    const record = (await collections(db).books.findOne({ _id: '0345339703' }))!;
    expect((await enrichFromOpenLibrary(db, record, { fetchImpl })).status).toBe('matched');

    const { body } = await call<BookDetailsResponse>(bookHandler, '/api/book?id=0345339703');
    expect(body.book).toMatchObject({
      description: 'Frodo inherits a ring of terrible power and leaves the Shire.',
      descriptionSource: 'open-library',
      descriptionLink: 'https://openlibrary.org/works/OL27513W',
      categories: ['Elves', 'Quests (Expeditions)'],
      pageCount: 458,
      enriched: true,
    });
    expect(body.book.covers).toContain('https://covers.openlibrary.org/b/id/123456-L.jpg?default=false');

    await buildAndStoreIndex(db);
    const search = await call<SearchResponse>(searchHandler, '/api/search?q=shire%20frodo');
    expect(search.body.results[0]!.book.id).toBe('0345339703');
  });

  it('keeps Google Books first when both sources have a description', async () => {
    const fetchImpl = vi.fn(async (url: URL | string | Request) => {
      const path = new URL(String(url)).pathname;
      if (path === '/isbn/0439139597.json') return new Response(JSON.stringify({ key: '/books/OL7M', title: 'Harry Potter and the Goblet of Fire', works: [{ key: '/works/OL82560W' }] }));
      return new Response(JSON.stringify({ key: '/works/OL82560W', description: 'An Open Library description of the fourth book.' }));
    });
    const record = (await collections(db).books.findOne({ _id: '0439139597' }))!;
    await enrichFromOpenLibrary(db, record, { fetchImpl });
    const { body } = await call<BookDetailsResponse>(bookHandler, '/api/book?id=0439139597');
    expect(body.book.descriptionSource).toBe('google-books');
  });
});

describe('configuration and database failures', () => {
  it('reports a missing index', async () => {
    useDatabase(server.getUri(), 'page_atelier_empty');
    const { status, body } = await call<{ error: { code: string } }>(searchHandler, '/api/search?q=python');
    expect(status).toBe(503);
    expect(body.error.code).toBe('INDEX_NOT_BUILT');
    useDatabase(server.getUri());
  });

  it('reports missing configuration without crashing', async () => {
    await closeDb();
    useDatabase(undefined);
    const search = await call<{ error: { code: string } }>(searchHandler, '/api/search?q=python');
    expect(search.status).toBe(503);
    expect(search.body.error.code).toBe('DATABASE_NOT_CONFIGURED');
    const health = await call<HealthResponse>(healthHandler, '/api/health');
    expect(health.status).toBe(503);
    expect(health.body.database).toBe('not_configured');
    useDatabase(server.getUri());
  });

  it('reports an unreachable database as a temporary outage', async () => {
    await closeDb();
    const originalError = console.error;
    console.error = () => {};
    try {
      useDatabase('mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500&connectTimeoutMS=500');
      const { status, body } = await call<{ error: { code: string; message: string } }>(bookHandler, '/api/book?id=0439139597');
      expect(status).toBe(503);
      expect(body.error.code).toBe('DATABASE_UNAVAILABLE');
      expect(body.error.message).not.toContain('127.0.0.1');
    } finally {
      console.error = originalError;
      await closeDb();
      useDatabase(server.getUri());
    }
  });
});
