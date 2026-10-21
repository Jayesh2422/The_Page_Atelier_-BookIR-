/** Validation of API query-string parameters. */
import { z } from 'zod';
import { QUERY_LIMITS } from '../ir/config.js';
import { Errors } from '../http/errors.js';
import type { SearchFilters, SearchMode, SortOrder } from '../types.js';

const currentYear = new Date().getFullYear();
const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const optionalYear = z.coerce.number().int().min(1000).max(currentYear + 1).optional();

const searchSchema = z
  .object({
    q: z.string().trim().max(200, 'The query is too long (maximum 200 characters).').default(''),
    mode: z.enum(['ranked', 'keyword']).default('ranked'),
    sort: z.enum(['relevance', 'title', 'author', 'year-desc', 'year-asc']).default('relevance'),
    page: z.coerce.number().int().min(1).max(500).default(1),
    pageSize: z.coerce.number().int().min(1).max(QUERY_LIMITS.maxPageSize).default(QUERY_LIMITS.defaultPageSize),
    author: optionalText(200),
    publisher: optionalText(200),
    yearFrom: optionalYear,
    yearTo: optionalYear,
  })
  .refine((v) => v.yearFrom === undefined || v.yearTo === undefined || v.yearFrom <= v.yearTo, {
    message: 'yearFrom must not be later than yearTo.',
    path: ['yearFrom'],
  });

export interface SearchParams {
  q: string;
  mode: SearchMode;
  sort: SortOrder;
  page: number;
  pageSize: number;
  filters: SearchFilters;
}

/** Convert URLSearchParams into an object, treating empty strings as missing. */
function toObject(params: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of params) if (value !== '') result[key] = value;
  return result;
}

function fail(error: z.ZodError, fallbackField = 'request'): never {
  const issue = error.issues[0];
  const field = issue?.path.join('.') || fallbackField;
  throw Errors.badRequest(issue ? `Invalid "${field}": ${issue.message}` : 'Invalid request parameters.');
}

export function parseSearchParams(params: URLSearchParams): SearchParams {
  const parsed = searchSchema.safeParse(toObject(params));
  if (!parsed.success) fail(parsed.error);
  const { q, mode, sort, page, pageSize, author, publisher, yearFrom, yearTo } = parsed.data;
  const filters: SearchFilters = {};
  if (author) filters.author = author;
  if (publisher) filters.publisher = publisher;
  if (yearFrom !== undefined) filters.yearFrom = yearFrom;
  if (yearTo !== undefined) filters.yearTo = yearTo;
  // Relevance ordering is meaningless without a query; browse mode sorts by title instead.
  return { q, mode, sort: !q && sort === 'relevance' ? 'title' : sort, page, pageSize, filters };
}

/** Book ids are normalised ISBNs (digits and X) — anything else cannot exist. */
export const bookIdSchema = z.string().trim().toUpperCase().regex(/^[0-9X]{1,20}$/, 'Book ids contain only digits and X.');

export function parseBookId(params: URLSearchParams): string {
  const parsed = bookIdSchema.safeParse(params.get('id') ?? '');
  if (!parsed.success) {
    if (!params.get('id')) throw Errors.badRequest('Missing "id" parameter.');
    fail(parsed.error, 'id');
  }
  return parsed.data;
}

export function parseLimit(params: URLSearchParams, fallback: number, max: number): number {
  const parsed = z.coerce.number().int().min(1).max(max).default(fallback).safeParse(params.get('limit') || undefined);
  if (!parsed.success) throw Errors.badRequest(`Invalid "limit": must be an integer between 1 and ${max}.`);
  return parsed.data;
}

export function parseK(params: URLSearchParams): number {
  const parsed = z.coerce.number().int().min(1).max(20).default(10).safeParse(params.get('k') || undefined);
  if (!parsed.success) throw Errors.badRequest('Invalid "k": must be an integer between 1 and 20.');
  return parsed.data;
}
