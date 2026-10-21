/** Book details, similar books and homepage discovery sections. */
import type { Db } from 'mongodb';
import { PUBLIC_BOOK_PROJECTION, toPublicBook, type BookDoc } from '../books/model.js';
import { collections } from '../db/collections.js';
import { loadIndexMeta } from '../db/mongo-store.js';
import { Errors } from '../http/errors.js';
import { QUERY_LIMITS } from '../ir/config.js';
import { explainSimilarity, findSimilar } from '../ir/similar.js';
import { enrichBook } from '../metadata/google-books.js';
import { enrichFromOpenLibrary } from '../metadata/open-library.js';
import type { BookDetailsResponse, DiscoverResponse, SimilarHit, SimilarResponse } from '../types.js';
import { requireIndex } from './catalogue.js';

const OTHER_EDITIONS_LIMIT = 8;

async function loadBook(db: Db, id: string): Promise<BookDoc> {
  const doc = await collections(db).books.findOne({ _id: id });
  if (!doc) throw Errors.notFound(`No book with id "${id}" exists in the catalogue.`);
  return doc;
}

const ON_VIEW_BUDGET_MS = 3000;
const ON_VIEW_MAX_ATTEMPTS = 3;

/** True when a source has never been tried for this book, or failed fewer than 3 times. */
export function shouldEnrichOnView(doc: Pick<BookDoc, 'enrichment'>): boolean {
  return shouldRetry(doc.enrichment);
}

function shouldRetry(state: BookDoc['enrichment']): boolean {
  if (!state) return true;
  return state.status === 'error' && state.attempts < ON_VIEW_MAX_ATTEMPTS;
}

export async function getBookDetails(db: Db, id: string): Promise<BookDetailsResponse> {
  let doc = await loadBook(db, id);

  // Optional on-demand enrichment for records the batch script has not reached yet (and for
  // earlier attempts that failed, up to ON_VIEW_MAX_ATTEMPTS). The page waits at most
  // ON_VIEW_BUDGET_MS; a slower lookup keeps running and is saved for the next view.
  // Google Books and Open Library are queried in parallel.
  if (process.env.ENRICH_ON_VIEW === 'true') {
    const lookups: Promise<unknown>[] = [];
    if (shouldRetry(doc.enrichment)) lookups.push(enrichBook(db, doc, { apiKey: process.env.GOOGLE_BOOKS_API_KEY || undefined, timeoutMs: 2500 }));
    if (shouldRetry(doc.openLibraryEnrichment)) lookups.push(enrichFromOpenLibrary(db, doc, { timeoutMs: 2500 }));
    if (lookups.length) {
      await Promise.race([Promise.allSettled(lookups), new Promise((resolve) => setTimeout(resolve, ON_VIEW_BUDGET_MS))]);
      // Even if the budget ran out, whatever has already been saved is shown.
      doc = await loadBook(db, id);
    }
  }

  const editions = await collections(db)
    .books.find({ dedupKey: doc.dedupKey, _id: { $ne: doc._id } }, { projection: PUBLIC_BOOK_PROJECTION })
    .sort({ year: -1, _id: 1 })
    .limit(OTHER_EDITIONS_LIMIT)
    .toArray();
  return { book: toPublicBook(doc), otherEditions: editions.map((e) => toPublicBook(e as BookDoc)) };
}

export async function getSimilarBooks(db: Db, id: string, limit: number): Promise<SimilarResponse> {
  const started = Date.now();
  const source = await loadBook(db, id);
  const store = await requireIndex(db);
  const vector = await store.docVector(id);
  if (!vector) return { source: toPublicBook(source), results: [], termsUsed: 0, tookMs: Date.now() - started };

  // Other editions of the same work would trivially be "most similar"; they are excluded
  // here and listed separately on the details page.
  const editions = await collections(db).books.find({ dedupKey: source.dedupKey }, { projection: { _id: 1 } }).limit(200).toArray();
  const exclude = new Set(editions.map((e) => e._id));

  const { candidates, termsUsed } = await findSimilar(store, vector, { limit: Math.min(limit * 3, QUERY_LIMITS.maxSimilarResults * 3), exclude });
  const docs = await collections(db)
    .books.find({ _id: { $in: candidates.map((c) => c.id) } }, { projection: { ...PUBLIC_BOOK_PROJECTION, dedupKey: 1, authorKey: 1 } })
    .toArray();
  const byId = new Map(docs.map((d) => [d._id, d as BookDoc]));

  const seenWorks = new Set<string>([source.dedupKey]);
  const results: SimilarHit[] = [];
  for (const candidate of candidates) {
    const doc = byId.get(candidate.id);
    if (!doc || seenWorks.has(doc.dedupKey)) continue;
    seenWorks.add(doc.dedupKey);
    const reasons = explainSimilarity(candidate);
    const author = reasons.find((r) => r.kind === 'author');
    if (author && doc.authorKey && doc.authorKey === source.authorKey && source.author) {
      author.label = `Same author: ${source.author}`;
    }
    results.push({ book: toPublicBook(doc), similarity: Math.round(candidate.similarity * 10000) / 10000, reasons });
    if (results.length >= limit) break;
  }
  return { source: toPublicBook(source), results, termsUsed, tookMs: Date.now() - started };
}

/** Extra candidates per section: the homepage hides books whose covers fail to load. */
const SECTION_SIZE = 24;

export async function getDiscover(db: Db): Promise<DiscoverResponse> {
  const meta = await loadIndexMeta(db);
  if (!meta) throw Errors.indexNotBuilt();
  const books = collections(db).books;

  const [sample, recent] = await Promise.all([
    books
      .aggregate<BookDoc>([{ $match: { 'covers.large': { $ne: null } } }, { $sample: { size: SECTION_SIZE + 6 } }, { $project: PUBLIC_BOOK_PROJECTION }])
      .toArray(),
    books.find({}, { projection: PUBLIC_BOOK_PROJECTION }).sort({ importedAt: -1, _id: 1 }).limit(SECTION_SIZE).toArray(),
  ]);

  // "Similar books worth exploring": the similar-book finder run for one sampled book.
  let similar: DiscoverResponse['similar'] = null;
  for (const seed of sample.slice(SECTION_SIZE)) {
    const result = await getSimilarBooks(db, seed._id, 12);
    if (result.results.length >= 4) {
      similar = { seed: result.source, results: result.results };
      break;
    }
  }

  return {
    stats: {
      books: meta.totalDocuments,
      vocabulary: meta.vocabularySize,
      postings: meta.postings,
      enriched: meta.enrichedBooks,
      builtAt: meta.builtAt.toISOString(),
    },
    discover: sample.slice(0, SECTION_SIZE).map((d) => toPublicBook(d)),
    recent: recent.map((d) => toPublicBook(d as BookDoc)),
    authors: meta.topAuthors.slice(0, 12),
    publishers: meta.topPublishers.slice(0, 12),
    similar,
  };
}
