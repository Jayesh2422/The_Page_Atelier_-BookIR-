import { handle, json } from '../lib/http/respond.js';
import { getBookDetails } from '../lib/services/books.js';
import { catalogueDb } from '../lib/services/catalogue.js';
import { parseBookId } from '../lib/validation/params.js';

/** GET /api/book?id=<isbn> — book details and other editions of the same work. */
export const GET = handle(async (_request, url) => {
  const id = parseBookId(url.searchParams);
  const db = await catalogueDb();
  return json(await getBookDetails(db, id), { cacheSeconds: 300 });
});
