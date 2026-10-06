import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withPlatform, type Q } from '@pediu/db';
import type { Ctx } from './context.js';
import { fail, parse } from './http.js';
import { guard } from './session.js';
import { staffGuard } from './staff.js';
import { withTenant } from '@pediu/db';
import { BUCKET_LIMITS, percentileFromBuckets } from './telemetry.js';

const TZ = 'America/Sao_Paulo';
const uuid = z.string().uuid();
const NO_STORE = '00000000-0000-0000-0000-000000000000';
const iso = (d: Date) => d.toISOString();

/** Definições: faturamento = pedidos não cancelados; ticket médio = faturamento / pedidos; cancelamento = cancelados / todos. */
export async function storeStats(q: Q, storeIds: string[] | null, from: Date, to: Date) {
  const ids = storeIds ? JSON.stringify(storeIds) : null;
  return q`
    select o.store_id,
      count(*)::int as orders,
      count(*) filter (where o.status = 'cancelado')::int as cancelled,
      coalesce(sum(o.total_cents) filter (where o.status <> 'cancelado'), 0)::bigint as revenue_cents,
      coalesce(avg(o.total_cents) filter (where o.status <> 'cancelado'), 0)::float as avg_ticket_cents,
      avg(extract(epoch from (o.accepted_at - o.created_at)) / 60) filter (where o.accepted_at is not null)::float as avg_accept_min,
      avg(extract(epoch from (o.ready_at - o.accepted_at)) / 60) filter (where o.ready_at is not null and o.accepted_at is not null)::float as avg_prep_min,
      avg(extract(epoch from (o.delivered_at - o.created_at)) / 60) filter (where o.type = 'delivery' and o.delivered_at is not null)::float as avg_delivery_min
    from orders o
    where o.created_at >= ${iso(from)}::timestamptz and o.created_at < ${iso(to)}::timestamptz
      and (${ids}::text is null or o.store_id in (select x::uuid from jsonb_array_elements_text(${ids}::jsonb) x))
    group by o.store_id`;
}
const round = (n: number | null, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);
export const shape = (r: Record<string, any> | undefined) => ({
  orders: r?.orders ?? 0, cancelled: r?.cancelled ?? 0, cancelRate: r?.orders ? round(r.cancelled / r.orders, 3) : 0,
  revenueCents: Number(r?.revenue_cents ?? 0), avgTicketCents: Math.round(r?.avg_ticket_cents ?? 0),
  avgAcceptMin: round(r?.avg_accept_min ?? null), avgPrepMin: round(r?.avg_prep_min ?? null), avgDeliveryMin: round(r?.avg_delivery_min ?? null),
});
const delta = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? 0 : null) : round((cur - prev) / prev, 3));

