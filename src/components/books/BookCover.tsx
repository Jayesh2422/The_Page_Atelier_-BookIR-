import { BookOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Book } from '../../../lib/types';
import { markCoverMissing } from '@/hooks/useMissingCovers';
import { cn } from '@/lib/utils';

/** Amazon answers missing covers with a 1×1 GIF, so tiny images count as missing too. */
const MIN_REAL_COVER_WIDTH = 10;

interface BookCoverProps {
  book: Pick<Book, 'id' | 'title' | 'author' | 'covers'>;
  className?: string;
  eager?: boolean;
  sizes?: string;
  /** Called once when no cover URL works and the placeholder is shown. */
  onMissing?: (id: string) => void;
}

/**
 * Portrait cover frame (2:3). Tries each cover URL in priority order and falls back to a plain
 * typographic placeholder — never generated artwork that could pass for a real cover.
 */
export function BookCover({ book, className, eager = false, sizes, onMissing }: BookCoverProps) {
  return (
    <div className={cn('relative aspect-[2/3] w-full overflow-hidden rounded-md bg-linen shadow-soft', className)}>
      <CoverImage key={book.id} book={book} eager={eager} sizes={sizes} onMissing={onMissing} />
    </div>
  );
}

function CoverImage({ book, eager, sizes, onMissing }: Omit<BookCoverProps, 'className'>) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const src = book.covers[index];
  useEffect(() => {
    if (!src) {
      markCoverMissing(book.id);
      onMissing?.(book.id);
    }
  }, [src, book.id, onMissing]);
  if (!src) return <CoverPlaceholder title={book.title} author={book.author} />;
  return (
    <>
      {!loaded && <div aria-hidden className="absolute inset-0 animate-pulse bg-linen" />}
      <img
        src={src}
        alt={`Cover of ${book.title}`}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        sizes={sizes}
        referrerPolicy="no-referrer"
        className={cn('absolute inset-0 size-full object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')}
        onLoad={(event) => {
          if (event.currentTarget.naturalWidth < MIN_REAL_COVER_WIDTH) {
            setIndex((i) => i + 1);
          } else {
            setLoaded(true);
          }
        }}
        onError={() => setIndex((i) => i + 1)}
      />
    </>
  );
}

export function CoverPlaceholder({ title, author }: { title: string; author: string | null }) {
  return (
    <div
      role="img"
      aria-label={`No cover image available for ${title}`}
      className="absolute inset-0 flex flex-col justify-between bg-linen p-[9%] text-left"
    >
      <div className="absolute inset-[5%] rounded-sm border border-white/70" aria-hidden />
      <BookOpen aria-hidden className="relative size-5 text-sage" />
      <div className="relative">
        <p className="font-display line-clamp-4 text-[clamp(0.8rem,1.6vw,1.05rem)] leading-snug text-olive">{title}</p>
        {author && <p className="mt-1.5 line-clamp-1 text-[0.7rem] tracking-wide text-ink/80 uppercase">{author}</p>}
      </div>
    </div>
  );
}
