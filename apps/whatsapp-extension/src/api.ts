// Cliente da API do Pediu para a extensão. A credencial (pext_...) fica só em chrome.storage.local
// (nível TRUSTED_CONTEXTS: nem os content scripts leem) e nunca passa pelo contexto MAIN do WhatsApp Web.

export interface Link { apiBase: string; token: string; storeName: string }
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Aceita só http(s) e devolve a origem; evita enviar a credencial para um endereço malformado. */
export function normalizeBase(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) return null;
    return u.origin;
  } catch { return null; }
}

async function errorOf(r: Response): Promise<string> {
  try { return ((await r.json()) as { error?: { message?: string } }).error?.message ?? `Erro ${r.status}`; } catch { return `Erro ${r.status}`; }
}

export async function pair(f: Fetch, apiBase: string, code: string, name: string): Promise<Link> {
  const r = await f(`${apiBase}/v1/extension/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.trim(), name }) });
  if (!r.ok) throw new Error(await errorOf(r));
  const b = (await r.json()) as { token: string; storeName: string };
  return { apiBase, token: b.token, storeName: b.storeName };
}

/** 'ok' conectado; 'revoked' credencial recusada (apague-a); 'offline' sem rede/servidor (mantenha). */
export async function checkLink(f: Fetch, link: Link): Promise<{ state: 'ok'; features: string[] } | { state: 'revoked' } | { state: 'offline' }> {
  try {
    const r = await f(`${link.apiBase}/v1/extension/me`, { headers: { authorization: `Bearer ${link.token}` } });
    if (r.status === 401) return { state: 'revoked' };
    if (!r.ok) return { state: 'offline' };
    return { state: 'ok', features: ((await r.json()) as { features: string[] }).features };
  } catch { return { state: 'offline' }; }
}
