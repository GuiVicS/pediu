import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withPlatform, withTenant, type Q } from '@pediu/db';
import { decryptSecret, encryptSecret, toCents } from '@pediu/shared';
import type { Ctx } from './context.js';
import { GatewayError } from './gateways.js';
import { audit, fail, parse } from './http.js';
import { afterOrder } from './orderHooks.js';
import { insertOrder } from './orders.js';
import { guard } from './session.js';
import { staffGuard } from './staff.js';

// ======================= cliente da API do iFood (app centralizado) =======================
export interface IfoodCreds { clientId: string; clientSecret: string }
export interface IfoodEvent { id: string; code: string; fullCode?: string; orderId: string; merchantId: string; createdAt?: string }
export interface IfoodOrder {
  id: string; displayId?: string; orderType: 'DELIVERY' | 'TAKEOUT' | 'INDOOR'; createdAt?: string;
  customer?: { name?: string; phone?: { number?: string }; documentNumber?: string };
  items: { id?: string; name: string; quantity: number; unitPrice: number; price?: number; externalCode?: string; observations?: string; options?: { name: string; quantity: number; unitPrice: number; price?: number; externalCode?: string }[] }[];
  total: { subTotal: number; deliveryFee: number; benefits?: number; orderAmount: number };
  payments?: { prepaid?: number; pending?: number; methods?: { method?: string; type?: 'ONLINE' | 'OFFLINE'; value: number; cash?: { changeFor?: number } }[] };
  delivery?: { deliveredBy?: 'IFOOD' | 'MERCHANT'; deliveryAddress?: { formattedAddress?: string; neighborhood?: string } };
  extraInfo?: string; takeout?: { mode?: string };
}
export interface IfoodApi {
  poll(): Promise<IfoodEvent[]>;
  ack(ids: string[]): Promise<void>;
  order(id: string): Promise<IfoodOrder>;
  confirm(id: string): Promise<void>;
  startPreparation(id: string): Promise<void>;
  readyToPickup(id: string): Promise<void>;
  dispatch(id: string): Promise<void>;
  cancelReasons(id: string): Promise<{ cancelCodeId: string; description: string }[]>;
  requestCancellation(id: string, reason: string, cancellationCode: string): Promise<void>;
}

