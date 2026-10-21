import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

interface PaginationProps {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}

/** Page numbers around the current page, with first/last and ellipses. */
export function pageWindow(page: number, totalPages: number): (number | 'gap')[] {
  const pages = new Set([1, totalPages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= totalPages));
  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | 'gap')[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) result.push('gap');
    result.push(p);
  });
  return result;
}

const itemClass = 'inline-flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-sm transition-colors';

export function Pagination({ page, totalPages, hrefFor }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-14 flex items-center justify-center gap-1">
      {page > 1 ? (
        <Link to={hrefFor(page - 1)} className={cn(itemClass, 'text-olive hover:bg-white')} aria-label="Previous page">
          <ChevronLeft className="size-4" /> <span className="hidden sm:inline">Previous</span>
        </Link>
      ) : (
        <span className={cn(itemClass, 'text-muted/60')} aria-hidden>
          <ChevronLeft className="size-4" /> <span className="hidden sm:inline">Previous</span>
        </span>
      )}
      <ul className="flex items-center gap-1">
        {pageWindow(page, totalPages).map((p, i) =>
          p === 'gap' ? (
            <li key={`gap-${i}`} aria-hidden className="px-1 text-muted">
              …
            </li>
          ) : (
            <li key={p}>
              <Link
                to={hrefFor(p)}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${p}`}
                className={cn(itemClass, p === page ? 'bg-olive font-semibold text-cream' : 'text-ink hover:bg-white')}
              >
                {p}
              </Link>
            </li>
          ),
        )}
      </ul>
      {page < totalPages ? (
        <Link to={hrefFor(page + 1)} className={cn(itemClass, 'text-olive hover:bg-white')} aria-label="Next page">
          <span className="hidden sm:inline">Next</span> <ChevronRight className="size-4" />
        </Link>
      ) : (
        <span className={cn(itemClass, 'text-muted/60')} aria-hidden>
          <span className="hidden sm:inline">Next</span> <ChevronRight className="size-4" />
        </span>
      )}
    </nav>
  );
}
