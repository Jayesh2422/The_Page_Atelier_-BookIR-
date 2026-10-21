import { handle, json } from '../lib/http/respond.js';
import { catalogueDb } from '../lib/services/catalogue.js';
import { evaluate } from '../lib/services/evaluation.js';
import { parseK } from '../lib/validation/params.js';

/** GET /api/evaluation?k=10 — Precision@K, Recall@K and MRR for both retrieval modes. */
export const GET = handle(async (_request, url) => {
  const k = parseK(url.searchParams);
  const db = await catalogueDb();
  return json(await evaluate(db, k), { cacheSeconds: 600 });
});