const BASE = 'https://merchant-api.ifood.com.br';
export function ifoodClient(c: IfoodCreds, f: typeof fetch = fetch, now = () => Date.now()): IfoodApi {
  let tok: { v: string; exp: number } | null = null;
  const token = async () => {
    if (tok && tok.exp > now() + 60_000) return tok.v;
    const res = await f(`${BASE}/authentication/v1.0/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grantType: 'client_credentials', clientId: c.clientId, clientSecret: c.clientSecret }).toString(), signal: AbortSignal.timeout(15_000) });
    const d: any = await res.json().catch(() => null);
    if (!res.ok || !d?.accessToken) throw new GatewayError('iFood recusou as credenciais do aplicativo.', res.status, d);
    tok = { v: d.accessToken, exp: now() + (d.expiresIn ?? 3600) * 1000 }; return tok.v;
  };
  const call = async (method: string, path: string, body?: unknown, ok: number[] = [200, 202, 204]) => {
    const res = await f(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${await token()}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const text = await res.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!ok.includes(res.status)) throw new GatewayError(`iFood respondeu ${res.status}`, res.status, data);
    return data;
  };
  return {
    async poll() { return (await call('GET', '/events/v1.0/events:polling', undefined, [200, 204])) ?? []; },
    async ack(ids) { if (ids.length) await call('POST', '/events/v1.0/events/acknowledgment', ids.map((id) => ({ id })), [200, 202, 204]); },
    order: (id) => call('GET', `/order/v1.0/orders/${encodeURIComponent(id)}`, undefined, [200]),
    confirm: (id) => call('POST', `/order/v1.0/orders/${encodeURIComponent(id)}/confirm`),
    startPreparation: (id) => call('POST', `/order/v1.0/orders/${encodeURIComponent(id)}/startPreparation`),
    readyToPickup: (id) => call('POST', `/order/v1.0/orders/${encodeURIComponent(id)}/readyToPickup`),
    dispatch: (id) => call('POST', `/order/v1.0/orders/${encodeURIComponent(id)}/dispatch`),
    async cancelReasons(id) { return (await call('GET', `/order/v1.0/orders/${encodeURIComponent(id)}/cancellationReasons`, undefined, [200])) ?? []; },
    requestCancellation: (id, reason, cancellationCode) => call('POST', `/order/v1.0/orders/${encodeURIComponent(id)}/requestCancellation`, { reason, cancellationCode }),
  };
}

const api = (ctx: Ctx, c: IfoodCreds): IfoodApi => (ctx.ifood ?? ((x: IfoodCreds) => ifoodClient(x)))(c);
async function appCreds(ctx: Ctx, q: Q): Promise<IfoodCreds | null> {
  const [r] = await q`select value_enc from platform_settings where key = 'ifood.credentials'`;
  return r ? (JSON.parse(decryptSecret(r.value_enc, ctx.ring)) as IfoodCreds) : null;
}

// ======================= iFood → pedido interno =======================
const cents = (n: number | undefined) => toCents(Number(n ?? 0));

/** Traduz o pedido do iFood para o pedido interno. Item sem mapeamento fica sem zona (vai para a zona padrão) e é avisado no log. */
export async function importOrder(ctx: Ctx, q: Q, link: { storeId: string; tenantId: string }, o: IfoodOrder): Promise<{ orderId: string; number: number; type: string } | 'duplicate'> {
  const [dup] = await q`select id from orders where store_id = ${link.storeId} and external_provider = 'ifood' and external_ref = ${o.id}`;
  if (dup) return 'duplicate';
  const codes = [...new Set(o.items.flatMap((i) => [i.externalCode, ...(i.options ?? []).map((x) => x.externalCode)]).filter((x): x is string => !!x))];
  const map = codes.length ? await q`select m.external_code, m.product_id, p.name, c.print_zone_id from ifood_item_map m join products p on p.id = m.product_id join categories c on c.id = p.category_id
      where m.store_id = ${link.storeId} and m.external_code in (select x from jsonb_array_elements_text(${JSON.stringify(codes)}::jsonb) x)` : [];
  const unmapped: string[] = [];
  const lines = o.items.map((it) => {
    const m = it.externalCode ? map.find((x) => x.external_code === it.externalCode) : undefined;
    if (!m) unmapped.push(it.name);
    const unit = Math.round(cents(it.price ?? it.unitPrice * it.quantity) / it.quantity);
    return { productId: (m?.product_id ?? null) as string | null, name: it.name, qty: it.quantity, unitCents: unit, totalCents: unit * it.quantity, note: it.observations ?? '',
      addons: (it.options ?? []).map((op) => ({ group: 'iFood', name: `${op.quantity > 1 ? op.quantity + 'x ' : ''}${op.name}`, priceCents: cents(op.price ?? op.unitPrice * op.quantity) })), zoneId: (m?.print_zone_id ?? null) as string | null };
  });
  const methods = o.payments?.methods ?? [];
  const online = methods.length > 0 && methods.every((x) => x.type === 'ONLINE');
  const label = methods.map((x) => x.method ?? '').filter(Boolean).join(' + ') || 'iFood';
  const change = methods.find((x) => x.cash?.changeFor)?.cash?.changeFor;
  const delivery = o.orderType === 'DELIVERY';
  // o iFood é a fonte do total. Se itens + taxa ficam abaixo do total dele (ex.: taxa de serviço), a diferença entra como taxa; se ficam acima (cupom), vira desconto.
  const itemsSum = lines.reduce((n, l) => n + l.totalCents, 0);
  const target = cents(o.total.orderAmount);
  const diff = target - (itemsSum + cents(o.total.deliveryFee));
  const fee = cents(o.total.deliveryFee) + Math.max(0, diff);
  const discount = Math.max(0, -diff);
  const order = await insertOrder(q, {
    storeId: link.storeId, tenantId: link.tenantId, channel: 'ifood', type: delivery ? 'delivery' : 'retirada', lines: lines.map((l) => ({ ...l, productId: l.productId as string })),
    customerName: o.customer?.name ?? 'Cliente iFood', phone: o.customer?.phone?.number ?? '', address: delivery ? (o.delivery?.deliveryAddress?.formattedAddress ?? '') : '',
    zoneId: null, feeCents: fee, table: null, note: [o.extraInfo, o.displayId ? `iFood #${o.displayId}` : '', o.delivery?.deliveredBy === 'IFOOD' ? 'Entrega pelo iFood' : ''].filter(Boolean).join(' · '),
    payment: online ? `iFood (${label})` : label, changeForCents: change ? cents(change) : null, createdBy: null, paid: online, paidMethod: `iFood (${label})`,
    status: 'novo', discountCents: discount, external: { provider: 'ifood', ref: o.id, data: { displayId: o.displayId, orderType: o.orderType, deliveredBy: o.delivery?.deliveredBy, discountReported: cents(o.total.benefits) } },
  });
  if (unmapped.length) ctx.telemetry?.log({ level: 'warn', service: 'worker', event: 'ifood.unmapped_items', message: `Pedido iFood ${o.displayId ?? o.id}: ${unmapped.length} item(ns) sem mapeamento (${unmapped.slice(0, 3).join(', ')})`, storeId: link.storeId, tenantId: link.tenantId });
  return { orderId: order.id, number: order.number, type: delivery ? 'delivery' : 'retirada' };
}

