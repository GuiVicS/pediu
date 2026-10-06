import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import https from 'node:https';
import { URL } from 'node:url';

/** Clientes HTTP dos gateways. Injetáveis: os testes trocam o `fetch` e o transporte mTLS por falsos. */
export class GatewayError extends Error { constructor(msg: string, readonly status: number, readonly detail?: unknown) { super(msg); } }

// =============== Mercado Pago ===============
export interface MpCreds { accessToken: string; webhookSecret?: string }
export type MpStatus = 'approved' | 'pending' | 'in_process' | 'authorized' | 'rejected' | 'cancelled' | 'refunded' | 'charged_back' | 'expired';
export interface MpPayment { id: string; status: MpStatus; amountCents: number; externalReference: string | null; qrCode?: string; expiresAt?: string }

export interface MercadoPagoApi {
  whoami(): Promise<{ id: string; nickname: string }>;
  createPix(p: { amountCents: number; description: string; reference: string; payer: { email: string; name: string; document?: string }; notificationUrl?: string; expiresAt: Date; idempotencyKey: string }): Promise<MpPayment>;
  createPreference(p: { title: string; amountCents: number; reference: string; notificationUrl?: string; backUrl: string; expiresAt: Date }): Promise<{ id: string; url: string }>;
  getPayment(id: string): Promise<MpPayment>;
  refund(id: string): Promise<void>;
}

const mpMap = (p: any): MpPayment => ({
  id: String(p.id), status: p.status, amountCents: Math.round(Number(p.transaction_amount) * 100), externalReference: p.external_reference ?? null,
  qrCode: p.point_of_interaction?.transaction_data?.qr_code, expiresAt: p.date_of_expiration ?? undefined,
});

export function mercadoPago(c: MpCreds, f: typeof fetch = fetch): MercadoPagoApi {
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const res = await f(`https://api.mercadopago.com${path}`, { method, headers: { authorization: `Bearer ${c.accessToken}`, 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const text = await res.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new GatewayError(`Mercado Pago respondeu ${res.status}`, res.status, data);
    return data;
  };
  return {
    async whoami() { const u = await call('GET', '/users/me'); return { id: String(u.id), nickname: u.nickname ?? u.email ?? '' }; },
    async createPix(p) {
      const [first, ...rest] = p.payer.name.trim().split(/\s+/);
      const r = await call('POST', '/v1/payments', {
        transaction_amount: p.amountCents / 100, description: p.description.slice(0, 200), payment_method_id: 'pix', external_reference: p.reference,
        date_of_expiration: p.expiresAt.toISOString().replace('Z', '-00:00'), notification_url: p.notificationUrl,
        payer: { email: p.payer.email, first_name: first, last_name: rest.join(' ') || undefined, ...(p.payer.document ? { identification: { type: p.payer.document.length > 11 ? 'CNPJ' : 'CPF', number: p.payer.document } } : {}) },
      }, { 'x-idempotency-key': p.idempotencyKey });
      return mpMap(r);
    },
    async createPreference(p) {
      const r = await call('POST', '/checkout/preferences', {
        items: [{ title: p.title.slice(0, 120), quantity: 1, unit_price: p.amountCents / 100, currency_id: 'BRL' }], external_reference: p.reference, notification_url: p.notificationUrl,
        back_urls: { success: p.backUrl, pending: p.backUrl, failure: p.backUrl }, auto_return: 'approved', expires: true, expiration_date_to: p.expiresAt.toISOString(),
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }], installments: 12 },
      });
      return { id: r.id, url: r.init_point };
    },
    async getPayment(id) { return mpMap(await call('GET', `/v1/payments/${encodeURIComponent(id)}`)); },
    async refund(id) { await call('POST', `/v1/payments/${encodeURIComponent(id)}/refunds`, {}, { 'x-idempotency-key': `refund-${id}` }); },
  };
}

/** Confere o cabeçalho x-signature do Mercado Pago (ts=…,v1=…): HMAC-SHA256 de "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". */
export function verifyMpSignature(secret: string, header: string | undefined, requestId: string | undefined, dataId: string, nowMs = Date.now(), toleranceMs = 10 * 60_000): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()]; }));
  const ts = Number(parts.ts); if (!ts || !parts.v1) return false;
  if (Math.abs(nowMs - (ts > 1e12 ? ts : ts * 1000)) > toleranceMs) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId ?? ''};ts:${parts.ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  return parts.v1.length === expected.length && timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
}

