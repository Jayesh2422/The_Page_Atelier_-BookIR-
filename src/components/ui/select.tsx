import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A styled native <select>: fully accessible and keyboard-friendly on every platform. */
export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className={cn('relative', className)}>
      <select
        className="h-10 w-full cursor-pointer appearance-none rounded-lg border border-linen bg-white pr-9 pl-3 text-sm text-ink transition-colors hover:border-sage/60 focus-visible:border-sage focus-visible:outline-2 focus-visible:outline-sage"
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
}