const STALE_MS = 10 * 60_000;

/** Um ciclo de polling (a cada 30 s). Cada evento é confirmado (ack) só depois de tratado; falha repetida por 10 min é confirmada para não travar a fila. */
export async function pollIfood(ctx: Ctx, nowMs = ctx.clock.now().getTime()): Promise<{ events: number; created: number; cancelled: number; errors: number }> {
  const res = { events: 0, created: 0, cancelled: 0, errors: 0 };
  const creds = await withPlatform(ctx.pools, (q) => appCreds(ctx, q));
  if (!creds) return res;
  const ifood = api(ctx, creds);
  const events = await ifood.poll();
  const toAck: string[] = [];
  for (const e of events) {
    res.events++;
    const state = await withPlatform(ctx.pools, async (q) => {
      const [prev] = await q`insert into ifood_events (event_id, merchant_id, order_ref, code) values (${e.id}, ${e.merchantId}, ${e.orderId}, ${e.code}) on conflict (event_id) do update set code = excluded.code returning received_at, processed_at`;
      return { first: new Date(prev!.received_at).getTime(), done: !!prev!.processed_at };
    });
    if (state.done) { toAck.push(e.id); continue; }
    try {
      const [link] = await withPlatform(ctx.pools, (q) => q`select store_id, tenant_id from ifood_links where merchant_id = ${e.merchantId} and active`);
      if (!link) { await markEvent(ctx, e.id, null); toAck.push(e.id); continue; }       // loja não vinculada: confirma e ignora
      const l = { storeId: link.store_id as string, tenantId: link.tenant_id as string };
      if (e.code === 'PLC') {
        const order = await ifood.order(e.orderId);
        const out = await withPlatform(ctx.pools, (q) => importOrder(ctx, q, l, order));
        if (out !== 'duplicate') { res.created++; await afterOrder(ctx, l, { kind: 'created', id: out.orderId, number: out.number, orderType: out.type, status: 'novo', print: ['novo'] }); }
        await withPlatform(ctx.pools, (q) => q`update ifood_links set last_event_at = now(), last_error = null where store_id = ${l.storeId}`);
      } else if (e.code === 'CAN') {
        const r = await withPlatform(ctx.pools, async (q) => (await q`update orders set status = 'cancelado', cancelled_at = now(), cancel_reason = 'cancelado pelo iFood/cliente'
          where store_id = ${l.storeId} and external_provider = 'ifood' and external_ref = ${e.orderId} and status not in ('entregue', 'cancelado') returning id, number, type`)[0]);
        if (r) { res.cancelled++; await afterOrder(ctx, l, { kind: 'status', id: r.id, number: r.number, orderType: r.type, status: 'cancelado', print: ['cancelado'], cancelReason: 'cancelado pelo iFood/cliente' }); }
      }
      await markEvent(ctx, e.id, null); toAck.push(e.id);
    } catch (err) {
      res.errors++;
      const msg = String((err as Error).message).slice(0, 300);
      await markEvent(ctx, e.id, msg);
      ctx.telemetry?.log({ level: 'error', service: 'worker', event: 'ifood.event_failed', message: `Evento iFood ${e.code} ${e.orderId}: ${msg}`, data: { eventId: e.id } });
      if (nowMs - state.first > STALE_MS) toAck.push(e.id);
    }
  }
  if (toAck.length) await ifood.ack(toAck);
  return res;
}
const markEvent = (ctx: Ctx, id: string, error: string | null) => withPlatform(ctx.pools, (q) => q`update ifood_events set processed_at = case when ${error}::text is null then now() else processed_at end, error = ${error} where event_id = ${id}`);

