/** Response helpers for the Web-standard Request/Response handlers in /api. */
import { AppError } from './errors.js';

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
};

export function json(body: unknown, init: { status?: number; cacheSeconds?: number } = {}): Response {
  const cache = init.cacheSeconds
    ? `public, max-age=0, s-maxage=${init.cacheSeconds}, stale-while-revalidate=${init.cacheSeconds * 4}`
    : 'no-store';
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { ...BASE_HEADERS, 'Cache-Control': cache },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  // Driver errors after a connection was established (network blips, timeouts, server
  // selection) are reported as a temporary database outage.
  if (error instanceof Error && error.name.startsWith('Mongo')) {
    console.error('[api] database error:', error.name);
    return json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'The catalogue database could not be reached. Please try again shortly.' } }, { status: 503 });
  }
  // Unknown failures: log server-side, never leak internals to the client.
  console.error('[api] unexpected error:', error instanceof Error ? `${error.name}: ${error.message}` : error);
  return json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.' } }, { status: 500 });
}

/** Wrap a handler with uniform error handling. */
export function handle(handler: (request: Request, url: URL) => Promise<Response>): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handler(request, new URL(request.url));
    } catch (error) {
      return errorResponse(error);
    }
  };
}
