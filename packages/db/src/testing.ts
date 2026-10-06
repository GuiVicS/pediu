// Somente testes: adapta o PGlite (Postgres em WebAssembly) à interface Pool, aplicando `set local role` em cada transação.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Pool, Pools, Q } from './types.js';

const supabaseDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');

const toQ = (run: (text: string, params: unknown[]) => Promise<{ rows: unknown[] }>): Q => async (strings, ...values) => {
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''), '');
  return (await run(text, values.map((v) => (v === undefined ? null : v)))).rows as Record<string, any>[];
};

export async function createTestPools(): Promise<Pools & { db: PGlite }> {
  const db = new PGlite();
  await db.exec('create role anon nologin; create role authenticated nologin;');
  for (const f of readdirSync(join(supabaseDir, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(supabaseDir, 'migrations', f), 'utf8'));
  }
  const as = (role: string): Pool => ({
    begin: (fn) => db.transaction(async (tx) => {
      await tx.exec(`set local role ${role}`);
      return fn(toQ((t, p) => tx.query(t, p as any[])));
    }),
  });
  return { db, app: as('app_api'), platform: as('platform_api'), mcp: as('mcp_agent'), close: () => db.close() };
}
