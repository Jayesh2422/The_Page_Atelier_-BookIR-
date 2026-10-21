import { useCallback, useSyncExternalStore } from 'react';

/**
 * Remembers, for the whole browser session, which books turned out to have no working cover.
 * Covers can only be checked by loading them, so pages that hide cover-less books learn this as
 * images fail; remembering it avoids showing the same placeholder again on the next page.
 */
const missing = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markCoverMissing(id: string): void {
  if (missing.has(id)) return;
  missing.add(id);
  version++;
  for (const listener of listeners) listener();
}

export function useMissingCovers(): { isMissing: (id: string) => boolean; markMissing: (id: string) => void } {
  useSyncExternalStore(subscribe, () => version);
  const isMissing = useCallback((id: string) => missing.has(id), []);
  return { isMissing, markMissing: markCoverMissing };
}
