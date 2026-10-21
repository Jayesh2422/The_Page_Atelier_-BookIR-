import { ArrowRight, Search, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { searchUrl, type SearchState } from '@/lib/search-params';
import { cn } from '@/lib/utils';

export const MAX_QUERY_LENGTH = 200;

interface SearchBarProps {
  initialQuery?: string;
  size?: 'hero' | 'compact';
  /** Search state kept when a new query is submitted (e.g. the mode). */
  keep?: Partial<SearchState>;
  autoFocus?: boolean;
  className?: string;
}

export function SearchBar({ initialQuery = '', size = 'compact', keep, autoFocus, className }: SearchBarProps) {
  const navigate = useNavigate();
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialQuery);
  const [message, setMessage] = useState<string | null>(null);
  const [syncedQuery, setSyncedQuery] = useState(initialQuery);
  // Follow the URL when it changes (e.g. after accepting a spelling suggestion).
  if (syncedQuery !== initialQuery) {
    setSyncedQuery(initialQuery);
    setValue(initialQuery);
  }

  const hero = size === 'hero';

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const query = value.trim().replace(/\s+/g, ' ');
    if (!query) {
      setMessage('Type a title, an author, a publisher or a few keywords.');
      inputRef.current?.focus();
      return;
    }
    if (!/[\p{L}\p{N}]/u.test(query)) {
      setMessage('Please include at least one letter or number.');
      return;
    }
    setMessage(null);
    navigate(searchUrl(query, keep?.mode ? { mode: keep.mode } : {}));
  }

  return (
    <form role="search" onSubmit={submit} className={cn('w-full', className)} noValidate>
      <label htmlFor={inputId} className="sr-only">
        Search books by title, author, publisher or keyword
      </label>
      <div
        className={cn(
          'flex items-center gap-2 rounded-full border border-linen bg-white transition-shadow focus-within:border-sage focus-within:shadow-lift',
          hero ? 'h-16 pr-2 pl-5 shadow-lift sm:h-[4.25rem] sm:pl-6' : 'h-12 pr-1.5 pl-4 shadow-soft',
        )}
      >
        <Search aria-hidden className={cn('shrink-0 text-sage-dark', hero ? 'size-5' : 'size-4')} />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          value={value}
          maxLength={MAX_QUERY_LENGTH}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder={hero ? 'Search by title, author, publisher or keyword' : 'Search the catalogue'}
          aria-describedby={message ? hintId : undefined}
          aria-invalid={message ? true : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            if (message) setMessage(null);
          }}
          className={cn(
            'min-w-0 flex-1 bg-transparent text-ink placeholder:text-muted focus:outline-none [&::-webkit-search-cancel-button]:hidden',
            hero ? 'text-base sm:text-lg' : 'text-sm',
          )}
        />
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setValue('');
              setMessage(null);
              inputRef.current?.focus();
            }}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-linen hover:text-ink"
          >
            <X className="size-4" />
          </button>
        )}
        <Button type="submit" size={hero ? 'lg' : 'sm'} className={cn(hero ? 'px-5 sm:px-7' : 'h-9 px-4')}>
          <span className={hero ? '' : 'sr-only sm:not-sr-only'}>Search</span>
          <ArrowRight aria-hidden className={hero ? 'hidden sm:block' : 'sm:hidden'} />
        </Button>
      </div>
      {message && (
        <p id={hintId} role="alert" className="mt-2 pl-5 text-sm text-terracotta-dark">
          {message}
        </p>
      )}
    </form>
  );
}
