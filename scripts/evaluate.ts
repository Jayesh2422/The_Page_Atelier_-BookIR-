/**
 * Run the evaluation from the command line (the same computation as /api/evaluation).
 *
 *   npm run evaluate -- --k 10
 */
import { parseArgs } from 'node:util';
import { evaluate } from '../lib/services/evaluation.js';
import { run, withDatabase } from './_shared.js';

const { values } = parseArgs({ options: { k: { type: 'string', default: '10' } } });
const pct = (v: number) => v.toFixed(3);

run(async () => {
  const k = Number(values.k);
  if (!Number.isInteger(k) || k < 1 || k > 20) throw new Error('--k must be an integer between 1 and 20.');
  const result = await withDatabase((db) => evaluate(db, k));
  console.log(`Dataset ${result.datasetName} (${result.source}); ${result.queriesEvaluated}/${result.queriesTotal} queries evaluated; N = ${result.index.books}\n`);
  console.log(`${'id'.padEnd(5)} ${'query'.padEnd(28)} ${'rel'.padStart(4)}   keyword P@${k}  R@${k}   RR    |  ranked P@${k}  R@${k}   RR`);
  for (const q of result.queries) {
    const kw = q.metrics.keyword;
    const rk = q.metrics.ranked;
    const row = q.skipped
      ? '  (skipped: no judged relevant book in this catalogue)'
      : `   ${pct(kw.precisionAtK)}  ${pct(kw.recallAtK)}  ${pct(kw.reciprocalRank)}  |  ${pct(rk.precisionAtK)}  ${pct(rk.recallAtK)}  ${pct(rk.reciprocalRank)}`;
    console.log(`${q.id.padEnd(5)} ${q.query.slice(0, 28).padEnd(28)} ${String(q.relevantInCatalogue).padStart(4)}${row}`);
  }
  console.log('\nMeans');
  for (const mode of ['keyword', 'ranked'] as const) {
    const s = result.summary[mode];
    console.log(`  ${mode.padEnd(8)} P@${k} ${pct(s.meanPrecisionAtK)}   R@${k} ${pct(s.meanRecallAtK)}   MRR@${result.mrrDepth} ${pct(s.mrr)}`);
  }
});
