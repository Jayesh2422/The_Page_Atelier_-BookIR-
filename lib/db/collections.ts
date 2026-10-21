/**
 * MongoDB collections and their indexes.
 *
 *   books              one document per Book-Crossing record (_id = normalised ISBN)
 *   vocabulary         one document per (index version, term): df, idf, trigrams for spelling
 *   postings           impact-ordered postings, split into chunks of ≤ postingsChunkSize
 *   docVectors         the top-weighted terms of each book's unit-length TF-IDF vector
 *   indexMeta          { _id: "active" } points at the index version used by queries
 *   evaluationQueries  evaluation queries and their manual relevance judgments
 *   googleBooksCache   raw Google Books API responses keyed by request
 *   openLibraryCache   raw Open Library responses keyed by path (404s included)
 *
 * Index data is versioned: a rebuild writes a new version alongside the old one, then flips
 * indexMeta.active in a single write and deletes the old version. Searches never see a
 * half-built index, and a failed build can simply be re-run.
 */
import type { Db } from 'mongodb';
import type { BookDoc } from '../books/model.js';
import type { EvaluationQuery } from '../evaluation/run.js';
import type { Posting } from '../ir/indexer.js';
import type { AuthorSummary, FieldName } from '../types.js';

export interface VocabularyDoc {
  _id: string; // `${version}:${term}`
  v: string;
  term: string;
  df: number;
  idf: number;
  cf: number;
  len: number;
  grams: string[];
  chunks: number;
}

export interface PostingsDoc {
  _id: string; // `${version}:${term}:${chunk}`
  v: string;
  term: string;
  chunk: number;
  p: Posting[];
}

export interface DocVectorDoc {
  _id: string; // `${version}:${bookId}`
  v: string;
  d: string;
  length: number;
  distinctTerms: number;
  terms: { t: string; w: number; m: number }[];
}

export interface IndexMetaDoc {
  _id: 'active';
  version: string;
  totalDocuments: number;
  vocabularySize: number;
  postings: number;
  builtAt: Date;
  buildSeconds: number;
  fieldWeights: Record<FieldName, number>;
  postingsChunkSize: number;
  averageDocumentLength: number;
  enrichedBooks: number;
  topAuthors: AuthorSummary[];
  topPublishers: AuthorSummary[];
}

export interface EvaluationQueryDoc extends EvaluationQuery {
  _id: string;
  order: number;
  dataset: string;
  updatedAt: Date;
}

export interface GoogleCacheDoc {
  _id: string; // request key, e.g. "isbn:0439139597"
  status: number;
  body: unknown;
  fetchedAt: Date;
}

export interface OpenLibraryCacheDoc {
  _id: string; // request path, e.g. "/isbn/0439139597.json"
  status: number;
  body: unknown;
  fetchedAt: Date;
}

export function collections(db: Db) {
  return {
    books: db.collection<BookDoc>('books'),
    vocabulary: db.collection<VocabularyDoc>('vocabulary'),
    postings: db.collection<PostingsDoc>('postings'),
    docVectors: db.collection<DocVectorDoc>('docVectors'),
    indexMeta: db.collection<IndexMetaDoc>('indexMeta'),
    evaluationQueries: db.collection<EvaluationQueryDoc>('evaluationQueries'),
    googleBooksCache: db.collection<GoogleCacheDoc>('googleBooksCache'),
    openLibraryCache: db.collection<OpenLibraryCacheDoc>('openLibraryCache'),
  };
}

export type Collections = ReturnType<typeof collections>;

/**
 * Indexes that serve actual application queries. `_id` already gives unique ISBN lookups;
 * the others support filters/sorting in browse mode, edition grouping and enrichment batches.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  const c = collections(db);
  await Promise.all([
    c.books.createIndexes([
      { key: { titleSort: 1, _id: 1 }, name: 'titleSort' },
      { key: { authorKey: 1, titleSort: 1 }, name: 'author_title' },
      { key: { publisherKey: 1, titleSort: 1 }, name: 'publisher_title' },
      { key: { year: 1 }, name: 'year' },
      { key: { importedAt: -1, _id: 1 }, name: 'importedAt' },
      { key: { dedupKey: 1 }, name: 'dedupKey' },
      { key: { isbn13: 1 }, name: 'isbn13', sparse: true },
      { key: { 'enrichment.status': 1 }, name: 'enrichmentStatus', sparse: true },
      { key: { 'openLibraryEnrichment.status': 1 }, name: 'openLibraryEnrichmentStatus', sparse: true },
    ]),
    c.vocabulary.createIndexes([
      { key: { v: 1, grams: 1 }, name: 'version_grams' },
    ]),
    c.postings.createIndexes([{ key: { v: 1, term: 1, chunk: 1 }, name: 'version_term_chunk' }]),
    c.docVectors.createIndexes([{ key: { v: 1 }, name: 'version' }]),
    c.evaluationQueries.createIndexes([{ key: { dataset: 1, order: 1 }, name: 'dataset_order' }]),
  ]);
}
