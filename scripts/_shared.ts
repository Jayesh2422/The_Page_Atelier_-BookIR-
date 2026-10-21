/** Helpers shared by the command-line scripts (not deployed as serverless functions). */
import { existsSync } from 'node:fs';
import { closeDb, databaseName, getDb } from '../lib/db/mongo.js';

/** Load .env from the project root when present (Node ≥ 20.12). */
export function loadEnv(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

export async function withDatabase<T>(task: (db: Awaited<ReturnType<typeof getDb>>) => Promise<T>): Promise<T> {
  loadEnv();
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set. Copy .env.example to .env and add your MongoDB Atlas connection string.');
  }
  const db = await getDb();
  console.log(`Connected to database "${databaseName()}".`);
  try {
    return await task(db);
  } finally {
    await closeDb();
  }
}

export function run(main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
