import { Link, useParams } from 'react-router';
import type { SimilarResponse } from '../../lib/types';
import { BookCover } from '@/components/books/BookCover';
import { BookGrid, BookGridSkeleton } from '@/components/books/BookCard';
import { SimilarBookCard } from '@/components/books/SimilarBookCard';
import { PageContainer } from '@/components/layout/Layout';
import { EmptyState, ErrorState } from '@/components/states/States';
import { useApi } from '@/hooks/useApi';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { BackLink } from './BookDetailsPage';

const LIMIT = 24;

/** The similar-book finder: the full ranked list with explanations for one source book. */
export function SimilarBooksPage() {
  const { id = '' } = useParams();
  const result = useApi<SimilarResponse>(`similar:${id}:${LIMIT}`, (signal) => api.similar(id, LIMIT, signal));
  const data = result.status === 'success' ? result.data : null;
  useDocumentTitle(data ? `Similar to ${data.source.title}` : 'Similar books');

  return (
    <PageContainer className="py-10">
      <BackLink />
      {result.status === 'error' && <ErrorState error={result.error} onRetry={result.retry} className="mt-10" />}
      {result.status === 'loading' && <BookGridSkeleton className="mt-10" />}
      {data && (
        <>
          <header className="mt-8 flex flex-col gap-6 border-b border-linen pb-10 sm:flex-row sm:items-end">
            <Link to={`/books/${encodeURIComponent(data.source.id)}`} className="w-28 shrink-0" aria-label={`Open ${data.source.title}`}>
              <BookCover book={data.source} eager />
            </Link>
            <div>
              <p className="eyebrow">Similar book finder</p>
              <h1 className="font-display mt-3 text-3xl leading-tight sm:text-4xl">Books similar to “{data.source.title}”</h1>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
                Ranked by the cosine similarity between TF-IDF vectors built from title, author, publisher, description and category terms
                ({data.termsUsed} strongest terms of this book, {data.tookMs} ms). Other editions of the same work are left out. Similarity
                is textual only — it does not predict whether you will enjoy a book.
              </p>
            </div>
          </header>
          <div className="mt-10">
            {data.results.length === 0 ? (
              <EmptyState title="No similar books found">
                <p>This record shares too few indexed terms with other books in the catalogue.</p>
              </EmptyState>
            ) : (
              <BookGrid label="Similar books">
                {data.results.map((hit, i) => (
                  <li key={hit.book.id}>
                    <SimilarBookCard hit={hit} eager={i < 6} />
                  </li>
                ))}
              </BookGrid>
            )}
          </div>
        </>
      )}
    </PageContainer>
  );
}
