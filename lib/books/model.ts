/**
 * The stored book document, record cleaning for the Book-Crossing import, and conversion to
 * the public API representation.
 */
import type { IndexableDocument } from '../ir/indexer.js';
import { decodeEntities, normalizeKey } from '../ir/text.js';
import type { Book, CoverSet, EnrichmentState, GoogleMetadata, OpenLibraryMetadata } from '../types.js';
import { isbn10To13, isValidIsbn, isValidIsbn13, normalizeIsbn } from './isbn.js';

export interface BookDoc {
  /** Stable internal id: the normalised Book-Crossing ISBN. */
  _id: string;
  isbn: string;
  isbn13: string | null;
  isbnValid: boolean;
  title: string;
  author: string | null;
  year: number | null;
  publisher: string | null;
  /**
   * HTTPS cover URLs derived from the Book-Crossing image URLs. The only change is the host
   * rewrite images.amazon.com → images-na.ssl-images-amazon.com (see upgradeCoverUrl).
   */
  covers: CoverSet;
  titleSort: string;
  authorKey: string;
  publisherKey: string;
  /** Groups editions of the same work (normalised title without parentheticals + author). */
  dedupKey: string;
  source: 'book-crossing';
  importedAt: Date;
  google?: GoogleMetadata | null;
  enrichment?: EnrichmentState | null;
  openLibrary?: OpenLibraryMetadata | null;
  openLibraryEnrichment?: EnrichmentState | null;
}

export const RAW_COLUMNS = [
  'ISBN', 'Book-Title', 'Book-Author', 'Year-Of-Publication', 'Publisher', 'Image-URL-S', 'Image-URL-M', 'Image-URL-L',
] as const;

export type RawBookRecord = Record<(typeof RAW_COLUMNS)[number], string>;

export type CleanResult =
  | { ok: true; book: Omit<BookDoc, 'importedAt'> }
  | { ok: false; reason: 'missing-isbn' | 'missing-title' | 'malformed-row' };

export function cleanText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = decodeEntities(value)
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' ? null : cleaned;
}

export function parseYear(value: string | null | undefined, currentYear = new Date().getFullYear()): number | null {
  const trimmed = (value ?? '').trim();
  if (!/^\d{3,4}$/.test(trimmed)) return null;
  const year = Number(trimmed);
  // Book-Crossing uses 0 for "unknown" and contains a few impossible future years.
  return year >= 1000 && year <= currentYear + 1 ? year : null;
}

/**
 * The original images.amazon.com host now answers 403; the same image paths are served over
 * HTTPS by images-na.ssl-images-amazon.com. Anything that is not an http(s) URL is dropped.
 */
export function upgradeCoverUrl(value: string | null | undefined): string | null {
  const url = cleanText(value);
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.hostname === 'images.amazon.com') parsed.hostname = 'images-na.ssl-images-amazon.com';
  parsed.protocol = 'https:';
  return parsed.toString();
}

export function titleWithoutParentheticals(title: string): string {
  return title.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').trim() || title;
}

export function dedupKeyFor(title: string, author: string | null): string {
  return `${normalizeKey(titleWithoutParentheticals(title))}|${normalizeKey(author)}`;
}

export function cleanRecord(raw: RawBookRecord): CleanResult {
  const isbn = normalizeIsbn(raw['ISBN']);
  if (!isbn) return { ok: false, reason: 'missing-isbn' };
  const title = cleanText(raw['Book-Title']);
  if (!title) return { ok: false, reason: 'missing-title' };
  const author = cleanText(raw['Book-Author']);
  const publisher = cleanText(raw['Publisher']);
  const isbnValid = isValidIsbn(isbn);
  return {
    ok: true,
    book: {
      _id: isbn,
      isbn,
      isbn13: isValidIsbn13(isbn) ? isbn : isbn10To13(isbn),
      isbnValid,
      title,
      author,
      year: parseYear(raw['Year-Of-Publication']),
      publisher,
      covers: {
        small: upgradeCoverUrl(raw['Image-URL-S']),
        medium: upgradeCoverUrl(raw['Image-URL-M']),
        large: upgradeCoverUrl(raw['Image-URL-L']),
      },
      titleSort: normalizeKey(title),
      authorKey: normalizeKey(author),
      publisherKey: normalizeKey(publisher),
      dedupKey: dedupKeyFor(title, author),
      source: 'book-crossing',
    },
  };
}

