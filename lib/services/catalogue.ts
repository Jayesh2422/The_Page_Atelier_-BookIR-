/** Shared access to the catalogue: database handle, index store and book look-ups. */
import type { Db, Filter, Sort } from 'mongodb';
import { PUBLIC_BOOK_PROJECTION, toPublicBook, type BookDoc } from '../books/model.js';
import { collections } from '../db/collections.js';
import { getDb } from '../db/mongo.js';
import { MongoIndexStore } from '../db/mongo-store.js';
import { Errors } from '../http/errors.js';
import { normalizeKey } from '../ir/text.js';
import type { Book, SearchFilters, SortOrder } from '../types.js';

export async function catalogueDb(): Promise<Db> {
  return getDb();
}

export async function requireIndex(db: Db): Promise<MongoIndexStore> {
  const store = await MongoIndexStore.open(db);
  if (!store) throw Errors.indexNotBuilt();
  return store;
}

export function filterQuery(filters: SearchFilters): Filter<BookDoc> {
  const query: Filter<BookDoc> = {};
  if (filters.author) query.authorKey = normalizeKey(filters.author);
  if (filters.publisher) query.publisherKey = normalizeKey(filters.publisher);
  if (filters.yearFrom !== undefined || filters.yearTo !== undefined) {
    query.year = {
      ...(filters.yearFrom !== undefined ? { $gte: filters.yearFrom } : {}),
      ...(filters.yearTo !== undefined ? { $lte: filters.yearTo } : {}),
    };
  }
  return query;
}

export function hasFilters(filters: SearchFilters): boolean {
  return Object.values(filters).some((v) => v !== undefined && v !== '');
}

export function sortSpec(sort: SortOrder): Sort {
  switch (sort) {
    case 'author':
      return { authorKey: 1, titleSort: 1, _id: 1 };
    case 'year-desc':
      return { year: -1, titleSort: 1, _id: 1 };
    case 'year-asc':
      return { year: 1, titleSort: 1, _id: 1 };
    default:
      return { titleSort: 1, _id: 1 };
  }
}

/** Fetch books by id and return them as public objects in the order of `ids`. */
export async function booksByIds(db: Db, ids: readonly string[]): Promise<Map<string, Book>> {
  if (ids.length === 0) return new Map();
  const docs = await collections(db)
    .books.find({ _id: { $in: [...ids] } }, { projection: PUBLIC_BOOK_PROJECTION })
    .toArray();
  return new Map(docs.map((doc) => [doc._id, toPublicBook(doc as BookDoc)]));
}

export function inOrder<T>(ids: readonly string[], map: ReadonlyMap<string, T>): T[] {
  return ids.map((id) => map.get(id)).filter((v): v is T => v !== undefined);
}
