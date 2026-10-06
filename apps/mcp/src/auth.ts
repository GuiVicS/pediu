import { hashToken } from '@pediu/shared';

import type { Db, Token } from './core.js';

/**
 * Valida o token pelo hash chamando a função app.mcp_authenticate (security definer): o role do MCP não lê a tabela de tokens.
 * A função também recusa tokens revogados ou vencidos e registra último uso e IP.
 */
export async function authenticate(pools: Db, bearer: string | undefined, ip: string): Promise<Token | null> {
  const token = bearer?.match(/^Bearer (pmcp_[A-Za-z0-9_-]{20,})$/)?.[1];
  if (!token) return null;
  const [r] = await pools.mcp.begin((q) => q`select id, store_limit from app.mcp_authenticate(${hashToken(token)}, ${ip})`);
  return r ? { id: r.id, storeLimit: r.store_limit ?? null } : null;
}

/** Limite simples por token (janela fixa de 1 min) para um agente em laço não derrubar a plataforma. */
export function rateLimiter(max = 120, windowMs = 60_000, now = () => Date.now()) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (key: string) => {
    const t = now(); const h = hits.get(key);
    if (!h || h.reset <= t) { hits.set(key, { n: 1, reset: t + windowMs }); return true; }
    return ++h.n <= max;
  };
}
