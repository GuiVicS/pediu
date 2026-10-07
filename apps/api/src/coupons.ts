import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, type Q } from '@pediu/db';
import type { Ctx } from './context.js';
import { loadCustomer, publicStore } from './customers.js';
import { lineSchema } from './extensionStore.js';
import { audit, fail, parse } from './http.js';
import { buildLines } from './orders.js';
import { staffGuard } from './staff.js';

const uuid = z.string().uuid();
const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
export const phoneKey = (phone: string) => { const d = phone.replace(/\D/g, ''); return d.length >= 8 ? d.slice(-8) : ''; };

export type CouponResult =
  | { ok: true; couponId: string; code: string; description: string; discountCents: number }
  | { ok: false; error: string };

/**
 * Regras do cupom, sempre no servidor: ativo, janela de datas, público (todos ou clientes escolhidos), pedido mínimo,
 * limite total e por cliente (conta ou telefone). O desconto vale só sobre os itens (nunca sobre a taxa de entrega).
 * Com `lock`, trava a linha do cupom para que dois pedidos simultâneos não estourem o limite.
 */
export async function evaluateCoupon(ctx: Ctx, q: Q, storeId: string, a: { code: string; subtotalCents: number; customerId: string | null; phone: string; lock?: boolean }): Promise<CouponResult> {
  const code = a.code.trim().toUpperCase();
  const [c] = a.lock
    ? await q`select * from coupons where store_id = ${storeId} and code = ${code} for update`
    : await q`select * from coupons where store_id = ${storeId} and code = ${code}`;
  const invalid = { ok: false as const, error: 'Cupom inválido ou indisponível.' };
  if (!c || !c.active) return invalid;
  const now = ctx.clock.now().getTime();
  if (c.starts_at && new Date(c.starts_at).getTime() > now) return { ok: false, error: 'Este cupom ainda não começou.' };
  if (c.ends_at && new Date(c.ends_at).getTime() <= now) return { ok: false, error: 'Este cupom expirou.' };
  if (c.audience === 'selected') {
    if (!a.customerId) return { ok: false, error: 'Este cupom é exclusivo: entre na sua conta para usá-lo.' };
    const [m] = await q`select 1 as ok from coupon_customers where coupon_id = ${c.id} and customer_id = ${a.customerId}`;
    if (!m) return invalid;
  }
  if (c.min_order_cents && a.subtotalCents < c.min_order_cents) return { ok: false, error: `Este cupom vale para pedidos a partir de ${brl(c.min_order_cents)}.` };
  if (c.max_uses && c.used_count >= c.max_uses) return { ok: false, error: 'Este cupom esgotou.' };
  if (c.max_uses_per_customer) {
    const key = phoneKey(a.phone);
    const [u] = await q`select count(*)::int as n from coupon_redemptions where coupon_id = ${c.id} and released_at is null
                        and ((${a.customerId}::uuid is not null and customer_id = ${a.customerId}) or (${key} <> '' and phone_key = ${key}))`;
    if (u!.n >= c.max_uses_per_customer) return { ok: false, error: 'Você já usou este cupom o máximo de vezes permitido.' };
  }
  let d = c.kind === 'percent' ? Math.floor((a.subtotalCents * c.percent) / 100) : c.amount_cents;
  if (c.max_discount_cents) d = Math.min(d, c.max_discount_cents);
  d = Math.min(d, a.subtotalCents);
  if (d <= 0) return invalid;
  return { ok: true, couponId: c.id, code: c.code, description: c.description, discountCents: d };
}

/** Registra o uso (dentro da mesma transação que cria o pedido). O cancelamento devolve o uso por gatilho no banco. */
export async function redeemCoupon(q: Q, a: { couponId: string; storeId: string; tenantId: string; orderId: string; code: string; customerId: string | null; phone: string; discountCents: number }) {
  await q`insert into coupon_redemptions (coupon_id, store_id, tenant_id, order_id, customer_id, phone_key, discount_cents)
          values (${a.couponId}, ${a.storeId}, ${a.tenantId}, ${a.orderId}, ${a.customerId}, ${phoneKey(a.phone)}, ${a.discountCents})`;
  await q`update coupons set used_count = used_count + 1 where id = ${a.couponId}`;
  await q`update orders set coupon_code = ${a.code} where id = ${a.orderId}`;
}

const couponBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,20}$/, 'Use de 3 a 20 letras, números, _ ou -.'),
  description: z.string().trim().max(120).default(''),
  kind: z.enum(['percent', 'fixed']),
  percent: z.number().int().min(1).max(100).optional(),
  amountCents: z.number().int().min(1).max(10_000_00).optional(),
  maxDiscountCents: z.number().int().min(1).max(10_000_00).nullable().default(null),
  minOrderCents: z.number().int().min(0).max(100_000_00).default(0),
  startsAt: z.string().datetime().nullable().default(null),
  endsAt: z.string().datetime().nullable().default(null),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
  maxUsesPerCustomer: z.number().int().min(1).max(1000).nullable().default(null),
  audience: z.enum(['all', 'selected']).default('all'),
  active: z.boolean().default(true),
}).superRefine((v, ctx) => {
  if (v.kind === 'percent' && !v.percent) ctx.addIssue({ code: 'custom', message: 'Informe a porcentagem (1 a 100).', path: ['percent'] });
  if (v.kind === 'fixed' && !v.amountCents) ctx.addIssue({ code: 'custom', message: 'Informe o valor do desconto.', path: ['amountCents'] });
  if (v.startsAt && v.endsAt && new Date(v.endsAt) <= new Date(v.startsAt)) ctx.addIssue({ code: 'custom', message: 'O fim deve ser depois do início.', path: ['endsAt'] });
});
const isUnique = (e: unknown) => (e as { code?: string })?.code === '23505';

const listSql = (q: Q, storeId: string) => q`
  select c.id, c.code, c.description, c.kind, c.percent, c.amount_cents, c.max_discount_cents, c.min_order_cents, c.starts_at, c.ends_at, c.max_uses,
         c.max_uses_per_customer, c.audience, c.active, c.used_count, c.created_at,
         (select count(*)::int from coupon_customers x where x.coupon_id = c.id) as customers,
         (select coalesce(sum(r.discount_cents), 0)::int from coupon_redemptions r where r.coupon_id = c.id and r.released_at is null) as discount_total_cents
  from coupons c where c.store_id = ${storeId} order by c.created_at desc`;

