/**
 * Builds the inverted index from the `books` collection and stores it in MongoDB.
 *
 * Steps: stream books → tokenise/weight in memory (buildIndex) → write a new index version
 * (vocabulary, postings chunks, document vectors) → flip indexMeta.active → delete older
 * versions. Re-running is safe: leftovers of an interrupted build are removed first.
 */
import type { Db } from 'mongodb';
import { indexableBook, type BookDoc } from '../books/model.js';
import {
  collections,
  ensureIndexes,
  type DocVectorDoc,
  type IndexMetaDoc,
  type PostingsDoc,
  type VocabularyDoc,
} from '../db/collections.js';
import { clearIndexMetaCache } from '../db/mongo-store.js';
import { DEFAULT_INDEX_CONFIG, type IndexConfig } from '../ir/config.js';
import { buildIndex, type BuiltIndex, type IndexableDocument } from '../ir/indexer.js';
import { trigrams } from '../ir/spelling.js';

const WRITE_BATCH = 1000;

export interface BuildIndexOptions {
  config?: IndexConfig;
  log?: (message: string) => void;
}

export interface BuildIndexReport {
  version: string;
  documents: number;
  skippedEmpty: number;
  vocabulary: number;
  postings: number;
  postingsDocuments: number;
  seconds: number;
}

async function insertInBatches<T extends { _id: string }>(
  insert: (docs: T[]) => Promise<unknown>,
  docs: Iterable<T>,
  onProgress?: (written: number) => void,
): Promise<number> {
  let batch: T[] = [];
  let written = 0;
  for (const doc of docs) {
    batch.push(doc);
    if (batch.length >= WRITE_BATCH) {
      await insert(batch);
      written += batch.length;
      onProgress?.(written);
      batch = [];
    }
  }
  if (batch.length) {
    await insert(batch);
    written += batch.length;
    onProgress?.(written);
  }
  return written;
}

export function* vocabularyDocs(index: BuiltIndex, version: string, chunkSize: number): Generator<VocabularyDoc> {
  for (const entry of index.terms.values()) {
    yield {
      _id: `${version}:${entry.term}`,
      v: version,
      term: entry.term,
      df: entry.df,
      idf: entry.idf,
      cf: entry.cf,
      len: entry.term.length,
      grams: trigrams(entry.term),
      chunks: Math.ceil(entry.postings.length / chunkSize),
    };
  }
}

export function* postingsDocs(index: BuiltIndex, version: string, chunkSize: number): Generator<PostingsDoc> {
  for (const entry of index.terms.values()) {
    for (let chunk = 0; chunk * chunkSize < entry.postings.length; chunk++) {
      yield {
        _id: `${version}:${entry.term}:${chunk}`,
        v: version,
        term: entry.term,
        chunk,
        p: entry.postings.slice(chunk * chunkSize, (chunk + 1) * chunkSize).map((p) => ({ ...p, w: round6(p.w) })),
      };
    }
  }
}

export function* docVectorDocs(index: BuiltIndex, version: string): Generator<DocVectorDoc> {
  for (const doc of index.docs.values()) {
    yield {
      _id: `${version}:${doc.id}`,
      v: version,
      d: doc.id,
      length: doc.length,
      distinctTerms: doc.distinctTerms,
      terms: doc.terms.map((t) => ({ ...t, w: round6(t.w) })),
    };
  }
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export async function buildAndStoreIndex(db: Db, options: BuildIndexOptions = {}): Promise<BuildIndexReport> {
  const started = Date.now();
  const log = options.log ?? (() => {});
  const config = options.config ?? DEFAULT_INDEX_CONFIG;
  const c = collections(db);
  await ensureIndexes(db);

  const active = await c.indexMeta.findOne({ _id: 'active' });
  const stale = { v: { $ne: active?.version ?? '' } };
  const removed = await Promise.all([c.vocabulary.deleteMany(stale), c.postings.deleteMany(stale), c.docVectors.deleteMany(stale)]);
  const leftovers = removed.reduce((sum, r) => sum + r.deletedCount, 0);
  if (leftovers) log(`Removed ${leftovers} documents left by an interrupted build.`);

  log('Reading books and building the in-memory index…');
  const documents: IndexableDocument[] = [];
  const cursor = c.books.find({}, { projection: { title: 1, author: 1, publisher: 1, google: 1, openLibrary: 1 } });
  for await (const book of cursor) documents.push(indexableBook(book as BookDoc));
  const index = buildIndex(documents, config);
  documents.length = 0;
  log(`Indexed ${index.totalDocuments} books: ${index.terms.size} terms, ${index.stats.postings} postings.`);

  const version = `v${Date.now().toString(36)}`;
  const chunkSize = config.postingsChunkSize;
  const vocabulary = await insertInBatches((docs) => c.vocabulary.insertMany(docs, { ordered: false }), vocabularyDocs(index, version, chunkSize), (n) => n % 20000 === 0 && log(`  vocabulary: ${n}`));
  const postingsDocuments = await insertInBatches((docs) => c.postings.insertMany(docs, { ordered: false }), postingsDocs(index, version, chunkSize), (n) => n % 20000 === 0 && log(`  postings documents: ${n}`));
  await insertInBatches((docs) => c.docVectors.insertMany(docs, { ordered: false }), docVectorDocs(index, version), (n) => n % 50000 === 0 && log(`  document vectors: ${n}`));

  const [topAuthors, topPublishers, enrichedBooks] = await Promise.all([
    topValues(db, 'authorKey', 'author'),
    topValues(db, 'publisherKey', 'publisher'),
    c.books.countDocuments({ $or: [{ 'enrichment.status': 'matched' }, { 'openLibraryEnrichment.status': 'matched' }] }),
  ]);

  const seconds = (Date.now() - started) / 1000;
  const meta: IndexMetaDoc = {
    _id: 'active',
    version,
    totalDocuments: index.totalDocuments,
    vocabularySize: index.terms.size,
    postings: index.stats.postings,
    builtAt: new Date(),
    buildSeconds: seconds,
    fieldWeights: { ...config.fieldWeights },
    postingsChunkSize: chunkSize,
    averageDocumentLength: index.stats.averageDocumentLength,
    enrichedBooks,
    topAuthors,
    topPublishers,
  };
  await c.indexMeta.replaceOne({ _id: 'active' }, meta, { upsert: true });
  clearIndexMetaCache();

  const old = { v: { $ne: version } };
  await Promise.all([c.vocabulary.deleteMany(old), c.postings.deleteMany(old), c.docVectors.deleteMany(old)]);

  return {
    version,
    documents: index.totalDocuments,
    skippedEmpty: index.stats.skippedEmpty,
    vocabulary,
    postings: index.stats.postings,
    postingsDocuments,
    seconds,
  };
}

/** Placeholder values that Book-Crossing uses instead of a real name. */
export const PLACEHOLDER_NAMES = ['', 'not applicable na', 'unknown', 'n a', 'na', 'various', 'anonymous'];

/** Most frequent authors/publishers in the catalogue (counts of catalogue records). */
async function topValues(db: Db, key: 'authorKey' | 'publisherKey', display: 'author' | 'publisher', limit = 24) {
  const rows = await collections(db)
    .books.aggregate<{ _id: string; name: string; count: number }>([
      { $match: { [key]: { $nin: [...PLACEHOLDER_NAMES, null] } } },
      { $group: { _id: `$${key}`, name: { $first: `$${display}` }, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit },
    ], { allowDiskUse: true })
    .toArray();
  return rows.map((r) => ({ name: r.name, count: r.count }));
}
