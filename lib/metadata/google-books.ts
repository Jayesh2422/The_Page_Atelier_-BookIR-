/**
 * Google Books metadata enrichment.
 *
 * Matching rules
 *  1. ISBN lookup (`q=isbn:<isbn>`). A volume is accepted only if one of its industry
 *     identifiers equals the record's ISBN-10 or ISBN-13.
 *  2. Fallback for records without a valid ISBN match: a plain-text title + author-surname
 *     search (Google's `intitle:`/`inauthor:` operators proved unreliable). A result whose
 *     identifiers contain the record's ISBN is accepted as an ISBN-confirmed match; otherwise a
 *     volume is accepted only if
 *       - the token Jaccard similarity between the record's title (without parentheticals) and
 *         the volume title is ≥ TITLE_SIMILARITY_THRESHOLD, and
 *       - the record's author surname appears among the volume's author names.
 *     The best accepted volume wins; its title similarity becomes the match confidence.
 *  Unvalidated results are never attached ("rejected").
 *
 * Every raw response is cached in `googleBooksCache`, so re-running enrichment or opening a
 * book page does not call the API again for the same request.
 */
import type { Db } from 'mongodb';
import { isbnVariants } from '../books/isbn.js';
import { cleanGoogleThumbnail, titleWithoutParentheticals, type BookDoc } from '../books/model.js';
import { collections } from '../db/collections.js';
import { tokenize } from '../ir/text.js';
import type { EnrichmentState, GoogleMetadata } from '../types.js';

export const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
export const TITLE_SIMILARITY_THRESHOLD = 0.6;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 90;

export interface GoogleVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    industryIdentifiers?: { type: string; identifier: string }[];
    pageCount?: number;
    categories?: string[];
    language?: string;
    imageLinks?: { smallThumbnail?: string; thumbnail?: string };
    infoLink?: string;
  };
}

export class GoogleBooksError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'GoogleBooksError';
  }
}

export interface FetchOptions {
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Validate the shape of a volumes response; anything unexpected yields an empty list. */
export function parseVolumesResponse(body: unknown): GoogleVolume[] {
  if (!body || typeof body !== 'object') return [];
  const items = (body as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is GoogleVolume => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as { id?: unknown; volumeInfo?: unknown };
    return typeof candidate.id === 'string' && (candidate.volumeInfo === undefined || typeof candidate.volumeInfo === 'object');
  });
}

export async function fetchVolumes(query: string, options: FetchOptions = {}): Promise<unknown> {
  const url = new URL(GOOGLE_BOOKS_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', '10');
  url.searchParams.set('printType', 'books');
  if (options.apiKey) url.searchParams.set('key', options.apiKey);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 8000), headers: { Accept: 'application/json' } });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new GoogleBooksError(timeout ? 'Google Books request timed out' : 'Google Books request failed', null, true);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new GoogleBooksError(`Google Books responded with HTTP ${response.status}`, response.status, true);
  }
  if (!response.ok) throw new GoogleBooksError(`Google Books responded with HTTP ${response.status}`, response.status, false);
  try {
    return await response.json();
  } catch {
    throw new GoogleBooksError('Google Books returned invalid JSON', response.status, false);
  }
}

/** Fetch through the MongoDB response cache. */
export async function cachedVolumes(db: Db | null, query: string, options: FetchOptions = {}): Promise<GoogleVolume[]> {
  const cache = db ? collections(db).googleBooksCache : null;
  if (cache) {
    const hit = await cache.findOne({ _id: query });
    if (hit && Date.now() - hit.fetchedAt.getTime() < CACHE_TTL_MS) return parseVolumesResponse(hit.body);
  }
  const body = await fetchVolumes(query, options);
  if (cache) await cache.replaceOne({ _id: query }, { status: 200, body, fetchedAt: new Date() }, { upsert: true });
  return parseVolumesResponse(body);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection++;
  return intersection / (setA.size + setB.size - intersection);
}

export function surname(author: string | null): string | null {
  const tokens = tokenize(author);
  return tokens.length ? tokens[tokens.length - 1]! : null;
}

export function titleSimilarity(recordTitle: string, volume: GoogleVolume): number {
  const recordTokens = tokenize(titleWithoutParentheticals(recordTitle));
  const info = volume.volumeInfo ?? {};
  const plain = jaccard(recordTokens, tokenize(info.title));
  const full = jaccard(recordTokens, tokenize(`${info.title ?? ''} ${info.subtitle ?? ''}`));
  return Math.max(plain, full);
}

export function volumeHasIsbn(volume: GoogleVolume, isbn: string): boolean {
  const variants = new Set(isbnVariants(isbn));
  return (volume.volumeInfo?.industryIdentifiers ?? []).some((id) => variants.has(id.identifier.replace(/[^0-9X]/gi, '').toUpperCase()));
}

export function authorMatches(recordAuthor: string | null, volume: GoogleVolume): boolean {
  const last = surname(recordAuthor);
  if (!last) return false;
  return (volume.volumeInfo?.authors ?? []).some((name) => tokenize(name).includes(last));
}

