/**
 * Inverted-index construction.
 *
 * For every vocabulary term the index stores
 *   - df(t): the number of documents containing t,
 *   - idf(t): the smoothed inverse document frequency,
 *   - a postings list of (document id, weighted tf, normalised TF-IDF weight, field mask).
 *
 * Postings are sorted by weight (descending, ties by document id) — an "impact-ordered"
 * index. Query processing can then read only the highest-impact postings of very common
 * terms (a champion list) while rare terms are always read completely.
 *
 * The builder is a pure function so it can be unit-tested on a toy corpus and reused by the
 * MongoDB index script.
 */
import type { FieldName } from '../types.js';
import { DEFAULT_INDEX_CONFIG, FIELD_BITS, FIELDS, type IndexConfig, validateFieldWeights } from './config.js';
import { tokenize } from './text.js';
import { idf as idfOf, tfWeight } from './vsm.js';

export interface IndexableDocument {
  id: string;
  fields: Partial<Record<FieldName, string | readonly string[] | null | undefined>>;
}

export interface Posting {
  /** Document id. */
  d: string;
  /** Field-weighted term frequency tf_w(t, d). */
  tf: number;
  /** Normalised TF-IDF weight w(t, d) / |d|. */
  w: number;
  /** Bit mask of the fields that contain the term (see FIELD_BITS). */
  m: number;
}

export interface TermEntry {
  term: string;
  df: number;
  idf: number;
  /** Collection frequency: total raw occurrences across all documents. */
  cf: number;
  postings: Posting[];
}

export interface DocVectorTerm {
  t: string;
  w: number;
  m: number;
}

export interface DocVector {
  id: string;
  /** Number of indexed tokens across all fields. */
  length: number;
  /** Highest-weighted terms of the unit-length document vector. */
  terms: DocVectorTerm[];
  /** Number of distinct terms before truncation to `terms`. */
  distinctTerms: number;
}

export interface BuiltIndex {
  totalDocuments: number;
  terms: Map<string, TermEntry>;
  docs: Map<string, DocVector>;
  config: IndexConfig;
  stats: { postings: number; averageDocumentLength: number; skippedEmpty: number };
}

interface FieldCounts {
  tf: number;
  raw: number;
  mask: number;
}

/** Tokenise every field and accumulate weighted term frequencies for one document. */
export function analyzeDocument(
  doc: IndexableDocument,
  fieldWeights: Record<FieldName, number>,
): { counts: Map<string, FieldCounts>; length: number } {
  const counts = new Map<string, FieldCounts>();
  let length = 0;
  for (const field of FIELDS) {
    const weight = fieldWeights[field];
    const value = doc.fields[field];
    if (!value || weight === 0) continue;
    const text = typeof value === 'string' ? value : value.join(' \n ');
    for (const token of tokenize(text)) {
      length++;
      const entry = counts.get(token) ?? { tf: 0, raw: 0, mask: 0 };
      entry.tf += weight;
      entry.raw += 1;
      entry.mask |= FIELD_BITS[field];
      counts.set(token, entry);
    }
  }
  return { counts, length };
}

export function comparePostings(a: Posting, b: Posting): number {
  return b.w - a.w || (a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
}

export function buildIndex(
  documents: Iterable<IndexableDocument>,
  config: IndexConfig = DEFAULT_INDEX_CONFIG,
): BuiltIndex {
  validateFieldWeights(config.fieldWeights);

  // Pass 1: term frequencies per document and document frequencies per term.
  const perDoc: { id: string; counts: Map<string, FieldCounts>; length: number }[] = [];
  const df = new Map<string, number>();
  const cf = new Map<string, number>();
  const seenIds = new Set<string>();
  let skippedEmpty = 0;
  let totalLength = 0;

  for (const doc of documents) {
    if (seenIds.has(doc.id)) throw new Error(`Duplicate document id "${doc.id}" passed to buildIndex.`);
    seenIds.add(doc.id);
    const { counts, length } = analyzeDocument(doc, config.fieldWeights);
    if (counts.size === 0) {
      skippedEmpty++;
      continue;
    }
    perDoc.push({ id: doc.id, counts, length });
    totalLength += length;
    for (const [term, entry] of counts) {
      df.set(term, (df.get(term) ?? 0) + 1);
      cf.set(term, (cf.get(term) ?? 0) + entry.raw);
    }
  }

  const totalDocuments = perDoc.length;
  const idfs = new Map<string, number>();
  for (const [term, frequency] of df) idfs.set(term, idfOf(frequency, totalDocuments));

  // Pass 2: TF-IDF weights, L2 normalisation, postings and document vectors.
  const terms = new Map<string, TermEntry>();
  for (const [term, frequency] of df) {
    terms.set(term, { term, df: frequency, idf: idfs.get(term)!, cf: cf.get(term)!, postings: [] });
  }

  const docs = new Map<string, DocVector>();
  let postingsCount = 0;
  for (const { id, counts, length } of perDoc) {
    const weighted: DocVectorTerm[] = [];
    let sumSquares = 0;
    for (const [term, entry] of counts) {
      const w = tfWeight(entry.tf) * idfs.get(term)!;
      sumSquares += w * w;
      weighted.push({ t: term, w, m: entry.mask });
    }
    const norm = Math.sqrt(sumSquares);
    for (const item of weighted) {
      item.w = norm > 0 ? item.w / norm : 0;
      const entry = counts.get(item.t)!;
      terms.get(item.t)!.postings.push({ d: id, tf: round(entry.tf), w: item.w, m: item.m });
      postingsCount++;
    }
    weighted.sort((a, b) => b.w - a.w || (a.t < b.t ? -1 : 1));
    docs.set(id, {
      id,
      length,
      distinctTerms: weighted.length,
      terms: weighted.slice(0, config.docVectorTerms),
    });
  }

  for (const entry of terms.values()) entry.postings.sort(comparePostings);

  return {
    totalDocuments,
    terms,
    docs,
    config,
    stats: {
      postings: postingsCount,
      averageDocumentLength: totalDocuments ? totalLength / totalDocuments : 0,
      skippedEmpty,
    },
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
