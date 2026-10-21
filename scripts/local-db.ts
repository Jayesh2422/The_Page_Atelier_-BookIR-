/**
 * Start a local MongoDB server for development without an Atlas cluster.
 * Data persists in data/local-db (gitignored). Keep this process running and set
 *   MONGODB_URI="mongodb://127.0.0.1:27027/"
 * in .env.
 *
 *   npm run db:local
 */
import { mkdirSync } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server';

const port = Number(process.env.LOCAL_MONGO_PORT ?? 27027);
const dbPath = 'data/local-db';
mkdirSync(dbPath, { recursive: true });

const server = await MongoMemoryServer.create({ instance: { port, dbPath, storageEngine: 'wiredTiger' } });
console.log(`Local MongoDB running at ${server.getUri()}  (data: ${dbPath})`);
console.log('Press Ctrl+C to stop.');

const stop = async () => {
  await server.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
