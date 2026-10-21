/**
 * Open Library metadata enrichment — a second source, used where Google Books has no
 * description, subjects, page count or cover. No API key or quota is needed.
 *
 * Lookup: GET https://openlibrary.org/isbn/<isbn>.json returns the edition with exactly that
 * ISBN (pages, publish date, cover ids and a link to its "work"); the work
 * (https://openlibrary.org/works/<id>.json) holds the description and subjects shared by all
 * editions.
 *
 * Validation: the edition is identified by ISBN, so it is the same book by construction. As a
 * guard against bad catalogue data the edition title must still share at least one word with
 * the Book-Crossing title, otherwise the result is rejected and nothing is attached.
 *
 * Open Library asks API users to identify themselves with a User-Agent and to keep request
 * rates low; responses (including 404s) are cached in MongoDB so each URL is fetched once.
 */
import type { Db } from 'mongodb';
import { titleWithoutParentheticals, type BookDoc } from '../books/model.js';
import { collections } from '../db/collections.js';
import { tokenize } from '../ir/text.js';
import type { EnrichmentState, OpenLibraryMetadata } from '../types.js';

export const OPEN_LIBRARY_BASE = 'https://openlibrary.org';
export const USER_AGENT = 'PageAtelier/1.0 (student book search project)';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 90;
const MAX_SUBJECTS = 8;

export class OpenLibraryError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'OpenLibraryError';
  }
}

export interface OpenLibraryFetchOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface Edition {
  key?: string;
  title?: string;
  subtitle?: string;
  works?: { key?: string }[];
  covers?: number[];
  number_of_pages?: number;
  publish_date?: string;
  description?: unknown;
  subjects?: unknown[];
}

interface Work {
  key?: string;
  description?: unknown;
  subjects?: unknown[];
  covers?: number[];
}

/** GET a JSON document; returns null for 404 (the record does not exist). */
export async function fetchJson(path: string, options: OpenLibraryFetchOptions = {}): Promise<unknown | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(new URL(path, OPEN_LIBRARY_BASE), {
      signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new OpenLibraryError(timeout ? 'Open Library request timed out' : 'Open Library request failed', null, true);
  }
  if (response.status === 404) return null;
  if (response.status === 429 || response.status >= 500) throw new OpenLibraryError(`Open Library responded with HTTP ${response.status}`, response.status, true);
  if (!response.ok) throw new OpenLibraryError(`Open Library responded with HTTP ${response.status}`, response.status, false);
  try {
    return await response.json();
  } catch {
    throw new OpenLibraryError('Open Library returned invalid JSON', response.status, false);
  }
}

/** Fetch through the MongoDB cache (404s are cached as null bodies). */
export async function cachedJson(db: Db | null, path: string, options: OpenLibraryFetchOptions = {}): Promise<unknown | null> {
  const cache = db ? collections(db).openLibraryCache : null;
  if (cache) {
    const hit = await cache.findOne({ _id: path });
    if (hit && Date.now() - hit.fetchedAt.getTime() < CACHE_TTL_MS) return hit.body;
  }
  const body = await fetchJson(path, options);
  if (cache) await cache.replaceOne({ _id: path }, { status: body === null ? 404 : 200, body, fetchedAt: new Date() }, { upsert: true });
  return body;
}

/**
 * Open Library descriptions are free text, sometimes Markdown with link lists and
 * "----------" separators followed by notes such as "Also contained in:". Keep the prose only.
 */
