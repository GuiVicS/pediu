import type { FastifyInstance } from 'fastify';
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
import { gatewayConfigured, startOnlinePayment } from './payments.js';
import { GatewayError } from './gateways.js';
import { resolveStore, staffGuard } from './staff.js';
import { loadCustomer } from './customers.js';

const uuid = z.string().uuid();
const selection = z.array(z.object({ groupId: uuid, addonIds: z.array(uuid).max(30) })).max(20).default([]);
const lineIn = z.object({ productId: uuid, qty: z.number().int().min(1).max(50), note: z.string().max(200).default(''), addons: selection });

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

const event = (q: Q, o: { orderId: string; storeId: string; tenantId: string }, actorKind: 'customer' | 'staff' | 'system', actorId: string | null, ev: string, data?: unknown) =>
  q`insert into order_events (order_id, store_id, tenant_id, actor_kind, actor_id, event, data) values (${o.orderId}, ${o.storeId}, ${o.tenantId}, ${actorKind}, ${actorId}, ${ev}, ${data === undefined ? null : JSON.stringify(data)}::jsonb)`;

export async function insertOrder(q: Q, a: {
  storeId: string; tenantId: string; channel: 'loja' | 'pdv' | 'garcom' | 'ifood'; type: OrderType; lines: NonNullable<Awaited<ReturnType<typeof buildLines>>['lines']>;
  customerName: string; phone: string; address: string; zoneId: string | null; feeCents: number; table: number | null; note: string; payment: string; changeForCents: number | null;
  createdBy: string | null; paid?: boolean; status?: OrderStatus; customerId?: string | null;
  discountCents?: number; paidMethod?: string; external?: { provider: string; ref: string; data?: unknown };
}) {
  const subtotal = a.lines.reduce((s, l) => s + l.totalCents, 0);
  const discount = a.discountCents ?? 0;
  const total = subtotal + a.feeCents - discount;
  const number = await nextNumber(q, a.storeId, a.tenantId);
  const [o] = await q`insert into orders (store_id, tenant_id, number, channel, type, status, customer_name, customer_phone, address, zone_id, table_number, note,
      subtotal_cents, fee_cents, discount_cents, total_cents, payment_method, change_for_cents, paid, paid_at, paid_method, created_by, external_provider, external_ref, external_data, customer_id)
    values (${a.storeId}, ${a.tenantId}, ${number}, ${a.channel}, ${a.type}, ${a.status ?? 'novo'}, ${a.customerName}, ${a.phone}, ${a.address}, ${a.zoneId}, ${a.table}, ${a.note},
      ${subtotal}, ${a.feeCents}, ${discount}, ${total}, ${a.payment}, ${a.changeForCents}, ${!!a.paid}, ${a.paid ? new Date().toISOString() : null}, ${a.paid ? (a.paidMethod ?? a.payment) : null}, ${a.createdBy},
      ${a.external?.provider ?? null}, ${a.external?.ref ?? null}, ${a.external?.data === undefined ? null : JSON.stringify(a.external.data)}::jsonb, ${a.customerId ?? null})
    returning id, number, tracking_token, total_cents`;
  for (const l of a.lines) {
    await q`insert into order_items (order_id, store_id, tenant_id, product_id, name, qty, unit_cents, total_cents, note, addons, print_zone_id)
            values (${o!.id}, ${a.storeId}, ${a.tenantId}, ${l.productId}, ${l.name}, ${l.qty}, ${l.unitCents}, ${l.totalCents}, ${l.note}, ${JSON.stringify(l.addons)}::jsonb, ${l.zoneId})`;
  }
  await event(q, { orderId: o!.id, storeId: a.storeId, tenantId: a.tenantId }, a.channel === 'loja' ? 'customer' : 'staff', a.createdBy, 'created', { channel: a.channel, total: total });
  return { id: o!.id as string, number: o!.number as number, trackingToken: o!.tracking_token as string, totalCents: total };
}

/** O público só enxerga lojas no ar. Rascunho (desenvolvimento), suspensa e arquivada respondem como inexistentes. */
const publicStore = async (ctx: Ctx, slug: string) => { const s = await resolveStore(ctx, slug); return s && s.status === 'producao' ? s : null; };

