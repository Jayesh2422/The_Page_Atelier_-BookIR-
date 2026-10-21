import { handle, json } from '../lib/http/respond.js';
import { catalogueDb } from '../lib/services/catalogue.js';
import { searchCatalogue } from '../lib/services/search.js';
import { parseSearchParams } from '../lib/validation/params.js';

/** GET /api/search?q=&mode=ranked|keyword&sort=&page=&pageSize=&author=&publisher=&yearFrom=&yearTo= */
export const GET = handle(async (_request, url) => {
  const params = parseSearchParams(url.searchParams);
  const db = await catalogueDb();
  return json(await searchCatalogue(db, params), { cacheSeconds: 60 });
});
