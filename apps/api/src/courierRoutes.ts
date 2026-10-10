import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@pediu/db';
import { planStops } from '@pediu/shared';
import type { Ctx } from './context.js';
import { fail, parse } from './http.js';
import { syncStatusToIfood } from './ifood.js';
import { afterOrder } from './orderHooks.js';
import { orderEvent } from './orders.js';
import { staffGuard } from './staff.js';

const ids = z.array(z.string().uuid()).min(1).max(12);

/**
 * Rotas do entregador: assumir várias entregas prontas de uma vez, já em ordem de parada.
 * Cada entrega continua sendo um pedido normal (status "saiu", dono = entregador); a rota só guarda a ordem (route_id/route_stop).
 */
export function courierRoutes(app: FastifyInstance, ctx: Ctx) {
  const R = '/v1/staff/routes';
  const guard = staffGuard(ctx, 'motoboy');

  // sugere a ordem das paradas (sem assumir nada)
  app.post(`${R}/suggest`, { preHandler: guard }, async (req, reply) => {
    const s = req.staff!; const b = parse(z.object({ orderIds: ids }), req.body, reply); if (!b) return;
    const rows = await withTenant(ctx.pools, s.tenantId, (q) => q`
      select id, number, address, customer_name, fee_cents, total_cents, paid, payment_method from orders
      where store_id = ${s.storeId} and id = any(${b.orderIds}::uuid[]) and type = 'delivery' and status = 'pronto' and courier_id is null`);
    const stops = planStops(rows.map((r) => ({ id: r.id as string, number: r.number as number, address: r.address as string })));
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    return {
      stops: stops.map((p) => ({ ...p, customerName: byId.get(p.id)!.customer_name as string, feeCents: byId.get(p.id)!.fee_cents as number, toCollectCents: byId.get(p.id)!.paid ? 0 : (byId.get(p.id)!.total_cents as number) })),
      unavailable: b.orderIds.filter((id) => !byId.has(id)),      // alguém já assumiu, ainda não ficou pronta ou não é entrega
    };
  });

  // inicia a rota: assume todas as entregas ainda livres, na ordem recebida. Quem já foi assumido por outro fica de fora (e é avisado).
  app.post(R, { preHandler: guard }, async (req, reply) => {
    const s = req.staff!; const b = parse(z.object({ orderIds: ids }), req.body, reply); if (!b) return;
    if (new Set(b.orderIds).size !== b.orderIds.length) return fail(reply, 400, 'invalid_input', 'Pedido repetido na rota.');
    const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const rows = await q`select id, number, type, status, courier_id from orders where store_id = ${s.storeId} and id = any(${b.orderIds}::uuid[]) order by id for update`;
      const byId = new Map(rows.map((r) => [r.id as string, r]));
      const free = b.orderIds.filter((id) => { const o = byId.get(id); return o && o.type === 'delivery' && o.status === 'pronto' && !o.courier_id; });
      if (free.length === 0) return { ok: false as const };
      const routeId = randomUUID();
      for (const [i, id] of free.entries()) {
        await q`update orders set status = 'saiu', dispatched_at = now(), courier_id = ${s.staffId}::uuid, route_id = ${routeId}::uuid, route_stop = ${i + 1} where id = ${id}`;
        await orderEvent(q, { orderId: id, storeId: s.storeId, tenantId: s.tenantId }, 'staff', s.staffId, 'status:saiu', { from: 'pronto', route: { id: routeId, stop: i + 1, of: free.length } });
      }
      return { ok: true as const, routeId, taken: free.map((id) => ({ id, number: byId.get(id)!.number as number })), unavailable: b.orderIds.filter((id) => !free.includes(id)).map((id) => ({ id, number: (byId.get(id)?.number ?? null) as number | null })) };
    });
    if (!out.ok) return fail(reply, 409, 'taken', 'Nenhuma destas entregas está mais disponível (outro entregador já assumiu ou ainda não estão prontas).');
    for (const t of out.taken) {
      await afterOrder(ctx, s, { kind: 'status', id: t.id, number: t.number, orderType: 'delivery', status: 'saiu', print: [] });
      await syncStatusToIfood(ctx, { storeId: s.storeId, orderId: t.id, to: 'saiu', type: 'delivery' });
    }
    return reply.status(201).send({ routeId: out.routeId, stops: out.taken, unavailable: out.unavailable });
  });

  // reordenar as paradas que ainda faltam (a rota é do próprio entregador)
  app.put(`${R}/:routeId/order`, { preHandler: guard }, async (req, reply) => {
    const s = req.staff!; const routeId = parse(z.string().uuid(), (req.params as { routeId: string }).routeId, reply); if (!routeId) return;
    const b = parse(z.object({ orderIds: ids }), req.body, reply); if (!b) return;
    const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const rows = await q`select id, route_stop from orders where store_id = ${s.storeId} and route_id = ${routeId}::uuid and courier_id = ${s.staffId}::uuid and status = 'saiu' order by route_stop for update`;
      const open = rows.map((r) => r.id as string);
      if (open.length === 0) return 'none' as const;
      if (b.orderIds.some((id) => !open.includes(id))) return 'foreign' as const;
      // as paradas pedidas vão para os mesmos "lugares" (números) que já ocupavam; quem não foi citado mantém a ordem depois delas
      const next = [...b.orderIds, ...open.filter((id) => !b.orderIds.includes(id))];
      const slots = rows.map((r) => r.route_stop as number);
      for (const [i, id] of next.entries()) await q`update orders set route_stop = ${slots[i]!} where id = ${id}`;
      return 'ok' as const;
    });
    if (out === 'none') return fail(reply, 404, 'not_found', 'Rota não encontrada ou já concluída.');
    if (out === 'foreign') return fail(reply, 422, 'invalid_input', 'Há pedidos que não fazem parte desta rota (ou já foram entregues).');
    return { ok: true };
  });
}
