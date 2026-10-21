import { Link, useLocation } from 'react-router';
import type { SearchHit } from '../../../lib/types';
import { Badge } from '@/components/ui/badge';
import { bookMeta } from './BookCard';
import { BookCover } from './BookCover';

/** Compact list row used by the list view of the search results. */
export function BookListItem({ hit, score }: { hit: SearchHit; score: { label: string; value: string; title: string } | null }) {
  const location = useLocation();
  const { book } = hit;
  const meta = bookMeta(book);
  return (
    <article className="group relative flex gap-4 rounded-[var(--radius-card)] border border-transparent p-3 transition-colors hover:border-linen hover:bg-white sm:gap-5">
      <BookCover book={book} className="w-16 shrink-0 sm:w-20" sizes="80px" />
      <div className="min-w-0 flex-1 py-0.5">
        <h3 className="text-base leading-snug font-semibold text-olive">
          <Link
            to={`/books/${encodeURIComponent(book.id)}`}
            state={{ from: `${location.pathname}${location.search}` }}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-has-[:focus-visible]:underline"
          >
            {book.title}
          </Link>
        </h3>
        {book.author && <p className="mt-0.5 text-sm text-ink/85">{book.author}</p>}
        {meta && <p className="mt-0.5 text-xs text-muted">{meta}</p>}
        {book.description && <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-relaxed text-muted">{book.description}</p>}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {score && (
            <Badge variant="terracotta" title={score.title}>
              {score.label} {score.value}
            </Badge>
          )}
          {hit.matchedFields.map((field) => (
            <Badge key={field} variant="linen" className="font-normal">
              {field}
            </Badge>
          ))}
          {hit.matchedTerms.length > 0 && <span className="text-xs text-muted">matched: {hit.matchedTerms.join(', ')}</span>}
        </div>
      </div>
    </article>
  );
}
