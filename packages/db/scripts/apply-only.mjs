// Aplica só as migrations num Postgres em memória (checagem de compilação do SQL, sem rodar os testes de isolamento).
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
const db = new PGlite();
await db.exec('create role anon nologin; create role authenticated nologin;');
for (const f of readdirSync(join(root, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  try { await db.exec(readFileSync(join(root, 'migrations', f), 'utf8')); console.log('ok   ', f); }
  catch (e) { console.error('ERRO ', f, '→', e.message); process.exit(1); }
}
