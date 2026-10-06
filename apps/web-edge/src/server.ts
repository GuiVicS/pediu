import { buildEdge } from './edge.js';

const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`Defina ${k}.`); process.exit(1); } return v; };
const app = buildEdge({
  apiUrl: need('API_URL').replace(/\/$/, ''), edgeSecret: need('EDGE_SECRET'),
  releasesDir: process.env.RELEASES_DIR, releasesBaseUrl: process.env.RELEASES_BASE_URL,
  builtinDir: process.env.BUILTIN_DIR ?? './builtin', cacheDir: process.env.CACHE_DIR ?? '/tmp/pediu-releases',
}, { logger: true });
const stop = async () => { await app.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
await app.listen({ port: Number(process.env.PORT ?? 3200), host: '0.0.0.0' });
