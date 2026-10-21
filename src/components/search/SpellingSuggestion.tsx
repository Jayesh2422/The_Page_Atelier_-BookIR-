import { SpellCheck, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { SpellingSuggestion as Suggestion } from '../../../lib/types';
import { searchUrl, type SearchState } from '@/lib/search-params';
import { cn } from '@/lib/utils';

interface SpellingSuggestionProps {
  query: string;
  suggestions: Suggestion[];
  keep: Partial<SearchState>;
  /** True when the original query found nothing at all. */
  noResults: boolean;
}

/** "Did you mean …?" — the user explicitly accepts a correction or keeps the original query. */
export function SpellingSuggestion({ query, suggestions, keep, noResults }: SpellingSuggestionProps) {
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [best, ...alternatives] = suggestions;
  if (!best || dismissedFor === query) return null;

  return (
    <aside
      aria-label="Spelling suggestion"
      className={cn('relative flex gap-3 rounded-[var(--radius-card)] border px-4 py-4 sm:px-5', noResults ? 'border-terracotta/40 bg-terracotta-soft/60' : 'border-linen bg-white')}
    >
      <SpellCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-terracotta-dark" />
      <div className="min-w-0 flex-1 pr-8">
        <p className="text-[0.95rem] text-ink">
          Did you mean{' '}
          <Link to={searchUrl(best.query, keep)} className="font-display text-lg text-olive underline decoration-terracotta/60 underline-offset-4 hover:decoration-terracotta">
            {best.query}
          </Link>
          ?
        </p>
        <p className="mt-1 text-xs text-muted">
          {best.corrections.map((c) => `“${c.from}” → “${c.to}” (${c.distance} edit${c.distance === 1 ? '' : 's'})`).join(' · ')} — from words in the catalogue.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {alternatives.length > 0 && <span className="text-muted">Other suggestions:</span>}
          {alternatives.map((s) => (
            <Link key={s.query} to={searchUrl(s.query, keep)} className="rounded-full border border-linen bg-white px-3 py-1 text-olive hover:border-sage hover:bg-sage-soft">
              {s.query}
            </Link>
          ))}
          <button type="button" onClick={() => setDismissedFor(query)} className="rounded-full px-3 py-1 text-muted underline-offset-2 hover:text-ink hover:underline">
            Keep “{query}”
          </button>
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss suggestion"
        onClick={() => setDismissedFor(query)}
        className="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-full text-muted hover:bg-linen hover:text-ink"
      >
        <X className="size-4" />
      </button>
    </aside>
  );
}
