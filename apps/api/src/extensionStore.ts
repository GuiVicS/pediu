import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, type Q } from '@pediu/db';
import { renderTemplate } from '@pediu/shared';
import type { Ctx } from './context.js';
import { extensionGuard } from './extension.js';
import { audit, fail, parse } from './http.js';
import { lookupOrder, quote, replyVars, searchMenu, storeSnapshot, type LineIn } from './storeInfo.js';
import { resolveStore, staffGuard } from './staff.js';

const uuid = z.string().uuid();
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export const lineSchema = z.object({
  productId: uuid, qty: z.number().int().min(1).max(50), note: z.string().max(200).optional(),
  addons: z.array(z.object({ groupId: uuid, addonIds: z.array(uuid).max(30) })).max(20).optional(),
});
export const quoteSchema = z.object({ type: z.enum(['delivery', 'retirada']), zoneId: uuid.optional(), lines: z.array(lineSchema).min(1).max(30) });

/** Cria o rascunho (já validado pelo mesmo cálculo do checkout) e devolve o link para o cliente finalizar. */
export async function createDraft(ctx: Ctx, q: Q, a: { tenantId: string; storeId: string; chatId?: string; type: 'delivery' | 'retirada'; zoneId?: string; lines: LineIn[] }) {
  const qt = await quote(ctx, q, a.storeId, a);
  if (!qt.ok) return qt;
  const token = randomBytes(24).toString('base64url');
  await q`insert into order_drafts (token, store_id, tenant_id, type, zone_id, lines, chat_id, expires_at)
          values (${token}, ${a.storeId}, ${a.tenantId}, ${a.type}, ${a.zoneId ?? null}, ${JSON.stringify(a.lines)}::jsonb, ${a.chatId ?? null}, ${new Date(ctx.clock.now().getTime() + DRAFT_TTL_MS).toISOString()})`;
  const snap = await storeSnapshot(ctx, q, a.storeId);
  return { ...qt, link: `${snap.link}/?rascunho=${token}` };
}

