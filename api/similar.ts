import { QUERY_LIMITS } from '../lib/ir/config.js';
import { handle, json } from '../lib/http/respond.js';
import { getSimilarBooks } from '../lib/services/books.js';
import { catalogueDb } from '../lib/services/catalogue.js';
import { parseBookId, parseLimit } from '../lib/validation/params.js';

/** GET /api/similar?id=<isbn>&limit=12 — textually similar books (TF-IDF cosine). */
export const GET = handle(async (_request, url) => {
  const id = parseBookId(url.searchParams);
  const limit = parseLimit(url.searchParams, 12, QUERY_LIMITS.maxSimilarResults);
  const db = await catalogueDb();
  return json(await getSimilarBooks(db, id, limit), { cacheSeconds: 300 });
});
