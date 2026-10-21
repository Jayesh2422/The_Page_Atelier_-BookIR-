/**
 * Create the MongoDB indexes used by the application (also done automatically by the import
 * and index scripts) and print a short status report.
 *
 *   npm run db:setup
 */
import { collections, ensureIndexes } from '../lib/db/collections.js';
import { run, withDatabase } from './_shared.js';

run(async () => {
  await withDatabase(async (db) => {
    await ensureIndexes(db);
    const c = collections(db);
    const [books, enriched, meta, evaluation] = await Promise.all([
      c.books.estimatedDocumentCount(),
      c.books.countDocuments({ 'enrichment.status': 'matched' }),
      c.indexMeta.findOne({ _id: 'active' }),
      c.evaluationQueries.countDocuments(),
    ]);
    console.log('Indexes are in place.');
    console.log(`books: ${books} (Google Books matches: ${enriched})`);
    console.log(meta ? `search index: ${meta.version}, ${meta.totalDocuments} books, built ${meta.builtAt.toISOString()}` : 'search index: not built (run npm run build:index)');
    console.log(`evaluation queries: ${evaluation}${evaluation ? '' : ' (run npm run seed:evaluation)'}`);
  });
});
