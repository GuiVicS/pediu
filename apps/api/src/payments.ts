import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withPlatform, withTenant, type Q } from '@pediu/db';
import { can, decryptSecret, encryptSecret } from '@pediu/shared';
import type { Ctx } from './context.js';
import { openCashSessionId } from './pdv.js';
import { GatewayError, TXID_RE, mercadoPago, newTxid, sicoob, verifyMpSignature, type MercadoPagoApi, type MpCreds, type MpPayment, type SicoobApi, type SicoobCreds } from './gateways.js';
import { audit, fail, parse } from './http.js';
import { afterOrder } from './orderHooks.js';
import { staffGuard } from './staff.js';

export type Provider = 'mercadopago' | 'sicoob';
export const PIX_EXPIRE_SEC = 15 * 60;
export const CARD_EXPIRE_MIN = 60;

const mpApi = (ctx: Ctx, c: MpCreds): MercadoPagoApi => (ctx.gateways ?? { mercadoPago: mercadoPago }).mercadoPago(c);
const sicoobApi = (ctx: Ctx, c: SicoobCreds): SicoobApi => (ctx.gateways ?? { sicoob: (x: SicoobCreds) => sicoob(x) }).sicoob(c);

async function loadCreds<T>(ctx: Ctx, q: Q, storeId: string, provider: Provider): Promise<T | null> {
  const [g] = await q`select credentials_enc from store_gateways where store_id = ${storeId} and provider = ${provider} and status = 'ativo'`;
  return g ? (JSON.parse(decryptSecret(g.credentials_enc, ctx.ring)) as T) : null;
}
export const gatewayConfigured = async (ctx: Ctx, storeId: string, provider: Provider) =>
  withPlatform(ctx.pools, async (q) => !!(await q`select 1 as x from store_gateways where store_id = ${storeId} and provider = ${provider} and status = 'ativo'`)[0]);

export interface StartPayment {
  tenantId: string; storeId: string; orderId: string; orderNumber: number; amountCents: number; slug: string;
  method: 'pix' | 'card'; gateway: Provider; customer: { name: string; email?: string; document?: string };
}
export interface StartedPayment { id: string; method: 'pix' | 'card'; qrCode?: string; checkoutUrl?: string; expiresAt: string }

/** Cria a cobrança no gateway e grava `order_payments`. O pedido continua 'aguardando' até o webhook (ou a conciliação) confirmar. */
export async function startOnlinePayment(ctx: Ctx, p: StartPayment): Promise<StartedPayment> {
  if (p.method === 'card' && p.gateway !== 'mercadopago') throw new GatewayError('Cartão online é pelo Mercado Pago.', 422);
  const now = ctx.clock.now();
  const expiresAt = new Date(now.getTime() + (p.method === 'pix' ? PIX_EXPIRE_SEC * 1000 : CARD_EXPIRE_MIN * 60_000));
  const notify = (path: string) => (ctx.publicUrl ? `${ctx.publicUrl}${path}` : undefined);
  return withPlatform(ctx.pools, async (q) => {
    const [row] = await q`insert into order_payments (order_id, store_id, tenant_id, provider, method, status, amount_cents, expires_at)
                          values (${p.orderId}, ${p.storeId}, ${p.tenantId}, ${p.gateway}, ${p.method}, 'pendente', ${p.amountCents}, ${expiresAt.toISOString()}) returning id`;
    const id = row!.id as string;
    if (p.gateway === 'mercadopago') {
      const creds = await loadCreds<MpCreds>(ctx, q, p.storeId, 'mercadopago');
      if (!creds) throw new GatewayError('Mercado Pago não configurado nesta loja.', 409);
      const mp = mpApi(ctx, creds);
      const url = notify(`/v1/webhooks/mercadopago?store=${p.storeId}`);
      if (p.method === 'pix') {
        const r = await mp.createPix({ amountCents: p.amountCents, description: `Pedido #${p.orderNumber}`, reference: id, payer: { email: p.customer.email || `pedido${p.orderNumber}@pedidos.pediu.app`, name: p.customer.name, document: p.customer.document }, notificationUrl: url, expiresAt, idempotencyKey: id });
        if (!r.qrCode) throw new GatewayError('Mercado Pago não devolveu o código Pix.', 502, r);
        await q`update order_payments set external_id = ${r.id}, qr_code = ${r.qrCode} where id = ${id}`;
        return { id, method: 'pix' as const, qrCode: r.qrCode, expiresAt: expiresAt.toISOString() };
      }
      const pref = await mp.createPreference({ title: `Pedido #${p.orderNumber}`, amountCents: p.amountCents, reference: id, notificationUrl: url, backUrl: `${ctx.publicUrl ?? ''}/acompanhar`, expiresAt });
      await q`update order_payments set checkout_url = ${pref.url} where id = ${id}`;
      return { id, method: 'card' as const, checkoutUrl: pref.url, expiresAt: expiresAt.toISOString() };
    }
    const creds = await loadCreds<SicoobCreds>(ctx, q, p.storeId, 'sicoob');
    if (!creds) throw new GatewayError('Sicoob não configurado nesta loja.', 409);
    const txid = newTxid();
    const cob = await sicoobApi(ctx, creds).createCob({ txid, amountCents: p.amountCents, expiresInSec: PIX_EXPIRE_SEC, description: `Pedido ${p.orderNumber}`, payerName: p.customer.document ? p.customer.name : undefined, payerDocument: p.customer.document });
    await q`update order_payments set txid = ${txid}, external_id = ${txid}, qr_code = ${cob.copyPaste ?? null} where id = ${id}`;
    return { id, method: 'pix' as const, qrCode: cob.copyPaste, expiresAt: expiresAt.toISOString() };
  });
}