export function couponRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---- cliente: simula o desconto no checkout (nada é gravado) ----
  app.post('/v1/store/:slug/coupons/validate', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({ code: z.string().trim().min(1).max(30), phone: z.string().max(20).default(''), lines: z.array(lineSchema).min(1).max(60) }), req.body, reply); if (!b) return;
    const store = await publicStore(ctx, (req.params as { slug: string }).slug);
    if (!store) return fail(reply, 404, 'not_found', 'Loja não encontrada.');
    const customer = await loadCustomer(ctx, req, store);
    const out = await withTenant(ctx.pools, store.tenantId, async (q) => {
      const built = await buildLines(q, store.storeId, b.lines.map((l) => ({ productId: l.productId, qty: l.qty, note: l.note ?? '', addons: l.addons ?? [] })));
      if ('error' in built) return { ok: false as const, error: built.error! };
      const subtotalCents = built.lines!.reduce((s, l) => s + l.totalCents, 0);
      const r = await evaluateCoupon(ctx, q, store.storeId, { code: b.code, subtotalCents, customerId: customer?.id ?? null, phone: b.phone });
      return r.ok ? { ...r, subtotalCents } : r;
    });
    return out.ok ? out : fail(reply, 422, 'coupon_invalid', out.error);
  });

  // ---- cliente logado: cupons exclusivos dele ----
  app.get('/v1/store/:slug/customer/coupons', async (req, reply) => {
    const store = await publicStore(ctx, (req.params as { slug: string }).slug);
    if (!store) return fail(reply, 404, 'not_found', 'Loja não encontrada.');
    const customer = await loadCustomer(ctx, req, store);
    if (!customer) return fail(reply, 401, 'unauthenticated', 'Entre na sua conta para ver seus cupons.');
    const now = ctx.clock.now().toISOString();
    const rows = await withTenant(ctx.pools, store.tenantId, (q) => q`
      select c.code, c.description, c.kind, c.percent, c.amount_cents, c.max_discount_cents, c.min_order_cents, c.ends_at
      from coupons c join coupon_customers x on x.coupon_id = c.id
      where c.store_id = ${store.storeId} and x.customer_id = ${customer.id} and c.active and (c.starts_at is null or c.starts_at <= ${now}::timestamptz) and (c.ends_at is null or c.ends_at > ${now}::timestamptz)
        and (c.max_uses is null or c.used_count < c.max_uses)
        and (c.max_uses_per_customer is null or (select count(*) from coupon_redemptions r where r.coupon_id = c.id and r.customer_id = ${customer.id} and r.released_at is null) < c.max_uses_per_customer)
      order by c.created_at desc`);
    return { coupons: rows };
  });

  // ---- lojista: gestão de cupons ----
  const S = '/v1/staff/coupons';
  app.get(S, { preHandler: staffGuard(ctx, 'admin.loja') }, async (req) => {
    const s = req.staff!;
    return { coupons: await withTenant(ctx.pools, s.tenantId, (q) => listSql(q, s.storeId)) };
  });

  const save = (idParam: boolean) => async (req: any, reply: any) => {
    const b = parse(couponBody, req.body, reply); if (!b) return;
    const s = req.staff!;
    const id = idParam ? parse(uuid, (req.params as { id: string }).id, reply) : null; if (idParam && !id) return;
    try {
      const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
        if (id) {
          const r = await q`update coupons set code = ${b.code}, description = ${b.description}, kind = ${b.kind}, percent = ${b.kind === 'percent' ? b.percent! : null}, amount_cents = ${b.kind === 'fixed' ? b.amountCents! : null},
              max_discount_cents = ${b.maxDiscountCents}, min_order_cents = ${b.minOrderCents}, starts_at = ${b.startsAt}, ends_at = ${b.endsAt}, max_uses = ${b.maxUses},
              max_uses_per_customer = ${b.maxUsesPerCustomer}, audience = ${b.audience}, active = ${b.active} where id = ${id} and store_id = ${s.storeId} returning id`;
          if (!r.length) return null;
          await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'coupon.updated', ip: req.ip, meta: { id, code: b.code } });
          return id;
        }
        const [r] = await q`insert into coupons (store_id, tenant_id, code, description, kind, percent, amount_cents, max_discount_cents, min_order_cents, starts_at, ends_at, max_uses, max_uses_per_customer, audience, active)
            values (${s.storeId}, ${s.tenantId}, ${b.code}, ${b.description}, ${b.kind}, ${b.kind === 'percent' ? b.percent! : null}, ${b.kind === 'fixed' ? b.amountCents! : null}, ${b.maxDiscountCents}, ${b.minOrderCents},
                    ${b.startsAt}, ${b.endsAt}, ${b.maxUses}, ${b.maxUsesPerCustomer}, ${b.audience}, ${b.active}) returning id`;
        await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'coupon.created', ip: req.ip, meta: { id: r!.id, code: b.code } });
        return r!.id as string;
      });
      if (!out) return fail(reply, 404, 'not_found', 'Cupom não encontrado.');
      return idParam ? { ok: true } : reply.status(201).send({ id: out });
    } catch (e) {
      if (isUnique(e)) return fail(reply, 409, 'code_taken', 'Já existe um cupom com este código.');
      throw e;
    }
  };
  app.post(S, { preHandler: staffGuard(ctx, 'admin.loja') }, save(false));
  app.put(`${S}/:id`, { preHandler: staffGuard(ctx, 'admin.loja') }, save(true));

  // apaga só cupom nunca usado; com histórico, o caminho é desativar
  app.delete(`${S}/:id`, { preHandler: staffGuard(ctx, 'admin.loja') }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const s = req.staff!;
    const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [c] = await q`select id, used_count from coupons where id = ${id} and store_id = ${s.storeId}`;
      if (!c) return 'missing' as const;
      const [h] = await q`select 1 as ok from coupon_redemptions where coupon_id = ${id} limit 1`;
      if (h) return 'used' as const;
      await q`delete from coupons where id = ${id}`;
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'coupon.deleted', ip: req.ip, meta: { id } });
      return 'ok' as const;
    });
    if (out === 'missing') return fail(reply, 404, 'not_found', 'Cupom não encontrado.');
    return out === 'used' ? fail(reply, 409, 'coupon_used', 'Este cupom já foi usado: desative-o em vez de apagar.') : { ok: true };
  });

  // clientes que podem usar um cupom exclusivo
  app.get(`${S}/:id/customers`, { preHandler: staffGuard(ctx, 'admin.loja') }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const s = req.staff!;
    const rows = await withTenant(ctx.pools, s.tenantId, (q) => q`
      select c.id, c.name, c.email from coupon_customers x join store_customers c on c.id = x.customer_id where x.coupon_id = ${id} and x.store_id = ${s.storeId} order by c.name, c.email`);
    return { customers: rows };
  });
  app.put(`${S}/:id/customers`, { preHandler: staffGuard(ctx, 'admin.loja') }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ customerIds: z.array(uuid).max(2000) }), req.body, reply); if (!b) return;
    const s = req.staff!;
    const n = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [c] = await q`select id from coupons where id = ${id} and store_id = ${s.storeId} for update`;
      if (!c) return null;
      await q`delete from coupon_customers where coupon_id = ${id}`;
      // só clientes DESTA loja entram (qualquer outro id é ignorado)
      const valid = await q`select id from store_customers where store_id = ${s.storeId} and id in (select x::uuid from jsonb_array_elements_text(${JSON.stringify(b.customerIds)}::jsonb) x)`;
      for (const v of valid) await q`insert into coupon_customers (coupon_id, store_id, tenant_id, customer_id) values (${id}, ${s.storeId}, ${s.tenantId}, ${v.id})`;
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'coupon.customers_set', ip: req.ip, meta: { id, count: valid.length } });
      return valid.length;
    });
    return n === null ? fail(reply, 404, 'not_found', 'Cupom não encontrado.') : { ok: true, count: n };
  });
}
