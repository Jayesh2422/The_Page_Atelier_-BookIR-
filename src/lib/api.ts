import type {
  ApiErrorBody,
  BookDetailsResponse,
  DiscoverResponse,
  EvaluationResponse,
  HealthResponse,
  SearchResponse,
  SimilarResponse,
} from '../../lib/types';

/** An error returned by The Page Atelier API (or a network failure, code NETWORK_ERROR). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isErrorBody(body: unknown): body is ApiErrorBody {
  return Boolean(body && typeof body === 'object' && 'error' in body && typeof (body as ApiErrorBody).error?.message === 'string');
}

export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'We could not reach The Page Atelier server. Check your connection and try again.');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body (e.g. an HTML error page from a proxy).
  }
  if (!response.ok) {
    if (isErrorBody(body)) throw new ApiError(response.status, body.error.code, body.error.message);
    throw new ApiError(response.status, 'HTTP_ERROR', `The server responded with an unexpected error (HTTP ${response.status}).`);
  }
  if (body === null) throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unreadable response.');
  return body as T;
}

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const api = {
  search: (params: URLSearchParams, signal?: AbortSignal) => getJson<SearchResponse>(`/api/search?${params.toString()}`, signal),
  book: (id: string, signal?: AbortSignal) => getJson<BookDetailsResponse>(`/api/book${query({ id })}`, signal),
  similar: (id: string, limit: number, signal?: AbortSignal) => getJson<SimilarResponse>(`/api/similar${query({ id, limit })}`, signal),
  discover: (signal?: AbortSignal) => getJson<DiscoverResponse>('/api/discover', signal),
  evaluation: (k: number, signal?: AbortSignal) => getJson<EvaluationResponse>(`/api/evaluation${query({ k })}`, signal),
  health: (signal?: AbortSignal) => getJson<HealthResponse>('/api/health', signal),
};
