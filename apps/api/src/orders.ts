import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { withTenant, type Q } from '@pediu/db';
import {
  can, canTransition, getOpenStatus, isTerminal, priceLine, roleCanTransition, toCents,
  type AddonGroupDef, type OrderStatus, type OrderType, type ProductDef, type Role,
} from '@pediu/shared';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { loadMenu } from './menu.js';
import { afterOrder } from './orderHooks.js';
import { syncStatusToIfood } from './ifood.js';
import { gatewayReady, startOnlinePayment } from './payments.js';
import { GatewayError } from './gateways.js';
import { loadStaff, resolveStore, staffGuard } from './staff.js';
import { loadCustomer } from './customers.js';
import { openCashSessionId, resolvePayInfo, type PayInfo } from './pdv.js';
import { evaluateCoupon, redeemCoupon } from './coupons.js';

const uuid = z.string().uuid();
const selection = z.array(z.object({ groupId: uuid, addonIds: z.array(uuid).max(30) })).max(20).default([]);
export const lineIn = z.object({ productId: uuid, qty: z.number().int().min(1).max(50), note: z.string().max(200).default(''), addons: selection });

/** Calcula as linhas SEMPRE a partir do banco: do cliente só vêm ids e quantidades. */
export async function buildLines(q: Q, storeId: string, lines: z.infer<typeof lineIn>[]) {
  const ids = [...new Set(lines.map((l) => l.productId))];
  const prods = await q`select p.id, p.name, p.price, p.active, p.available, c.print_zone_id, c.active as cat_active,
      coalesce((select array_agg(pg.group_id) from product_addon_groups pg where pg.product_id = p.id), '{}') as group_ids
      from products p join categories c on c.id = p.category_id where p.store_id = ${storeId} and p.id in (select x::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) x)`;
  const groups = await q`select g.id, g.name, g.min, g.max, g.required, g.pricing, g.active,
      coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price, 'active', a.active) order by a.sort) from addons a where a.group_id = g.id), '[]') as addons
      from addon_groups g where g.store_id = ${storeId}`;
  const groupDefs: AddonGroupDef[] = groups.map((g) => ({ id: g.id, name: g.name, min: g.min, max: g.max, required: g.required, pricing: g.pricing, active: g.active,
    addons: (g.addons as any[]).map((a) => ({ id: a.id, name: a.name, priceCents: toCents(Number(a.price)), active: a.active })) }));
  const out: { productId: string; name: string; qty: number; unitCents: number; totalCents: number; note: string; addons: unknown[]; zoneId: string | null }[] = [];
  for (const l of lines) {
    const p = prods.find((x) => x.id === l.productId);
    if (!p || !p.cat_active) return { error: 'Produto não encontrado nesta loja.' as const };
    const def: ProductDef = { id: p.id, name: p.name, priceCents: toCents(Number(p.price)), active: p.active, available: p.available, groupIds: p.group_ids };
    const r = priceLine(def, groupDefs, l.addons);
    if (!r.ok) return { error: r.error };
    out.push({ productId: p.id, name: p.name, qty: l.qty, unitCents: r.unitCents, totalCents: r.unitCents * l.qty, note: l.note, addons: r.addons, zoneId: p.print_zone_id ?? null });
  }
  return { lines: out };
}

const nextNumber = async (q: Q, storeId: string, tenantId: string) =>
  (await q`insert into order_counters (store_id, tenant_id, last) values (${storeId}, ${tenantId}, 1001)
           on conflict (store_id) do update set last = order_counters.last + 1 returning last`)[0]!.last as number;

export const orderEvent = (q: Q, o: { orderId: string; storeId: string; tenantId: string }, actorKind: 'customer' | 'staff' | 'system', actorId: string | null, ev: string, data?: unknown) =>
  q`insert into order_events (order_id, store_id, tenant_id, actor_kind, actor_id, event, data) values (${o.orderId}, ${o.storeId}, ${o.tenantId}, ${actorKind}, ${actorId}, ${ev}, ${data === undefined ? null : JSON.stringify(data)}::jsonb)`;
const event = orderEvent;