/** Quando o status muda aqui, avisa o iFood (confirmar, preparar, pronto/despacho, cancelar). Falha não desfaz a mudança local: devolve um aviso. */
export async function syncStatusToIfood(ctx: Ctx, o: { storeId: string; orderId: string; to: string; type: string; cancelReason?: string }): Promise<string | null> {
  const row = await withPlatform(ctx.pools, async (q) => {
    const [x] = await q`select external_ref, external_data, channel from orders where id = ${o.orderId} and store_id = ${o.storeId}`;
    return x?.channel === 'ifood' ? { ref: x.external_ref as string, deliveredBy: x.external_data?.deliveredBy as string | undefined } : null;
  });
  if (!row) return null;
  try {
    const creds = await withPlatform(ctx.pools, (q) => appCreds(ctx, q));
    if (!creds) return 'iFood não configurado na plataforma: o status não foi enviado.';
    const ifood = api(ctx, creds);
    if (o.to === 'preparo') { await ifood.confirm(row.ref); await ifood.startPreparation(row.ref); }
    else if (o.to === 'pronto' && o.type !== 'delivery') await ifood.readyToPickup(row.ref);
    else if (o.to === 'saiu') await ifood.dispatch(row.ref);
    else if (o.to === 'cancelado') {
      const reasons = await ifood.cancelReasons(row.ref);
      const pick = reasons[0];
      if (!pick) return 'O iFood não aceita cancelar este pedido agora.';
      await ifood.requestCancellation(row.ref, (o.cancelReason ?? pick.description).slice(0, 200), pick.cancelCodeId);
    }
    return null;
  } catch (e) {
    ctx.telemetry?.log({ level: 'error', service: 'worker', event: 'ifood.sync_failed', message: `Falha ao enviar "${o.to}" ao iFood: ${String((e as Error).message).slice(0, 200)}`, storeId: o.storeId, data: { orderId: o.orderId } });
    return `O pedido mudou aqui, mas o iFood não confirmou (${(e as Error).message}). Confira no portal do iFood.`;
  }
}

