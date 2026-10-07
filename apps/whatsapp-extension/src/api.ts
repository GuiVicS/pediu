// Cliente da API do PediuLanchou para a extensão. A credencial (pext_...) fica só em chrome.storage.local
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

// ---- chamadas autenticadas do atendimento ----
export interface AgentMessage { id: string; fromMe: boolean; kind: string; text: string; image?: { mimetype: string; data: string } }
export interface AgentReply { skipped?: string; text?: string; handoff?: boolean; handoffReason?: string; draftLink?: string; messageId?: string; autoAllowed?: boolean }
export interface QuickReply { id: string; title: string; text: string }
export interface Conversation { mode: 'off' | 'assisted' | 'auto'; humanPaused: boolean }

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export function client(f: Fetch, link: Link) {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await f(`${link.apiBase}${path}`, { method, headers: { authorization: `Bearer ${link.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new ApiError(r.status, await errorOf(r));
    return (await r.json()) as T;
  };
  return {
    agentReply: (chatId: string, customerName: string, messages: AgentMessage[]) => call<AgentReply>('POST', '/v1/extension/agent/reply', { chatId, customerName, messages }),
    sendCheck: (chatId: string, messageId: string) => call<{ allowed: boolean; reason?: string }>('POST', '/v1/extension/agent/send-check', { chatId, messageId }),
    transcribe: (mimetype: string, data: string) => call<{ text: string }>('POST', '/v1/extension/agent/transcribe', { mimetype, data }),
    getConversation: (chatId: string) => call<Conversation>('GET', `/v1/extension/conversations/${encodeURIComponent(chatId)}`),
    setConversation: (chatId: string, patch: Partial<Conversation>) => call<{ ok: true }>('PUT', `/v1/extension/conversations/${encodeURIComponent(chatId)}`, patch),
    quickReplies: (customerName: string) => call<{ replies: QuickReply[] }>('GET', `/v1/extension/quick-replies?customerName=${encodeURIComponent(customerName)}`),
    nextBroadcast: () => call<{ none: true; waitSeconds: number } | { none: false; recipientId: string; phone: string; text: string }>('POST', '/v1/extension/broadcasts/next', {}),
    broadcastResult: (id: string, status: 'enviada' | 'falhou', error?: string) => call<{ ok: true }>('POST', `/v1/extension/broadcasts/${id}/result`, { status, error }),
  };
}
export type ApiClient = ReturnType<typeof client>;
