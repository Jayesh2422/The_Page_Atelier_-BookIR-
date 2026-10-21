import type { FieldName } from '../types.js';

/** Bit flags stored in each posting to record which fields contained the term. */
export const FIELD_BITS: Record<FieldName, number> = {
  title: 1,
  author: 2,
  publisher: 4,
  description: 8,
  categories: 16,
};

export const FIELDS = Object.keys(FIELD_BITS) as FieldName[];

export function fieldsFromMask(mask: number): FieldName[] {
  return FIELDS.filter((field) => (mask & FIELD_BITS[field]) !== 0);
}

/**
 * Field weights used to build the weighted term frequency
 *   tf_w(t, d) = Σ_f  weight(f) · count(t in field f of d)
 * Descriptions and categories are weighted low on purpose: a long description adds many terms
 * to a book's vector, and cosine normalisation then shrinks the weight of its title terms. With
 * description 1 / categories 1.5, enriched books sank below short un-enriched editions (ranked
 * P@10 0.650, MRR 0.725 on the evaluation set); with 0.1 / 0.3 they score 0.831 / 0.938.
 * Changing these values requires rebuilding the index (`npm run build:index`).
 */
export const DEFAULT_FIELD_WEIGHTS: Readonly<Record<FieldName, number>> = {
  title: 3,
  author: 2.5,
  categories: 0.3,
  description: 0.1,
  publisher: 0.75,
};

export interface IndexConfig {
  fieldWeights: Record<FieldName, number>;
  /** Number of postings stored per MongoDB document (postings are impact-ordered). */
  postingsChunkSize: number;
  /** Number of highest-weighted terms kept in each stored document vector. */
  docVectorTerms: number;
}

export const DEFAULT_INDEX_CONFIG: Readonly<IndexConfig> = {
  fieldWeights: { ...DEFAULT_FIELD_WEIGHTS },
  postingsChunkSize: 2000,
  docVectorTerms: 60,
};

/** Query-time limits. They bound database reads so a search fits a serverless invocation. */
export const QUERY_LIMITS = {
  /** Maximum query terms considered (extra terms are ignored and reported). */
  maxQueryTerms: 12,
  /** Postings read per query term — the highest-impact ones (champion list). */
  maxPostingsPerTerm: 20000,
  /** Ranked candidates kept for filtering, sorting and pagination. */
  maxCandidates: 5000,
  /** Ranked candidates inspected to build author/publisher/year facets. */
  facetCandidates: 300,
  maxPageSize: 48,
  defaultPageSize: 24,
  /** Similar-book search: source-vector terms used and postings read per term. */
  similarTerms: 25,
  similarPostingsPerTerm: 4000,
  maxSimilarResults: 48,
} as const;

export function validateFieldWeights(weights: Record<FieldName, number>): void {
  for (const field of FIELDS) {
    const value = weights[field];
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Field weight for "${field}" must be a non-negative number (got ${value}).`);
    }
  }
}
