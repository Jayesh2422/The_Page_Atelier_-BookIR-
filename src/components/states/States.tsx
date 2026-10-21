import { AlertTriangle, BookDashed, Database, RotateCw, WifiOff } from 'lucide-react';
import type { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function Panel({ icon, title, children, className }: { icon: React.ReactNode; title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mx-auto flex max-w-xl flex-col items-center rounded-[var(--radius-card)] border border-linen bg-white px-6 py-12 text-center shadow-soft', className)}>
      <div className="flex size-12 items-center justify-center rounded-full bg-sage-soft text-sage-dark [&_svg]:size-6">{icon}</div>
      <h2 className="font-display mt-5 text-2xl">{title}</h2>
      <div className="mt-3 text-sm leading-relaxed text-muted">{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, className }: { title: string; children?: React.ReactNode; className?: string }) {
  return (
    <Panel icon={<BookDashed />} title={title} className={className}>
      {children}
    </Panel>
  );
}

/** Setup instructions when the catalogue has not been configured or indexed yet. */
export function SetupState({ code, className }: { code: string; className?: string }) {
  const steps =
    code === 'DATABASE_NOT_CONFIGURED'
      ? ['Create a MongoDB Atlas cluster and copy its connection string.', 'Set MONGODB_URI (and optionally MONGODB_DATABASE) in .env or in the Vercel project settings.', 'Run npm run import:books and npm run build:index.']
      : ['Import the Book-Crossing records: npm run import:books', 'Build the inverted index: npm run build:index', 'Optionally load the evaluation queries: npm run seed:evaluation'];
  return (
    <Panel icon={<Database />} title={code === 'DATABASE_NOT_CONFIGURED' ? 'The catalogue is not connected yet' : 'The catalogue has not been indexed yet'} className={className}>
      <p>The Page Atelier needs its book catalogue before it can search. To finish setting it up:</p>
      <ol className="mt-4 space-y-2 text-left">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-linen text-xs font-semibold text-olive">{i + 1}</span>
            <span className="text-ink">{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4">The README describes each step in detail.</p>
    </Panel>
  );
}

export function ErrorState({ error, onRetry, className }: { error: ApiError; onRetry?: () => void; className?: string }) {
  if (error.code === 'DATABASE_NOT_CONFIGURED' || error.code === 'INDEX_NOT_BUILT') return <SetupState code={error.code} className={className} />;
  const offline = error.code === 'NETWORK_ERROR';
  const title = offline
    ? 'We couldn’t reach the server'
    : error.code === 'DATABASE_UNAVAILABLE'
      ? 'The catalogue is temporarily unavailable'
      : error.status === 404
        ? 'We couldn’t find that'
        : error.status === 400
          ? 'That request didn’t look quite right'
          : 'Something went wrong';
  return (
    <Panel icon={offline ? <WifiOff /> : <AlertTriangle />} title={title} className={className}>
      <p role="alert">{error.message}</p>
      {onRetry && error.status !== 404 && error.status !== 400 && (
        <Button variant="secondary" className="mt-6" onClick={onRetry}>
          <RotateCw /> Try again
        </Button>
      )}
    </Panel>
  );
}
