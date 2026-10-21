import { ArrowRight, Feather } from 'lucide-react';
import { Link } from 'react-router';
import type { Book, DiscoverResponse } from '../../lib/types';
import { BookCard, BookGrid, BookGridSkeleton } from '@/components/books/BookCard';
import { BookCover } from '@/components/books/BookCover';
import { SimilarBookCard } from '@/components/books/SimilarBookCard';
import { PageContainer } from '@/components/layout/Layout';
import { ExampleQueries } from '@/components/search/ExampleQueries';
import { SearchBar } from '@/components/search/SearchBar';
import { ErrorState } from '@/components/states/States';
import { useApi } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useMissingCovers } from '@/hooks/useMissingCovers';
import { api } from '@/lib/api';
import { exploreUrl } from '@/lib/search-params';
import { formatNumber } from '@/lib/utils';

function SectionHeading({ eyebrow, title, action }: { eyebrow: string; title: string; action?: { to: string; label: string } }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="font-display mt-2 text-3xl sm:text-4xl">{title}</h2>
      </div>
      {action && (
        <Link to={action.to} className="inline-flex items-center gap-1.5 text-sm font-medium text-olive hover:text-sage-dark">
          {action.label} <ArrowRight aria-hidden className="size-4" />
        </Link>
      )}
    </div>
  );
}

function HeroCovers({ books }: { books: Book[] }) {
  const [a, b, c] = books;
  if (!a || !b || !c) return null;
  return (
    <div aria-hidden className="relative mx-auto hidden h-[25rem] w-full max-w-sm lg:block">
      <div className="absolute top-10 left-0 w-40 -rotate-6">
        <BookCover book={b} eager />
      </div>
      <div className="absolute top-0 left-1/2 z-10 w-48 -translate-x-1/2">
        <BookCover book={a} eager className="shadow-lift" />
      </div>
      <div className="absolute top-12 right-0 w-40 rotate-6">
        <BookCover book={c} eager />
      </div>
      <div className="absolute right-6 bottom-0 left-6 h-px bg-linen" />
    </div>
  );
}

export function HomePage() {
  useDocumentTitle(null);
  const discover = useApi<DiscoverResponse>('discover', (signal) => api.discover(signal));
  const data = discover.data;
  // Showcase sections only show books whose cover actually loads; a card whose cover fails is
  // replaced by the next candidate (the API returns extra books for this reason).
  const { isMissing } = useMissingCovers();
  const withCover = (books: Book[]) => books.filter((b) => b.covers.length > 0 && !isMissing(b.id));
  const heroBooks = data ? withCover(data.discover).slice(0, 3) : [];

  return (
    <>
      <section className="border-b border-linen/70">
        <PageContainer className="grid items-center gap-12 py-16 sm:py-20 lg:grid-cols-[1.25fr_1fr] lg:py-24">
          <div>
            <p className="eyebrow">Your next chapter awaits</p>
            <h1 className="font-display mt-4 max-w-2xl text-[2.75rem] leading-[1.05] sm:text-6xl lg:text-[4.25rem]">Find a book that speaks to you.</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">Explore books, discover meaningful matches, and follow your curiosity.</p>
            <SearchBar size="hero" className="mt-9 max-w-2xl" />
            <ExampleQueries className="mt-5" />
            {data && (
              <p className="mt-8 flex items-center gap-2 text-sm text-muted">
                <Feather aria-hidden className="size-4 text-sage" />
                Searching {formatNumber(data.stats.books)} Book-Crossing records through {formatNumber(data.stats.vocabulary)} indexed terms.
              </p>
            )}
          </div>
          <HeroCovers books={heroBooks} />
        </PageContainer>
      </section>

      {discover.status === 'error' && !data && (
        <PageContainer className="py-16">
          <ErrorState error={discover.error} onRetry={discover.retry} />
        </PageContainer>
      )}

      {!data && discover.status === 'loading' && (
        <PageContainer className="py-16">
          <BookGridSkeleton count={6} />
        </PageContainer>
      )}

      {data && (
        <div className="space-y-20 py-16 sm:space-y-24 sm:py-20">
          <PageContainer>
            <SectionHeading eyebrow="From the shelves" title="Discover books" action={{ to: '/explore', label: 'Browse the catalogue' }} />
            <BookGrid label="Books to discover">
              {withCover(data.discover).filter((b) => !heroBooks.includes(b)).slice(0, 6).map((book) => (
                <li key={book.id}>
                  <BookCard book={book} showDescription={false} />
                </li>
              ))}
            </BookGrid>
            <p className="mt-6 text-xs text-muted">A random selection of catalogue records with cover images, refreshed every few minutes.</p>
          </PageContainer>

          <section className="bg-white/70 py-16">
            <PageContainer>
              <SectionHeading eyebrow="Well represented" title="Explore by author" action={{ to: '/explore', label: 'All authors' }} />
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {data.authors.map((author) => (
                  <li key={author.name}>
                    <Link
                      to={exploreUrl({ author: author.name })}
                      className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-linen bg-cream px-5 py-4 transition-colors hover:border-sage hover:bg-sage-soft"
                    >
                      <span className="font-display truncate text-lg text-olive">{author.name}</span>
                      <span className="shrink-0 text-xs text-muted">{formatNumber(author.count)} records</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-xs text-muted">Authors with the most records (editions included) in the catalogue.</p>
            </PageContainer>
          </section>

          <PageContainer>
            <SectionHeading eyebrow="Latest import" title="Recently added to the catalogue" />
            <BookGrid label="Recently added books">
              {withCover(data.recent).slice(0, 6).map((book) => (
                <li key={book.id}>
                  <BookCard book={book} showDescription={false} />
                </li>
              ))}
            </BookGrid>
          </PageContainer>

          {data.similar && (
            <PageContainer>
              <SectionHeading
                eyebrow="Textual neighbours"
                title="Similar books worth exploring"
                action={{ to: `/books/${encodeURIComponent(data.similar.seed.id)}/similar`, label: 'Open the similar-book finder' }}
              />
              <div className="grid gap-10 lg:grid-cols-[14rem_1fr]">
                <div className="max-w-[14rem]">
                  <p className="mb-3 text-sm text-muted">Books whose metadata resembles</p>
                  <BookCard book={data.similar.seed} showDescription={false} />
                </div>
                <BookGrid label="Similar books" className="lg:grid-cols-3 xl:grid-cols-6">
                  {data.similar.results.filter((hit) => hit.book.covers.length > 0 && !isMissing(hit.book.id)).slice(0, 6).map((hit) => (
                    <li key={hit.book.id}>
                      <SimilarBookCard hit={hit} />
                    </li>
                  ))}
                </BookGrid>
              </div>
            </PageContainer>
          )}
        </div>
      )}
    </>
  );
}
