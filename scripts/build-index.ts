/**
 * Build (or rebuild) the inverted index from the books collection.
 *
 *   npm run build:index
 *
 * Run after every import or enrichment batch. Searches keep using the previous index version
 * until the new one is complete.
 */
import { buildAndStoreIndex } from '../lib/indexing/build.js';
import { DEFAULT_INDEX_CONFIG } from '../lib/ir/config.js';
import { run, withDatabase } from './_shared.js';

run(async () => {
  console.log('Field weights:', DEFAULT_INDEX_CONFIG.fieldWeights);
  const report = await withDatabase((db) => buildAndStoreIndex(db, { log: console.log }));
  console.log('\nIndex report');
  console.log('────────────');
  console.log(`Version              : ${report.version}`);
  console.log(`Indexed books (N)    : ${report.documents}`);
  console.log(`Books without terms  : ${report.skippedEmpty}`);
  console.log(`Vocabulary terms     : ${report.vocabulary}`);
  console.log(`Postings             : ${report.postings} (in ${report.postingsDocuments} chunk documents)`);
  console.log(`Time                 : ${report.seconds.toFixed(1)} s`);
});
