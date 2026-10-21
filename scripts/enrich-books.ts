/**
 * Enrich Book-Crossing records with Google Books or Open Library metadata.
 *
 *   npm run enrich:books -- --priority --limit 1000 --delay 400              (Google Books)
 *   npm run enrich:books -- --source openlibrary --priority --limit 2000     (Open Library)
 *   npm run enrich:books -- --retry-errors --retry-not-found                 (retry failed / not found)
 *   npm run enrich:books -- --limit 500                                      (next records by ISBN)
 *
 * --priority enriches the best-ranked books of the example and evaluation queries before
 * anything else (the first result of every query, then the second, …), so a limited quota is
 * spent on the records most likely to be displayed.
 *
 * Records are processed one at a time with a delay between them. Retryable failures (HTTP 429,
 * 5xx, timeouts) back off exponentially; the run stops after four in a row. Rebuild the index
 * afterwards so new descriptions and subjects become searchable.
 */
import { parseArgs } from 'node:util';
import type { Filter } from 'mongodb';
import type { BookDoc } from '../lib/books/model.js';
import { collections } from '../lib/db/collections.js';
import { retrieveBoth } from '../lib/ir/engine.js';
import { enrichBook, GoogleBooksError } from '../lib/metadata/google-books.js';
import { enrichFromOpenLibrary, OpenLibraryError } from '../lib/metadata/open-library.js';
import { requireIndex } from '../lib/services/catalogue.js';
import { BUNDLED_DATASET } from '../lib/services/evaluation.js';
import type { EnrichmentState, EnrichmentStatus } from '../lib/types.js';
import { run, withDatabase } from './_shared.js';

const { values } = parseArgs({
  options: {
    source: { type: 'string', default: 'google' },
    limit: { type: 'string', default: '200' },
    delay: { type: 'string' },
    'retry-errors': { type: 'boolean', default: false },
    'retry-not-found': { type: 'boolean', default: false },
    priority: { type: 'boolean', default: false },
    depth: { type: 'string', default: '40' },
  },
});

/** Example queries shown in the UI, plus the evaluation queries. */
const PRIORITY_QUERIES = [
  ...BUNDLED_DATASET.queries.map((q) => q.query),
  'python programming', 'classic literature', 'mystery novels', 'science fiction', 'jane austen', 'harry potter',
  'stephen king', 'agatha christie', 'shakespeare', 'charles dickens', 'isaac asimov', 'cooking', 'history', 'romance',
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_CONSECUTIVE_FAILURES = 4;

run(async () => {
  const source = values.source;
  if (source !== 'google' && source !== 'openlibrary') throw new Error('--source must be "google" or "openlibrary".');
  const limit = Number(values.limit);
  // Open Library asks for gentle request rates; each book needs up to two requests.
  const delay = Number(values.delay ?? (source === 'openlibrary' ? 700 : 250));
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer.');
  if (!Number.isFinite(delay) || delay < 0) throw new Error('--delay must be a non-negative number of milliseconds.');
  const stateField = source === 'google' ? 'enrichment' : 'openLibraryEnrichment';

  await withDatabase(async (db) => {
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY || undefined; // .env is loaded by withDatabase
    if (source === 'google' && !apiKey) console.log('GOOGLE_BOOKS_API_KEY is not set — using unauthenticated access (strict, shared quota).');
    console.log(`Source: ${source === 'google' ? 'Google Books' : 'Open Library'}`);

    const books = collections(db).books;
    const retryStatuses = [...(values['retry-errors'] ? ['error'] : []), ...(values['retry-not-found'] ? ['not_found'] : [])];
    const neverTried = { [stateField]: { $exists: false } } as Filter<BookDoc>;
    const filter: Filter<BookDoc> = retryStatuses.length
      ? ({ $or: [neverTried, { [`${stateField}.status`]: { $in: retryStatuses } }] } as Filter<BookDoc>)
      : neverTried;
    const projection = { isbn: 1, isbnValid: 1, title: 1, author: 1, enrichment: 1, openLibraryEnrichment: 1 } as const;

    let batch;
    if (values.priority) {
      const store = await requireIndex(db);
      const depth = Number(values.depth);
      const lists: string[][] = [];
      for (const query of PRIORITY_QUERIES) {
        const { ranked } = await retrieveBoth(store, query);
        lists.push(ranked.slice(0, depth).map((c) => c.id));
      }
      // Rank-major order: the top result of every query first, then the second of every query, …
      const ids: string[] = [];
      for (let rank = 0; rank < depth; rank++) for (const list of lists) if (list[rank]) ids.push(list[rank]!);
      const unique = [...new Set(ids)];
      const pending = await books.find({ ...filter, _id: { $in: unique } }, { projection }).toArray();
      const order = new Map(unique.map((id, i) => [id, i]));
      batch = pending.sort((a, b) => order.get(a._id)! - order.get(b._id)!).slice(0, limit);
      console.log(`Priority set: ${unique.length} books from ${PRIORITY_QUERIES.length} queries, ${pending.length} still to do.`);
    } else {
      batch = await books.find(filter, { projection }).sort({ _id: 1 }).limit(limit).toArray();
    }
    console.log(`Enriching ${batch.length} record(s)…`);

    const enrich = (book: (typeof batch)[number]): Promise<EnrichmentState> =>
      source === 'google' ? enrichBook(db, book, { apiKey }) : enrichFromOpenLibrary(db, book);

    const counts: Record<EnrichmentStatus, number> = { matched: 0, not_found: 0, rejected: 0, error: 0 };
    let consecutiveFailures = 0;
    for (let i = 0; i < batch.length; i++) {
      try {
        const state = await enrich(batch[i]!);
        counts[state.status]++;
        consecutiveFailures = 0;
      } catch (error) {
        counts.error++;
        const retryable = (error instanceof GoogleBooksError || error instanceof OpenLibraryError) && error.retryable;
        if (retryable) {
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.log(`Stopping: ${(error as Error).message} ${consecutiveFailures} times in a row (quota, rate limit or outage).`);
            break;
          }
          const backoff = 2000 * 2 ** (consecutiveFailures - 1);
          console.log(`  ${(error as Error).message}; backing off ${backoff / 1000}s`);
          await sleep(backoff);
        }
      }
      if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${batch.length}  ${JSON.stringify(counts)}`);
      if (delay) await sleep(delay);
    }

    console.log('\nEnrichment report');
    console.log('─────────────────');
    console.log(`Matched   : ${counts.matched}`);
    console.log(`Not found : ${counts.not_found}`);
    console.log(`Rejected  : ${counts.rejected} (results failed validation and were not attached)`);
    console.log(`Errors    : ${counts.error} (retry with --retry-errors)`);
    console.log(`Never attempted records remaining: ${await books.countDocuments(neverTried)}`);
    console.log('\nNext: npm run build:index   (index new descriptions and subjects)');
  });
});
