import { Link } from 'react-router';
import { searchUrl } from '@/lib/search-params';
import { cn } from '@/lib/utils';

/** "Harry Poter" is deliberately misspelled to demonstrate spelling correction. */
export const EXAMPLE_QUERIES = ['Python programming', 'Classic literature', 'Mystery novels', 'Science fiction', 'Jane Austen', 'Harry Poter'];

export function ExampleQueries({ queries = EXAMPLE_QUERIES, className }: { queries?: string[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="mr-1 text-sm text-muted">Try</span>
      {queries.map((query) => (
        <Link
          key={query}
          to={searchUrl(query)}
          className="rounded-full border border-linen bg-white px-3.5 py-1.5 text-sm text-olive transition-colors hover:border-sage hover:bg-sage-soft"
        >
          {query}
        </Link>
      ))}
    </div>
  );
}