export function toGoogleMetadata(volume: GoogleVolume, matchedBy: GoogleMetadata['matchedBy'], confidence: number): GoogleMetadata {
  const info = volume.volumeInfo ?? {};
  const pageCount = typeof info.pageCount === 'number' && info.pageCount > 0 ? info.pageCount : null;
  return {
    volumeId: volume.id,
    matchedBy,
    confidence: Math.round(confidence * 1000) / 1000,
    title: info.title ?? null,
    subtitle: info.subtitle ?? null,
    authors: Array.isArray(info.authors) ? info.authors.filter((a) => typeof a === 'string') : [],
    publisher: info.publisher ?? null,
    publishedDate: info.publishedDate ?? null,
    description: info.description ? htmlToText(info.description) || null : null,
    categories: Array.isArray(info.categories) ? info.categories.filter((c) => typeof c === 'string') : [],
    pageCount,
    language: info.language ?? null,
    thumbnail: cleanGoogleThumbnail(info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail),
    infoLink: info.infoLink ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

export type MatchOutcome =
  | { status: 'matched'; metadata: GoogleMetadata }
  | { status: 'not_found' | 'rejected'; message: string };

/** Select a validated volume for a record from ISBN and fallback search results. */
export function selectMatch(
  book: Pick<BookDoc, 'isbn' | 'isbnValid' | 'title' | 'author'>,
  isbnResults: readonly GoogleVolume[],
  titleResults: readonly GoogleVolume[] | null,
): MatchOutcome {
  const byIsbn = [...isbnResults, ...(titleResults ?? [])].find((v) => volumeHasIsbn(v, book.isbn));
  if (byIsbn) return { status: 'matched', metadata: toGoogleMetadata(byIsbn, 'isbn', 1) };

  if (titleResults && titleResults.length > 0) {
    let best: { volume: GoogleVolume; similarity: number } | null = null;
    for (const volume of titleResults) {
      const similarity = titleSimilarity(book.title, volume);
      if (similarity >= TITLE_SIMILARITY_THRESHOLD && authorMatches(book.author, volume) && (!best || similarity > best.similarity)) {
        best = { volume, similarity };
      }
    }
    if (best) return { status: 'matched', metadata: toGoogleMetadata(best.volume, 'title-author', best.similarity) };
    return { status: 'rejected', message: 'Search results did not match the title and author closely enough.' };
  }
  if (isbnResults.length > 0) return { status: 'rejected', message: 'ISBN search results did not contain this ISBN.' };
  return { status: 'not_found', message: 'No Google Books volume found.' };
}

export function titleAuthorQuery(book: Pick<BookDoc, 'title' | 'author'>): string | null {
  const titleTerms = tokenize(titleWithoutParentheticals(book.title)).slice(0, 8);
  const last = surname(book.author);
  if (titleTerms.length === 0 || !last) return null;
  // Plain words: the Google Books operators (intitle:, inauthor:) return nothing intermittently.
  return `${titleTerms.join(' ')} ${last}`;
}

/**
 * The `isbn:` operator sometimes stops returning anything. After this many empty answers in a
 * row the operator is skipped for the rest of the process (the plain-text search still
 * confirms ISBNs), so a limited quota is not wasted.
 */
const ISBN_OPERATOR_GIVE_UP = 8;
let emptyIsbnAnswers = 0;
export function resetIsbnOperatorState(): void {
  emptyIsbnAnswers = 0;
}

/** Look up one record (ISBN first, title + author as fallback) and store the outcome. */
export async function enrichBook(
  db: Db,
  book: Pick<BookDoc, '_id' | 'isbn' | 'isbnValid' | 'title' | 'author' | 'enrichment'>,
  options: FetchOptions = {},
): Promise<EnrichmentState> {
  const books = collections(db).books;
  const attempts = (book.enrichment?.attempts ?? 0) + 1;
  try {
    const tryIsbn = book.isbnValid && emptyIsbnAnswers < ISBN_OPERATOR_GIVE_UP;
    const isbnResults = tryIsbn ? await cachedVolumes(db, `isbn:${book.isbn}`, options) : [];
    if (tryIsbn) emptyIsbnAnswers = isbnResults.some((v) => volumeHasIsbn(v, book.isbn)) ? 0 : emptyIsbnAnswers + 1;
    let titleResults: GoogleVolume[] | null = null;
    if (!isbnResults.some((v) => volumeHasIsbn(v, book.isbn))) {
      const query = titleAuthorQuery(book);
      titleResults = query ? await cachedVolumes(db, query, options) : null;
    }
    const outcome = selectMatch(book, isbnResults, titleResults);
    const state: EnrichmentState = {
      status: outcome.status,
      attemptedAt: new Date().toISOString(),
      attempts,
      ...(outcome.status === 'matched' ? {} : { message: outcome.message }),
    };
    // A validated match is kept: a later unsuccessful attempt never downgrades it.
    await books.updateOne(
      outcome.status === 'matched' ? { _id: book._id } : { _id: book._id, 'enrichment.status': { $ne: 'matched' } },
      { $set: { enrichment: state, ...(outcome.status === 'matched' ? { google: outcome.metadata } : {}) } },
    );
    return state;
  } catch (error) {
    const state: EnrichmentState = {
      status: 'error',
      attemptedAt: new Date().toISOString(),
      attempts,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
    await books.updateOne({ _id: book._id, 'enrichment.status': { $ne: 'matched' } }, { $set: { enrichment: state } });
    if (error instanceof GoogleBooksError) throw error;
    return state;
  }
}
