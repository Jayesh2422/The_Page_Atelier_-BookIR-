/** Health check: configuration, connectivity and index status. Never returns secrets. */
import { databaseConfigured, getDb } from '../db/mongo.js';
import { loadIndexMeta } from '../db/mongo-store.js';
import { AppError } from '../http/errors.js';
import type { HealthResponse } from '../types.js';

export async function health(): Promise<HealthResponse> {
  const googleBooksKey = Boolean(process.env.GOOGLE_BOOKS_API_KEY);
  if (!databaseConfigured()) {
    return { status: 'degraded', database: 'not_configured', index: 'unknown', googleBooksKey, stats: null };
  }
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    const meta = await loadIndexMeta(db, { fresh: true });
    return {
      status: meta ? 'ok' : 'degraded',
      database: 'connected',
      index: meta ? 'ready' : 'missing',
      googleBooksKey,
      stats: meta
        ? { books: meta.totalDocuments, vocabulary: meta.vocabularySize, postings: meta.postings, enriched: meta.enrichedBooks, builtAt: meta.builtAt.toISOString() }
        : null,
    };
  } catch (error) {
    if (error instanceof AppError || (error instanceof Error && error.name.startsWith('Mongo'))) {
      return { status: 'degraded', database: 'unavailable', index: 'unknown', googleBooksKey, stats: null };
    }
    throw error;
  }
}
