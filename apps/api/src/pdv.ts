import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, type Q } from '@pediu/db';
import type { Ctx } from './context.js';
import { evaluateCoupon } from './coupons.js';
import { audit, fail, parse } from './http.js';
import { staffGuard } from './staff.js';

type PayType = 'pix' | 'cash' | 'credit' | 'debit' | 'voucher';

/** Informações de pagamento gravadas no pedido. `mode`: tela = QR/online (gateway); externo = maquininha, dinheiro e afins (o sistema só registra). */
export interface PayInfo { name: string; type: PayType; mode: 'tela' | 'externo'; receivedCents: number | null; changeCents: number | null; ref: string | null }

/**
 * Valida a forma de pagamento do PDV. Dinheiro: o valor recebido não pode ser menor que o total e o troco é calculado aqui, nunca confiado à tela.
 * Os demais tipos (maquininha, vale, Pix manual) não têm troco; a referência (autorização/NSU) é opcional.
 */
export async function resolvePayInfo(q: Q, storeId: string, paymentId: string, totalCents: number, input: { receivedCents?: number; reference?: string }): Promise<PayInfo | { error: string }> {
  const [pm] = await q`select name, type from payment_methods where id = ${paymentId} and store_id = ${storeId} and active`;
  if (!pm) return { error: 'Forma de pagamento indisponível.' };
  if (pm.type === 'cash') {
    const received = input.receivedCents ?? totalCents;               // sem valor informado = recebeu exatamente o total
    if (received < totalCents) return { error: 'O valor recebido é menor que o total do pedido.' };
    return { name: pm.name, type: 'cash', mode: 'externo', receivedCents: received, changeCents: received - totalCents, ref: null };
  }
  const ref = input.reference?.trim() ? input.reference.trim().slice(0, 40) : null;
  return { name: pm.name, type: pm.type, mode: 'externo', receivedCents: null, changeCents: null, ref };
}

/** Turno de caixa aberto do operador (null se não abriu). Os recebimentos feitos por ele entram nesse turno. */
export async function openCashSessionId(q: Q, storeId: string, staffId: string): Promise<string | null> {
  const [s] = await q`select id from cash_sessions where store_id = ${storeId} and opened_by = ${staffId} and closed_at is null`;
  return (s?.id as string | undefined) ?? null;
}

/** Resumo do turno: vendas por forma de pagamento, totais, cancelamentos e a conta do dinheiro (abertura + vendas em dinheiro). */
export async function cashSummary(q: Q, storeId: string, sessionId: string, openingCents: number) {
  const by = await q`select coalesce(paid_type, 'outros') as type, coalesce(nullif(paid_method, ''), 'Outros') as method, count(*)::int as orders, coalesce(sum(total_cents), 0)::bigint as cents
    from orders where store_id = ${storeId} and cash_session_id = ${sessionId} and paid and status <> 'cancelado' group by 1, 2 order by cents desc`;
  const [tot] = await q`select count(*)::int as orders, coalesce(sum(total_cents), 0)::bigint as cents, count(distinct coalesce(customer_id::text, nullif(customer_phone, ''))) ::int as customers
    from orders where store_id = ${storeId} and cash_session_id = ${sessionId} and paid and status <> 'cancelado'`;
  const [items] = await q`select coalesce(sum(i.qty), 0)::int as n from order_items i join orders o on o.id = i.order_id and o.store_id = i.store_id
    where o.store_id = ${storeId} and o.cash_session_id = ${sessionId} and o.paid and o.status <> 'cancelado'`;
  const [canc] = await q`select count(*)::int as orders, coalesce(sum(total_cents), 0)::bigint as cents from orders where store_id = ${storeId} and cash_session_id = ${sessionId} and paid and status = 'cancelado'`;
  const cashSales = by.filter((r) => r.type === 'cash').reduce((s, r) => s + Number(r.cents), 0);
  const revenue = Number(tot!.cents), orders = tot!.orders as number;
  return {
    byMethod: by.map((r) => ({ type: r.type as string, method: r.method as string, orders: r.orders as number, cents: Number(r.cents) })),
    totals: { orders, revenueCents: revenue, avgTicketCents: orders ? Math.round(revenue / orders) : 0, itemsSold: items!.n as number, customers: tot!.customers as number },
    cancelled: { orders: canc!.orders as number, cents: Number(canc!.cents) },
    cash: { openingCents, salesCents: cashSales, expectedCents: openingCents + cashSales },
  };
}

const DENOMS = ['100', '50', '20', '10', '5', '2', '1', '0.5', '0.25', '0.1', '0.05'] as const;
const breakdownCents = (b: Record<string, number>) => Object.entries(b).reduce((s, [k, n]) => s + Math.round(Number(k) * 100) * n, 0);
const sessionOut = (r: Record<string, any>) => ({
  id: r.id, openedBy: r.opened_by_name, openedAt: r.opened_at, openingCents: r.opening_cents, openingBreakdown: r.opening_breakdown,
  closedAt: r.closed_at, countedCents: r.counted_cents, expectedCents: r.expected_cents, differenceCents: r.difference_cents, note: r.note,
});

