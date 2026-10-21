import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';

export type ApiState<T> =
  | { status: 'loading'; data: T | null; error: null }
  | { status: 'success'; data: T; error: null }
  | { status: 'error'; data: T | null; error: ApiError };

type Settled<T> = { key: string; status: 'success'; data: T; error: null } | { key: string; status: 'error'; data: T | null; error: ApiError };

/**
 * Run an API request whenever `key` changes, cancelling the previous request.
 * The state is "loading" until a response for the current key arrives; the previous data is
 * kept meanwhile, so pages can show stale results dimmed instead of a blank screen.
 */
export function useApi<T>(key: string | null, request: (signal: AbortSignal) => Promise<T>): ApiState<T> & { retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const requestKey = key === null ? null : `${key}#${attempt}`;

  useEffect(() => {
    if (requestKey === null) return;
    const controller = new AbortController();
    request(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setSettled({ key: requestKey, status: 'success', data, error: null });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const apiError = error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Something unexpected happened.');
        setSettled((previous) => ({ key: requestKey, status: 'error', data: previous?.data ?? null, error: apiError }));
      },
    );
    return () => controller.abort();
    // `request` is intentionally excluded: callers pass inline closures identified by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const retry = () => setAttempt((n) => n + 1);
  if (!settled || settled.key !== requestKey) return { status: 'loading', data: settled?.data ?? null, error: null, retry };
  return settled.status === 'success'
    ? { status: 'success', data: settled.data, error: null, retry }
    : { status: 'error', data: settled.data, error: settled.error, retry };
}
