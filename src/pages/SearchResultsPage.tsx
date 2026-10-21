import { Info, LayoutGrid, List, X } from 'lucide-react';
import { useSearchParams } from 'react-router';
import type { SearchHit, SearchMode, SearchResponse, SortOrder } from '../../lib/types';
import { BookCard, BookGrid, BookGridSkeleton } from '@/components/books/BookCard';
import { BookListItem } from '@/components/books/BookListItem';
import { PageContainer } from '@/components/layout/Layout';
import { ExampleQueries } from '@/components/search/ExampleQueries';
import { CoverToggle, HiddenCoversNote, useCoverFilter } from '@/components/search/CoverFilter';
import { Pagination } from '@/components/search/Pagination';
import { SearchBar } from '@/components/search/SearchBar';
import { SearchFilters } from '@/components/search/SearchFilters';
import { SpellingSuggestion } from '@/components/search/SpellingSuggestion';
import { EmptyState, ErrorState } from '@/components/states/States';
import { Select } from '@/components/ui/select';
import { useApi } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { apiParams, readSearchState, writeSearchState, type SearchState } from '@/lib/search-params';
import { cn, formatNumber } from '@/lib/utils';

const PAGE_SIZE = 24;

const MODES: { value: SearchMode; label: string; hint: string }[] = [
  { value: 'ranked', label: 'Ranked', hint: 'TF-IDF weights and cosine similarity' },
  { value: 'keyword', label: 'Keyword', hint: 'Baseline: number of query words matched' },
];

const SORT_LABELS: Record<SortOrder, string> = {
  relevance: 'Relevance',
  title: 'Title (A–Z)',
  author: 'Author (A–Z)',
  'year-desc': 'Newest first',
  'year-asc': 'Oldest first',
};

export function scoreFor(hit: SearchHit, mode: SearchMode, termCount: number) {
  return mode === 'ranked'
    ? { label: 'Score', value: hit.score.toFixed(3), title: 'Cosine similarity between the query and the book (0 = unrelated, 1 = identical term profile)' }
    : { label: 'Matched', value: `${hit.score}/${termCount}`, title: 'Number of distinct query terms found in the book' };
}

