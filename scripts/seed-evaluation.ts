/**
 * Load the evaluation queries and relevance judgments from data/evaluation/queries.json into
 * the evaluationQueries collection (replacing the previous copy of the same dataset).
 *
 *   npm run seed:evaluation
 */
import { collections } from '../lib/db/collections.js';
import { BUNDLED_DATASET } from '../lib/services/evaluation.js';
import { run, withDatabase } from './_shared.js';

run(async () => {
  const dataset = BUNDLED_DATASET;
  const ids = new Set<string>();
  for (const query of dataset.queries) {
    if (!query.id || !query.query || !Array.isArray(query.relevant)) throw new Error(`Invalid evaluation query: ${JSON.stringify(query)}`);
    if (ids.has(query.id)) throw new Error(`Duplicate evaluation query id "${query.id}".`);
    ids.add(query.id);
  }
  await withDatabase(async (db) => {
    const c = collections(db).evaluationQueries;
    await c.deleteMany({ dataset: dataset.name });
    if (dataset.queries.length) {
      await c.insertMany(
        dataset.queries.map((query, order) => ({ ...query, _id: `${dataset.name}:${query.id}`, order, dataset: dataset.name, updatedAt: new Date() })),
      );
    }
    console.log(`Stored ${dataset.queries.length} evaluation queries for dataset "${dataset.name}".`);
  });
});
