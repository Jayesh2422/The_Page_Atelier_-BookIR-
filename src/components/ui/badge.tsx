import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium [&_svg]:size-3', {
  variants: {
    variant: {
      sage: 'bg-sage-soft text-olive',
      terracotta: 'bg-terracotta-soft font-semibold text-terracotta-dark',
      outline: 'border border-linen bg-white text-ink',
      linen: 'bg-linen text-ink',
    },
  },
  defaultVariants: { variant: 'sage' },
});

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