export function analyticsRoutes(app: FastifyInstance, ctx: Ctx) {
  const P = '/v1/platform';
  const days = z.coerce.number().int().min(1).max(90).default(7);

  // ---- ranking de lojas (período atual × anterior) ----
  app.get(`${P}/analytics/stores`, { preHandler: guard(ctx) }, async (req, reply) => {
    const qs = parse(z.object({ days }), req.query, reply); if (!qs) return;
    const now = ctx.clock.now(), from = new Date(now.getTime() - qs.days * 86_400_000), prevFrom = new Date(from.getTime() - qs.days * 86_400_000);
    return withPlatform(ctx.pools, async (q) => {
      const stores = await q`select s.id, s.slug, s.name, s.status, t.name as tenant_name from stores s join tenants t on t.id = s.tenant_id where s.status <> 'arquivada' order by s.name`;
      const cur = new Map((await storeStats(q, null, from, now)).map((r) => [r.store_id, r]));
      const prev = new Map((await storeStats(q, null, prevFrom, from)).map((r) => [r.store_id, r]));
      const rows = stores.map((s) => {
        const c = shape(cur.get(s.id)), p = shape(prev.get(s.id));
        return { id: s.id, slug: s.slug, name: s.name, status: s.status, tenant: s.tenant_name, ...c, previous: { orders: p.orders, revenueCents: p.revenueCents }, change: { orders: delta(c.orders, p.orders), revenue: delta(c.revenueCents, p.revenueCents) } };
      }).sort((a, b) => b.revenueCents - a.revenueCents);
      const open = await q`select store_id, count(*)::int as n from alerts where status <> 'resolved' and store_id is not null group by store_id`;
      const alerts = new Map(open.map((r) => [r.store_id, r.n]));
      return { periodDays: qs.days, from: iso(from), to: iso(now), stores: rows.map((r) => ({ ...r, openAlerts: alerts.get(r.id) ?? 0 })) };
    });
  });

  // ---- detalhe de uma loja ----
  app.get(`${P}/analytics/stores/:id`, { preHandler: guard(ctx) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const qs = parse(z.object({ days }), req.query, reply); if (!qs) return;
    const now = ctx.clock.now(), from = new Date(now.getTime() - qs.days * 86_400_000), prevFrom = new Date(from.getTime() - qs.days * 86_400_000);
    const out = await withPlatform(ctx.pools, async (q) => {
      const [store] = await q`select s.id, s.slug, s.name, s.status, t.id as tenant_id, t.name as tenant_name from stores s join tenants t on t.id = s.tenant_id where s.id = ${id}`;
      if (!store) return null;
      const [cur] = await storeStats(q, [id], from, now), [prev] = await storeStats(q, [id], prevFrom, from);
      const c = shape(cur), p = shape(prev);
      const f = iso(from), t = iso(now);
      const byDay = await q`select to_char(date_trunc('day', created_at at time zone ${TZ}), 'YYYY-MM-DD') as day, count(*)::int as orders,
          coalesce(sum(total_cents) filter (where status <> 'cancelado'), 0)::bigint as revenue_cents, count(*) filter (where status = 'cancelado')::int as cancelled
        from orders where store_id = ${id} and created_at >= ${f}::timestamptz and created_at < ${t}::timestamptz group by 1 order by 1`;
      const byHour = await q`select extract(hour from created_at at time zone ${TZ})::int as hour, count(*)::int as orders
        from orders where store_id = ${id} and status <> 'cancelado' and created_at >= ${f}::timestamptz and created_at < ${t}::timestamptz group by 1 order by 1`;
      const byChannel = await q`select channel, type, count(*)::int as orders, coalesce(sum(total_cents), 0)::bigint as revenue_cents
        from orders where store_id = ${id} and status <> 'cancelado' and created_at >= ${f}::timestamptz and created_at < ${t}::timestamptz group by channel, type order by revenue_cents desc`;
      const byPayment = await q`select coalesce(nullif(payment_method, ''), '—') as method, count(*)::int as orders, coalesce(sum(total_cents), 0)::bigint as revenue_cents
        from orders where store_id = ${id} and status <> 'cancelado' and created_at >= ${f}::timestamptz and created_at < ${t}::timestamptz group by 1 order by revenue_cents desc`;
      const top = await q`select i.name, sum(i.qty)::int as qty, sum(i.total_cents)::bigint as revenue_cents
        from order_items i join orders o on o.id = i.order_id
        where i.store_id = ${id} and o.status <> 'cancelado' and o.created_at >= ${f}::timestamptz and o.created_at < ${t}::timestamptz group by i.name order by revenue_cents desc limit 10`;
      const cancels = await q`select coalesce(nullif(cancel_reason, ''), '—') as reason, count(*)::int as n from orders
        where store_id = ${id} and status = 'cancelado' and created_at >= ${f}::timestamptz and created_at < ${t}::timestamptz group by 1 order by n desc limit 5`;
      const api = await q`select coalesce(sum(count), 0)::int as requests, coalesce(sum(errors), 0)::int as errors, coalesce(sum(sum_ms), 0)::bigint as sum_ms,
          coalesce(sum(b0), 0)::int as b0, coalesce(sum(b1), 0)::int as b1, coalesce(sum(b2), 0)::int as b2, coalesce(sum(b3), 0)::int as b3, coalesce(sum(b4), 0)::int as b4, coalesce(sum(b5), 0)::int as b5, coalesce(sum(b6), 0)::int as b6
        from metrics_minute where store_id = ${id} and bucket >= ${f}::timestamptz`;
      const a = api[0]!;
      const hist = [a.b0, a.b1, a.b2, a.b3, a.b4, a.b5, a.b6].map(Number);
      const alerts = await q`select id, rule_key, severity, title, status, first_seen, last_seen, occurrences from alerts where store_id = ${id} and status <> 'resolved' order by last_seen desc`;
      return {
        store, periodDays: qs.days, ...c, previous: p, change: { orders: delta(c.orders, p.orders), revenue: delta(c.revenueCents, p.revenueCents) },
        byDay: byDay.map((r) => ({ ...r, revenue_cents: Number(r.revenue_cents) })), byHour, byChannel: byChannel.map((r) => ({ ...r, revenue_cents: Number(r.revenue_cents) })),
        byPayment: byPayment.map((r) => ({ ...r, revenue_cents: Number(r.revenue_cents) })), topProducts: top.map((r) => ({ ...r, revenue_cents: Number(r.revenue_cents) })), cancelReasons: cancels,
        api: { requests: a.requests, errors: a.errors, errorRate: a.requests ? round(a.errors / a.requests, 4) : 0, avgMs: a.requests ? Math.round(Number(a.sum_ms) / a.requests) : null, p95Ms: percentileFromBuckets(hist, 0.95) },
        openAlerts: alerts,
      };
    });
    return out ?? fail(reply, 404, 'not_found', 'Loja não encontrada.');
  });

  // ---- visão geral da plataforma ----
  app.get(`${P}/analytics/overview`, { preHandler: guard(ctx) }, async (req, reply) => {
    const qs = parse(z.object({ days: z.coerce.number().int().min(1).max(90).default(1) }), req.query, reply); if (!qs) return;
    const now = ctx.clock.now(), from = new Date(now.getTime() - qs.days * 86_400_000), prevFrom = new Date(from.getTime() - qs.days * 86_400_000);
    return withPlatform(ctx.pools, async (q) => {
      const byStatus = await q`select status, count(*)::int as n from stores group by status`;
      const sum = (rows: Record<string, any>[]) => rows.reduce((a, r) => ({ orders: a.orders + r.orders, cancelled: a.cancelled + r.cancelled, revenue: a.revenue + Number(r.revenue_cents) }), { orders: 0, cancelled: 0, revenue: 0 });
      const c = sum(await storeStats(q, null, from, now)), p = sum(await storeStats(q, null, prevFrom, from));
      const active = await q`select count(distinct store_id)::int as n from orders where created_at >= ${iso(from)}::timestamptz and status <> 'cancelado'`;
      const [subs] = await q`select coalesce(sum(case when interval = 'year' then round(amount_cents / 12.0) else amount_cents end) filter (where status = 'active'), 0)::bigint as mrr,
          count(*) filter (where status = 'active')::int as active, count(*) filter (where status = 'trialing')::int as trialing, count(*) filter (where status in ('past_due', 'unpaid'))::int as past_due from subscriptions`;
      const [al] = await q`select count(*) filter (where severity = 'critical')::int as critical, count(*) filter (where severity = 'warn')::int as warn, count(*) filter (where severity = 'info')::int as info
        from alerts where status <> 'resolved'`;
      const [pend] = await q`select count(*)::int as n from publication_requests where status = 'pendente'`;
      return {
        periodDays: qs.days, stores: Object.fromEntries(byStatus.map((r) => [r.status, r.n])), storesWithOrders: active[0]!.n,
        orders: c.orders, revenueCents: c.revenue, cancelRate: c.orders ? round(c.cancelled / c.orders, 3) : 0, avgTicketCents: c.orders - c.cancelled ? Math.round(c.revenue / (c.orders - c.cancelled)) : 0,
        change: { orders: delta(c.orders, p.orders), revenue: delta(c.revenue, p.revenue) },
        subscriptions: { mrrCents: Number(subs!.mrr), active: subs!.active, trialing: subs!.trialing, pastDue: subs!.past_due },
        openAlerts: al!, pendingPublications: pend!.n,
      };
    });
  });

  // ---- saúde técnica (últimos minutos) ----
  app.get(`${P}/health`, { preHandler: guard(ctx) }, async (req, reply) => {
    const qs = parse(z.object({ minutes: z.coerce.number().int().min(5).max(360).default(60) }), req.query, reply); if (!qs) return;
    const now = ctx.clock.now(), from = new Date(now.getTime() - qs.minutes * 60_000);
    return withPlatform(ctx.pools, async (q) => {
      const series = await q`select bucket, sum(count)::int as requests, sum(errors)::int as errors, sum(sum_ms)::bigint as sum_ms,
          sum(b0)::int as b0, sum(b1)::int as b1, sum(b2)::int as b2, sum(b3)::int as b3, sum(b4)::int as b4, sum(b5)::int as b5, sum(b6)::int as b6
        from metrics_minute where scope in ('platform', 'store', 'webhook') and bucket >= ${iso(from)}::timestamptz group by bucket order by bucket`;
      const pts = series.map((r) => ({ at: r.bucket, requests: r.requests, errors: r.errors, avgMs: r.requests ? Math.round(Number(r.sum_ms) / r.requests) : null, p95Ms: percentileFromBuckets([r.b0, r.b1, r.b2, r.b3, r.b4, r.b5, r.b6].map(Number), 0.95) }));
      const tot = series.reduce((a: { n: number; e: number; h: number[] }, r) => ({ n: a.n + r.requests, e: a.e + r.errors, h: a.h.map((x: number, i: number) => x + Number(r[`b${i}`])) }), { n: 0, e: 0, h: [0, 0, 0, 0, 0, 0, 0] });
      const routes = await q`select route, method, sum(count)::int as requests, sum(errors)::int as errors, round(sum(sum_ms)::numeric / nullif(sum(count), 0))::int as avg_ms, max(max_ms)::int as max_ms
        from metrics_minute where scope in ('platform', 'store', 'webhook') and bucket >= ${iso(from)}::timestamptz group by route, method order by sum(errors) desc, sum(sum_ms) desc limit 15`;
      const [wh] = await q`select count(*)::int as n from webhook_inbox where processed_at is null and received_at < ${iso(new Date(now.getTime() - 10 * 60_000))}::timestamptz`;
      const [al] = await q`select count(*)::int as n from alerts where status = 'open'`;
      return { minutes: qs.minutes, requests: tot.n, errors: tot.e, errorRate: tot.n ? round(tot.e / tot.n, 4) : 0, p95Ms: percentileFromBuckets(tot.h, 0.95), series: pts, slowestRoutes: routes,
        webhooksStuck: wh!.n, openAlerts: al!.n, telemetryDropped: ctx.telemetry?.dropped ?? 0, latencyBucketsMs: BUCKET_LIMITS };
    });
  });
}

