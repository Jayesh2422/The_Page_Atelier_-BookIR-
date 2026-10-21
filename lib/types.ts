/**
 * Domain and API types shared by the serverless functions, scripts and the React client.
 * This module must stay type-only so the browser bundle never pulls in server code.
 */

export type SearchMode = 'ranked' | 'keyword';
export type SortOrder = 'relevance' | 'title' | 'author' | 'year-desc' | 'year-asc';

/** Indexed text fields. The bit values are stored in postings as a field mask. */
export type FieldName = 'title' | 'author' | 'publisher' | 'description' | 'categories';

export interface CoverSet {
  small: string | null;
  medium: string | null;
  large: string | null;
}

/** Metadata obtained from Google Books, kept separately so provenance stays visible. */
export interface GoogleMetadata {
  volumeId: string;
  matchedBy: 'isbn' | 'title-author';
  confidence: number;
  title: string | null;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  publishedDate: string | null;
  description: string | null;
  categories: string[];
  pageCount: number | null;
  language: string | null;
  thumbnail: string | null;
  infoLink: string | null;
  fetchedAt: string;
}

/** Metadata obtained from Open Library (edition looked up by ISBN, plus its work). */
export interface OpenLibraryMetadata {
  editionKey: string;
  workKey: string | null;
  title: string | null;
  description: string | null;
  subjects: string[];
  pageCount: number | null;
  publishDate: string | null;
  coverId: number | null;
  fetchedAt: string;
}

export type EnrichmentStatus = 'matched' | 'not_found' | 'rejected' | 'error';

export interface EnrichmentState {
  status: EnrichmentStatus;
  attemptedAt: string;
  attempts: number;
  message?: string;
}

/** The public representation of a book returned by the API. */
export interface Book {
  id: string;
  isbn: string;
  isbn13: string | null;
  isbnValid: boolean;
  title: string;
  author: string | null;
  authors: string[];
  year: number | null;
  publisher: string | null;
  /** Cover URLs in priority order (Book-Crossing first, then Google Books). */
  covers: string[];
  description: string | null;
  descriptionSource: 'google-books' | 'open-library' | null;
  /** Page at the source of the description (Google Books or Open Library). */
  descriptionLink: string | null;
  categories: string[];
  pageCount: number | null;
  publishedDate: string | null;
  language: string | null;
  infoLink: string | null;
  enriched: boolean;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface SpellingCorrection {
  from: string;
  to: string;
  distance: number;
}

export interface SpellingSuggestion {
  query: string;
  corrections: SpellingCorrection[];
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface SearchFilters {
  author?: string;
  publisher?: string;
  yearFrom?: number;
  yearTo?: number;
}

export interface SearchHit {
  book: Book;
  /** Cosine similarity (ranked mode) or number of matched query terms (keyword mode). */
  score: number;
  cosine: number;
  matchedTerms: string[];
  matchedFields: FieldName[];
}

export interface SearchResponse {
  query: string;
  terms: string[];
  unknownTerms: string[];
  mode: SearchMode;
  sort: SortOrder;
  filters: SearchFilters;
  page: number;
  pageSize: number;
  total: number;
  /** True when the candidate list was truncated before filtering/sorting. */
  totalIsCapped: boolean;
  totalPages: number;
  results: SearchHit[];
  suggestions: SpellingSuggestion[];
  facets: { authors: FacetValue[]; publishers: FacetValue[]; years: { min: number; max: number } | null };
  notice: string | null;
  tookMs: number;
}

export interface BookDetailsResponse {
  book: Book;
  otherEditions: Book[];
}

export interface SimilarReason {
  kind: 'author' | 'title' | 'description' | 'categories' | 'publisher';
  label: string;
  terms: string[];
}

export interface SimilarHit {
  book: Book;
  similarity: number;
  reasons: SimilarReason[];
}

export interface SimilarResponse {
  source: Book;
  results: SimilarHit[];
  termsUsed: number;
  tookMs: number;
}

export interface AuthorSummary {
  name: string;
  count: number;
}

export interface CatalogueStats {
  books: number;
  vocabulary: number;
  postings: number;
  enriched: number;
  builtAt: string;
}

export interface DiscoverResponse {
  stats: CatalogueStats;
  discover: Book[];
  recent: Book[];
  authors: AuthorSummary[];
  publishers: AuthorSummary[];
  similar: { seed: Book; results: SimilarHit[] } | null;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  database: 'connected' | 'not_configured' | 'unavailable';
  index: 'ready' | 'missing' | 'unknown';
  googleBooksKey: boolean;
  stats: CatalogueStats | null;
}

// ---------- Evaluation ----------

export interface QueryMetrics {
  precisionAtK: number;
  recallAtK: number;
  reciprocalRank: number;
  firstRelevantRank: number | null;
  retrieved: number;
}

export interface EvaluationQueryResult {
  id: string;
  query: string;
  informationNeed: string;
  relevantJudged: number;
  relevantInCatalogue: number;
  skipped: boolean;
  metrics: Record<SearchMode, QueryMetrics>;
  topResults: Record<SearchMode, { id: string; title: string; author: string | null; relevant: boolean }[]>;
}

export interface MetricSummary {
  meanPrecisionAtK: number;
  meanRecallAtK: number;
  mrr: number;
}

export interface EvaluationResponse {
  k: number;
  mrrDepth: number;
  datasetName: string;
  judgmentNote: string;
  source: 'database' | 'bundled-file';
  queriesTotal: number;
  queriesEvaluated: number;
  summary: Record<SearchMode, MetricSummary>;
  queries: EvaluationQueryResult[];
  index: { books: number; builtAt: string; fieldWeights: Record<FieldName, number> };
  computedAt: string;
  tookMs: number;
}
