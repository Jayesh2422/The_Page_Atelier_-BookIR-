import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-lg border border-linen bg-white px-3 text-sm text-ink placeholder:text-muted transition-colors hover:border-sage/60 focus-visible:border-sage focus-visible:outline-2 focus-visible:outline-sage',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-xs font-semibold tracking-wide text-olive uppercase', className)} {...props} />;
}