export function ifoodRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---- plataforma: credenciais do aplicativo iFood (as suas, de desenvolvedor) ----
  app.put('/v1/platform/ifood/config', { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const b = parse(z.object({ clientId: z.string().min(8).max(200), clientSecret: z.string().min(8).max(300) }), req.body, reply); if (!b) return;
    try { await api(ctx, b).poll(); } catch (e) { return fail(reply, 422, 'invalid_credentials', e instanceof GatewayError && e.status !== 401 && e.status !== 400 ? `O iFood respondeu ${e.status}.` : 'O iFood recusou estas credenciais.'); }
    await withPlatform(ctx.pools, async (q) => {
      await q`insert into platform_settings (key, value_enc, updated_by) values ('ifood.credentials', ${encryptSecret(JSON.stringify(b), ctx.ring)}, ${req.session!.adminId}) on conflict (key) do update set value_enc = excluded.value_enc, updated_by = excluded.updated_by, updated_at = now()`;
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'ifood.config_updated', ip: req.ip });
    });
    return { ok: true };
  });
  app.get('/v1/platform/ifood/config', { preHandler: guard(ctx) }, async () => withPlatform(ctx.pools, async (q) => {
    const c = await appCreds(ctx, q);
    const [n] = await q`select count(*)::int as n from ifood_links where active`;
    return { configured: !!c, clientIdHint: c ? `…${c.clientId.slice(-4)}` : null, linkedStores: n!.n };
  }));

  // ---- lojista: vínculo e mapeamento de itens ----
  const S = '/v1/staff/ifood'; const adm = staffGuard(ctx, 'admin.loja');
  app.get(S, { preHandler: adm }, async (req) => {
    const s = req.staff!;
    return withTenant(ctx.pools, s.tenantId, async (q) => ({
      link: (await q`select merchant_id, active, last_event_at, last_error from ifood_links where store_id = ${s.storeId}`)[0] ?? null,
      map: await q`select m.external_code, m.product_id, p.name as product_name from ifood_item_map m join products p on p.id = m.product_id where m.store_id = ${s.storeId} order by p.name`,
      platformConfigured: !!(await withPlatform(ctx.pools, (pq) => appCreds(ctx, pq))),
    }));
  });
  app.put(`${S}/link`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!; const b = parse(z.object({ merchantId: z.string().regex(/^[0-9a-fA-F-]{8,40}$/, 'ID da loja no iFood inválido') }), req.body, reply); if (!b) return;
    try {
      await withTenant(ctx.pools, s.tenantId, async (q) => {
        await q`insert into ifood_links (store_id, tenant_id, merchant_id) values (${s.storeId}, ${s.tenantId}, ${b.merchantId}) on conflict (store_id) do update set merchant_id = excluded.merchant_id, active = true, last_error = null`;
        await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'ifood.linked', ip: req.ip, meta: { merchantId: b.merchantId } });
      });
      return { ok: true };
    } catch (e) { if ((e as { code?: string }).code === '23505') return fail(reply, 409, 'merchant_taken', 'Este ID do iFood já está vinculado a outra loja.'); throw e; }
  });
  app.delete(`${S}/link`, { preHandler: adm }, async (req) => {
    const s = req.staff!;
    await withTenant(ctx.pools, s.tenantId, (q) => q`delete from ifood_links where store_id = ${s.storeId}`);
    return { ok: true };
  });
  app.put(`${S}/map`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!;
    const b = parse(z.object({ items: z.array(z.object({ externalCode: z.string().min(1).max(100), productId: z.string().uuid() })).min(1).max(500) }), req.body, reply); if (!b) return;
    try {
      await withTenant(ctx.pools, s.tenantId, async (q) => {
        for (const i of b.items) await q`insert into ifood_item_map (store_id, tenant_id, external_code, product_id) values (${s.storeId}, ${s.tenantId}, ${i.externalCode}, ${i.productId}) on conflict (store_id, external_code) do update set product_id = excluded.product_id`;
      });
      return { ok: true, saved: b.items.length };
    } catch (e) { if ((e as { code?: string }).code === '23503') return fail(reply, 422, 'invalid_reference', 'Produto de outra loja.'); throw e; }
  });
  app.delete(`${S}/map/:code`, { preHandler: adm }, async (req) => {
    const s = req.staff!; const code = (req.params as { code: string }).code;
    await withTenant(ctx.pools, s.tenantId, (q) => q`delete from ifood_item_map where store_id = ${s.storeId} and external_code = ${code}`);
    return { ok: true };
  });
}

