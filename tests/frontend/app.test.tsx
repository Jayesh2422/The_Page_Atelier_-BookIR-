// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book, DiscoverResponse, SearchResponse, SimilarResponse } from '../../lib/types';
import { routes } from '@/routes';

const book = (id: string, title: string, extra: Partial<Book> = {}): Book => ({
  id,
  isbn: id,
  isbn13: null,
  isbnValid: true,
  title,
  author: 'J. K. Rowling',
  authors: ['J. K. Rowling'],
  year: 2000,
  publisher: 'Scholastic',
  covers: [],
  description: null,
  descriptionSource: null,
  descriptionLink: null,
  categories: [],
  pageCount: null,
  publishedDate: null,
  language: null,
  infoLink: null,
  enriched: false,
  ...extra,
});

const GOBLET = book('0439139597', 'Harry Potter and the Goblet of Fire');
const CHAMBER = book('0439064872', 'Harry Potter and the Chamber of Secrets');

function searchResponse(query: string, overrides: Partial<SearchResponse> = {}): SearchResponse {
  return {
    query,
    terms: query.toLowerCase().split(' '),
    unknownTerms: [],
    mode: 'ranked',
    sort: 'relevance',
    filters: {},
    page: 1,
    pageSize: 24,
    total: 2,
    totalIsCapped: false,
    totalPages: 1,
    results: [
      { book: GOBLET, score: 0.81, cosine: 0.81, matchedTerms: ['harry', 'potter'], matchedFields: ['title'] },
      { book: CHAMBER, score: 0.79, cosine: 0.79, matchedTerms: ['harry', 'potter'], matchedFields: ['title'] },
    ],
    suggestions: [],
    facets: { authors: [{ value: 'J. K. Rowling', count: 2 }], publishers: [{ value: 'Scholastic', count: 2 }], years: { min: 1998, max: 2003 } },
    notice: null,
    tookMs: 12,
    ...overrides,
  };
}

const similarResponse: SimilarResponse = {
  source: GOBLET,
  results: [{ book: CHAMBER, similarity: 0.5, reasons: [{ kind: 'author', label: 'Same author: J. K. Rowling', terms: ['rowling'] }] }],
  termsUsed: 9,
  tookMs: 5,
};

const discoverResponse: DiscoverResponse = {
  stats: { books: 271016, vocabulary: 116548, postings: 2345215, enriched: 0, builtAt: '2026-10-21T00:00:00.000Z' },
  discover: [GOBLET],
  recent: [CHAMBER],
  authors: [{ name: 'Agatha Christie', count: 634 }],
  publishers: [],
  similar: null,
};

type Handler = (url: URL) => { status?: number; body: unknown };
let handler: Handler;
const requests: URL[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function defaultHandler(url: URL): { status?: number; body: unknown } {
  switch (url.pathname) {
    case '/api/discover':
      return { body: discoverResponse };
    case '/api/search': {
      const q = url.searchParams.get('q') ?? '';
      if (q === 'Harry Poter') {
        return {
          body: searchResponse(q, {
            unknownTerms: ['poter'],
            suggestions: [{ query: 'Harry Potter', corrections: [{ from: 'poter', to: 'potter', distance: 1 }] }],
          }),
        };
      }
      if (q === 'zzzz') return { body: searchResponse(q, { total: 0, totalPages: 0, results: [] }) };
      return { body: searchResponse(q) };
    }
    case '/api/book':
      return url.searchParams.get('id') === GOBLET.id
        ? { body: { book: GOBLET, otherEditions: [] } }
        : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'No book with that id exists in the catalogue.' } } };
    case '/api/similar':
      return { body: similarResponse };
    default:
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Unknown API route.' } } };
  }
}

beforeEach(() => {
  handler = defaultHandler;
  requests.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      requests.push(url);
      const { status = 200, body } = handler(url);
      return json(body, status);
    }),
  );
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const searchRequests = () => requests.filter((u) => u.pathname === '/api/search');

