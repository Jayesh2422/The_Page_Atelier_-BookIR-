/**
 * Search service: query → inverted-index retrieval → ranking → filters → sorting → page.
 *
 * Filtering and non-relevance sorting operate on the top `QUERY_LIMITS.maxCandidates`
 * candidates of the active ranking; the response flags `totalIsCapped` when candidates were
 * cut off. With no query the service browses the catalogue directly (Explore page).
 */
import type { Db } from 'mongodb';
import { PUBLIC_BOOK_PROJECTION, toPublicBook, type BookDoc } from '../books/model.js';
import { collections } from '../db/collections.js';
import { loadIndexMeta } from '../db/mongo-store.js';
import { fieldsFromMask, QUERY_LIMITS } from '../ir/config.js';
import { retrieve, suggestSpelling, type Candidate } from '../ir/engine.js';
import type { FacetValue, SearchHit, SearchResponse } from '../types.js';
import type { SearchParams } from '../validation/params.js';
import { booksByIds, filterQuery, hasFilters, inOrder, requireIndex, sortSpec } from './catalogue.js';

function countFacet(rows: { key: string; label: string | null }[], limit = 10): FacetValue[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const { key, label } of rows) {
    if (!key || !label) continue;
    const entry = counts.get(key) ?? { label, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map(({ label, count }) => ({ value: label, count }));
}

async function browse(db: Db, params: SearchParams, started: number): Promise<SearchResponse> {
  const books = collections(db).books;
  const filter = filterQuery(params.filters);
  const skip = (params.page - 1) * params.pageSize;
  const [docs, total, meta] = await Promise.all([
    books.find(filter, { projection: PUBLIC_BOOK_PROJECTION }).sort(sortSpec(params.sort)).skip(skip).limit(params.pageSize).toArray(),
    hasFilters(params.filters) ? books.countDocuments(filter) : books.estimatedDocumentCount(),
    loadIndexMeta(db),
  ]);
  return {
    query: '',
    terms: [],
    unknownTerms: [],
    mode: params.mode,
    sort: params.sort,
    filters: params.filters,
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalIsCapped: false,
    totalPages: Math.ceil(total / params.pageSize),
    results: docs.map((doc) => ({ book: toPublicBook(doc as BookDoc), score: 0, cosine: 0, matchedTerms: [], matchedFields: [] })),
    suggestions: [],
    facets: {
      authors: (meta?.topAuthors ?? []).slice(0, 12).map((a) => ({ value: a.name, count: a.count })),
      publishers: (meta?.topPublishers ?? []).slice(0, 12).map((p) => ({ value: p.name, count: p.count })),
      years: null,
    },
    notice: null,
    tookMs: Date.now() - started,
  };
}

export async function searchCatalogue(db: Db, params: SearchParams): Promise<SearchResponse> {
  const started = Date.now();
  if (!params.q) return browse(db, params, started);

  const store = await requireIndex(db);
  const [retrieval, suggestions] = await Promise.all([retrieve(store, params.q, params.mode), suggestSpelling(store, params.q)]);
  const books = collections(db).books;

  const capped = retrieval.candidates.length > QUERY_LIMITS.maxCandidates;
  const considered = retrieval.candidates.slice(0, QUERY_LIMITS.maxCandidates);

  // Facets describe the best-ranked candidates before author/publisher/year filters.
  const facetIds = considered.slice(0, QUERY_LIMITS.facetCandidates).map((c) => c.id);
  const facetDocs = facetIds.length
    ? await books.find({ _id: { $in: facetIds } }, { projection: { author: 1, authorKey: 1, publisher: 1, publisherKey: 1, year: 1 } }).toArray()
    : [];
  const years = facetDocs.map((d) => d.year).filter((y): y is number => typeof y === 'number');

  let filtered: Candidate[] = considered;
  if (hasFilters(params.filters) && considered.length > 0) {
    const allowed = await books
      .find({ _id: { $in: considered.map((c) => c.id) }, ...filterQuery(params.filters) }, { projection: { _id: 1 } })
      .toArray();
    const allowedIds = new Set(allowed.map((d) => d._id));
    filtered = considered.filter((c) => allowedIds.has(c.id));
  }

  const total = hasFilters(params.filters) ? filtered.length : retrieval.totalCandidates;
  const skip = (params.page - 1) * params.pageSize;
  let pageIds: string[];
  if (params.sort === 'relevance') {
    pageIds = filtered.slice(skip, skip + params.pageSize).map((c) => c.id);
  } else {
    const sorted = filtered.length
      ? await books
          .find({ _id: { $in: filtered.map((c) => c.id) } }, { projection: { _id: 1 } })
          .sort(sortSpec(params.sort))
          .skip(skip)
          .limit(params.pageSize)
          .toArray()
      : [];
    pageIds = sorted.map((d) => d._id);
  }

  const byId = new Map(filtered.map((c) => [c.id, c]));
  const pageBooks = await booksByIds(db, pageIds);
  const results: SearchHit[] = inOrder(pageIds, pageBooks).map((book) => {
    const candidate = byId.get(book.id)!;
    return {
      book,
      score: params.mode === 'ranked' ? round(candidate.cosine) : candidate.matchedTerms,
      cosine: round(candidate.cosine),
      matchedTerms: candidate.terms,
      matchedFields: fieldsFromMask(candidate.fieldMask),
    };
  });

  let notice: string | null = null;
  if (retrieval.terms.length === 0) {
    notice = 'Your query only contains very common words (such as “the” or “and”), which are not indexed. Try adding a title word or an author name.';
  } else if (retrieval.ignoredTerms.length) {
    notice = `Only the first ${QUERY_LIMITS.maxQueryTerms} distinct terms were used; ignored: ${retrieval.ignoredTerms.join(', ')}.`;
  }

  return {
    query: params.q,
    terms: retrieval.terms,
    unknownTerms: retrieval.unseenTerms,
    mode: params.mode,
    sort: params.sort,
    filters: params.filters,
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalIsCapped: capped,
    totalPages: Math.ceil(Math.min(total, filtered.length) / params.pageSize),
    results,
    suggestions,
    facets: {
      authors: countFacet(facetDocs.map((d) => ({ key: d.authorKey, label: d.author }))),
      publishers: countFacet(facetDocs.map((d) => ({ key: d.publisherKey, label: d.publisher }))),
      years: years.length ? { min: Math.min(...years), max: Math.max(...years) } : null,
    },
    notice,
    tookMs: Date.now() - started,
  };
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