export function orderRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---------------- público: a loja online ----------------
  const pub = '/v1/store/:slug';

  app.get(`${pub}`, async (req, reply) => {
    const store = await publicStore(ctx, (req.params as { slug: string }).slug);
    if (!store) return fail(reply, 404, 'not_found', 'Loja não encontrada.');
    return withTenant(ctx.pools, store.tenantId, async (q) => {
      const [settings] = await q`select data from store_settings where store_id = ${store.storeId}`;
      const [theme] = await q`select data from store_themes where store_id = ${store.storeId}`;
      const [land] = await q`select value from platform_public_settings where key = 'landing_url'`;
      return { name: store.name, status: store.status, open: getOpenStatus(settings?.data ?? {}), settings: settings?.data ?? {}, theme: theme?.data ?? {}, platform: { landingUrl: land?.value ?? '' } };
    });
  });

  app.get(`${pub}/menu`, async (req, reply) => {
    const store = await publicStore(ctx, (req.params as { slug: string }).slug);
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
      lines: z.array(lineIn).min(1).max(60),
    }), req.body, reply); if (!b) return;
    const store = await resolveStore(ctx, slug);
    if (!store || store.status !== 'producao') return fail(reply, 404, 'not_found', 'Loja não encontrada ou ainda não está no ar.');
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
      if (pay.online && !(await gatewayConfigured(ctx, store.storeId, pay.gateway))) return { ok: false as const, status: 422, code: 'payment_unavailable', message: 'O pagamento online está indisponível no momento. Escolha outra forma de pagamento.' };
      let fee = 0, zone: { id: string; name: string } | null = null;
      if (b.type === 'delivery') {
        if (!b.address) return { ok: false as const, status: 422, code: 'address_required', message: 'Informe o endereço de entrega.' };
        const [z] = b.zoneId ? await q`select id, name, fee from delivery_zones where id = ${b.zoneId} and store_id = ${store.storeId} and active` : [];
        if (!z) return { ok: false as const, status: 422, code: 'invalid_zone', message: 'Escolha uma região de entrega válida.' };
        fee = toCents(Number(z.fee)); zone = { id: z.id, name: z.name };
      }
      const total = subtotal + fee;
      if (pay.type === 'cash' && b.changeFor !== undefined && toCents(b.changeFor) < total) return { ok: false as const, status: 422, code: 'invalid_change', message: 'O valor para troco é menor que o total.' };
      const o = await insertOrder(q, { storeId: store.storeId, tenantId: store.tenantId, channel: 'loja', type: b.type, lines: built.lines!, customerName: b.customerName, phone: b.phone,
        address: zone ? `${b.address} — ${zone.name}` : '', zoneId: zone?.id ?? null, feeCents: fee, table: null, note: b.note, payment: pay.name,
        changeForCents: pay.type === 'cash' && b.changeFor !== undefined ? toCents(b.changeFor) : null, createdBy: null, status: pay.online ? 'aguardando' : 'novo', customerId: customer?.id ?? null });
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
  const itemRows = (q: Q, ids: string[]) => q`select order_id, name, qty, unit_cents, total_cents, note, addons, print_zone_id from order_items
                                               where order_id in (select x::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) x) order by created_at`;
  const orderCols = `id, number, channel, type, status, customer_name, customer_phone, address, table_number, note, subtotal_cents, fee_cents, discount_cents, total_cents,
                     payment_method, change_for_cents, paid, paid_at, courier_id, created_at, accepted_at, ready_at, dispatched_at, delivered_at, cancelled_at, cancel_reason`;
  void orderCols;

  app.get(S, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const s = req.staff!;
    const qs = parse(z.object({ status: z.string().optional(), open: z.enum(['1']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query, reply); if (!qs) return;
    // entregador só vê entregas; garçom só mesas e o que ele mesmo criou
    const perms = { pedidos: can(s.role, 'admin.pedidos') || can(s.role, 'pdv'), garcom: can(s.role, 'garcom'), motoboy: can(s.role, 'motoboy') };
    if (!perms.pedidos && !perms.garcom && !perms.motoboy) return fail(reply, 403, 'forbidden', 'Seu perfil não acessa pedidos.');
    return withTenant(ctx.pools, s.tenantId, async (q) => {
      const rows = await q`select id, number, channel, type, status, customer_name, customer_phone, address, table_number, note, subtotal_cents, fee_cents, discount_cents, total_cents,
          payment_method, change_for_cents, paid, paid_at, courier_id, created_at, accepted_at, ready_at, dispatched_at, delivered_at, cancelled_at, cancel_reason
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
      address: z.string().trim().max(200).default(''), zoneId: uuid.optional(), table: z.number().int().min(1).max(500).optional(), note: z.string().max(300).default(''),
      paymentId: uuid.optional(), receiveNow: z.boolean().default(false), lines: z.array(lineIn).min(1).max(60),
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
        let pay: Record<string, any> | undefined;
        if (b.paymentId) { [pay] = await q`select name from payment_methods where id = ${b.paymentId} and store_id = ${s.storeId} and active`; if (!pay) return { ok: false as const, status: 422, code: 'invalid_payment', message: 'Forma de pagamento indisponível.' }; }
        if (b.receiveNow && !pay) return { ok: false as const, status: 422, code: 'invalid_payment', message: 'Informe a forma de pagamento para receber.' };
        const o = await insertOrder(q, { storeId: s.storeId, tenantId: s.tenantId, channel, type: b.type, lines: built.lines!, customerName: b.customerName || (b.type === 'mesa' ? `Mesa ${b.table}` : 'Balcão'),
          phone: b.phone, address: zone ? `${b.address} — ${zone.name}` : '', zoneId: zone?.id ?? null, feeCents: fee, table: b.type === 'mesa' ? b.table! : null, note: b.note,
          payment: pay?.name ?? '', changeForCents: null, createdBy: s.staffId, paid: b.receiveNow, status: b.receiveNow ? 'preparo' : 'novo' });
        return { ok: true as const, o };
      });
      if (!out.ok) return fail(reply, out.status, out.code, out.message);
      await afterOrder(ctx, s, { kind: 'created', id: out.o.id, number: out.o.number, orderType: b.type, status: b.receiveNow ? 'preparo' : 'novo', print: b.receiveNow ? ['novo', 'preparo'] : ['novo'] });
      return reply.status(201).send({ id: out.o.id, number: out.o.number, totalCents: out.o.totalCents });
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
      const newIds: string[] = [];
      for (const l of built.lines!) {
        const [it] = await q`insert into order_items (order_id, store_id, tenant_id, product_id, name, qty, unit_cents, total_cents, note, addons, print_zone_id)
                values (${id}, ${s.storeId}, ${s.tenantId}, ${l.productId}, ${l.name}, ${l.qty}, ${l.unitCents}, ${l.totalCents}, ${l.note}, ${JSON.stringify(l.addons)}::jsonb, ${l.zoneId}) returning id`;
        newIds.push(it!.id as string);
      }
      const add = built.lines!.reduce((n, l) => n + l.totalCents, 0);
      const subtotal = o.subtotal_cents + add;
      await q`update orders set subtotal_cents = ${subtotal}, total_cents = ${subtotal + o.fee_cents - o.discount_cents},
              status = case when status in ('pronto') then 'preparo' else status end, ready_at = case when status = 'pronto' then null else ready_at end where id = ${id}`;
      await event(q, { orderId: id, storeId: s.storeId, tenantId: s.tenantId }, 'staff', s.staffId, 'items_added', { added: built.lines!.length, addedCents: add });
      return { ok: true as const, totalCents: subtotal + o.fee_cents - o.discount_cents, newIds, number: o.number as number };
    });
    if (!out.ok) return fail(reply, out.status, out.code, out.message);
    await afterOrder(ctx, s, { kind: 'items', id, number: out.number, orderType: 'mesa', status: 'preparo', print: ['items_added'], itemIds: out.newIds });
    return { ok: true, totalCents: out.totalCents };
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
    const b = parse(z.object({ paymentId: uuid }), req.body, reply); if (!b) return;
    const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [o] = await q`select id, type, status, paid, total_cents, number from orders where id = ${id} and store_id = ${s.storeId} for update`;
      if (!o) return { ok: false as const, status: 404, code: 'not_found', message: 'Pedido não encontrado.' };
      if (o.status === 'cancelado') return { ok: false as const, status: 422, code: 'cancelled', message: 'Pedido cancelado.' };
      if (o.paid) return { ok: false as const, status: 409, code: 'already_paid', message: 'Pedido já recebido.' };
      const [pay] = await q`select name from payment_methods where id = ${b.paymentId} and store_id = ${s.storeId} and active`;
      if (!pay) return { ok: false as const, status: 422, code: 'invalid_payment', message: 'Forma de pagamento indisponível.' };
      await q`update orders set paid = true, paid_at = now(), paid_method = ${pay.name}, payment_method = ${pay.name},
              status = case when status = 'aguardando' then 'novo' when type = 'mesa' then 'entregue' else status end,
              delivered_at = case when type = 'mesa' and status <> 'aguardando' then now() else delivered_at end where id = ${id}`;
      // o recebimento manual encerra qualquer cobrança online pendente deste pedido (evita pagar duas vezes)
      await q`update order_payments set status = 'cancelado' where order_id = ${id} and status = 'pendente'`;
      await event(q, { orderId: id, storeId: s.storeId, tenantId: s.tenantId }, 'staff', s.staffId, 'paid', { method: pay.name, totalCents: o.total_cents });
      return { ok: true as const, totalCents: o.total_cents as number, number: o.number as number, orderType: o.type as string, wasWaiting: o.status === 'aguardando' };
    });
    if (!out.ok) return fail(reply, out.status, out.code, out.message);
    await afterOrder(ctx, s, out.wasWaiting
      ? { kind: 'created', id, number: out.number, orderType: out.orderType, status: 'novo', print: ['novo'] }
      : { kind: 'paid', id, number: out.number, orderType: out.orderType, status: out.orderType === 'mesa' ? 'entregue' : 'novo' });
    return { ok: true, totalCents: out.totalCents };
  });

  // linha do tempo do pedido
  app.get(`${S}/:id/events`, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const s = req.staff!;
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    if (!(can(s.role, 'admin.pedidos') || can(s.role, 'pdv'))) return fail(reply, 403, 'forbidden', 'Seu perfil não acessa o histórico.');
    return { events: await withTenant(ctx.pools, s.tenantId, (q) => q`select at, actor_kind, event, data from order_events where order_id = ${id} and store_id = ${s.storeId} order by id`) };
  });
}
