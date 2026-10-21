import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/http/errors.js';
import { errorResponse } from '../../lib/http/respond.js';
import { parseBookId, parseK, parseLimit, parseSearchParams } from '../../lib/validation/params.js';

const params = (init: Record<string, string>) => new URLSearchParams(init);

describe('search parameter validation', () => {
  it('applies defaults', () => {
    expect(parseSearchParams(params({ q: '  python ' }))).toEqual({ q: 'python', mode: 'ranked', sort: 'relevance', page: 1, pageSize: 24, filters: {} });
  });

  it('parses filters and treats empty values as missing', () => {
    const parsed = parseSearchParams(params({ q: 'x', author: 'Mark Lutz', publisher: '', yearFrom: '1990', yearTo: '2000', mode: 'keyword', sort: 'year-desc', page: '3', pageSize: '12' }));
    expect(parsed).toMatchObject({ mode: 'keyword', sort: 'year-desc', page: 3, pageSize: 12, filters: { author: 'Mark Lutz', yearFrom: 1990, yearTo: 2000 } });
    expect(parsed.filters.publisher).toBeUndefined();
  });

  it('uses title order when browsing without a query', () => {
    expect(parseSearchParams(params({})).sort).toBe('title');
  });

  it.each([
    [{ pageSize: '999' }, /pageSize/],
    [{ page: '0' }, /page/],
    [{ mode: 'magic' }, /mode/],
    [{ sort: 'random' }, /sort/],
    [{ yearFrom: '2005', yearTo: '1990' }, /yearFrom/],
    [{ yearFrom: 'abc' }, /yearFrom/],
    [{ q: 'x'.repeat(201) }, /too long/],
  ])('rejects %o', (input, message) => {
    expect(() => parseSearchParams(params(input))).toThrow(message);
    try {
      parseSearchParams(params(input));
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(400);
    }
  });
});

describe('other parameters', () => {
  it('validates book ids', () => {
    expect(parseBookId(params({ id: '080652121x' }))).toBe('080652121X');
    expect(() => parseBookId(params({}))).toThrow(/Missing "id"/);
    expect(() => parseBookId(params({ id: '{"$ne":1}' }))).toThrow(/Invalid "id"/);
  });

  it('caps limits and K', () => {
    expect(parseLimit(params({}), 12, 48)).toBe(12);
    expect(parseLimit(params({ limit: '48' }), 12, 48)).toBe(48);
    expect(() => parseLimit(params({ limit: '49' }), 12, 48)).toThrow(/between 1 and 48/);
    expect(parseK(params({}))).toBe(10);
    expect(() => parseK(params({ k: '0' }))).toThrow();
  });
});

describe('error responses', () => {
  it('returns structured errors for known failures', async () => {
    const response = errorResponse(new AppError(404, 'NOT_FOUND', 'Nope'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Nope' } });
  });

  it('hides internal details of unexpected errors', async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const response = errorResponse(new Error('secret connection string mongodb+srv://user:pw@host'));
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain('mongodb');
      const mongo = Object.assign(new Error('timeout'), { name: 'MongoServerSelectionError' });
      expect(errorResponse(mongo).status).toBe(503);
    } finally {
      console.error = original;
    }
  });
});
