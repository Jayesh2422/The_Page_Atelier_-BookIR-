import { handle, json } from '../lib/http/respond.js';
import { getDiscover } from '../lib/services/books.js';
import { catalogueDb } from '../lib/services/catalogue.js';

/** GET /api/discover — homepage sections built from real catalogue records. */
export const GET = handle(async () => {
  const db = await catalogueDb();
  return json(await getDiscover(db), { cacheSeconds: 300 });
});
