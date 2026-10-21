/**
 * MongoDB connection management for serverless functions and scripts.
 *
 * The client promise is cached on `globalThis`, so warm Vercel invocations (and Vite's hot
 * module reloading in development) reuse one connection pool instead of opening a new one
 * per request.
 */
import { MongoClient, type Db } from 'mongodb';
import { Errors } from '../http/errors.js';

interface MongoCache {
  uri: string;
  promise: Promise<MongoClient>;
}

const globalCache = globalThis as typeof globalThis & { __pageAtelierMongo?: MongoCache };

export function databaseConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

export function databaseName(): string {
  return process.env.MONGODB_DATABASE?.trim() || 'page_atelier';
}

export async function getClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw Errors.databaseNotConfigured();
  const cached = globalCache.__pageAtelierMongo;
  if (cached && cached.uri === uri) return cached.promise;

  const promise = MongoClient.connect(uri, {
    appName: 'page-atelier',
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 6000,
    connectTimeoutMS: 6000,
  });
  globalCache.__pageAtelierMongo = { uri, promise };
  try {
    return await promise;
  } catch (error) {
    // Do not cache a failed connection; the next request retries.
    delete globalCache.__pageAtelierMongo;
    // Log the driver's error class only — messages can contain host names.
    console.error('[mongo] connection failed:', error instanceof Error ? error.name : 'unknown error');
    throw Errors.databaseUnavailable();
  }
}

export async function getDb(): Promise<Db> {
  return (await getClient()).db(databaseName());
}

/** Close the cached client (scripts and tests). */
export async function closeDb(): Promise<void> {
  const cached = globalCache.__pageAtelierMongo;
  delete globalCache.__pageAtelierMongo;
  if (cached) await (await cached.promise.catch(() => null))?.close();
}
