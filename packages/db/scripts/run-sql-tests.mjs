// Roda as migrations e o teste de isolamento (rls_lock.sql) num Postgres 17 em WebAssembly (PGlite). Sem servidor, sem Docker.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = process.env.SQL_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
const db = new PGlite();

// O Supabase já traz os roles anon/authenticated; no PGlite criamos para o teste ser equivalente.
await db.exec(`create role anon nologin; create role authenticated nologin;`);

for (const f of readdirSync(join(root, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(join(root, 'migrations', f), 'utf8'));
  console.log(`migration ok  ${f}`);
}
for (const f of readdirSync(join(root, 'tests')).filter((x) => x.endsWith('.sql')).sort()) {
  const results = await db.exec(readFileSync(join(root, 'tests', f), 'utf8'));
  const last = results.at(-2) ?? results.at(-1);
  console.log(`${f}: ${JSON.stringify(last?.rows ?? results.at(-1)?.rows)}`);
}