export function pdvRoutes(app: FastifyInstance, ctx: Ctx) {
  const pdv = staffGuard(ctx, 'pdv');

  // ---- turno de caixa ----
  app.get('/v1/staff/cash/current', { preHandler: pdv }, async (req) => {
    const s = req.staff!;
    return withTenant(ctx.pools, s.tenantId, async (q) => {
      const [r] = await q`select * from cash_sessions where store_id = ${s.storeId} and opened_by = ${s.staffId} and closed_at is null`;
      return r ? { session: sessionOut(r), summary: await cashSummary(q, s.storeId, r.id, r.opening_cents) } : { session: null, summary: null };
    });
  });

  app.post('/v1/staff/cash/open', { preHandler: pdv }, async (req, reply) => {
    const s = req.staff!;
    const b = parse(z.object({
      openingCents: z.number().int().min(0).max(100_000_000),
      breakdown: z.record(z.enum(DENOMS), z.number().int().min(0).max(9999)).default({}),
    }), req.body, reply); if (!b) return;
    if (Object.keys(b.breakdown).length && breakdownCents(b.breakdown) !== b.openingCents) return fail(reply, 400, 'breakdown_mismatch', 'O detalhamento de cédulas e moedas não bate com o valor de abertura.');
    const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
      if (await openCashSessionId(q, s.storeId, s.staffId)) return { error: true as const };
      const [r] = await q`insert into cash_sessions (store_id, tenant_id, opened_by, opened_by_name, opening_cents, opening_breakdown, opened_at)
        values (${s.storeId}, ${s.tenantId}, ${s.staffId}, ${s.name}, ${b.openingCents}, ${JSON.stringify(b.breakdown)}::jsonb, ${ctx.clock.now().toISOString()}::timestamptz) returning *`;
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'cash.opened', ip: req.ip, meta: { openingCents: b.openingCents } });
      return { r: r! };
    });
    if ('error' in out) return fail(reply, 409, 'already_open', 'Você já tem um caixa aberto.');
    return reply.status(201).send({ session: sessionOut(out.r) });
  });

  app.post('/v1/staff/cash/close', { preHandler: pdv }, async (req, reply) => {
    const s = req.staff!;
    const b = parse(z.object({ countedCents: z.number().int().min(0).max(100_000_000), note: z.string().trim().max(300).default('') }), req.body, reply); if (!b) return;
    const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [cur] = await q`select * from cash_sessions where store_id = ${s.storeId} and opened_by = ${s.staffId} and closed_at is null for update`;
      if (!cur) return null;
      const summary = await cashSummary(q, s.storeId, cur.id, cur.opening_cents);
      const expected = summary.cash.expectedCents, diff = b.countedCents - expected;
      const [r] = await q`update cash_sessions set closed_at = ${ctx.clock.now().toISOString()}::timestamptz, closed_by = ${s.staffId}, counted_cents = ${b.countedCents}, expected_cents = ${expected},
        difference_cents = ${diff}, note = ${b.note}, summary = ${JSON.stringify(summary)}::jsonb where id = ${cur.id} returning *`;
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'cash.closed', ip: req.ip, meta: { expectedCents: expected, countedCents: b.countedCents, differenceCents: diff } });
      return { session: sessionOut(r!), summary };
    });
    return out ?? fail(reply, 404, 'no_open_cash', 'Não há caixa aberto para fechar.');
  });

  // ---- cupom no PDV: prévia do desconto com as mesmas regras da vitrine ----
  app.post('/v1/staff/coupons/check', { preHandler: pdv, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const s = req.staff!;
    const b = parse(z.object({ code: z.string().trim().min(1).max(30), subtotalCents: z.number().int().min(0).max(100_000_000), customerId: z.string().uuid().optional(), phone: z.string().max(20).default('') }), req.body, reply); if (!b) return;
    const r = await withTenant(ctx.pools, s.tenantId, async (q) => {
      if (b.customerId) { const [c] = await q`select 1 as ok from store_customers where id = ${b.customerId} and store_id = ${s.storeId}`; if (!c) return { ok: false as const, error: 'Cliente não encontrado.' }; }
      return evaluateCoupon(ctx, q, s.storeId, { code: b.code, subtotalCents: b.subtotalCents, customerId: b.customerId ?? null, phone: b.phone });
    });
    return r.ok ? { ok: true, code: r.code, description: r.description, discountCents: r.discountCents } : fail(reply, 422, 'coupon_invalid', r.error);
  });

  // ---- cupom impresso: status por setor (tela "pedido finalizado") ----
  app.get('/v1/staff/print/orders/:id/jobs', { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const s = req.staff!;
    const id = parse(z.string().uuid(), (req.params as { id: string }).id, reply); if (!id) return;
    if (!(s.role === 'admin' || s.role === 'gerente' || s.role === 'suporte' || s.role === 'balcao')) return fail(reply, 403, 'forbidden', 'Seu perfil não vê as impressões.');
    const jobs = await withTenant(ctx.pools, s.tenantId, (q) => q`
      select j.id, j.kind, j.status, j.created_at, j.printed_at, j.last_error, coalesce(z.name, 'Padrão') as zone
      from print_jobs j left join print_zones z on z.id = j.zone_id where j.order_id = ${id} and j.store_id = ${s.storeId} order by j.created_at`);
    return { jobs };
  });
}