// =============== Sicoob Pix (mTLS + OAuth) ===============
export interface SicoobCreds { clientId: string; clientSecret?: string; pixKey: string; pfxB64: string; pfxPass?: string; sandbox?: boolean }
export interface SicoobCob { txid: string; status: 'ATIVA' | 'CONCLUIDA' | 'REMOVIDA_PELO_USUARIO_RECEBEDOR' | 'REMOVIDA_PELO_PSP'; amountCents: number; copyPaste?: string }

export interface SicoobApi {
  checkAuth(): Promise<void>;
  createCob(p: { txid: string; amountCents: number; expiresInSec: number; description: string; payerName?: string; payerDocument?: string }): Promise<SicoobCob>;
  getCob(txid: string): Promise<SicoobCob>;
  registerWebhook(url: string): Promise<void>;
}

export type MtlsRequest = (method: string, url: string, o: { headers?: Record<string, string>; body?: string }) => Promise<{ status: number; data: any }>;

const agents = new Map<string, https.Agent>();
export function mtlsRequest(c: SicoobCreds): MtlsRequest {
  const key = `${c.clientId}:${c.pfxB64.length}`;
  let agent = agents.get(key);
  if (!agent) { agent = new https.Agent({ pfx: Buffer.from(c.pfxB64, 'base64'), passphrase: c.pfxPass, keepAlive: true }); agents.set(key, agent); }
  return (method, urlStr, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const h: Record<string, string> = { ...headers }; if (body) h['content-length'] = String(Buffer.byteLength(body));
    const req = https.request({ method, hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, headers: h, agent, timeout: 12_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (x) => chunks.push(x)); res.on('end', () => { const t = Buffer.concat(chunks).toString('utf8'); let d: any = t; try { d = t ? JSON.parse(t) : null; } catch { /* texto */ } resolve({ status: res.statusCode ?? 0, data: d }); });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout ao chamar o Sicoob'))); req.on('error', reject);
    if (body) req.write(body); req.end();
  });
}

const SICOOB = { token: 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token', pix: 'https://api.sicoob.com.br/pix/api/v2', scopes: 'cob.write cob.read pix.read webhook.read webhook.write' };
const sicoobMap = (txid: string, d: any): SicoobCob => ({ txid, status: d.status, amountCents: Math.round(Number(d.valor?.original ?? 0) * 100), copyPaste: d.pixCopiaECola ?? d.brcode });

export function sicoob(c: SicoobCreds, req: MtlsRequest = mtlsRequest(c), now = () => Date.now()): SicoobApi {
  let token: { v: string; exp: number } | null = null;
  const getToken = async () => {
    if (token && token.exp > now() + 30_000) return token.v;
    const p = new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, scope: SICOOB.scopes }); if (c.clientSecret) p.set('client_secret', c.clientSecret);
    const r = await req('POST', SICOOB.token, { headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: p.toString() });
    if (r.status !== 200 || !r.data?.access_token) throw new GatewayError('Falha ao obter token do Sicoob (confira client id, certificado e senha).', r.status, r.data);
    token = { v: r.data.access_token, exp: now() + (r.data.expires_in ?? 300) * 1000 }; return token.v;
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await req(method, `${SICOOB.pix}${path}`, { headers: { authorization: `Bearer ${await getToken()}`, client_id: c.clientId, accept: 'application/json', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status >= 400) throw new GatewayError(`Sicoob respondeu ${r.status}`, r.status, r.data);
    return r.data;
  };
  return {
    async checkAuth() { await getToken(); },
    async createCob(p) {
      const d = await call('PUT', `/cob/${p.txid}`, {
        calendario: { expiracao: p.expiresInSec }, valor: { original: (p.amountCents / 100).toFixed(2) }, chave: c.pixKey, solicitacaoPagador: p.description.slice(0, 140),
        ...(p.payerName && p.payerDocument ? { devedor: { [p.payerDocument.length > 11 ? 'cnpj' : 'cpf']: p.payerDocument, nome: p.payerName } } : {}),
      });
      if (!(d?.pixCopiaECola || d?.brcode)) throw new GatewayError('Resposta do Sicoob sem pixCopiaECola.', 502, d);
      return sicoobMap(p.txid, { ...d, valor: d.valor ?? { original: (p.amountCents / 100).toFixed(2) } });
    },
    async getCob(txid) { return sicoobMap(txid, await call('GET', `/cob/${txid}`)); },
    async registerWebhook(url) { await call('PUT', `/webhook/${encodeURIComponent(c.pixKey)}`, { webhookUrl: url }); },
  };
}

/** txid do Pix: 26 a 35 caracteres alfanuméricos (padrão Bacen). */
export const newTxid = () => ('PED' + Date.now().toString(36) + randomBytes(12).toString('hex')).toUpperCase().slice(0, 32);
export const TXID_RE = /^[a-zA-Z0-9]{26,35}$/;
