import { ImageOff } from 'lucide-react';
import type { SearchHit } from '../../../lib/types';
import { useMissingCovers } from '@/hooks/useMissingCovers';
import { cn } from '@/lib/utils';

export function CoverToggle({ pressed, onChange }: { pressed: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors',
        pressed ? 'border-olive bg-olive text-cream' : 'border-linen bg-white text-ink hover:border-sage hover:bg-sage-soft',
      )}
    >
      <ImageOff aria-hidden className="size-4" /> Only with covers
    </button>
  );
}

/**
 * Hide books without a working cover on the current page. Whether a cover works is only known
 * once the browser has tried to load it, so the filter is applied to the loaded page, not by the
 * search engine — rankings, counts and evaluation are unaffected.
 */
export function useCoverFilter(hits: SearchHit[] | undefined, enabled: boolean): { shown: SearchHit[]; hidden: number } {
  const { isMissing } = useMissingCovers();
  const all = hits ?? [];
  if (!enabled) return { shown: all, hidden: 0 };
  const shown = all.filter((hit) => hit.book.covers.length > 0 && !isMissing(hit.book.id));
  return { shown, hidden: all.length - shown.length };
}

export function HiddenCoversNote({ hidden }: { hidden: number }) {
  if (hidden === 0) return null;
  return (
    <p className="mb-6 text-sm text-muted" aria-live="polite">
      {hidden} {hidden === 1 ? 'book' : 'books'} without a cover image {hidden === 1 ? 'is' : 'are'} hidden on this page.
    </p>
  );
}