export async function insertOrder(q: Q, a: {
  storeId: string; tenantId: string; channel: 'loja' | 'pdv' | 'garcom' | 'ifood' | 'totem'; type: OrderType; lines: NonNullable<Awaited<ReturnType<typeof buildLines>>['lines']>;
  customerName: string; phone: string; address: string; zoneId: string | null; feeCents: number; table: number | null; note: string; payment: string; changeForCents: number | null;
  createdBy: string | null; paid?: boolean; status?: OrderStatus; customerId?: string | null; customerEmail?: string | null;
  pay?: PayInfo; cashSessionId?: string | null;
  discountCents?: number; paidMethod?: string; external?: { provider: string; ref: string; data?: unknown };
}) {
  const subtotal = a.lines.reduce((s, l) => s + l.totalCents, 0);
  const discount = a.discountCents ?? 0;
  const total = subtotal + a.feeCents - discount;
  const number = await nextNumber(q, a.storeId, a.tenantId);
  const [o] = await q`insert into orders (store_id, tenant_id, number, channel, type, status, customer_name, customer_phone, address, zone_id, table_number, note,
      subtotal_cents, fee_cents, discount_cents, total_cents, payment_method, change_for_cents, paid, paid_at, paid_method, created_by, external_provider, external_ref, external_data, customer_id,
      paid_type, payment_mode, cash_received_cents, change_cents, payment_ref, paid_by, cash_session_id, customer_email)
    values (${a.storeId}, ${a.tenantId}, ${number}, ${a.channel}, ${a.type}, ${a.status ?? 'novo'}, ${a.customerName}, ${a.phone}, ${a.address}, ${a.zoneId}, ${a.table}, ${a.note},
      ${subtotal}, ${a.feeCents}, ${discount}, ${total}, ${a.payment}, ${a.changeForCents}, ${!!a.paid}, ${a.paid ? new Date().toISOString() : null}, ${a.paid ? (a.paidMethod ?? a.payment) : null}, ${a.createdBy},
      ${a.external?.provider ?? null}, ${a.external?.ref ?? null}, ${a.external?.data === undefined ? null : JSON.stringify(a.external.data)}::jsonb, ${a.customerId ?? null},
      ${a.paid ? a.pay?.type ?? null : null}, ${a.paid ? a.pay?.mode ?? null : null}, ${a.pay?.receivedCents ?? null}, ${a.pay?.changeCents ?? null}, ${a.pay?.ref ?? null}, ${a.paid ? a.createdBy : null}, ${a.cashSessionId ?? null}, ${a.customerEmail ?? null})
    returning id, number, tracking_token, total_cents`;
  for (const l of a.lines) {
    await q`insert into order_items (order_id, store_id, tenant_id, product_id, name, qty, unit_cents, total_cents, note, addons, print_zone_id)
            values (${o!.id}, ${a.storeId}, ${a.tenantId}, ${l.productId}, ${l.name}, ${l.qty}, ${l.unitCents}, ${l.totalCents}, ${l.note}, ${JSON.stringify(l.addons)}::jsonb, ${l.zoneId})`;
  }
  await event(q, { orderId: o!.id, storeId: a.storeId, tenantId: a.tenantId }, a.channel === 'loja' || a.channel === 'totem' ? 'customer' : 'staff', a.createdBy, 'created', { channel: a.channel, total: total });
  return { id: o!.id as string, number: o!.number as number, trackingToken: o!.tracking_token as string, totalCents: total };
}

/**
 * Acrescenta itens a uma comanda de mesa aberta (garçom e totem): grava os itens, refaz o total, volta para a cozinha se
 * estava pronta e desfaz o "conta pedida" (a mesa pediu mais coisa). A comanda já deve estar travada (FOR UPDATE) por quem chama.
 */
export async function appendItems(q: Q, o: { id: string; storeId: string; tenantId: string; subtotalCents: number; feeCents: number; discountCents: number },
  lines: NonNullable<Awaited<ReturnType<typeof buildLines>>['lines']>, actor: { kind: 'staff' | 'customer'; id: string | null }) {
  const newIds: string[] = [];
  for (const l of lines) {
    const [it] = await q`insert into order_items (order_id, store_id, tenant_id, product_id, name, qty, unit_cents, total_cents, note, addons, print_zone_id)
            values (${o.id}, ${o.storeId}, ${o.tenantId}, ${l.productId}, ${l.name}, ${l.qty}, ${l.unitCents}, ${l.totalCents}, ${l.note}, ${JSON.stringify(l.addons)}::jsonb, ${l.zoneId}) returning id`;
    newIds.push(it!.id as string);
  }
  const add = lines.reduce((n, l) => n + l.totalCents, 0);
  const subtotal = o.subtotalCents + add;
  await q`update orders set subtotal_cents = ${subtotal}, total_cents = ${subtotal + o.feeCents - o.discountCents},
          status = case when status in ('pronto') then 'preparo' else status end, ready_at = case when status = 'pronto' then null else ready_at end, bill_requested_at = null where id = ${o.id}`;
  await event(q, { orderId: o.id, storeId: o.storeId, tenantId: o.tenantId }, actor.kind, actor.id, 'items_added', { added: lines.length, addedCents: add });
  return { totalCents: subtotal + o.feeCents - o.discountCents, newIds };
}

/** O público só enxerga lojas no ar. Rascunho (desenvolvimento), suspensa e arquivada respondem como inexistentes. */
const publicStore = async (ctx: Ctx, slug: string) => { const s = await resolveStore(ctx, slug); return s && s.status === 'producao' ? s : null; };

/** Cookie gravado pelo edge quando a loja é aberta pelo link de prévia (?previa=…). */
export const PREVIEW_COOKIE = 'pediu_previa';

/**
 * Vitrine para leitura: lojas no ar para qualquer pessoa; loja em `desenvolvimento` para a equipe logada DESTA loja
 * ou para quem abriu o link secreto de prévia. Pedidos continuam só em produção.
 */
