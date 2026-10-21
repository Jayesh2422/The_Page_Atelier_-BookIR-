import { Link, useLocation } from 'react-router';
import type { Book, FieldName } from '../../../lib/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { BookCover } from './BookCover';

interface BookCardProps {
  book: Book;
  /** Shown as a relevance badge, e.g. "0.812". */
  score?: { label: string; value: string; title: string } | null;
  matchedFields?: FieldName[];
  footer?: React.ReactNode;
  eager?: boolean;
  showDescription?: boolean;
}

export function bookMeta(book: Pick<Book, 'year' | 'publisher'>): string {
  return [book.year, book.publisher].filter(Boolean).join(' · ');
}

/** A book in a grid: cover, title, author and the metadata that exists. Fully clickable. */
export function BookCard({ book, score, matchedFields, footer, eager, showDescription = true }: BookCardProps) {
  const location = useLocation();
  const meta = bookMeta(book);
  return (
    <article className="group relative flex h-full flex-col">
      <BookCover book={book} eager={eager} className="transition-shadow duration-200 group-hover:shadow-lift" sizes="(min-width: 1024px) 200px, 45vw" />
      <div className="mt-3 flex flex-1 flex-col">
        <h3 className="line-clamp-2 text-[0.95rem] leading-snug font-semibold text-olive">
          <Link
            to={`/books/${encodeURIComponent(book.id)}`}
            state={{ from: `${location.pathname}${location.search}` }}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none group-has-[:focus-visible]:underline"
          >
            {book.title}
          </Link>
        </h3>
        {book.author && <p className="mt-1 line-clamp-1 text-sm text-ink/85">{book.author}</p>}
        {meta && <p className="mt-0.5 line-clamp-1 text-xs text-muted">{meta}</p>}
        {showDescription && book.description && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">{book.description}</p>}
        {(score || (matchedFields && matchedFields.length > 0)) && (
          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2.5">
            {score && (
              <Badge variant="terracotta" title={score.title}>
                {score.label} {score.value}
              </Badge>
            )}
            {matchedFields?.map((field) => (
              <Badge key={field} variant="linen" className="font-normal">
                {field}
              </Badge>
            ))}
          </div>
        )}
        {footer && <div className="relative z-10 mt-auto pt-2.5">{footer}</div>}
      </div>
    </article>
  );
}

export function BookGrid({ children, className, label }: { children: React.ReactNode; className?: string; label?: string }) {
  return (
    <ul aria-label={label} className={cn('grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6', className)}>
      {children}
    </ul>
  );
}

export function BookGridSkeleton({ count = 12, className }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading books" className={cn('grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6', className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <div className="aspect-[2/3] w-full animate-pulse rounded-md bg-linen" />
          <div className="mt-3 h-4 w-4/5 animate-pulse rounded bg-linen" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-linen" />
        </div>
      ))}
    </div>
  );
}
