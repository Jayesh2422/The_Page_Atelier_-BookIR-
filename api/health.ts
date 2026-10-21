import { handle, json } from '../lib/http/respond.js';
import { health } from '../lib/services/health.js';

/** GET /api/health — configuration and index status (no secrets are returned). */
export const GET = handle(async () => {
  const result = await health();
  return json(result, { status: result.database === 'connected' ? 200 : 503 });
});
