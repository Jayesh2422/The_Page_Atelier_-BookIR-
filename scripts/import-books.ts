/**
 * Import Book-Crossing records into MongoDB.
 *
 *   npm run import:books -- --file data/raw/BX-Books.csv --limit 50000
 *   npm run import:books -- --dry-run            (parse and report only)
 *
 * Safe to re-run: records are upserted by normalised ISBN.
 */
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { importBooks, type ImportReport } from '../lib/dataset/import.js';
import { loadEnv, run, withDatabase } from './_shared.js';

const { values } = parseArgs({
  options: {
    file: { type: 'string', default: 'data/raw/BX-Books.csv' },
    limit: { type: 'string' },
    'batch-size': { type: 'string', default: '1000' },
    'dry-run': { type: 'boolean', default: false },
  },
});

function printReport(report: ImportReport, dryRun: boolean): void {
  console.log('\nImport report');
  console.log('─────────────');
  console.log(`Rows read                : ${report.rowsRead}`);
  console.log(`Valid records            : ${report.accepted}`);
  if (!dryRun) {
    console.log(`Inserted                 : ${report.inserted}`);
    console.log(`Updated                  : ${report.updated}`);
    console.log(`Unchanged                : ${report.unchanged}`);
  }
  console.log(`Skipped (duplicate ISBN) : ${report.skippedDuplicates}`);
  const rejected = Object.entries(report.rejected);
  console.log(`Rejected                 : ${rejected.reduce((s, [, n]) => s + n, 0)}${rejected.length ? ` (${rejected.map(([k, n]) => `${k}: ${n}`).join(', ')})` : ''}`);
  console.log(`Possible duplicate editions (same title + author, different ISBN): ${report.possibleDuplicateEditions}`);
  console.log(`Encoding repairs         : ${report.encoding.repairedDoubleEncoded} double-encoded, ${report.encoding.ambiguousRepairs} ambiguous (best guess), ${report.encoding.legacyBytes} legacy bytes`);
  console.log(`Delimiter                : "${report.delimiter}"`);
}

run(async () => {
  const file = values.file!;
  if (!existsSync(file)) {
    throw new Error(`Dataset file not found: ${file}\nDownload BX-Books.csv (see README → Dataset source) and pass --file <path>.`);
  }
  const limit = values.limit ? Number(values.limit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) throw new Error('--limit must be a positive integer.');
  const batchSize = Number(values['batch-size']);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000) throw new Error('--batch-size must be between 1 and 10000.');

  const options = { limit, batchSize, dryRun: values['dry-run'], log: console.log };
  let report: ImportReport;
  if (values['dry-run']) {
    loadEnv();
    report = await importBooks(null, file, options);
  } else {
    report = await withDatabase((db) => importBooks(db, file, options));
  }
  printReport(report, values['dry-run']!);
  if (!values['dry-run']) console.log('\nNext: npm run build:index   (rebuild the inverted index for the new records)');
});
