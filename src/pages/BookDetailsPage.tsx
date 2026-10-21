import { ArrowLeft, ArrowRight, ExternalLink, Search, Sparkles, UserRound } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import type { Book, BookDetailsResponse, SimilarResponse } from '../../lib/types';
import { BookCard, BookGrid, BookGridSkeleton } from '@/components/books/BookCard';
import { BookCover } from '@/components/books/BookCover';
import { SimilarBookCard } from '@/components/books/SimilarBookCard';
import { PageContainer } from '@/components/layout/Layout';
import { EmptyState, ErrorState } from '@/components/states/States';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useApi } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { exploreUrl, searchUrl } from '@/lib/search-params';

const SIMILAR_PREVIEW = 6;

/** Where "back" should go: the results page the reader came from, if any. */
export function useBackTarget(): { href: string | null; label: string } {
  const location = useLocation();
  const from = (location.state as { from?: unknown } | null)?.from;
  if (typeof from === 'string' && from.startsWith('/')) {
    const label = from.startsWith('/search') ? 'Back to results' : from.startsWith('/explore') ? 'Back to the catalogue' : 'Back';
    return { href: from, label };
  }
  return { href: null, label: 'Back' };
}

export function BackLink() {
  const navigate = useNavigate();
  const back = useBackTarget();
  const className = 'inline-flex items-center gap-1.5 rounded-full py-1 text-sm font-medium text-olive hover:text-sage-dark';
  if (back.href) {
    return (
      <Link to={back.href} className={className}>
        <ArrowLeft aria-hidden className="size-4" /> {back.label}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
      <ArrowLeft aria-hidden className="size-4" /> {back.label}
    </button>
  );
}

function MetadataList({ book }: { book: Book }) {
  const rows: [string, React.ReactNode][] = [];
  if (book.authors.length) rows.push([book.authors.length > 1 ? 'Authors' : 'Author', book.authors.join(', ')]);
  if (book.publisher) rows.push(['Publisher', book.publisher]);
  if (book.year) rows.push(['Year', book.year]);
  if (book.publishedDate && book.publishedDate !== String(book.year)) rows.push(['Published (Google Books)', book.publishedDate]);
  if (book.pageCount) rows.push(['Pages', book.pageCount]);
  if (book.language) rows.push(['Language', book.language.toUpperCase()]);
  rows.push([book.isbnValid ? 'ISBN-10' : 'Identifier', book.isbn]);
  if (book.isbn13 && book.isbn13 !== book.isbn) rows.push(['ISBN-13', book.isbn13]);
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 gap-y-3 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted">{term}</dt>
          <dd className="text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailsSkeleton() {
  return (
    <div role="status" aria-label="Loading book" className="grid gap-10 md:grid-cols-[18rem_1fr] lg:gap-16">
      <Skeleton className="aspect-[2/3] w-full max-w-[18rem]" />
      <div className="space-y-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-4/5" />
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="mt-8 h-32 w-full" />
      </div>
    </div>
  );
}

export function BookDetailsPage() {
  const { id = '' } = useParams();
  const details = useApi<BookDetailsResponse>(`book:${id}`, (signal) => api.book(id, signal));
  const similar = useApi<SimilarResponse>(`similar:${id}:${SIMILAR_PREVIEW}`, (signal) => api.similar(id, SIMILAR_PREVIEW, signal));
  const book = details.status === 'success' ? details.data.book : null;
  useDocumentTitle(book ? book.title : details.status === 'error' ? 'Book not found' : 'Book');

  return (
    <PageContainer className="py-10">
      <BackLink />
      <div className="mt-8">
        {details.status === 'error' ? (
          <ErrorState error={details.error} onRetry={details.retry} />
        ) : !book ? (
          <DetailsSkeleton />
        ) : (
          <article className="grid gap-10 md:grid-cols-[18rem_1fr] lg:gap-16">
            <div className="mx-auto w-full max-w-[18rem] md:mx-0">
              <BookCover book={book} eager className="shadow-lift" sizes="288px" />
            </div>
            <div className="min-w-0">
              {book.year && <p className="eyebrow">{book.year}</p>}
              <h1 className="font-display mt-3 text-4xl leading-tight break-words sm:text-5xl">{book.title}</h1>
              {book.author && (
                <p className="mt-3 text-lg text-ink">
                  by{' '}
                  <Link to={exploreUrl({ author: book.author })} className="font-medium text-olive underline decoration-linen underline-offset-4 hover:decoration-sage">
                    {book.author}
                  </Link>
                </p>
              )}
              <div className="mt-7 flex flex-wrap gap-3">
                {book.author && (
                  <Button asChild>
                    <Link to={exploreUrl({ author: book.author })}>
                      <UserRound /> More by this author
                    </Link>
                  </Button>
                )}
                <Button asChild variant="secondary">
                  <Link to={`/books/${encodeURIComponent(book.id)}/similar`}>
                    <Sparkles /> Find similar books
                  </Link>
                </Button>
                {book.author && (
                  <Button asChild variant="ghost">
                    <Link to={searchUrl(book.author)}>
                      <Search /> Search “{book.author}”
                    </Link>
                  </Button>
                )}
              </div>

              <section aria-labelledby="about" className="mt-10 max-w-3xl">
                <h2 id="about" className="font-display text-2xl">
                  About this edition
                </h2>
                {book.description ? (
                  <>
                    <div className="mt-4 space-y-4 leading-relaxed text-ink/90">
                      {book.description.split(/\n{2,}/).map((paragraph, i) => (
                        <p key={i}>{paragraph}</p>
                      ))}
                    </div>
                    <p className="mt-3 text-xs text-muted">
                      Description from {book.descriptionSource === 'open-library' ? 'Open Library' : 'Google Books'}
                      {book.descriptionLink && (
                        <>
                          {' · '}
                          <a href={book.descriptionLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-ink">
                            View on {book.descriptionSource === 'open-library' ? 'Open Library' : 'Google Books'} <ExternalLink aria-hidden className="size-3" />
                          </a>
                        </>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="mt-4 text-muted italic">Description unavailable for this edition.</p>
                )}
                {book.categories.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {book.categories.map((category) => (
                      <Badge key={category}>{category}</Badge>
                    ))}
                  </div>
                )}
              </section>

              <section aria-labelledby="details" className="mt-10 max-w-3xl rounded-[var(--radius-card)] border border-linen bg-white p-6">
                <h2 id="details" className="font-display mb-5 text-xl">
                  Bibliographic details
                </h2>
                <MetadataList book={book} />
                <p className="mt-5 text-xs text-muted">Source: Book-Crossing dataset{book.enriched ? ', supplemented by validated Google Books and Open Library metadata' : ''}.</p>
              </section>
            </div>
          </article>
        )}
      </div>

      {book && details.data && details.data.otherEditions.length > 0 && (
        <section aria-labelledby="editions" className="mt-20">
          <h2 id="editions" className="font-display text-3xl">
            Other editions in the catalogue
          </h2>
          <p className="mt-2 text-sm text-muted">Records with the same title and author but a different ISBN.</p>
          <BookGrid label="Other editions" className="mt-8">
            {details.data.otherEditions.slice(0, 6).map((edition) => (
              <li key={edition.id}>
                <BookCard book={edition} showDescription={false} />
              </li>
            ))}
          </BookGrid>
        </section>
      )}

      {book && (
        <section aria-labelledby="similar" className="mt-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="similar" className="font-display text-3xl">
                Find similar books
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-muted">Books whose title, author, publisher and description terms resemble this one (TF-IDF cosine similarity).</p>
            </div>
            <Link to={`/books/${encodeURIComponent(book.id)}/similar`} className="inline-flex items-center gap-1.5 text-sm font-medium text-olive hover:text-sage-dark">
              See more similar books <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
          <div className="mt-8">
            {similar.status === 'loading' && <BookGridSkeleton count={6} />}
            {similar.status === 'error' && <ErrorState error={similar.error} onRetry={similar.retry} />}
            {similar.status === 'success' &&
              (similar.data.results.length === 0 ? (
                <EmptyState title="No similar books found">
                  <p>This record shares too few indexed terms with other books.</p>
                </EmptyState>
              ) : (
                <BookGrid label="Similar books">
                  {similar.data.results.map((hit) => (
                    <li key={hit.book.id}>
                      <SimilarBookCard hit={hit} />
                    </li>
                  ))}
                </BookGrid>
              ))}
          </div>
        </section>
      )}
    </PageContainer>
  );
}