export interface Confirmed { orderId: string; number: number; orderType: string; storeId: string; tenantId: string; wasWaiting: boolean; late: boolean }

/** Dá baixa no pagamento: idempotente (confirmar duas vezes não faz nada) e só aceita se o valor bater com o cobrado. */
export async function confirmPayment(ctx: Ctx, paymentId: string, paidAmountCents: number, externalId?: string): Promise<Confirmed | 'already' | 'amount_mismatch' | 'not_found'> {
  const out = await withPlatform(ctx.pools, async (q) => {
    const [p] = await q`select p.*, o.status as order_status, o.number, o.type from order_payments p join orders o on o.id = p.order_id and o.store_id = p.store_id where p.id = ${paymentId} for update of p`;
    if (!p) return 'not_found' as const;
    if (p.status === 'aprovado') return 'already' as const;
    if (paidAmountCents !== p.amount_cents) return 'amount_mismatch' as const;
    const label = p.method === 'pix' ? 'Pix online' : 'Cartão online';
    const late = p.order_status === 'cancelado';
    await q`update order_payments set status = 'aprovado', paid_at = now(), external_id = coalesce(external_id, ${externalId ?? null}) where id = ${paymentId}`;
    if (!late) {
      await q`update orders set paid_type = ${p.method === 'pix' ? 'pix' : 'credit'}, payment_mode = 'tela' where id = ${p.order_id}`;
      await q`update orders set paid = true, paid_at = now(), paid_method = ${label}, payment_method = ${label},
              status = case when status = 'aguardando' then 'novo' when type = 'mesa' then 'entregue' else status end,
              delivered_at = case when type = 'mesa' and status <> 'aguardando' then now() else delivered_at end where id = ${p.order_id}`;
    }
    await q`insert into order_events (order_id, store_id, tenant_id, actor_kind, event, data) values (${p.order_id}, ${p.store_id}, ${p.tenant_id}, 'system', 'paid', ${JSON.stringify({ provider: p.provider, method: p.method, amountCents: p.amount_cents, late })}::jsonb)`;
    return { orderId: p.order_id as string, number: p.number as number, orderType: p.type as string, storeId: p.store_id as string, tenantId: p.tenant_id as string, wasWaiting: p.order_status === 'aguardando', late };
  });
  if (typeof out === 'string') {
    if (out === 'amount_mismatch') ctx.telemetry?.log({ level: 'error', service: 'payments', event: 'payment.amount_mismatch', message: `Valor pago diferente do cobrado (pagamento ${paymentId}, pago ${paidAmountCents})`, data: { paymentId } });
    return out;
  }
  if (out.late) {
    ctx.telemetry?.log({ level: 'error', service: 'payments', event: 'payment.late_after_cancel', message: `Pagamento aprovado depois de o pedido #${out.number} ser cancelado: ESTORNAR`, storeId: out.storeId, tenantId: out.tenantId, data: { paymentId, orderId: out.orderId } });
    return out;
  }
  await afterOrder(ctx, out, out.wasWaiting
    ? { kind: 'created', id: out.orderId, number: out.number, orderType: out.orderType, status: 'novo', print: ['novo'] }
    : { kind: 'paid', id: out.orderId, number: out.number, orderType: out.orderType, status: out.orderType === 'mesa' ? 'entregue' : 'novo' });
  return out;
}

