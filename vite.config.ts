import { existsSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const SERVER_ENV = ['MONGODB_URI', 'MONGODB_DATABASE', 'GOOGLE_BOOKS_API_KEY', 'ENRICH_ON_VIEW'] as const;

/**
 * Development only: serve the Vercel functions in /api from the Vite dev server, so
 * `npm run dev` runs the complete application. Each request loads api/<name>.ts through
 * Vite's SSR module loader and calls the exported handler for the HTTP method with a
 * Web-standard Request — the same contract Vercel uses in production.
 */
function devApi(): Plugin {
  return {
    name: 'page-atelier-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        if (!url.pathname.startsWith('/api/')) return next();
        const sendJson = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(body));
        };
        const name = url.pathname.slice('/api/'.length).replace(/\/$/, '');
        const file = path.resolve(server.config.root, 'api', `${name}.ts`);
        if (!/^[a-z-]+$/.test(name) || !existsSync(file)) {
          return sendJson(404, { error: { code: 'NOT_FOUND', message: 'Unknown API route.' } });
        }
        try {
          const mod = (await server.ssrLoadModule(file)) as Record<string, unknown>;
          const handler = mod[req.method ?? 'GET'];
          if (typeof handler !== 'function') {
            return sendJson(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'This endpoint only supports GET requests.' } });
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers.set(key, value);
          }
          const response = (await handler(new Request(url, { method: req.method, headers }))) as Response;
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          if (error instanceof Error) server.ssrFixStacktrace(error);
          next(error);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Make server-side variables from .env available to the dev API (never to the client:
  // only VITE_-prefixed variables are exposed to browser code).
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of SERVER_ENV) if (env[key] && !process.env[key]) process.env[key] = env[key];

  return {
    plugins: [react(), tailwindcss(), devApi()],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    build: { outDir: 'dist', sourcemap: false },
  };
});
