import { describe, expect, it } from 'vitest';
import { openLibraryCoverUrl } from '../../lib/books/model.js';
import { shouldEnrichOnView } from '../../lib/services/books.js';

describe('enrich on view', () => {
  const state = (status: 'matched' | 'not_found' | 'rejected' | 'error', attempts: number) => ({
    enrichment: { status, attempts, attemptedAt: '2026-10-22T00:00:00.000Z' },
  });

  it('enriches books that were never attempted', () => {
    expect(shouldEnrichOnView({ enrichment: null })).toBe(true);
    expect(shouldEnrichOnView({})).toBe(true);
  });

  it('retries failed lookups a limited number of times', () => {
    expect(shouldEnrichOnView(state('error', 1))).toBe(true);
    expect(shouldEnrichOnView(state('error', 2))).toBe(true);
    expect(shouldEnrichOnView(state('error', 3))).toBe(false);
  });

  it('does not repeat settled lookups', () => {
    expect(shouldEnrichOnView(state('matched', 1))).toBe(false);
    expect(shouldEnrichOnView(state('not_found', 1))).toBe(false);
    expect(shouldEnrichOnView(state('rejected', 1))).toBe(false);
  });
});

describe('Open Library cover fallback', () => {
  it('builds a 404-on-missing URL for valid ISBNs only', () => {
    expect(openLibraryCoverUrl('0439139597', true)).toBe('https://covers.openlibrary.org/b/isbn/0439139597-L.jpg?default=false');
    expect(openLibraryCoverUrl('00008X', false)).toBeNull();
  });
});
