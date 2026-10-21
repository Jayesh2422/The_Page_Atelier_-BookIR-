/** IndexStore implementation that reads the versioned inverted index from MongoDB. */
import type { Db } from 'mongodb';
import type { DocVector, Posting } from '../ir/indexer.js';
import { trigrams, type VocabularyTerm } from '../ir/spelling.js';
import type { IndexInfo, IndexStore, TermStats } from '../ir/store.js';
import { collections, type Collections, type IndexMetaDoc } from './collections.js';

const META_TTL_MS = 30_000;
const SPELLING_CANDIDATE_LIMIT = 2000;

const metaCache = new Map<string, { at: number; meta: IndexMetaDoc | null }>();

export async function loadIndexMeta(db: Db, { fresh = false } = {}): Promise<IndexMetaDoc | null> {
  const cached = metaCache.get(db.databaseName);
  if (!fresh && cached && Date.now() - cached.at < META_TTL_MS) return cached.meta;
  const meta = await collections(db).indexMeta.findOne({ _id: 'active' });
  metaCache.set(db.databaseName, { at: Date.now(), meta });
  return meta;
}

export function clearIndexMetaCache(): void {
  metaCache.clear();
}

export class MongoIndexStore implements IndexStore {
  private readonly c: Collections;

  private constructor(
    db: Db,
    private readonly meta: IndexMetaDoc,
  ) {
    this.c = collections(db);
  }

  /** Returns null when no index has been built yet. */
  static async open(db: Db): Promise<MongoIndexStore | null> {
    const meta = await loadIndexMeta(db);
    return meta ? new MongoIndexStore(db, meta) : null;
  }

  get version(): string {
    return this.meta.version;
  }

  get metadata(): IndexMetaDoc {
    return this.meta;
  }

  async info(): Promise<IndexInfo> {
    return {
      version: this.meta.version,
      totalDocuments: this.meta.totalDocuments,
      vocabularySize: this.meta.vocabularySize,
      postings: this.meta.postings,
      builtAt: this.meta.builtAt.toISOString(),
      fieldWeights: this.meta.fieldWeights,
    };
  }

  async termStats(terms: readonly string[]): Promise<Map<string, TermStats>> {
    const result = new Map<string, TermStats>();
    if (terms.length === 0) return result;
    const docs = await this.c.vocabulary
      .find({ _id: { $in: terms.map((t) => `${this.version}:${t}`) } }, { projection: { term: 1, df: 1, idf: 1 } })
      .toArray();
    for (const doc of docs) result.set(doc.term, { term: doc.term, df: doc.df, idf: doc.idf });
    return result;
  }

  async postings(terms: readonly string[], maxPerTerm: number): Promise<Map<string, Posting[]>> {
    const result = new Map<string, Posting[]>();
    if (terms.length === 0) return result;
    const maxChunks = Math.max(1, Math.ceil(maxPerTerm / this.meta.postingsChunkSize));
    const docs = await this.c.postings
      .find({ v: this.version, term: { $in: [...terms] }, chunk: { $lt: maxChunks } })
      .toArray();
    docs.sort((a, b) => a.chunk - b.chunk);
    for (const doc of docs) {
      const list = result.get(doc.term) ?? [];
      list.push(...doc.p);
      result.set(doc.term, list);
    }
    for (const [term, list] of result) if (list.length > maxPerTerm) result.set(term, list.slice(0, maxPerTerm));
    return result;
  }

  async docVector(id: string): Promise<DocVector | null> {
    const doc = await this.c.docVectors.findOne({ _id: `${this.version}:${id}` });
    return doc ? { id: doc.d, length: doc.length, distinctTerms: doc.distinctTerms, terms: doc.terms } : null;
  }

  /**
   * k-gram candidate generation, executed inside MongoDB: vocabulary terms sharing at least
   * `minShared` trigrams (multikey index on grams) and within the length bound.
   */
  async spellingCandidates(term: string, minShared: number, maxLengthDifference: number): Promise<VocabularyTerm[]> {
    const grams = trigrams(term);
    const docs = await this.c.vocabulary
      .aggregate<{ term: string; df: number }>([
        {
          $match: {
            v: this.version,
            grams: { $in: grams },
            len: { $gte: term.length - maxLengthDifference, $lte: term.length + maxLengthDifference },
          },
        },
        // $literal is required: boundary trigrams such as "$ri" would otherwise be read as field paths.
        { $project: { _id: 0, term: 1, df: 1, shared: { $size: { $setIntersection: ['$grams', { $literal: grams }] } } } },
        { $match: { shared: { $gte: minShared } } },
        { $sort: { shared: -1, df: -1 } },
        { $limit: SPELLING_CANDIDATE_LIMIT },
        { $project: { term: 1, df: 1 } },
      ])
      .toArray();
    return docs;
  }
}