const viewableStore = async (ctx: Ctx, req: FastifyRequest, slug: string) => {
  const s = await resolveStore(ctx, slug);
  if (!s) return null;
  if (s.status === 'producao') return s;
  if (s.status !== 'desenvolvimento') return null;
  const preview = req.cookies[PREVIEW_COOKIE];
  if (preview && (await ctx.pools.app.begin((q) => q`select app.store_preview_ok(${s.storeId}, ${preview}) as ok`))[0]?.ok) return s;
  const staff = await loadStaff(ctx, req);
  return staff && staff.storeId === s.storeId && staff.tenantId === s.tenantId ? s : null;
};

export function orderRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---------------- público: a loja online ----------------
  const pub = '/v1/store/:slug';

  app.get(`${pub}`, async (req, reply) => {
    const store = await viewableStore(ctx, req, (req.params as { slug: string }).slug);
    if (!store) return fail(reply, 404, 'not_found', 'Loja não encontrada.');
    return withTenant(ctx.pools, store.tenantId, async (q) => {
      const [settings] = await q`select data from store_settings where store_id = ${store.storeId}`;
      const [theme] = await q`select data from store_themes where store_id = ${store.storeId}`;
      const [land] = await q`select value from platform_public_settings where key = 'landing_url'`;
      return { name: store.name, status: store.status, open: getOpenStatus(settings?.data ?? {}), settings: settings?.data ?? {}, theme: theme?.data ?? {}, platform: { landingUrl: land?.value ?? '' } };
    });
  });

  app.get(`${pub}/menu`, async (req, reply) => {
    const store = await viewableStore(ctx, req, (req.params as { slug: string }).slug);
    if (!store) return fail(reply, 404, 'not_found', 'Loja não encontrada.');
    return withTenant(ctx.pools, store.tenantId, (q) => loadMenu(q, store.storeId));
  });

  // checkout: preço, taxa e horário calculados aqui, nunca confiados ao navegador
  app.post(`${pub}/orders`, { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    const b = parse(z.object({
      type: z.enum(['delivery', 'retirada']), customerName: z.string().trim().min(2).max(80), phone: z.string().trim().min(8).max(20),
      address: z.string().trim().max(200).default(''), zoneId: uuid.optional(), paymentId: uuid, note: z.string().max(300).default(''),
      changeFor: z.number().min(0).max(10000).optional(), email: z.string().email().max(120).optional(), document: z.string().regex(/^\d{11}$|^\d{14}$/, 'CPF ou CNPJ só com números').optional(),
      lines: z.array(lineIn).min(1).max(60), couponCode: z.string().trim().max(30).optional(),
    }), req.body, reply); if (!b) return;
    const store = await resolveStore(ctx, slug);
    if (!store || store.status !== 'producao') return fail(reply, 404, 'not_found', 'Loja não encontrada ou ainda não está no ar. Pedidos só são aceitos depois que a loja for publicada.');
    const customer = await loadCustomer(ctx, req, store);   // logado: o pedido entra no histórico dele
    const out = await withTenant(ctx.pools, store.tenantId, async (q) => {
      const [settings] = await q`select data from store_settings where store_id = ${store.storeId}`;
      const cfg = (settings?.data ?? {}) as Record<string, any>;
      const open = getOpenStatus(cfg, ctx.clock.now());
      if (!open.open) return { ok: false as const, status: 422, code: 'closed', message: `A loja está fechada. ${open.label}.` };
      const built = await buildLines(q, store.storeId, b.lines);
      if ('error' in built) return { ok: false as const, status: 422, code: 'invalid_items', message: built.error! };
      const subtotal = built.lines!.reduce((s, l) => s + l.totalCents, 0);
      if (cfg.minOrder && subtotal < toCents(Number(cfg.minOrder))) return { ok: false as const, status: 422, code: 'below_minimum', message: `Pedido mínimo: R$ ${Number(cfg.minOrder).toFixed(2).replace('.', ',')}.` };
      const [pay] = await q`select name, type, online, gateway from payment_methods where id = ${b.paymentId} and store_id = ${store.storeId} and active`;
      if (!pay) return { ok: false as const, status: 422, code: 'invalid_payment', message: 'Forma de pagamento indisponível.' };
      if (pay.online && !(await gatewayReady(q, store.storeId, pay.gateway, pay.type === 'credit' ? 'card' : 'pix'))) return { ok: false as const, status: 422, code: 'payment_unavailable', message: 'O pagamento online está indisponível no momento. Escolha outra forma de pagamento.' };
      let fee = 0, zone: { id: string; name: string } | null = null;
      if (b.type === 'delivery') {
        if (!b.address) return { ok: false as const, status: 422, code: 'address_required', message: 'Informe o endereço de entrega.' };
        const [z] = b.zoneId ? await q`select id, name, fee from delivery_zones where id = ${b.zoneId} and store_id = ${store.storeId} and active` : [];
        if (!z) return { ok: false as const, status: 422, code: 'invalid_zone', message: 'Escolha uma região de entrega válida.' };
        fee = toCents(Number(z.fee)); zone = { id: z.id, name: z.name };
      }
      // cupom: validado e travado aqui (limites não estouram com pedidos simultâneos); o desconto vale só sobre os itens
      let coupon: Extract<Awaited<ReturnType<typeof evaluateCoupon>>, { ok: true }> | null = null;
      if (b.couponCode) {
        const r = await evaluateCoupon(ctx, q, store.storeId, { code: b.couponCode, subtotalCents: subtotal, customerId: customer?.id ?? null, phone: b.phone, lock: true });
        if (!r.ok) return { ok: false as const, status: 422, code: 'coupon_invalid', message: r.error };
        coupon = r;
      }
      const total = subtotal + fee - (coupon?.discountCents ?? 0);
      if (pay.type === 'cash' && b.changeFor !== undefined && toCents(b.changeFor) < total) return { ok: false as const, status: 422, code: 'invalid_change', message: 'O valor para troco é menor que o total.' };
      const o = await insertOrder(q, { storeId: store.storeId, tenantId: store.tenantId, channel: 'loja', type: b.type, lines: built.lines!, customerName: b.customerName, phone: b.phone,
        address: zone ? `${b.address} — ${zone.name}` : '', zoneId: zone?.id ?? null, feeCents: fee, table: null, note: b.note, payment: pay.name,
        changeForCents: pay.type === 'cash' && b.changeFor !== undefined ? toCents(b.changeFor) : null, createdBy: null, status: pay.online ? 'aguardando' : 'novo', customerId: customer?.id ?? null, customerEmail: (customer?.email ?? b.email)?.toLowerCase() ?? null, discountCents: coupon?.discountCents });
      if (coupon) await redeemCoupon(q, { couponId: coupon.couponId, storeId: store.storeId, tenantId: store.tenantId, orderId: o.id, code: coupon.code, customerId: customer?.id ?? null, phone: b.phone, discountCents: coupon.discountCents });
      if (customer) await q`update store_customers set name = case when name = '' then ${b.customerName} else name end, phone = case when phone = '' then ${b.phone} else phone end where id = ${customer.id}`;
      return { ok: true as const, o, online: pay.online ? { gateway: pay.gateway as 'mercadopago' | 'sicoob', method: (pay.type === 'credit' ? 'card' : 'pix') as 'pix' | 'card' } : null };
    });
    if (!out.ok) return fail(reply, out.status, out.code, out.message);

    // pagamento online: o pedido fica 'aguardando' (invisível para a cozinha) até o gateway confirmar
    if (out.online) {
      try {
        const payment = await startOnlinePayment(ctx, { tenantId: store.tenantId, storeId: store.storeId, orderId: out.o.id, orderNumber: out.o.number, amountCents: out.o.totalCents, slug,
          method: out.online.method, gateway: out.online.gateway, customer: { name: b.customerName, email: b.email, document: b.document } });
        return reply.status(201).send({ number: out.o.number, totalCents: out.o.totalCents, trackingToken: out.o.trackingToken, payment });
      } catch (e) {
        await withTenant(ctx.pools, store.tenantId, (q) => q`update orders set status = 'cancelado', cancelled_at = now(), cancel_reason = 'falha ao criar o pagamento online' where id = ${out.o.id}`);
        ctx.telemetry?.log({ level: 'error', service: 'payments', event: 'payment.start_failed', message: String((e as Error).message).slice(0, 300), storeId: store.storeId, tenantId: store.tenantId, data: { orderId: out.o.id, gateway: out.online.gateway } });
        return fail(reply, 502, 'payment_failed', e instanceof GatewayError && e.status === 409 ? e.message : 'Não foi possível gerar o pagamento agora. Tente novamente ou escolha outra forma.');
      }
    }
    await afterOrder(ctx, store, { kind: 'created', id: out.o.id, number: out.o.number, orderType: b.type, status: 'novo', print: ['novo'] });
    return reply.status(201).send({ number: out.o.number, totalCents: out.o.totalCents, trackingToken: out.o.trackingToken });
  });

  // acompanhamento por token (sem telefone nem endereço)
  app.get('/v1/track/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = parse(z.string().regex(/^[0-9a-f]{64}$/), (req.params as { token: string }).token, reply); if (!token) return;
    const [o] = await ctx.pools.app.begin((q) => q`select * from app.order_by_token(${token})`);
    return o ? o : fail(reply, 404, 'not_found', 'Pedido não encontrado.');
  });

  // ---------------- equipe: PDV, garçom, entregador, painel ----------------
  const S = '/v1/staff/orders';
  const itemRows = (q: Q, ids: string[]) => q`select order_id, name, qty, unit_cents, total_cents, note, addons, print_zone_id, created_at from order_items
                                               where order_id in (select x::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) x) order by created_at`;
  const orderCols = `id, number, channel, type, status, customer_name, customer_phone, address, table_number, note, subtotal_cents, fee_cents, discount_cents, total_cents,
                     payment_method, change_for_cents, paid, paid_at, paid_type, payment_mode, cash_received_cents, change_cents, payment_ref, courier_id, guests, bill_requested_at, created_at, accepted_at, ready_at, dispatched_at, delivered_at, cancelled_at, cancel_reason`;
  void orderCols;

  app.get(S, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const s = req.staff!;
    const qs = parse(z.object({ status: z.string().optional(), open: z.enum(['1']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query, reply); if (!qs) return;
    // entregador só vê entregas; garçom só mesas e o que ele mesmo criou
    const perms = { pedidos: can(s.role, 'admin.pedidos') || can(s.role, 'pdv'), garcom: can(s.role, 'garcom'), motoboy: can(s.role, 'motoboy') };
    if (!perms.pedidos && !perms.garcom && !perms.motoboy) return fail(reply, 403, 'forbidden', 'Seu perfil não acessa pedidos.');
    return withTenant(ctx.pools, s.tenantId, async (q) => {
      const rows = await q`select id, number, channel, type, status, customer_name, customer_phone, address, table_number, note, subtotal_cents, fee_cents, discount_cents, total_cents,
          payment_method, change_for_cents, paid, paid_at, paid_type, payment_mode, cash_received_cents, change_cents, payment_ref, courier_id, guests, bill_requested_at, created_at, accepted_at, ready_at, dispatched_at, delivered_at, cancelled_at, cancel_reason
        from orders where store_id = ${s.storeId}
          and (${qs.open ?? null}::text is null or status not in ('entregue', 'cancelado'))
          and (${qs.status ?? null}::text is null or status = ${qs.status ?? null})
          and (status <> 'aguardando' or ${qs.status ?? null}::text = 'aguardando')
          and (${perms.pedidos}::boolean or (${perms.garcom}::boolean and type = 'mesa') or (${perms.motoboy}::boolean and type = 'delivery' and status in ('pronto', 'saiu', 'entregue') and (courier_id is null or courier_id = ${s.staffId})))
        order by created_at desc limit ${qs.limit}`;
      const items = rows.length ? await itemRows(q, rows.map((r) => r.id)) : [];
      return { orders: rows.map((r) => ({ ...r, items: items.filter((i) => i.order_id === r.id) })) };
    });
  });

  // lançamento no PDV (balcão/entrega) ou comanda do garçom (mesa)
  app.post(S, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const s = req.staff!;
    const b = parse(z.object({
      type: z.enum(['delivery', 'retirada', 'mesa']), customerName: z.string().trim().max(80).default(''), phone: z.string().trim().max(20).default(''),
      address: z.string().trim().max(200).default(''), zoneId: uuid.optional(), table: z.number().int().min(1).max(500).optional(), guests: z.number().int().min(1).max(99).optional(), note: z.string().max(300).default(''),
      paymentId: uuid.optional(), receiveNow: z.boolean().default(false), lines: z.array(lineIn).min(1).max(60),
      receivedCents: z.number().int().min(0).max(100_000_000).optional(), reference: z.string().trim().max(40).optional(),
      couponCode: z.string().trim().max(30).optional(), customerId: uuid.optional(),
    }), req.body, reply); if (!b) return;
    if (b.type === 'mesa' ? !can(s.role, 'garcom') && !can(s.role, 'pdv') : !can(s.role, 'pdv')) return fail(reply, 403, 'forbidden', 'Seu perfil não pode lançar este tipo de pedido.');
    if (b.type === 'mesa' && !b.table) return fail(reply, 400, 'invalid_input', 'Informe o número da mesa.');
    if (b.type === 'delivery' && (!b.customerName || !b.address || !b.zoneId)) return fail(reply, 400, 'invalid_input', 'Entrega exige nome, endereço e região.');
    const channel = b.type === 'mesa' ? 'garcom' : 'pdv';
    try {
      const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
        const built = await buildLines(q, s.storeId, b.lines);
        if ('error' in built) return { ok: false as const, status: 422, code: 'invalid_items', message: built.error! };
        let fee = 0, zone: { id: string; name: string } | null = null;
        if (b.type === 'delivery') {
          const [z] = await q`select id, name, fee from delivery_zones where id = ${b.zoneId!} and store_id = ${s.storeId} and active`;
          if (!z) return { ok: false as const, status: 422, code: 'invalid_zone', message: 'Região de entrega inválida.' };
          fee = toCents(Number(z.fee)); zone = { id: z.id, name: z.name };
        }
        if (b.customerId) { const [c] = await q`select 1 as ok from store_customers where id = ${b.customerId} and store_id = ${s.storeId}`; if (!c) return { ok: false as const, status: 422, code: 'invalid_customer', message: 'Cliente não encontrado.' }; }
        const subtotal = built.lines!.reduce((n, l) => n + l.totalCents, 0);
        let coupon: Extract<Awaited<ReturnType<typeof evaluateCoupon>>, { ok: true }> | null = null;
        if (b.couponCode) {
          const r = await evaluateCoupon(ctx, q, s.storeId, { code: b.couponCode, subtotalCents: subtotal, customerId: b.customerId ?? null, phone: b.phone, lock: true });
          if (!r.ok) return { ok: false as const, status: 422, code: 'coupon_invalid', message: r.error };
          coupon = r;
        }
        const total = subtotal + fee - (coupon?.discountCents ?? 0);
        let pay: Record<string, any> | undefined; let payInfo: PayInfo | undefined;
        if (b.paymentId) {
          [pay] = await q`select name from payment_methods where id = ${b.paymentId} and store_id = ${s.storeId} and active`;
          if (!pay) return { ok: false as const, status: 422, code: 'invalid_payment', message: 'Forma de pagamento indisponível.' };
          if (b.receiveNow) { const r = await resolvePayInfo(q, s.storeId, b.paymentId, total, { receivedCents: b.receivedCents, reference: b.reference }); if ('error' in r) return { ok: false as const, status: 422, code: 'invalid_payment', message: r.error }; payInfo = r; }
        }
        if (b.receiveNow && !pay) return { ok: false as const, status: 422, code: 'invalid_payment', message: 'Informe a forma de pagamento para receber.' };
        const cashSessionId = b.receiveNow || channel === 'pdv' ? await openCashSessionId(q, s.storeId, s.staffId) : null;
        const o = await insertOrder(q, { storeId: s.storeId, tenantId: s.tenantId, channel, type: b.type, lines: built.lines!, customerName: b.customerName || (b.type === 'mesa' ? `Mesa ${b.table}` : 'Balcão'),
          phone: b.phone, address: zone ? `${b.address} — ${zone.name}` : '', zoneId: zone?.id ?? null, feeCents: fee, table: b.type === 'mesa' ? b.table! : null, note: b.note,
          payment: pay?.name ?? '', changeForCents: null, createdBy: s.staffId, paid: b.receiveNow, status: b.receiveNow ? 'preparo' : 'novo',
          discountCents: coupon?.discountCents ?? 0, customerId: b.customerId ?? null, pay: payInfo, cashSessionId });
        if (b.type === 'mesa' && b.guests) await q`update orders set guests = ${b.guests} where id = ${o.id}`;
        if (coupon) await redeemCoupon(q, { couponId: coupon.couponId, storeId: s.storeId, tenantId: s.tenantId, orderId: o.id, code: coupon.code, customerId: b.customerId ?? null, phone: b.phone, discountCents: coupon.discountCents });
        return { ok: true as const, o, changeCents: payInfo?.changeCents ?? 0 };
      });
      if (!out.ok) return fail(reply, out.status, out.code, out.message);
      await afterOrder(ctx, s, { kind: 'created', id: out.o.id, number: out.o.number, orderType: b.type, status: b.receiveNow ? 'preparo' : 'novo', print: b.receiveNow ? ['novo', 'preparo'] : ['novo'] });
      return reply.status(201).send({ id: out.o.id, number: out.o.number, totalCents: out.o.totalCents, changeCents: out.changeCents });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return fail(reply, 409, 'table_busy', 'Esta mesa já tem uma comanda aberta. Adicione itens a ela.');
      throw e;
    }
  });

  // adicionar itens à comanda aberta da mesa (volta para a cozinha)
  app.post(`${S}/:id/items`, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const s = req.staff!;
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ lines: z.array(lineIn).min(1).max(60) }), req.body, reply); if (!b) return;
    const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [o] = await q`select id, number, type, status, subtotal_cents, fee_cents, discount_cents from orders where id = ${id} and store_id = ${s.storeId} for update`;
      if (!o) return { ok: false as const, status: 404, code: 'not_found', message: 'Pedido não encontrado.' };
      if (o.type !== 'mesa') return { ok: false as const, status: 422, code: 'not_table', message: 'Só comandas de mesa aceitam itens depois de abertas.' };
      if (!(can(s.role, 'garcom') || can(s.role, 'pdv'))) return { ok: false as const, status: 403, code: 'forbidden', message: 'Seu perfil não pode alterar comandas.' };
      if (isTerminal(o.status)) return { ok: false as const, status: 422, code: 'closed', message: 'A comanda já foi encerrada.' };
      const built = await buildLines(q, s.storeId, b.lines);
      if ('error' in built) return { ok: false as const, status: 422, code: 'invalid_items', message: built.error! };
      const r = await appendItems(q, { id, storeId: s.storeId, tenantId: s.tenantId, subtotalCents: o.subtotal_cents, feeCents: o.fee_cents, discountCents: o.discount_cents }, built.lines!, { kind: 'staff', id: s.staffId });
      return { ok: true as const, ...r, number: o.number as number };
    });
    if (!out.ok) return fail(reply, out.status, out.code, out.message);
    await afterOrder(ctx, s, { kind: 'items', id, number: out.number, orderType: 'mesa', status: 'preparo', print: ['items_added'], itemIds: out.newIds });
    return { ok: true, totalCents: out.totalCents };
  });

  // mesa: transferir a comanda, ajustar pessoas e pedir a conta (o caixa vê no PDV; a mesa fica destacada no mapa)
  app.post(`${S}/:id/mesa`, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const s = req.staff!;
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ table: z.number().int().min(1).max(500).optional(), guests: z.number().int().min(1).max(99).nullable().optional(), bill: z.boolean().optional() })
      .refine((v) => v.table !== undefined || v.guests !== undefined || v.bill !== undefined, 'Nada para alterar.'), req.body, reply); if (!b) return;
    if (!(can(s.role, 'garcom') || can(s.role, 'pdv'))) return fail(reply, 403, 'forbidden', 'Seu perfil não pode alterar comandas.');
    try {
      const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
        const [o] = await q`select id, number, type, status, table_number from orders where id = ${id} and store_id = ${s.storeId} for update`;
        if (!o) return { ok: false as const, status: 404, code: 'not_found', message: 'Comanda não encontrada.' };
        if (o.type !== 'mesa') return { ok: false as const, status: 422, code: 'not_table', message: 'Só comandas de mesa.' };
        if (isTerminal(o.status)) return { ok: false as const, status: 422, code: 'closed', message: 'A comanda já foi encerrada.' };
        if (b.table !== undefined && b.table !== o.table_number) {
          await q`update orders set table_number = ${b.table}, customer_name = case when customer_name = ${`Mesa ${o.table_number}`} then ${`Mesa ${b.table}`} else customer_name end where id = ${id}`;
          await event(q, { orderId: id, storeId: s.storeId, tenantId: s.tenantId }, 'staff', s.staffId, 'table_moved', { from: o.table_number, to: b.table });
        }
        if (b.guests !== undefined) await q`update orders set guests = ${b.guests} where id = ${id}`;
        if (b.bill !== undefined) {
          await q`update orders set bill_requested_at = case when ${b.bill} then now() else null end where id = ${id}`;
          await event(q, { orderId: id, storeId: s.storeId, tenantId: s.tenantId }, 'staff', s.staffId, b.bill ? 'bill_requested' : 'bill_cancelled', {});
        }
        return { ok: true as const, number: o.number as number, status: o.status as string };
      });
      if (!out.ok) return fail(reply, out.status, out.code, out.message);
      await afterOrder(ctx, s, { kind: 'status', id, number: out.number, orderType: 'mesa', status: out.status, print: [] });   // atualiza mapa e PDV em tempo real
      return { ok: true };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return fail(reply, 409, 'table_busy', `A mesa ${b.table} já tem uma comanda aberta.`);
      throw e;
    }
  });

  // mudar o status respeitando o fluxo e o perfil
  app.post(`${S}/:id/status`, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const s = req.staff!;
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ to: z.enum(['novo', 'preparo', 'pronto', 'saiu', 'entregue', 'cancelado']), reason: z.string().max(200).optional() }), req.body, reply); if (!b) return;
    const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [o] = await q`select id, type, status, paid, courier_id, number, payment_method from orders where id = ${id} and store_id = ${s.storeId} for update`;
      if (!o) return { ok: false as const, status: 404, code: 'not_found', message: 'Pedido não encontrado.' };
      if (!canTransition(o.type as OrderType, o.status, b.to)) return { ok: false as const, status: 422, code: 'invalid_transition', message: `Não é possível ir de "${o.status}" para "${b.to}".` };
      if (!roleCanTransition(s.role as Role, o.type as OrderType, o.status, b.to)) return { ok: false as const, status: 403, code: 'forbidden', message: 'Seu perfil não pode fazer esta mudança.' };
      if (b.to === 'cancelado' && !b.reason?.trim()) return { ok: false as const, status: 400, code: 'reason_required', message: 'Informe o motivo do cancelamento.' };
      if (s.role === 'entregador' && (b.to === 'saiu' || b.to === 'entregue') && o.courier_id && o.courier_id !== s.staffId) return { ok: false as const, status: 409, code: 'taken', message: 'Esta entrega pertence a outro entregador.' };
      const ts = { preparo: 'accepted_at', pronto: 'ready_at', saiu: 'dispatched_at', entregue: 'delivered_at', cancelado: 'cancelled_at' } as Record<string, string>;
      const col = ts[b.to];
      const collect = b.to === 'entregue' && s.role === 'entregador' && !o.paid;       // o entregador recebeu na porta (dinheiro/maquininha)
      await q`update orders set paid = paid or ${collect}, paid_at = case when ${collect} then now() else paid_at end, paid_method = case when ${collect} then payment_method else paid_method end where id = ${id}`;
      await q`update orders set status = ${b.to},
          accepted_at = case when ${col === 'accepted_at'} then now() else accepted_at end, ready_at = case when ${col === 'ready_at'} then now() else ready_at end,
          dispatched_at = case when ${col === 'dispatched_at'} then now() else dispatched_at end, delivered_at = case when ${col === 'delivered_at'} then now() else delivered_at end,
          cancelled_at = case when ${col === 'cancelled_at'} then now() else cancelled_at end, cancel_reason = case when ${b.to === 'cancelado'} then ${b.reason ?? null} else cancel_reason end,
          courier_id = case when ${b.to === 'saiu' && s.role === 'entregador'} then ${s.staffId}::uuid else courier_id end where id = ${id}`;
      await event(q, { orderId: id, storeId: s.storeId, tenantId: s.tenantId }, 'staff', s.staffId, `status:${b.to}`, { from: o.status, reason: b.reason });
      if (b.to === 'cancelado') await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'order.cancelled', ip: req.ip, meta: { number: o.number, reason: b.reason, from: o.status } });
      return { ok: true as const, status: b.to, number: o.number as number, orderType: o.type as string };
    });
    if (!out.ok) return fail(reply, out.status, out.code, out.message);
    const printKind = { preparo: 'preparo', pronto: 'pronto', cancelado: 'cancelado' } as const;
    await afterOrder(ctx, s, { kind: 'status', id, number: out.number, orderType: out.orderType, status: b.to, print: b.to in printKind ? [printKind[b.to as keyof typeof printKind]] : [], cancelReason: b.reason });
    const warning = await syncStatusToIfood(ctx, { storeId: s.storeId, orderId: id, to: b.to, type: out.orderType, cancelReason: b.reason });
    return { ok: true, status: out.status, ...(warning ? { warning } : {}) };
  });

  // receber (PDV): marca como pago; em mesa, receber a conta encerra a comanda
  app.post(`${S}/:id/pay`, { preHandler: staffGuard(ctx, 'pdv') }, async (req, reply) => {
    const s = req.staff!;
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ paymentId: uuid, receivedCents: z.number().int().min(0).max(100_000_000).optional(), reference: z.string().trim().max(40).optional() }), req.body, reply); if (!b) return;
    const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [o] = await q`select id, type, status, paid, total_cents, number from orders where id = ${id} and store_id = ${s.storeId} for update`;
      if (!o) return { ok: false as const, status: 404, code: 'not_found', message: 'Pedido não encontrado.' };
      if (o.status === 'cancelado') return { ok: false as const, status: 422, code: 'cancelled', message: 'Pedido cancelado.' };
      if (o.paid) return { ok: false as const, status: 409, code: 'already_paid', message: 'Pedido já recebido.' };
      const pi = await resolvePayInfo(q, s.storeId, b.paymentId, o.total_cents, { receivedCents: b.receivedCents, reference: b.reference });
      if ('error' in pi) return { ok: false as const, status: 422, code: 'invalid_payment', message: pi.error };
      const pay = { name: pi.name };
      const sessionId = await openCashSessionId(q, s.storeId, s.staffId);
      await q`update orders set paid_type = ${pi.type}, payment_mode = ${pi.mode}, cash_received_cents = ${pi.receivedCents}, change_cents = ${pi.changeCents}, payment_ref = ${pi.ref},
              paid_by = ${s.staffId}, cash_session_id = coalesce(cash_session_id, ${sessionId}) where id = ${id}`;
      await q`update orders set paid = true, paid_at = now(), paid_method = ${pay.name}, payment_method = ${pay.name},
              status = case when status = 'aguardando' then 'novo' when type = 'mesa' then 'entregue' else status end,
              delivered_at = case when type = 'mesa' and status <> 'aguardando' then now() else delivered_at end where id = ${id}`;
      // o recebimento manual encerra qualquer cobrança online pendente deste pedido (evita pagar duas vezes)
      await q`update order_payments set status = 'cancelado' where order_id = ${id} and status = 'pendente'`;
      await event(q, { orderId: id, storeId: s.storeId, tenantId: s.tenantId }, 'staff', s.staffId, 'paid', { method: pay.name, type: pi.type, mode: pi.mode, totalCents: o.total_cents, changeCents: pi.changeCents });
      return { ok: true as const, changeCents: pi.changeCents ?? 0, totalCents: o.total_cents as number, number: o.number as number, orderType: o.type as string, wasWaiting: o.status === 'aguardando' };
    });
    if (!out.ok) return fail(reply, out.status, out.code, out.message);
    await afterOrder(ctx, s, out.wasWaiting
      ? { kind: 'created', id, number: out.number, orderType: out.orderType, status: 'novo', print: ['novo'] }
      : { kind: 'paid', id, number: out.number, orderType: out.orderType, status: out.orderType === 'mesa' ? 'entregue' : 'novo' });
    return { ok: true, totalCents: out.totalCents, changeCents: out.changeCents };
  });

  // linha do tempo do pedido
  app.get(`${S}/:id/events`, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const s = req.staff!;
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    if (!(can(s.role, 'admin.pedidos') || can(s.role, 'pdv'))) return fail(reply, 403, 'forbidden', 'Seu perfil não acessa o histórico.');
    return { events: await withTenant(ctx.pools, s.tenantId, (q) => q`select at, actor_kind, event, data from order_events where order_id = ${id} and store_id = ${s.storeId} order by id`) };
  });
}