export function extensionStoreRoutes(app: FastifyInstance, ctx: Ctx) {
  const E = '/v1/extension';

  app.get(`${E}/store`, { preHandler: extensionGuard(ctx, 'whatsapp_support') }, async (req) => {
    const e = req.extension!;
    return withTenant(ctx.pools, e.tenantId, (q) => storeSnapshot(ctx, q, e.storeId));
  });

  app.get(`${E}/menu`, { preHandler: extensionGuard(ctx, 'whatsapp_support') }, async (req, reply) => {
    const b = parse(z.object({ q: z.string().max(80).default('') }), req.query, reply); if (!b) return;
    const e = req.extension!;
    return { items: await withTenant(ctx.pools, e.tenantId, (q) => searchMenu(q, e.storeId, b.q, 30)) };
  });

  app.post(`${E}/quote`, { preHandler: extensionGuard(ctx, 'whatsapp_support') }, async (req, reply) => {
    const b = parse(quoteSchema, req.body, reply); if (!b) return;
    const e = req.extension!;
    const r = await withTenant(ctx.pools, e.tenantId, (q) => quote(ctx, q, e.storeId, b));
    return r.ok ? r : fail(reply, 422, 'invalid_quote', r.error);
  });

  // pedido só é revelado com número + telefone conferindo (o telefone do WhatsApp não prova identidade sozinho)
  app.post(`${E}/orders/lookup`, { preHandler: extensionGuard(ctx, 'whatsapp_support') }, async (req, reply) => {
    const b = parse(z.object({ number: z.number().int().min(1), phone: z.string().min(8).max(20) }), req.body, reply); if (!b) return;
    const e = req.extension!;
    const o = await withTenant(ctx.pools, e.tenantId, (q) => lookupOrder(q, e.storeId, b.number, b.phone));
    return o ? { order: o } : fail(reply, 404, 'not_found', 'Pedido não encontrado para este telefone.');
  });

  app.post(`${E}/drafts`, { preHandler: extensionGuard(ctx, 'order_draft') }, async (req, reply) => {
    const b = parse(quoteSchema.extend({ chatId: z.string().max(80).optional() }), req.body, reply); if (!b) return;
    const e = req.extension!;
    const r = await withTenant(ctx.pools, e.tenantId, (q) => createDraft(ctx, q, { ...b, tenantId: e.tenantId, storeId: e.storeId }));
    return r.ok ? reply.status(201).send(r) : fail(reply, 422, 'invalid_draft', r.error);
  });

  // ---- respostas rápidas ----
  app.get(`${E}/quick-replies`, { preHandler: extensionGuard(ctx, 'quick_replies') }, async (req, reply) => {
    const b = parse(z.object({ customerName: z.string().max(80).default('') }), req.query, reply); if (!b) return;
    const e = req.extension!;
    return withTenant(ctx.pools, e.tenantId, async (q) => {
      const vars = replyVars(await storeSnapshot(ctx, q, e.storeId), b.customerName);
      const rows = await q`select id, title, body from quick_replies where store_id = ${e.storeId} and active order by sort, created_at`;
      return { replies: rows.map((r) => ({ id: r.id as string, title: r.title as string, text: renderTemplate(r.body as string, vars) })) };
    });
  });

  const S = '/v1/staff/quick-replies';
  const body = z.object({ title: z.string().trim().min(1).max(60), body: z.string().trim().min(1).max(1000), sort: z.number().int().min(0).max(999).default(0), active: z.boolean().default(true) });
  const featureOn = async (s: { tenantId: string; storeId: string }) => withTenant(ctx.pools, s.tenantId, async (q) => !!(await q`select 1 as ok from store_features where store_id = ${s.storeId} and feature = 'quick_replies' and enabled`)[0]);

  app.get(S, { preHandler: staffGuard(ctx, 'admin.pedidos') }, async (req, reply) => {
    const s = req.staff!;
    if (!(await featureOn(s))) return fail(reply, 403, 'feature_disabled', 'Respostas rápidas não liberadas para esta loja.');
    return { replies: await withTenant(ctx.pools, s.tenantId, (q) => q`select id, title, body, sort, active from quick_replies where store_id = ${s.storeId} order by sort, created_at`) };
  });
  app.post(S, { preHandler: staffGuard(ctx, 'admin.pedidos') }, async (req, reply) => {
    const b = parse(body, req.body, reply); if (!b) return;
    const s = req.staff!;
    if (!(await featureOn(s))) return fail(reply, 403, 'feature_disabled', 'Respostas rápidas não liberadas para esta loja.');
    const id = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [r] = await q`insert into quick_replies (store_id, tenant_id, title, body, sort, active) values (${s.storeId}, ${s.tenantId}, ${b.title}, ${b.body}, ${b.sort}, ${b.active}) returning id`;
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'quick_reply.created', ip: req.ip, meta: { id: r!.id } });
      return r!.id as string;
    });
    return reply.status(201).send({ id });
  });
  app.put(`${S}/:id`, { preHandler: staffGuard(ctx, 'admin.pedidos') }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(body, req.body, reply); if (!b) return;
    const s = req.staff!;
    const n = await withTenant(ctx.pools, s.tenantId, async (q) => (await q`update quick_replies set title = ${b.title}, body = ${b.body}, sort = ${b.sort}, active = ${b.active} where id = ${id} and store_id = ${s.storeId} returning id`).length);
    return n ? { ok: true } : fail(reply, 404, 'not_found', 'Resposta não encontrada.');
  });
  app.delete(`${S}/:id`, { preHandler: staffGuard(ctx, 'admin.pedidos') }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const s = req.staff!;
    const n = await withTenant(ctx.pools, s.tenantId, async (q) => (await q`delete from quick_replies where id = ${id} and store_id = ${s.storeId} returning id`).length);
    return n ? { ok: true } : fail(reply, 404, 'not_found', 'Resposta não encontrada.');
  });

  // ---- rascunho aberto pelo cliente (público, por token; só ids e quantidades) ----
  app.get('/v1/store/:slug/drafts/:token', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { slug, token } = req.params as { slug: string; token: string };
    const store = await resolveStore(ctx, slug);
    if (!store || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return fail(reply, 404, 'not_found', 'Rascunho não encontrado.');
    const [d] = await ctx.pools.app.begin((q) => q`select * from app.order_draft(${token}, ${ctx.clock.now().toISOString()}::timestamptz)`);
    if (d && d.store_id !== store.storeId) return fail(reply, 404, 'not_found', 'Rascunho não encontrado.');
    return d ? { type: d.type, zoneId: d.zone_id, lines: d.lines } : fail(reply, 404, 'not_found', 'Rascunho não encontrado ou vencido.');
  });
}
