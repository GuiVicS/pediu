import postgres from 'postgres';
import type { Pool, Pools, Q } from './types.js';

export type { Pool, Pools, Q } from './types.js';

export interface PoolUrls { app: string; platform: string; mcp: string }

/**
 * Um pool por role do Postgres (app_api, platform_api, mcp_agent), cada um com a sua string de conexão.
 * `prepare: false` é obrigatório no pooler em modo transação do Supabase (porta 6543).
 */
export function createPools(urls: PoolUrls, max = 10): Pools {
  const mk = (url: string): { pool: Pool; end: () => Promise<void> } => {
    const sql = postgres(url, { max, prepare: false, idle_timeout: 20, connect_timeout: 10 });
    return { pool: { begin: (fn) => sql.begin((tx) => fn(tx as unknown as Q)) as Promise<never> }, end: () => sql.end() };
  };
  const app = mk(urls.app), platform = mk(urls.platform), mcp = mk(urls.mcp);
  return { app: app.pool, platform: platform.pool, mcp: mcp.pool, close: async () => { await Promise.all([app.end(), platform.end(), mcp.end()]); } };
}

/** Define a conta da requisição; a RLS usa isso. SET LOCAL vale só dentro da transação. */
export const withTenant = <T>(pools: Pools, tenantId: string, fn: (q: Q) => Promise<T>) =>
  pools.app.begin(async (q) => { await q`select set_config('app.tenant_id', ${tenantId}, true)`; return fn(q); });
export const withPlatform = <T>(pools: Pools, fn: (q: Q) => Promise<T>) => pools.platform.begin(fn);
export const withMcp = <T>(pools: Pools, fn: (q: Q) => Promise<T>) => pools.mcp.begin(fn);

/** Pool de um único role (ex.: o MCP só recebe a conexão do mcp_agent, nunca a da plataforma). */
export function createRolePool(url: string, max = 5): Pool & { close(): Promise<void> } {
  const sql = postgres(url, { max, prepare: false, idle_timeout: 20, connect_timeout: 10 });
  return { begin: (fn) => sql.begin((tx) => fn(tx as unknown as Q)) as Promise<never>, close: () => sql.end() };
}