/** Google Books thumbnails: force HTTPS and remove the page-curl effect. */
export function cleanGoogleThumbnail(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    parsed.protocol = 'https:';
    parsed.searchParams.delete('edge');
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Open Library cover by ISBN — the last fallback. `default=false` makes Open Library answer
 * 404 instead of a blank image when it has no cover, so the client moves on to its
 * placeholder. No key or quota is needed (ISBN lookups are rate-limited per visitor IP).
 */
export function openLibraryCoverUrl(isbn: string, isbnValid: boolean): string | null {
  return isbnValid ? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false` : null;
}

/** Open Library cover by cover id (not rate-limited, unlike ISBN-based cover URLs). */
export function openLibraryCoverById(coverId: number | null | undefined): string | null {
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false` : null;
}

/**
 * Fields fed to the inverted index. Book-Crossing values first; Google Books fills gaps, then
 * Open Library (description and subjects only when Google Books has none).
 */
export function indexableBook(doc: Pick<BookDoc, '_id' | 'title' | 'author' | 'publisher' | 'google' | 'openLibrary'>): IndexableDocument {
  const google = doc.google ?? null;
  const ol = doc.openLibrary ?? null;
  return {
    id: doc._id,
    fields: {
      title: [doc.title, google?.subtitle ?? ''].filter(Boolean).join(' '),
      author: doc.author ?? (google?.authors.length ? google.authors.join(', ') : null),
      publisher: doc.publisher ?? google?.publisher ?? null,
      description: google?.description ?? ol?.description ?? null,
      categories: google?.categories.length ? google.categories : (ol?.subjects ?? []),
    },
  };
}

/** Projection with every field needed by `toPublicBook` (keeps network transfer small). */
export const PUBLIC_BOOK_PROJECTION = {
  isbn: 1, isbn13: 1, isbnValid: 1, title: 1, author: 1, year: 1, publisher: 1, covers: 1, google: 1, enrichment: 1, openLibrary: 1, openLibraryEnrichment: 1,
} as const;

type PublicBookSource = Pick<BookDoc, '_id' | 'isbn' | 'isbn13' | 'isbnValid' | 'title' | 'author' | 'year' | 'publisher' | 'covers' | 'google' | 'enrichment'> &
  Partial<Pick<BookDoc, 'openLibrary' | 'openLibraryEnrichment'>>;

export function toPublicBook(doc: PublicBookSource): Book {
  const google = doc.google ?? null;
  const ol = doc.openLibrary ?? null;
  // Priority: Book-Crossing (Amazon) → Google Books → Open Library (cover id, then ISBN).
  const covers = [
    doc.covers?.large,
    doc.covers?.medium,
    google?.thumbnail,
    openLibraryCoverById(ol?.coverId),
    openLibraryCoverUrl(doc.isbn, doc.isbnValid),
  ].filter((u): u is string => Boolean(u));
  const description = google?.description ?? ol?.description ?? null;
  const descriptionSource = google?.description ? ('google-books' as const) : ol?.description ? ('open-library' as const) : null;
  const olLink = ol ? `https://openlibrary.org${ol.workKey ?? ol.editionKey}` : null;
  const authors = doc.author ? [doc.author] : (google?.authors ?? []);
  return {
    id: doc._id,
    isbn: doc.isbn,
    isbn13: doc.isbn13,
    isbnValid: doc.isbnValid,
    title: doc.title,
    author: doc.author ?? (google?.authors.length ? google.authors.join(', ') : null),
    authors,
    year: doc.year,
    publisher: doc.publisher ?? google?.publisher ?? null,
    covers: [...new Set(covers)],
    description,
    descriptionSource,
    descriptionLink: descriptionSource === 'google-books' ? (google?.infoLink ?? null) : descriptionSource === 'open-library' ? olLink : null,
    categories: google?.categories.length ? google.categories : (ol?.subjects ?? []),
    pageCount: google?.pageCount ?? ol?.pageCount ?? null,
    publishedDate: google?.publishedDate ?? ol?.publishDate ?? null,
    language: google?.language ?? null,
    infoLink: google?.infoLink ?? null,
    enriched: doc.enrichment?.status === 'matched' || doc.openLibraryEnrichment?.status === 'matched',
  };
}
