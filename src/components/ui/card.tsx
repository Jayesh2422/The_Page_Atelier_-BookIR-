import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('rounded-[var(--radius-card)] border border-linen bg-white shadow-soft', className)} {...props} />;
}