describe('The Page Atelier user flows', () => {
  it('submits a search from the homepage', async () => {
    const user = userEvent.setup();
    const router = renderAt('/');
    expect(await screen.findByText(/271,016 Book-Crossing records/)).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'harry potter{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/search'));
    expect(router.state.location.search).toBe('?q=harry+potter');
    expect(await screen.findByRole('link', { name: 'Harry Potter and the Goblet of Fire' })).toBeInTheDocument();
    expect(screen.getAllByText(/Score/)[0]).toHaveTextContent('Score 0.810');
  });

  it('validates an empty query instead of searching', async () => {
    const user = userEvent.setup();
    const router = renderAt('/');
    await user.click(screen.getAllByRole('button', { name: /^Search$/ })[0]!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Type a title/);
    expect(router.state.location.pathname).toBe('/');
  });

  it('runs a real search when an example query is clicked', async () => {
    const user = userEvent.setup();
    const router = renderAt('/');
    await user.click(screen.getByRole('link', { name: 'Mystery novels' }));
    await waitFor(() => expect(router.state.location.search).toBe('?q=Mystery+novels'));
    await waitFor(() => expect(searchRequests().at(-1)?.searchParams.get('q')).toBe('Mystery novels'));
  });

  it('opens a book and navigates back to the same results', async () => {
    const user = userEvent.setup();
    const router = renderAt('/search?q=harry+potter&sort=title');
    await user.click(await screen.findByRole('link', { name: 'Harry Potter and the Goblet of Fire' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Harry Potter and the Goblet of Fire' })).toBeInTheDocument();
    expect(screen.getByText('Description unavailable for this edition.')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Back to results/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/search'));
    expect(router.state.location.search).toBe('?q=harry+potter&sort=title');
  });

  it('lets the reader accept a spelling suggestion', async () => {
    const user = userEvent.setup();
    const router = renderAt('/search?q=Harry+Poter');
    const suggestion = await screen.findByRole('complementary', { name: 'Spelling suggestion' });
    expect(suggestion).toHaveTextContent('“poter” → “potter” (1 edit)');
    await user.click(within(suggestion).getByRole('link', { name: 'Harry Potter' }));
    await waitFor(() => expect(router.state.location.search).toBe('?q=Harry+Potter'));
    await waitFor(() => expect(searchRequests().at(-1)?.searchParams.get('q')).toBe('Harry Potter'));
    expect(screen.queryByRole('complementary', { name: 'Spelling suggestion' })).not.toBeInTheDocument();
  });

  it('lets the reader keep the original query', async () => {
    const user = userEvent.setup();
    renderAt('/search?q=Harry+Poter');
    await user.click(await screen.findByRole('button', { name: 'Keep “Harry Poter”' }));
    expect(screen.queryByRole('complementary', { name: 'Spelling suggestion' })).not.toBeInTheDocument();
  });

  it('applies filters to the API request and resets to page one', async () => {
    const user = userEvent.setup();
    const router = renderAt('/search?q=harry&page=2');
    await screen.findByRole('link', { name: 'Harry Potter and the Goblet of Fire' });
    await user.selectOptions(screen.getByLabelText('Author'), 'J. K. Rowling');
    await waitFor(() => expect(searchRequests().at(-1)?.searchParams.get('author')).toBe('J. K. Rowling'));
    expect(searchRequests().at(-1)?.searchParams.get('page')).toBeNull();
    expect(router.state.location.search).toContain('author=J.+K.+Rowling');
    await user.type(screen.getByLabelText('From year'), '1999');
    await user.click(screen.getByRole('button', { name: 'Apply years' }));
    await waitFor(() => expect(searchRequests().at(-1)?.searchParams.get('yearFrom')).toBe('1999'));
    await user.click(screen.getByRole('button', { name: /Remove filter Author/ }));
    await waitFor(() => expect(searchRequests().at(-1)?.searchParams.get('author')).toBeNull());
  });

  it('switches between ranked and keyword modes', async () => {
    const user = userEvent.setup();
    renderAt('/search?q=harry');
    await screen.findByRole('link', { name: 'Harry Potter and the Goblet of Fire' });
    await user.click(screen.getByRole('button', { name: 'Keyword' }));
    await waitFor(() => expect(searchRequests().at(-1)?.searchParams.get('mode')).toBe('keyword'));
    expect(screen.getByRole('button', { name: 'Keyword' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('finds similar books from the details page', async () => {
    const user = userEvent.setup();
    const router = renderAt(`/books/${GOBLET.id}`);
    expect(await screen.findByText('Same author: J. K. Rowling')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: /Find similar books/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/books/${GOBLET.id}/similar`));
    expect(await screen.findByRole('heading', { name: /Books similar to/ })).toBeInTheDocument();
    expect(screen.getByText('Similarity 0.50')).toBeInTheDocument();
  });

  it('hides books without covers when "Only with covers" is on, without a new search', async () => {
    const user = userEvent.setup();
    handler = (url) =>
      url.pathname === '/api/search'
        ? {
            body: searchResponse('harry', {
              results: [
                { book: book('0000000019', 'A Book With A Cover', { covers: ['https://example.org/cover.jpg'] }), score: 0.8, cosine: 0.8, matchedTerms: ['harry'], matchedFields: ['title'] },
                { book: CHAMBER, score: 0.7, cosine: 0.7, matchedTerms: ['harry'], matchedFields: ['title'] },
              ],
            }),
          }
        : defaultHandler(url);
    const router = renderAt('/search?q=harry');
    expect(await screen.findByRole('link', { name: 'Harry Potter and the Chamber of Secrets' })).toBeInTheDocument();
    const before = searchRequests().length;
    await user.click(screen.getByRole('button', { name: 'Only with covers' }));
    await waitFor(() => expect(router.state.location.search).toContain('covers=only'));
    expect(screen.queryByRole('link', { name: 'Harry Potter and the Chamber of Secrets' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'A Book With A Cover' })).toBeInTheDocument();
    expect(screen.getByText('1 book without a cover image is hidden on this page.')).toBeInTheDocument();
    // a display option only: the API is not asked again and never sees the parameter
    expect(searchRequests().length).toBe(before);
    expect(searchRequests().every((u) => !u.searchParams.has('covers'))).toBe(true);
  });

  it('only shows books with covers in the homepage sections', async () => {
    handler = (url) =>
      url.pathname === '/api/discover'
        ? { body: { ...discoverResponse, discover: [GOBLET, { ...CHAMBER, covers: ['https://example.org/chamber.jpg'] }], recent: [] } }
        : defaultHandler(url);
    renderAt('/');
    const section = await screen.findByRole('list', { name: 'Books to discover' });
    // GOBLET has no cover at all; CHAMBER is used by the hero, so nothing coverless remains.
    expect(within(section).queryByText('Harry Potter and the Goblet of Fire')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    renderAt('/search?q=zzzz');
    expect(await screen.findByRole('heading', { name: 'No books matched your search' })).toBeInTheDocument();
  });

  it('shows a not-found state for unknown books', async () => {
    renderAt('/books/0000000000');
    expect(await screen.findByRole('heading', { name: 'We couldn’t find that' })).toBeInTheDocument();
  });

  it('shows setup instructions when the database is not configured', async () => {
    handler = () => ({ status: 503, body: { error: { code: 'DATABASE_NOT_CONFIGURED', message: 'Not configured.' } } });
    renderAt('/search?q=python');
    expect(await screen.findByRole('heading', { name: 'The catalogue is not connected yet' })).toBeInTheDocument();
  });

  it('shows a retryable error for server failures and recovers', async () => {
    const user = userEvent.setup();
    let fail = true;
    handler = (url) => (fail ? { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side.' } } } : defaultHandler(url));
    renderAt('/search?q=python');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side.');
    fail = false;
    await user.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByRole('link', { name: 'Harry Potter and the Goblet of Fire' })).toBeInTheDocument();
  });
});