/** Painel do lojista: o dia e os últimos 7 dias da PRÓPRIA loja (a conta vem da sessão; RLS impede olhar outra). */
export function staffDashboardRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/v1/staff/dashboard', { preHandler: staffGuard(ctx, 'admin.dashboard') }, async (req) => {
    const s = req.staff!;
    const now = ctx.clock.now();
    const startOfDay = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) + 'T00:00:00-03:00');
    const from7 = new Date(now.getTime() - 7 * 86_400_000);
    return withTenant(ctx.pools, s.tenantId, async (q) => {
      const [today] = await storeStats(q, [s.storeId], startOfDay, now);
      const [week] = await storeStats(q, [s.storeId], from7, now);
      const f = iso(from7), t = iso(now);
      const open = await q`select status, count(*)::int as n from orders where store_id = ${s.storeId} and status not in ('entregue', 'cancelado') group by status`;
      const byHour = await q`select extract(hour from created_at at time zone ${TZ})::int as hour, count(*)::int as orders from orders
        where store_id = ${s.storeId} and status <> 'cancelado' and created_at >= ${iso(startOfDay)}::timestamptz group by 1 order by 1`;
      const top = await q`select i.name, sum(i.qty)::int as qty, sum(i.total_cents)::bigint as revenue_cents from order_items i join orders o on o.id = i.order_id
        where i.store_id = ${s.storeId} and o.status <> 'cancelado' and o.created_at >= ${f}::timestamptz and o.created_at < ${t}::timestamptz group by i.name order by qty desc limit 5`;
      const byChannel = await q`select channel, count(*)::int as orders, coalesce(sum(total_cents), 0)::bigint as revenue_cents from orders
        where store_id = ${s.storeId} and status <> 'cancelado' and created_at >= ${f}::timestamptz group by channel order by revenue_cents desc`;
      const [toReceive] = await q`select count(*)::int as n, coalesce(sum(total_cents), 0)::bigint as cents from orders where store_id = ${s.storeId} and not paid and status not in ('cancelado', 'aguardando')`;
      return {
        today: shape(today), week: shape(week), open: Object.fromEntries(open.map((r) => [r.status, r.n])), byHour,
        topProducts: top.map((r) => ({ ...r, revenue_cents: Number(r.revenue_cents) })), byChannel: byChannel.map((r) => ({ ...r, revenue_cents: Number(r.revenue_cents) })),
        toReceive: { orders: toReceive!.n, cents: Number(toReceive!.cents) },
      };
    });
  });
}