export function cleanDescription(value: unknown): string | null {
  const raw = typeof value === 'string' ? value : value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'string' ? (value as { value: string }).value : null;
  if (!raw) return null;
  const text = raw
    .replace(/\r\n/g, '\n')
    .split(/\n\s*-{3,}\s*\n/)[0]!
    .replace(/^\s*\[\d+\]:\s*\S+.*$/gm, '')
    .replace(/\(\[source\]\[\d+\]\)/gi, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[\d+\]/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length >= 20 ? text : null;
}

/** Subjects without Open Library's machine tags (e.g. "nyt:hardcover-fiction=2007-01-01"). */
export function cleanSubjects(values: unknown[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    if (typeof value !== 'string') continue;
    const subject = value.trim();
    if (!subject || /[:=]/.test(subject) || subject.length > 60) continue;
    const key = subject.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(subject);
    if (result.length >= MAX_SUBJECTS) break;
  }
  return result;
}

const firstCover = (covers: unknown): number | null =>
  Array.isArray(covers) ? ((covers.find((c) => typeof c === 'number' && c > 0) as number | undefined) ?? null) : null;

/** The edition title must share at least one indexed word with the catalogue title. */
export function titlesAgree(recordTitle: string, editionTitle: string | undefined): boolean {
  const record = new Set(tokenize(titleWithoutParentheticals(recordTitle)));
  return tokenize(editionTitle).some((t) => record.has(t));
}

export function toOpenLibraryMetadata(edition: Edition, work: Work | null): OpenLibraryMetadata {
  const pages = typeof edition.number_of_pages === 'number' && edition.number_of_pages > 0 ? edition.number_of_pages : null;
  return {
    editionKey: edition.key ?? '',
    workKey: work?.key ?? edition.works?.[0]?.key ?? null,
    title: edition.title ?? null,
    description: cleanDescription(edition.description) ?? cleanDescription(work?.description),
    subjects: cleanSubjects([...(work?.subjects ?? []), ...(edition.subjects ?? [])]),
    pageCount: pages,
    publishDate: typeof edition.publish_date === 'string' ? edition.publish_date : null,
    coverId: firstCover(edition.covers) ?? firstCover(work?.covers),
    fetchedAt: new Date().toISOString(),
  };
}

export type OpenLibraryOutcome = { status: 'matched'; metadata: OpenLibraryMetadata } | { status: 'not_found' | 'rejected'; message: string };

/** Look up a record by ISBN (edition + work) without touching the database's books. */
export async function lookupOpenLibrary(
  db: Db | null,
  book: Pick<BookDoc, 'isbn' | 'isbnValid' | 'title'>,
  options: OpenLibraryFetchOptions = {},
): Promise<OpenLibraryOutcome> {
  if (!book.isbnValid) return { status: 'not_found', message: 'No valid ISBN to look up.' };
  const edition = (await cachedJson(db, `/isbn/${book.isbn}.json`, options)) as Edition | null;
  if (!edition || typeof edition !== 'object' || typeof edition.key !== 'string') return { status: 'not_found', message: 'No Open Library edition for this ISBN.' };
  if (!titlesAgree(book.title, `${edition.title ?? ''} ${edition.subtitle ?? ''}`)) {
    return { status: 'rejected', message: 'The Open Library edition title does not match the catalogue title.' };
  }
  const workKey = edition.works?.[0]?.key;
  const work = typeof workKey === 'string' && /^\/works\/OL\d+W$/.test(workKey) ? ((await cachedJson(db, `${workKey}.json`, options)) as Work | null) : null;
  return { status: 'matched', metadata: toOpenLibraryMetadata(edition, work) };
}

/** Look up one record and store the outcome; a stored match is never downgraded. */
export async function enrichFromOpenLibrary(
  db: Db,
  book: Pick<BookDoc, '_id' | 'isbn' | 'isbnValid' | 'title' | 'openLibraryEnrichment'>,
  options: OpenLibraryFetchOptions = {},
): Promise<EnrichmentState> {
  const books = collections(db).books;
  const attempts = (book.openLibraryEnrichment?.attempts ?? 0) + 1;
  const notMatched = { _id: book._id, 'openLibraryEnrichment.status': { $ne: 'matched' as const } };
  try {
    const outcome = await lookupOpenLibrary(db, book, options);
    const state: EnrichmentState = {
      status: outcome.status,
      attemptedAt: new Date().toISOString(),
      attempts,
      ...(outcome.status === 'matched' ? {} : { message: outcome.message }),
    };
    await books.updateOne(outcome.status === 'matched' ? { _id: book._id } : notMatched, {
      $set: { openLibraryEnrichment: state, ...(outcome.status === 'matched' ? { openLibrary: outcome.metadata } : {}) },
    });
    return state;
  } catch (error) {
    const state: EnrichmentState = { status: 'error', attemptedAt: new Date().toISOString(), attempts, message: error instanceof Error ? error.message : 'Unknown error' };
    await books.updateOne(notMatched, { $set: { openLibraryEnrichment: state } });
    if (error instanceof OpenLibraryError) throw error;
    return state;
  }
}
