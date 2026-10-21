import { Link } from 'react-router';
import { cn } from '@/lib/utils';

/** An open-book mark with a terracotta spine, paired with the lower-case wordmark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8', className)}>
      <rect width="32" height="32" rx="9" className="fill-olive" />
      <path
        d="M16 10.5c-2.6-1.7-5.6-2.2-8.5-1.7v12.6c2.9-.5 5.9 0 8.5 1.7 2.6-1.7 5.6-2.2 8.5-1.7V8.8c-2.9-.5-5.9 0-8.5 1.7Z"
        fill="none"
        className="stroke-cream"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M16 10.5v12.6" className="stroke-terracotta" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn('group inline-flex items-center gap-2.5 rounded-md', className)} aria-label="The Page Atelier home">
      <LogoMark />
      <span className="font-display text-[1.45rem] leading-none text-olive">
        The Page <span className="text-sage-dark italic">Atelier</span>
      </span>
    </Link>
  );
}