async function closePayment(ctx: Ctx, paymentId: string, status: 'recusado' | 'cancelado' | 'expirado' | 'estornado') {
  const r = await withPlatform(ctx.pools, async (q) => {
    const [p] = await q`update order_payments set status = ${status} where id = ${paymentId} and status = 'pendente' returning order_id, store_id, tenant_id`;
    if (!p) return null;
    // pedido ainda aguardando e sem outra cobrança pendente: cancela (o cliente pode refazer)
    const [still] = await q`select 1 as x from order_payments where order_id = ${p.order_id} and status in ('pendente', 'aprovado')`;
    if (still) return null;
    const [o] = await q`update orders set status = 'cancelado', cancelled_at = now(), cancel_reason = ${`pagamento ${status}`} where id = ${p.order_id} and status = 'aguardando' returning number, type`;
    if (o) await q`insert into order_events (order_id, store_id, tenant_id, actor_kind, event, data) values (${p.order_id}, ${p.store_id}, ${p.tenant_id}, 'system', 'status:cancelado', ${JSON.stringify({ reason: `pagamento ${status}` })}::jsonb)`;
    return o ? { orderId: p.order_id as string, storeId: p.store_id as string, tenantId: p.tenant_id as string, number: o.number as number, type: o.type as string } : null;
  });
  if (r) await afterOrder(ctx, r, { kind: 'status', id: r.orderId, number: r.number, orderType: r.type, status: 'cancelado' });
}

/** Rede de segurança do webhook: consulta os pagamentos pendentes no gateway e expira os vencidos. Roda a cada 30 s. */
export async function reconcilePayments(ctx: Ctx, nowMs = ctx.clock.now().getTime()): Promise<{ checked: number; confirmed: number; expired: number }> {
  const pending = await withPlatform(ctx.pools, (q) => q`select id, store_id, provider, method, external_id, txid, amount_cents, expires_at from order_payments where status = 'pendente' order by created_at limit 200`);
  const res = { checked: 0, confirmed: 0, expired: 0 };
  for (const p of pending) {
    try {
      res.checked++;
      const expired = p.expires_at && new Date(p.expires_at).getTime() + 60_000 < nowMs;
      if (p.provider === 'sicoob' && p.txid) {
        const creds = await withPlatform(ctx.pools, (q) => loadCreds<SicoobCreds>(ctx, q, p.store_id, 'sicoob'));
        if (creds) {
          const cob = await sicoobApi(ctx, creds).getCob(p.txid);
          if (cob.status === 'CONCLUIDA') { const r = await confirmPayment(ctx, p.id, cob.amountCents); if (typeof r === 'object') res.confirmed++; continue; }
          if (cob.status !== 'ATIVA') { await closePayment(ctx, p.id, 'cancelado'); continue; }
        }
      } else if (p.provider === 'mercadopago' && p.external_id) {
        const creds = await withPlatform(ctx.pools, (q) => loadCreds<MpCreds>(ctx, q, p.store_id, 'mercadopago'));
        if (creds) {
          const mp = await mpApi(ctx, creds).getPayment(p.external_id);
          if (mp.status === 'approved') { const r = await confirmPayment(ctx, p.id, mp.amountCents, mp.id); if (typeof r === 'object') res.confirmed++; continue; }
          if (mp.status === 'rejected' || mp.status === 'cancelled') { await closePayment(ctx, p.id, mp.status === 'rejected' ? 'recusado' : 'cancelado'); continue; }
        }
      }
      if (expired) { await closePayment(ctx, p.id, 'expirado'); res.expired++; }
    } catch (e) { ctx.telemetry?.log({ level: 'warn', service: 'payments', event: 'payment.reconcile_failed', message: String((e as Error).message).slice(0, 200), storeId: p.store_id, data: { paymentId: p.id } }); }
  }
  return res;
}

