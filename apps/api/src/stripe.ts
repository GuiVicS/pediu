import { createHmac, timingSafeEqual } from 'node:crypto';

/** Cliente mínimo da API do Stripe (fetch, sem SDK). Injetável: os testes usam um falso. */
export interface StripePrice {
  id: string; active: boolean; currency: string; type: 'recurring' | 'one_time';
  interval: 'month' | 'year' | null; unitAmount: number | null; product: string; livemode: boolean;
}
export interface CheckoutParams {
  customerId?: string; customerEmail?: string; tenantId: string; planCode: string;
  prices: string[];                    // recorrente + (opcional) taxa de implantação
  trialDays?: number; successUrl: string; cancelUrl: string;
}
export interface StripeClient {
  getPrice(id: string): Promise<StripePrice>;
  createCheckoutSession(p: CheckoutParams): Promise<{ id: string; url: string; customer: string | null }>;
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
}

/** Stripe espera application/x-www-form-urlencoded com chaves aninhadas: a[b][0]=c */
export function encodeForm(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) return [];
    if (Array.isArray(v)) return v.flatMap((x, i) => (typeof x === 'object' && x !== null ? encodeForm(x as Record<string, unknown>, `${key}[${i}]`) : [`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`]));
    if (typeof v === 'object') return encodeForm(v as Record<string, unknown>, key);
    return [`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`];
  });
}

export function createStripeClient(secretKey: string, fetchImpl: typeof fetch = fetch): StripeClient {
  const call = async (method: 'GET' | 'POST', path: string, body?: Record<string, unknown>) => {
    const res = await fetchImpl(`https://api.stripe.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: body ? encodeForm(body).join('&') : undefined,
    });
    const json = (await res.json()) as any;
    if (!res.ok) throw new Error(json?.error?.message ?? `Stripe respondeu ${res.status}`);
    return json;
  };
  return {
    async getPrice(id) {
      const p = await call('GET', `/prices/${encodeURIComponent(id)}`);
      return { id: p.id, active: p.active, currency: p.currency, type: p.type, interval: p.recurring?.interval ?? null, unitAmount: p.unit_amount, product: typeof p.product === 'string' ? p.product : p.product?.id, livemode: p.livemode };
    },
    async createCheckoutSession(p) {
      const s = await call('POST', '/checkout/sessions', {
        mode: 'subscription',
        customer: p.customerId, customer_email: p.customerId ? undefined : p.customerEmail,
        line_items: p.prices.map((price) => ({ price, quantity: 1 })),
        locale: 'pt-BR',
        allow_promotion_codes: 'true',
        billing_address_collection: 'required',
        tax_id_collection: { enabled: 'true' },
        customer_update: p.customerId ? { name: 'auto', address: 'auto' } : undefined,
        success_url: p.successUrl, cancel_url: p.cancelUrl,
        client_reference_id: p.tenantId,
        metadata: { tenant_id: p.tenantId, plan_code: p.planCode },
        subscription_data: { metadata: { tenant_id: p.tenantId, plan_code: p.planCode }, trial_period_days: p.trialDays || undefined },
      });
      return { id: s.id, url: s.url, customer: s.customer ?? null };
    },
    async createPortalSession(customerId, returnUrl) {
      const s = await call('POST', '/billing_portal/sessions', { customer: customerId, return_url: returnUrl });
      return { url: s.url };
    },
  };
}

/** Confere o cabeçalho Stripe-Signature (t=...,v1=...): HMAC-SHA256 de "t.payload", com tolerância de 5 minutos. */
export function verifyStripeSignature(payload: string, header: string | undefined, secret: string, nowMs = Date.now(), toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
  const t = Number(parts.t);
  if (!t || Math.abs(nowMs / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const given = header.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  return given.some((sig) => sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
}
