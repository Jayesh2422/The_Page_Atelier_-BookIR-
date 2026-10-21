/**
 * Relevance-judgment helper (pooling). Prints the union of the top-N results of both modes
 * for a query, marking books already judged relevant in data/evaluation/queries.json, so a
 * person can review the pool and edit the judgments file by hand.
 *
 *   npm run judge -- --query "harry potter" --depth 20
 */
import { parseArgs } from 'node:util';
import { collections } from '../lib/db/collections.js';
import { retrieveBoth } from '../lib/ir/engine.js';
import { BUNDLED_DATASET } from '../lib/services/evaluation.js';
import { requireIndex } from '../lib/services/catalogue.js';
import { run, withDatabase } from './_shared.js';

const { values } = parseArgs({ options: { query: { type: 'string' }, depth: { type: 'string', default: '20' } } });

run(async () => {
  const query = values.query?.trim();
  if (!query) throw new Error('Pass --query "<text>".');
  const depth = Number(values.depth);
  const judged = new Set(BUNDLED_DATASET.queries.find((q) => q.query === query)?.relevant ?? []);
  await withDatabase(async (db) => {
    const store = await requireIndex(db);
    const { ranked, keyword } = await retrieveBoth(store, query);
    const pool = [...new Set([...ranked.slice(0, depth), ...keyword.slice(0, depth)].map((c) => c.id))];
    const docs = await collections(db).books.find({ _id: { $in: pool } }, { projection: { title: 1, author: 1, year: 1 } }).toArray();
    const byId = new Map(docs.map((d) => [d._id, d]));
    const rankOf = (list: typeof ranked, id: string) => {
      const i = list.findIndex((c) => c.id === id);
      return i === -1 || i >= depth ? '  -' : String(i + 1).padStart(3);
    };
    console.log(`Pool for "${query}" (${pool.length} books, top ${depth} of each mode). ✓ = already judged relevant\n`);
    console.log('   ranked keyword  isbn        title — author (year)');
    for (const id of pool) {
      const d = byId.get(id);
      console.log(`${judged.has(id) ? '✓' : ' '}  ${rankOf(ranked, id)}    ${rankOf(keyword, id)}    ${id.padEnd(11)} ${d?.title} — ${d?.author ?? 'unknown'} (${d?.year ?? 'n.d.'})`);
    }
  });
});