export function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = readSearchState(searchParams);
  useDocumentTitle(state.q ? `“${state.q}”` : 'Search');
  const key = state.q ? apiParams(state, PAGE_SIZE).toString() : null;
  const result = useApi<SearchResponse>(key, (signal) => api.search(apiParams(state, PAGE_SIZE), signal));
  const covers = useCoverFilter(result.data?.results, state.coversOnly);

  const update = (patch: Partial<SearchState>) => {
    const next = { ...state, ...patch, page: patch.page ?? 1 };
    setSearchParams(writeSearchState(next));
  };
  const hrefFor = (page: number) => `/search?${writeSearchState({ ...state, page }).toString()}`;

  if (!state.q) {
    return (
      <PageContainer className="py-16">
        <h1 className="font-display text-4xl sm:text-5xl">Search the catalogue</h1>
        <p className="mt-3 max-w-xl text-muted">Look up titles, authors, publishers or a few keywords.</p>
        <SearchBar size="hero" className="mt-8 max-w-3xl" autoFocus />
        <ExampleQueries className="mt-5" />
      </PageContainer>
    );
  }

  const data = result.data;
  const stale = result.status === 'loading' && data !== null;
  const keep = { mode: state.mode };
  const filterChips = [
    state.author && { key: 'author', label: `Author: ${state.author}`, clear: { author: '' } },
    state.publisher && { key: 'publisher', label: `Publisher: ${state.publisher}`, clear: { publisher: '' } },
    (state.yearFrom || state.yearTo) && { key: 'year', label: `Year: ${state.yearFrom || '…'}–${state.yearTo || '…'}`, clear: { yearFrom: '', yearTo: '' } },
  ].filter(Boolean) as { key: string; label: string; clear: Partial<SearchState> }[];

  return (
    <PageContainer className="py-10">
      <div className="max-w-3xl">
        <SearchBar initialQuery={state.q} keep={keep} />
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[15rem_1fr]">
        <SearchFilters
          state={state}
          authors={data?.facets.authors ?? []}
          publishers={data?.facets.publishers ?? []}
          years={data?.facets.years ?? null}
          facetNote="Author and publisher options come from the 300 best-ranked results for this query."
          onChange={update}
        />

        <section aria-labelledby="results-heading" className="min-w-0">
          <div className="flex flex-col gap-4 border-b border-linen pb-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h1 id="results-heading" className="font-display text-3xl leading-tight sm:text-4xl">
                “{state.q}”
              </h1>
              <p className="mt-2 text-sm text-muted" aria-live="polite">
                {data && !stale ? (
                  <>
                    {formatNumber(data.total)} {data.total === 1 ? 'book' : 'books'}
                    {data.totalIsCapped && ' — filters and sorting apply to the best 5,000 matches'} · {data.mode === 'ranked' ? 'ranked by TF-IDF cosine similarity' : 'keyword baseline'} · {data.tookMs} ms
                  </>
                ) : (
                  'Searching…'
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div role="group" aria-label="Search mode" className="inline-flex rounded-full border border-linen bg-white p-1">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    aria-pressed={state.mode === m.value}
                    title={m.hint}
                    onClick={() => update({ mode: m.value })}
                    className={cn('rounded-full px-4 py-1.5 text-sm font-medium transition-colors', state.mode === m.value ? 'bg-olive text-cream' : 'text-ink hover:bg-sage-soft')}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <label className="sr-only" htmlFor="sort">
                Sort results
              </label>
              <Select id="sort" className="w-44" value={state.sort} onChange={(e) => update({ sort: e.target.value as SortOrder })}>
                {(Object.keys(SORT_LABELS) as SortOrder[]).map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABELS[s]}
                  </option>
                ))}
              </Select>
              <div className="inline-flex rounded-full border border-linen bg-white p-1" role="group" aria-label="Layout">
                {(['grid', 'list'] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    aria-pressed={state.view === view}
                    aria-label={view === 'grid' ? 'Grid view' : 'List view'}
                    onClick={() => setSearchParams(writeSearchState({ ...state, view }))}
                    className={cn('inline-flex size-8 items-center justify-center rounded-full', state.view === view ? 'bg-sage-soft text-olive' : 'text-muted hover:text-ink')}
                  >
                    {view === 'grid' ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
                  </button>
                ))}
              </div>
              <CoverToggle pressed={state.coversOnly} onChange={(coversOnly) => setSearchParams(writeSearchState({ ...state, coversOnly }))} />
            </div>
          </div>

          {(filterChips.length > 0 || (data && data.terms.length > 0)) && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              {filterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => update(chip.clear)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-sage-soft px-3 py-1 text-olive hover:bg-linen"
                  aria-label={`Remove filter ${chip.label}`}
                >
                  {chip.label} <X aria-hidden className="size-3.5" />
                </button>
              ))}
              {data && data.terms.length > 0 && (
                <span className="text-xs text-muted">
                  Index terms: {data.terms.map((t) => (data.unknownTerms.includes(t) ? `${t} (not in catalogue)` : t)).join(', ')}
                </span>
              )}
            </div>
          )}

          <div className="mt-6 space-y-6">
            {data && data.suggestions.length > 0 && (
              <SpellingSuggestion query={state.q} suggestions={data.suggestions} keep={keep} noResults={data.total === 0} />
            )}
            {data?.notice && (
              <p className="flex gap-2 rounded-[var(--radius-card)] border border-linen bg-white px-4 py-3 text-sm text-ink">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-sage-dark" /> {data.notice}
              </p>
            )}

            {result.status === 'error' && <ErrorState error={result.error} onRetry={result.retry} />}
            {result.status === 'loading' && !data && <BookGridSkeleton />}
            {data && result.status !== 'error' && (
              <div className={cn('transition-opacity', stale && 'pointer-events-none opacity-50')} aria-busy={stale}>
                <HiddenCoversNote hidden={covers.hidden} />
                {data.results.length > 0 && covers.shown.length === 0 ? (
                  <EmptyState title="None of the books on this page has a cover">
                    <p>Try the next page, or switch off “Only with covers”.</p>
                  </EmptyState>
                ) : data.results.length === 0 ? (
                  <EmptyState title={filterChips.length ? 'No books match these filters' : 'No books matched your search'}>
                    {filterChips.length ? (
                      <p>Try removing a filter or widening the year range.</p>
                    ) : (
                      <p>Check the spelling, try fewer or different words, or search by author name.</p>
                    )}
                  </EmptyState>
                ) : state.view === 'list' ? (
                  <ul className="space-y-1">
                    {covers.shown.map((hit) => (
                      <li key={hit.book.id}>
                        <BookListItem hit={hit} score={data.sort === 'relevance' ? scoreFor(hit, data.mode, data.terms.length) : null} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <BookGrid label="Search results" className="lg:grid-cols-4 xl:grid-cols-5">
                    {covers.shown.map((hit, i) => (
                      <li key={hit.book.id}>
                        <BookCard
                          book={hit.book}
                          eager={i < 5}
                          score={data.sort === 'relevance' ? scoreFor(hit, data.mode, data.terms.length) : null}
                          matchedFields={hit.matchedFields}
                        />
                      </li>
                    ))}
                  </BookGrid>
                )}
                <Pagination page={data.page} totalPages={data.totalPages} hrefFor={hrefFor} />
              </div>
            )}
          </div>
        </section>
      </div>
    </PageContainer>
  );
}
