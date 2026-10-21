import { useSearchParams } from 'react-router';
import type { SearchResponse, SortOrder } from '../../lib/types';
import { BookCard, BookGrid, BookGridSkeleton } from '@/components/books/BookCard';
import { PageContainer } from '@/components/layout/Layout';
import { CoverToggle, HiddenCoversNote, useCoverFilter } from '@/components/search/CoverFilter';
import { Pagination } from '@/components/search/Pagination';
import { SearchBar } from '@/components/search/SearchBar';
import { SearchFilters } from '@/components/search/SearchFilters';
import { EmptyState, ErrorState } from '@/components/states/States';
import { Select } from '@/components/ui/select';
import { useApi } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { apiParams, readSearchState, writeSearchState, type SearchState } from '@/lib/search-params';
import { cn, formatNumber } from '@/lib/utils';

const PAGE_SIZE = 24;
const BROWSE_SORTS: { value: SortOrder; label: string }[] = [
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'author', label: 'Author (A–Z)' },
  { value: 'year-desc', label: 'Newest first' },
  { value: 'year-asc', label: 'Oldest first' },
];

/** Browse the catalogue without a query: filters, sorting and pagination only. */
export function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = readSearchState(searchParams);
  const state: SearchState = { ...raw, q: '', sort: raw.sort === 'relevance' ? 'title' : raw.sort };
  useDocumentTitle(state.author ? `Books by ${state.author}` : 'Explore');
  const params = apiParams(state, PAGE_SIZE);
  const result = useApi<SearchResponse>(params.toString(), (signal) => api.search(params, signal));
  const covers = useCoverFilter(result.data?.results, state.coversOnly);
  const data = result.data;
  const stale = result.status === 'loading' && data !== null;

  const update = (patch: Partial<SearchState>) => setSearchParams(writeSearchState({ ...state, ...patch, page: patch.page ?? 1 }));
  const hrefFor = (page: number) => `/explore?${writeSearchState({ ...state, page }).toString()}`;
  const heading = state.author ? `Books by ${state.author}` : state.publisher ? `Published by ${state.publisher}` : 'Explore the catalogue';

  return (
    <PageContainer className="py-12">
      <p className="eyebrow">Browse</p>
      <h1 className="font-display mt-3 text-4xl sm:text-5xl">{heading}</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Wander through the Book-Crossing collection by author, publisher and publication year — or search it directly.
      </p>
      <SearchBar className="mt-7 max-w-2xl" />

      <div className="mt-12 grid gap-10 lg:grid-cols-[15rem_1fr]">
        <SearchFilters
          state={state}
          authors={data?.facets.authors ?? []}
          publishers={data?.facets.publishers ?? []}
          years={null}
          facetNote="Suggested authors and publishers are those with the most records in the whole catalogue."
          onChange={update}
        />
        <section aria-labelledby="explore-results" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-linen pb-4">
            <h2 id="explore-results" className="text-sm text-muted" aria-live="polite">
              {data && !stale ? `${formatNumber(data.total)} ${data.total === 1 ? 'record' : 'records'}` : 'Loading…'}
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <CoverToggle pressed={state.coversOnly} onChange={(coversOnly) => setSearchParams(writeSearchState({ ...state, coversOnly }))} />
              <label className="sr-only" htmlFor="explore-sort">
                Sort books
              </label>
              <Select id="explore-sort" className="w-44" value={state.sort} onChange={(e) => update({ sort: e.target.value as SortOrder })}>
                {BROWSE_SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="mt-8">
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
                  <EmptyState title="No books match these filters">
                    <p>Try another author or publisher, or widen the year range.</p>
                  </EmptyState>
                ) : (
                  <BookGrid label="Catalogue records" className="lg:grid-cols-4 xl:grid-cols-5">
                    {covers.shown.map((hit, i) => (
                      <li key={hit.book.id}>
                        <BookCard book={hit.book} eager={i < 5} showDescription={false} />
                      </li>
                    ))}
                  </BookGrid>
                )}
                <Pagination page={data.page} totalPages={Math.min(data.totalPages, 500)} hrefFor={hrefFor} />
              </div>
            )}
          </div>
        </section>
      </div>
    </PageContainer>
  );
}