export function paymentRoutes(app: FastifyInstance, ctx: Ctx) {
  const G = '/v1/staff/gateways';
  const adm = staffGuard(ctx, 'admin.loja');

  app.get(G, { preHandler: adm }, async (req) => {
    const s = req.staff!;
    return { gateways: await withTenant(ctx.pools, s.tenantId, (q) => q`select provider, status, meta, updated_at from store_gateways where store_id = ${s.storeId}`) };   // credenciais nunca saem
  });

  const save = async (s: { tenantId: string; storeId: string; staffId: string }, provider: Provider, creds: unknown, meta: object, ip: string) =>
    withTenant(ctx.pools, s.tenantId, async (q) => {
      await q`insert into store_gateways (store_id, tenant_id, provider, credentials_enc, status, meta) values (${s.storeId}, ${s.tenantId}, ${provider}, ${encryptSecret(JSON.stringify(creds), ctx.ring)}, 'ativo', ${JSON.stringify(meta)}::jsonb)
              on conflict (store_id, provider) do update set credentials_enc = excluded.credentials_enc, status = 'ativo', meta = excluded.meta, updated_at = now()`;
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: `gateway.${provider}.saved`, ip });
    });

  app.put(`${G}/mercadopago`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!;
    const b = parse(z.object({ accessToken: z.string().regex(/^(APP_USR|TEST)-[A-Za-z0-9-]{20,}$/, 'Access token do Mercado Pago inválido'), webhookSecret: z.string().min(8).max(200).optional() }), req.body, reply); if (!b) return;
    try {
      const me = await mpApi(ctx, { accessToken: b.accessToken }).whoami();                  // confere o token antes de gravar
      await save(s, 'mercadopago', b, { account: me.nickname, accountId: me.id, test: b.accessToken.startsWith('TEST-') }, req.ip);
      return { ok: true, account: me.nickname };
    } catch (e) { return e instanceof GatewayError ? fail(reply, 422, 'invalid_credentials', e.status === 401 ? 'O Mercado Pago recusou este token.' : 'Não foi possível validar o token agora.') : (() => { throw e; })(); }
  });

  app.put(`${G}/sicoob`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!;
    const b = parse(z.object({ clientId: z.string().min(8).max(100), clientSecret: z.string().max(200).optional(), pixKey: z.string().min(5).max(80), pfxB64: z.string().min(100).max(60_000), pfxPass: z.string().max(200).optional() }), req.body, reply); if (!b) return;
    try {
      await sicoobApi(ctx, b).checkAuth();                                                 // conferir certificado + client id antes de gravar
      await save(s, 'sicoob', b, { pixKey: b.pixKey.replace(/.(?=.{4})/g, '•') }, req.ip);
      return { ok: true };
    } catch (e) { return e instanceof GatewayError ? fail(reply, 422, 'invalid_credentials', e.message) : fail(reply, 422, 'invalid_credentials', 'Certificado ou senha inválidos.'); }
  });

  app.post(`${G}/sicoob/webhook`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!;
    if (!ctx.publicUrl) return fail(reply, 409, 'no_public_url', 'Defina PUBLIC_API_URL no servidor para registrar o webhook.');
    const creds = await withPlatform(ctx.pools, (q) => loadCreds<SicoobCreds>(ctx, q, s.storeId, 'sicoob'));
    if (!creds) return fail(reply, 409, 'not_configured', 'Configure o Sicoob primeiro.');
    try { await sicoobApi(ctx, creds).registerWebhook(`${ctx.publicUrl}/v1/webhooks/sicoob/${s.storeId}`); return { ok: true }; }
    catch (e) { return fail(reply, 502, 'gateway_error', e instanceof GatewayError ? e.message : 'Falha ao registrar o webhook.'); }
  });

  app.delete(`${G}/:provider`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!; const provider = parse(z.enum(['mercadopago', 'sicoob']), (req.params as { provider: string }).provider, reply); if (!provider) return;
    const n = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const r = await q`delete from store_gateways where store_id = ${s.storeId} and provider = ${provider} returning id`;
      if (r.length) { await q`update payment_methods set online = false, gateway = null where store_id = ${s.storeId} and gateway = ${provider}`; await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: `gateway.${provider}.removed`, ip: req.ip }); }
      return r.length;
    });
    return n ? { ok: true } : fail(reply, 404, 'not_found', 'Gateway não configurado.');
  });

  // ---- PDV: cobrar um pedido existente por Pix (QR na tela) ----
  app.post('/v1/staff/orders/:id/charge', { preHandler: staffGuard(ctx, 'pdv') }, async (req, reply) => {
    const s = req.staff!; const id = parse(z.string().uuid(), (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ gateway: z.enum(['mercadopago', 'sicoob']) }), req.body, reply); if (!b) return;
    const o = await withTenant(ctx.pools, s.tenantId, async (q) => (await q`select id, number, status, paid, total_cents, customer_name from orders where id = ${id} and store_id = ${s.storeId}`)[0]);
    if (!o) return fail(reply, 404, 'not_found', 'Pedido não encontrado.');
    if (o.paid) return fail(reply, 409, 'already_paid', 'Pedido já recebido.');
    if (o.status === 'cancelado') return fail(reply, 422, 'cancelled', 'Pedido cancelado.');
    try {
      const slug = (await withTenant(ctx.pools, s.tenantId, (q) => q`select slug from stores where id = ${s.storeId}`))[0]!.slug as string;
      await withTenant(ctx.pools, s.tenantId, async (q) => { const sid = await openCashSessionId(q, s.storeId, s.staffId); if (sid) await q`update orders set cash_session_id = coalesce(cash_session_id, ${sid}), paid_by = ${s.staffId} where id = ${id} and not paid`; });   // a cobrança entra no turno de quem a iniciou
      const started = await startOnlinePayment(ctx, { tenantId: s.tenantId, storeId: s.storeId, orderId: id, orderNumber: o.number, amountCents: o.total_cents, slug, method: 'pix', gateway: b.gateway, customer: { name: o.customer_name || 'Cliente' } });
      return reply.status(201).send(started);
    } catch (e) { return e instanceof GatewayError ? fail(reply, e.status === 409 ? 409 : 502, 'gateway_error', e.message) : (() => { throw e; })(); }
  });

  app.get('/v1/staff/orders/:id/payments', { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const s = req.staff!; const id = parse(z.string().uuid(), (req.params as { id: string }).id, reply); if (!id) return;
    if (!(can(s.role, 'pdv') || can(s.role, 'admin.pedidos'))) return fail(reply, 403, 'forbidden', 'Seu perfil não vê pagamentos.');
    return { payments: await withTenant(ctx.pools, s.tenantId, (q) => q`select id, provider, method, status, amount_cents, qr_code, checkout_url, expires_at, paid_at from order_payments where order_id = ${id} and store_id = ${s.storeId} order by created_at desc`) };
  });

  // ---- estorno (só Mercado Pago, total) ----
  app.post('/v1/staff/orders/:id/refund', { preHandler: staffGuard(ctx, 'pagamentos.estornar') }, async (req, reply) => {
    const s = req.staff!; const id = parse(z.string().uuid(), (req.params as { id: string }).id, reply); if (!id) return;
    const p = await withPlatform(ctx.pools, async (q) => (await q`select id, provider, external_id from order_payments where order_id = ${id} and store_id = ${s.storeId} and status = 'aprovado' order by paid_at desc limit 1`)[0]);
    if (!p) return fail(reply, 404, 'not_found', 'Não há pagamento online aprovado neste pedido.');
    if (p.provider !== 'mercadopago') return fail(reply, 422, 'not_supported', 'O estorno de Pix do Sicoob é feito pelo app do banco.');
    try {
      const creds = await withPlatform(ctx.pools, (q) => loadCreds<MpCreds>(ctx, q, s.storeId, 'mercadopago'));
      if (!creds) return fail(reply, 409, 'not_configured', 'Mercado Pago não configurado.');
      await mpApi(ctx, creds).refund(p.external_id);
      await withPlatform(ctx.pools, async (q) => { await q`update order_payments set status = 'estornado' where id = ${p.id}`; await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'payment.refunded', ip: req.ip, meta: { orderId: id, paymentId: p.id } }); });
      return { ok: true };
    } catch (e) { return e instanceof GatewayError ? fail(reply, 502, 'gateway_error', 'O Mercado Pago não aceitou o estorno agora.') : (() => { throw e; })(); }
  });

  // ---- pagamento pendente do cliente (para reabrir o QR) ----
  app.get('/v1/track/:token/payment', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = parse(z.string().regex(/^[0-9a-f]{64}$/), (req.params as { token: string }).token, reply); if (!token) return;
    const [r] = await ctx.pools.app.begin((q) => q`select * from app.payment_by_token(${token})`);
    return r ?? fail(reply, 404, 'not_found', 'Pagamento não encontrado.');
  });

  // ---- webhooks: nunca confiam no corpo; sempre reconsultam o provedor com a credencial da loja ----
  app.post('/v1/webhooks/mercadopago', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const storeId = parse(z.string().uuid(), (req.query as { store?: string }).store, reply); if (!storeId) return;
    const body = (req.body ?? {}) as { type?: string; topic?: string; data?: { id?: string | number }; id?: string | number };
    const dataId = String(body.data?.id ?? (req.query as { 'data.id'?: string })['data.id'] ?? body.id ?? '');
    if (!dataId || !/^\d{3,20}$/.test(dataId) || (body.type ?? body.topic) !== 'payment') return { ok: true };         // outros tipos de evento: ignorar
    try {
      const creds = await withPlatform(ctx.pools, (q) => loadCreds<MpCreds>(ctx, q, storeId, 'mercadopago'));
      if (!creds) return { ok: true };
      if (creds.webhookSecret && !verifyMpSignature(creds.webhookSecret, req.headers['x-signature'] as string | undefined, req.headers['x-request-id'] as string | undefined, dataId, ctx.clock.now().getTime())) return fail(reply, 401, 'bad_signature', 'Assinatura inválida.');
      const pay: MpPayment = await mpApi(ctx, creds).getPayment(dataId);
      const row = pay.externalReference && z.string().uuid().safeParse(pay.externalReference).success
        ? (await withPlatform(ctx.pools, (q) => q`select id from order_payments where id = ${pay.externalReference} and store_id = ${storeId} and provider = 'mercadopago'`))[0] : undefined;
      if (!row) return { ok: true };                                                         // pagamento que não é de um pedido desta loja
      if (pay.status === 'approved') await confirmPayment(ctx, row.id, pay.amountCents, pay.id);
      else if (pay.status === 'rejected') await closePayment(ctx, row.id, 'recusado');
      else if (pay.status === 'cancelled') await closePayment(ctx, row.id, 'cancelado');
      else if (pay.status === 'refunded' || pay.status === 'charged_back') await withPlatform(ctx.pools, (q) => q`update order_payments set status = 'estornado' where id = ${row.id}`);
      return { ok: true };
    } catch (e) {
      ctx.telemetry?.log({ level: 'error', service: 'payments', event: 'webhook.mercadopago_failed', message: String((e as Error).message).slice(0, 300), storeId });
      return fail(reply, 500, 'retry', 'Tente novamente.');                                 // o MP reenvia
    }
  });

  app.post('/v1/webhooks/sicoob/:storeId', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const storeId = parse(z.string().uuid(), (req.params as { storeId: string }).storeId, reply); if (!storeId) return;
    const txids = ((req.body as { pix?: { txid?: string }[] } | null)?.pix ?? []).map((x) => x.txid).filter((t): t is string => !!t && TXID_RE.test(t)).slice(0, 50);
    try {
      const creds = await withPlatform(ctx.pools, (q) => loadCreds<SicoobCreds>(ctx, q, storeId, 'sicoob'));
      if (!creds) return { ok: true };
      for (const txid of txids) {
        const row = (await withPlatform(ctx.pools, (q) => q`select id from order_payments where txid = ${txid} and store_id = ${storeId} and provider = 'sicoob'`))[0];
        if (!row) continue;
        const cob = await sicoobApi(ctx, creds).getCob(txid);                                // confirma no Sicoob: o corpo do webhook não é confiável
        if (cob.status === 'CONCLUIDA') await confirmPayment(ctx, row.id, cob.amountCents);
      }
      return { ok: true };
    } catch (e) {
      ctx.telemetry?.log({ level: 'error', service: 'payments', event: 'webhook.sicoob_failed', message: String((e as Error).message).slice(0, 300), storeId });
      return fail(reply, 500, 'retry', 'Tente novamente.');
    }
  });
}
