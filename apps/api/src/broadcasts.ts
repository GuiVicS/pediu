import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, type Q } from '@pediu/db';
import { normalizePhone, renderTemplate } from '@pediu/shared';
import type { Ctx } from './context.js';
import { extensionGuard } from './extension.js';
import { audit, fail, parse } from './http.js';
import { staffGuard } from './staff.js';

const uuid = z.string().uuid();
/** Intervalo mínimo entre envios de uma loja e prazo para o resultado de um envio; vencido = incerto (nunca reenviado sozinho). */
export const MIN_GAP_MS = 20_000;
export const LEASE_MS = 2 * 60_000;

export function broadcastRoutes(app: FastifyInstance, ctx: Ctx) {
  const S = '/v1/staff/broadcasts';
  const featureOn = (s: { tenantId: string; storeId: string }) => withTenant(ctx.pools, s.tenantId, async (q) => !!(await q`select 1 as ok from store_features where store_id = ${s.storeId} and feature = 'broadcasts' and enabled`)[0]);
  const off = (reply: Parameters<typeof fail>[0]) => fail(reply, 403, 'feature_disabled', 'Disparos não liberados para esta loja.');

  // clientes que aceitaram receber mensagens (marcação feita pelo lojista, que garante o consentimento)
  app.put('/v1/staff/customers/:id/marketing', { preHandler: staffGuard(ctx, 'admin.pedidos') }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ optIn: z.boolean() }), req.body, reply); if (!b) return;
    const s = req.staff!;
    const n = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const r = await q`update store_customers set marketing_opt_in = ${b.optIn} where id = ${id} and store_id = ${s.storeId} returning id`;
      if (r.length) await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'customer.marketing_opt', ip: req.ip, meta: { id, optIn: b.optIn } });
      return r.length;
    });
    return n ? { ok: true } : fail(reply, 404, 'not_found', 'Cliente não encontrado.');
  });

  app.post(S, { preHandler: staffGuard(ctx, 'admin.pedidos') }, async (req, reply) => {
    const b = parse(z.object({ name: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(1000) }), req.body, reply); if (!b) return;
    const s = req.staff!;
    if (!(await featureOn(s))) return off(reply);
    const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [c] = await q`insert into broadcast_campaigns (store_id, tenant_id, name, body, created_by) values (${s.storeId}, ${s.tenantId}, ${b.name}, ${b.body}, ${s.staffId}) returning id`;
      const customers = await q`select id, name, phone from store_customers where store_id = ${s.storeId} and marketing_opt_in and phone <> ''`;
      const seen = new Set<string>(); let n = 0;
      for (const cu of customers) {
        const phone = normalizePhone(String(cu.phone));
        if (!phone || seen.has(phone)) continue;
        seen.add(phone); n++;
        await q`insert into broadcast_recipients (campaign_id, store_id, tenant_id, customer_id, name, phone) values (${c!.id}, ${s.storeId}, ${s.tenantId}, ${cu.id}, ${cu.name}, ${phone})`;
      }
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'broadcast.created', ip: req.ip, meta: { id: c!.id, recipients: n } });
      return { id: c!.id as string, recipients: n };
    });
    return reply.status(201).send(out);
  });

  app.get(S, { preHandler: staffGuard(ctx, 'admin.pedidos') }, async (req, reply) => {
    const s = req.staff!;
    if (!(await featureOn(s))) return off(reply);
    return { campaigns: await withTenant(ctx.pools, s.tenantId, (q) => q`
      select c.id, c.name, c.body, c.status, c.created_at,
        count(r.id)::int as total, count(r.id) filter (where r.status = 'enviada')::int as sent, count(r.id) filter (where r.status = 'falhou')::int as failed,
        count(r.id) filter (where r.status = 'incerta')::int as uncertain, count(r.id) filter (where r.status in ('pendente', 'enviando'))::int as pending
      from broadcast_campaigns c left join broadcast_recipients r on r.campaign_id = c.id where c.store_id = ${s.storeId} group by c.id order by c.created_at desc limit 50`) };
  });

  app.post(`${S}/:id/status`, { preHandler: staffGuard(ctx, 'admin.pedidos') }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ action: z.enum(['start', 'pause', 'cancel']) }), req.body, reply); if (!b) return;
    const s = req.staff!;
    if (!(await featureOn(s))) return off(reply);
    const next = { start: 'rodando', pause: 'pausada', cancel: 'cancelada' }[b.action];
    const n = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const r = await q`update broadcast_campaigns set status = ${next} where id = ${id} and store_id = ${s.storeId} and status not in ('cancelada', 'concluida') returning id`;
      if (r.length) await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: `broadcast.${b.action}`, ip: req.ip, meta: { id } });
      return r.length;
    });
    return n ? { ok: true, status: next } : fail(reply, 409, 'not_changeable', 'Campanha não encontrada ou já encerrada.');
  });

  // ---- a extensão pega um destinatário por vez ----
  const E = '/v1/extension/broadcasts';
  app.post(`${E}/next`, { preHandler: extensionGuard(ctx, 'broadcasts') }, async (req) => {
    const e = req.extension!;
    const now = ctx.clock.now();
    return withTenant(ctx.pools, e.tenantId, async (q: Q) => {
      // envio sem resultado dentro do prazo pode ter saído ou não: fica "incerto" e NUNCA é repetido sozinho
      await q`update broadcast_recipients set status = 'incerta', finished_at = ${now.toISOString()} where store_id = ${e.storeId} and status = 'enviando' and leased_at < ${new Date(now.getTime() - LEASE_MS).toISOString()}`;
      const [recent] = await q`select max(leased_at) as at from broadcast_recipients where store_id = ${e.storeId} and leased_at is not null`;
      const wait = recent?.at ? Math.ceil((new Date(recent.at as string).getTime() + MIN_GAP_MS - now.getTime()) / 1000) : 0;
      if (wait > 0) return { none: true as const, waitSeconds: wait };
      const [r] = await q`
        update broadcast_recipients set status = 'enviando', leased_at = ${now.toISOString()}
        where id = (select r.id from broadcast_recipients r join broadcast_campaigns c on c.id = r.campaign_id
                     where r.store_id = ${e.storeId} and r.status = 'pendente' and c.status = 'rodando' order by r.id limit 1 for update of r skip locked)
        returning id, campaign_id, phone, name`;
      if (!r) {
        await q`update broadcast_campaigns c set status = 'concluida' where c.store_id = ${e.storeId} and c.status = 'rodando'
                and not exists (select 1 from broadcast_recipients r where r.campaign_id = c.id and r.status in ('pendente', 'enviando'))`;
        return { none: true as const, waitSeconds: 0 };
      }
      const [c] = await q`select body from broadcast_campaigns where id = ${r.campaign_id}`;
      return { none: false as const, recipientId: r.id as string, phone: r.phone as string, text: renderTemplate(String(c!.body), { cliente: String(r.name).split(' ')[0] ?? '' }) };
    });
  });

  app.post(`${E}/:id/result`, { preHandler: extensionGuard(ctx, 'broadcasts') }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ status: z.enum(['enviada', 'falhou']), error: z.string().max(200).optional() }), req.body, reply); if (!b) return;
    const e = req.extension!;
    const n = await withTenant(ctx.pools, e.tenantId, async (q) =>
      (await q`update broadcast_recipients set status = ${b.status}, error = ${b.error ?? null}, finished_at = now() where id = ${id} and store_id = ${e.storeId} and status in ('enviando', 'incerta') returning id`).length);
    return n ? { ok: true } : fail(reply, 409, 'not_changeable', 'Destinatário não está aguardando resultado.');
  });
}
