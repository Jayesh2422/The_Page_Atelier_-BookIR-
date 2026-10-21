import type { SearchMode, SortOrder } from '../../lib/types';

/** The search page keeps all of its state in the URL so back/forward and refresh work. */
export interface SearchState {
  q: string;
  mode: SearchMode;
  sort: SortOrder;
  page: number;
  author: string;
  publisher: string;
  yearFrom: string;
  yearTo: string;
  view: 'grid' | 'list';
  /** Client-side display option: hide books whose cover cannot be loaded. */
  coversOnly: boolean;
}

const SORTS: SortOrder[] = ['relevance', 'title', 'author', 'year-desc', 'year-asc'];

export function readSearchState(params: URLSearchParams): SearchState {
  const page = Number(params.get('page'));
  const sort = params.get('sort') as SortOrder | null;
  return {
    q: params.get('q')?.trim() ?? '',
    mode: params.get('mode') === 'keyword' ? 'keyword' : 'ranked',
    sort: sort && SORTS.includes(sort) ? sort : 'relevance',
    page: Number.isInteger(page) && page > 0 ? page : 1,
    author: params.get('author') ?? '',
    publisher: params.get('publisher') ?? '',
    yearFrom: params.get('yearFrom') ?? '',
    yearTo: params.get('yearTo') ?? '',
    view: params.get('view') === 'list' ? 'list' : 'grid',
    coversOnly: params.get('covers') === 'only',
  };
}

/** Serialise, omitting defaults to keep URLs short. */
export function writeSearchState(state: Partial<SearchState>): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.mode && state.mode !== 'ranked') params.set('mode', state.mode);
  if (state.sort && state.sort !== 'relevance') params.set('sort', state.sort);
  if (state.author) params.set('author', state.author);
  if (state.publisher) params.set('publisher', state.publisher);
  if (state.yearFrom) params.set('yearFrom', state.yearFrom);
  if (state.yearTo) params.set('yearTo', state.yearTo);
  if (state.page && state.page > 1) params.set('page', String(state.page));
  if (state.view && state.view !== 'grid') params.set('view', state.view);
  if (state.coversOnly) params.set('covers', 'only');
  return params;
}

/** Parameters sent to /api/search (view and coversOnly are client-only preferences). */
export function apiParams(state: SearchState, pageSize: number): URLSearchParams {
  const params = writeSearchState({ ...state, view: 'grid', coversOnly: false });
  params.set('pageSize', String(pageSize));
  return params;
}

export function searchUrl(q: string, extra: Partial<SearchState> = {}): string {
  return `/search?${writeSearchState({ ...extra, q }).toString()}`;
}

export function exploreUrl(extra: Partial<SearchState> = {}): string {
  const text = writeSearchState(extra).toString();
  return text ? `/explore?${text}` : '/explore';
}
