/**
 * Book-Crossing → MongoDB import.
 *
 * - Reads BX-Books.csv (original ";"-separated dump or the ","-separated Kaggle copy).
 * - Repairs the file's character-encoding damage and decodes HTML entities.
 * - Cleans every record (see books/model.ts) and rejects rows without ISBN or title.
 * - De-duplicates records whose ISBNs normalise to the same value (first occurrence wins).
 * - Upserts by _id in batches, so re-running never creates duplicates. Only Book-Crossing
 *   fields are written: Google Books enrichment stored on a record is preserved.
 */
import { readFile } from 'node:fs/promises';
import type { AnyBulkWriteOperation, Db } from 'mongodb';
import type { BookDoc, RawBookRecord } from '../books/model.js';
import { cleanRecord, RAW_COLUMNS } from '../books/model.js';
import { collections, ensureIndexes } from '../db/collections.js';
import { detectDelimiter, parseCsv } from './csv.js';
import { decodeBookCrossing, type DecodeStats } from './encoding.js';

export interface ImportOptions {
  /** Maximum number of valid records to import (default: all). */
  limit?: number;
  batchSize?: number;
  /** Parse and clean without writing to the database. */
  dryRun?: boolean;
  log?: (message: string) => void;
}

export interface ImportReport {
  rowsRead: number;
  accepted: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skippedDuplicates: number;
  rejected: Record<string, number>;
  /** Records that share a normalised title+author with another imported record (editions). */
  possibleDuplicateEditions: number;
  encoding: DecodeStats;
  delimiter: string;
}

export interface ParsedRecords {
  records: Omit<BookDoc, 'importedAt'>[];
  report: Omit<ImportReport, 'inserted' | 'updated' | 'unchanged'>;
}

/** Parse and clean a Book-Crossing CSV buffer. Pure — no database access. */
export function parseBookCrossing(bytes: Uint8Array, limit = Infinity): ParsedRecords {
  const encoding: DecodeStats = { repairedDoubleEncoded: 0, ambiguousRepairs: 0, legacyBytes: 0 };
  const text = decodeBookCrossing(bytes, encoding);
  const newline = text.indexOf('\n');
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  const delimiter = detectDelimiter(firstLine);

  const rows = parseCsv(text, { delimiter, backslashEscapes: true });
  const header = rows.next();
  if (header.done) throw new Error('The CSV file is empty.');
  const columns = header.value.map((h) => h.trim());
  const positions = RAW_COLUMNS.map((name) => columns.indexOf(name));
  const missing = RAW_COLUMNS.filter((_, i) => positions[i] === -1);
  if (missing.length) {
    throw new Error(`Unexpected CSV header. Missing column(s): ${missing.join(', ')}. Found: ${columns.join(', ')}`);
  }

  const rejected: Record<string, number> = {};
  const seen = new Set<string>();
  const dedupCounts = new Map<string, number>();
  const records: Omit<BookDoc, 'importedAt'>[] = [];
  let rowsRead = 0;
  let skippedDuplicates = 0;

  for (const row of rows) {
    if (records.length >= limit) break;
    rowsRead++;
    if (row.length !== columns.length) {
      rejected['malformed-row'] = (rejected['malformed-row'] ?? 0) + 1;
      continue;
    }
    const raw = Object.fromEntries(RAW_COLUMNS.map((name, i) => [name, row[positions[i]!] ?? ''])) as RawBookRecord;
    const result = cleanRecord(raw);
    if (!result.ok) {
      rejected[result.reason] = (rejected[result.reason] ?? 0) + 1;
      continue;
    }
    if (seen.has(result.book._id)) {
      skippedDuplicates++;
      continue;
    }
    seen.add(result.book._id);
    dedupCounts.set(result.book.dedupKey, (dedupCounts.get(result.book.dedupKey) ?? 0) + 1);
    records.push(result.book);
  }

  let possibleDuplicateEditions = 0;
  for (const count of dedupCounts.values()) if (count > 1) possibleDuplicateEditions += count;

  return {
    records,
    report: { rowsRead, accepted: records.length, skippedDuplicates, rejected, possibleDuplicateEditions, encoding, delimiter },
  };
}

export async function importBooks(db: Db | null, filePath: string, options: ImportOptions = {}): Promise<ImportReport> {
  const log = options.log ?? (() => {});
  const bytes = await readFile(filePath);
  log(`Read ${(bytes.length / 1024 / 1024).toFixed(1)} MB from ${filePath}`);
  const { records, report } = parseBookCrossing(bytes, options.limit ?? Infinity);
  log(`Parsed ${report.rowsRead} rows → ${report.accepted} valid records.`);

  const result: ImportReport = { ...report, inserted: 0, updated: 0, unchanged: 0 };
  if (options.dryRun || !db) return result;

  await ensureIndexes(db);
  const books = collections(db).books;
  const batchSize = options.batchSize ?? 1000;
  const importedAt = new Date();

  for (let start = 0; start < records.length; start += batchSize) {
    const batch = records.slice(start, start + batchSize);
    const operations: AnyBulkWriteOperation<BookDoc>[] = batch.map(({ _id, ...fields }) => ({
      updateOne: {
        filter: { _id },
        update: { $set: fields, $setOnInsert: { importedAt } },
        upsert: true,
      },
    }));
    const write = await books.bulkWrite(operations, { ordered: false });
    result.inserted += write.upsertedCount;
    result.updated += write.modifiedCount;
    result.unchanged += write.matchedCount - write.modifiedCount;
    if ((start / batchSize) % 20 === 0 || start + batchSize >= records.length) {
      log(`  written ${Math.min(start + batchSize, records.length)} / ${records.length}`);
    }
  }
  return result;
}
