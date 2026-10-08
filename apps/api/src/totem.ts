import { randomBytes, randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { withTenant, type Q } from '@pediu/db';
import { hashToken } from '@pediu/shared';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { loadMenu } from './menu.js';
import { afterOrder } from './orderHooks.js';
import { appendItems, buildLines, insertOrder, lineIn, orderEvent } from './orders.js';
import { bus } from './realtime.js';
import { staffGuard } from './staff.js';

/**
 * Totem de mesa: um tablet pareado a UMA mesa, em que o próprio cliente pede.
 * O aparelho não tem sessão de funcionário: recebe um token (cookie httpOnly) que só lê o cardápio e a comanda daquela mesa,
 * envia itens para ela, chama o garçom e pede a conta. Tudo exige a funcionalidade 'table_totem' liberada no super admin.
 */
export const TOTEM_COOKIE = 'pediu_totem';
const FEATURE = 'table_totem';
const PAIR_TTL_MIN = 15;
const codeHash = (storeId: string, code: string) => hashToken(`totem:${storeId}:${code}`);

interface Totem { id: string; storeId: string; tenantId: string; table: number; name: string }

const featureOn = (ctx: Ctx, tenantId: string, storeId: string) =>
  withTenant(ctx.pools, tenantId, async (q) => !!(await q`select 1 as ok from store_features where store_id = ${storeId} and feature = ${FEATURE} and enabled`)[0]);

async function loadTotem(ctx: Ctx, req: FastifyRequest): Promise<Totem | null> {
  const token = req.cookies[TOTEM_COOKIE];
  if (!token) return null;
  const [t] = await ctx.pools.app.begin((q) => q`select * from app.totem_by_token(${hashToken(token)})`);
  return t ? { id: t.id, storeId: t.store_id, tenantId: t.tenant_id, table: t.table_number, name: t.name } : null;
}

/** Guarda do aparelho: token válido + funcionalidade liberada. */
const totemGuard = (ctx: Ctx) => async (req: FastifyRequest, reply: FastifyReply) => {
  const t = await loadTotem(ctx, req);
  if (!t) return fail(reply, 401, 'not_paired', 'Este aparelho não está pareado. Peça para a equipe parear o totem.');
  if (!(await featureOn(ctx, t.tenantId, t.storeId))) return fail(reply, 403, 'feature_off', 'O totem de mesa não está liberado para esta loja.');
  (req as FastifyRequest & { totem?: Totem }).totem = t;
};
const totemOf = (req: FastifyRequest) => (req as FastifyRequest & { totem: Totem }).totem;

const openComanda = (q: Q, t: Totem) => q`select id, number, status, subtotal_cents, fee_cents, discount_cents, total_cents, bill_requested_at, created_at from orders
  where store_id = ${t.storeId} and type = 'mesa' and table_number = ${t.table} and status not in ('entregue', 'cancelado') for update`;

export function totemRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---------------- equipe: parear e gerenciar os totens ----------------
  const S = '/v1/staff/totems';
  const adm = staffGuard(ctx, 'admin.loja');
  const needFeature = async (s: { tenantId: string; storeId: string }, reply: FastifyReply) =>
    (await featureOn(ctx, s.tenantId, s.storeId)) ? true : (fail(reply, 403, 'feature_off', 'O totem de mesa não está liberado para esta loja. Fale com o suporte.'), false);

  app.get(S, { preHandler: adm }, async (req) => {
    const s = req.staff!;
    const enabled = await featureOn(ctx, s.tenantId, s.storeId);
    const totems = await withTenant(ctx.pools, s.tenantId, (q) => q`select id, table_number, name, paired_at, last_seen_at, pair_expires_at, created_at from store_totems
      where store_id = ${s.storeId} and revoked_at is null order by table_number, created_at`);
    return { enabled, totems };
  });

  // novo totem (ou novo código para um totem existente): devolve o código de 6 dígitos para digitar no tablet
  app.post(S, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!;
    const b = parse(z.object({ table: z.number().int().min(1).max(500), name: z.string().trim().max(60).default(''), id: z.string().uuid().optional() }), req.body, reply); if (!b) return;
    if (!(await needFeature(s, reply))) return;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expires = new Date(ctx.clock.now().getTime() + PAIR_TTL_MIN * 60_000).toISOString();
    const row = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [r] = b.id
        ? await q`update store_totems set table_number = ${b.table}, name = ${b.name}, pair_code_hash = ${codeHash(s.storeId, code)}, pair_expires_at = ${expires}, token_hash = null, paired_at = null
                  where id = ${b.id} and store_id = ${s.storeId} and revoked_at is null returning id`
        : await q`insert into store_totems (store_id, tenant_id, table_number, name, pair_code_hash, pair_expires_at, created_by)
                  values (${s.storeId}, ${s.tenantId}, ${b.table}, ${b.name}, ${codeHash(s.storeId, code)}, ${expires}, ${s.staffId}) returning id`;
      if (r) await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'totem.pair_code', ip: req.ip, meta: { totemId: r.id, table: b.table } });
      return r;
    });
    if (!row) return fail(reply, 404, 'not_found', 'Totem não encontrado.');
    return reply.status(201).send({ id: row.id, code, expiresAt: expires });
  });

  app.delete(`${S}/:id`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!; const id = parse(z.string().uuid(), (req.params as { id: string }).id, reply); if (!id) return;
    const n = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const r = await q`update store_totems set revoked_at = now(), token_hash = null, pair_code_hash = null where id = ${id} and store_id = ${s.storeId} and revoked_at is null returning id`;
      if (r.length) await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'totem.revoked', ip: req.ip, meta: { totemId: id } });
      return r.length;
    });
    return n ? { ok: true } : fail(reply, 404, 'not_found', 'Totem não encontrado.');
  });

  // ---------------- aparelho: parear com o código ----------------
  const T = '/v1/totem';
  app.post(`${T}/pair`, { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({ code: z.string().regex(/^\d{6}$/, 'O código tem 6 dígitos.') }), req.body, reply); if (!b) return;
    // o código é por loja: a loja vem do domínio pelo qual o tablet abriu (o edge repassa o host)
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0]!.split(':')[0]!.trim().toLowerCase();
    const [st] = await ctx.pools.app.begin((q) => q`select store_id from app.resolve_store_by_host(${host})`);
    if (!st) return fail(reply, 404, 'not_found', 'Loja não encontrada para este endereço.');
    const token = randomBytes(32).toString('base64url');
    const [t] = await ctx.pools.app.begin((q) => q`select * from app.totem_pair(${codeHash(st.store_id, b.code)}, ${hashToken(token)})`);
    if (!t) return fail(reply, 401, 'invalid_code', 'Código inválido ou vencido. Gere outro no painel (Loja e entrega → Totens de mesa).');
    if (!(await featureOn(ctx, t.tenant_id, t.store_id))) return fail(reply, 403, 'feature_off', 'O totem de mesa não está liberado para esta loja.');
    reply.setCookie(TOTEM_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: ctx.cookieSecure, path: '/', maxAge: 365 * 24 * 3600 });
    return { table: t.table_number };
  });

  const g = { preHandler: totemGuard(ctx) };
  app.get(`${T}/me`, g, async (req) => {
    const t = totemOf(req);
    const [s] = await withTenant(ctx.pools, t.tenantId, (q) => q`select s.name, s.slug, th.data as theme from stores s left join store_themes th on th.store_id = s.id where s.id = ${t.storeId}`);
    return { table: t.table, name: t.name, store: { name: s?.name, slug: s?.slug, logoUrl: s?.theme?.logoUrl ?? '', primary: s?.theme?.primary ?? null } };
  });
  app.get(`${T}/menu`, g, async (req) => { const t = totemOf(req); return withTenant(ctx.pools, t.tenantId, (q) => loadMenu(q, t.storeId)); });

  // a conta da mesa (sem dados de outras mesas nem do cliente)
  app.get(`${T}/comanda`, g, async (req) => {
    const t = totemOf(req);
    return withTenant(ctx.pools, t.tenantId, async (q) => {
      const [o] = await q`select id, number, status, total_cents, bill_requested_at, created_at from orders
        where store_id = ${t.storeId} and type = 'mesa' and table_number = ${t.table} and status not in ('entregue', 'cancelado')`;
      if (!o) return { comanda: null };
      const items = await q`select name, qty, total_cents, note, addons, created_at from order_items where order_id = ${o.id} order by created_at`;
      return { comanda: { number: o.number, status: o.status, totalCents: o.total_cents, billRequested: !!o.bill_requested_at, items } };
    });
  });

  // pedir: abre a comanda da mesa ou acrescenta uma rodada (vai para a cozinha e impressão como o pedido do garçom)
  app.post(`${T}/orders`, { ...g, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const t = totemOf(req);
    const b = parse(z.object({ lines: z.array(lineIn).min(1).max(40) }), req.body, reply); if (!b) return;
    try {
      const out = await withTenant(ctx.pools, t.tenantId, async (q) => {
        const built = await buildLines(q, t.storeId, b.lines);
        if ('error' in built) return { ok: false as const, message: built.error! };
        const [o] = await openComanda(q, t);
        if (o) {
          const r = await appendItems(q, { id: o.id, storeId: t.storeId, tenantId: t.tenantId, subtotalCents: o.subtotal_cents, feeCents: o.fee_cents, discountCents: o.discount_cents }, built.lines!, { kind: 'customer', id: null });
          return { ok: true as const, kind: 'items' as const, id: o.id as string, number: o.number as number, itemIds: r.newIds, totalCents: r.totalCents };
        }
        const n = await insertOrder(q, { storeId: t.storeId, tenantId: t.tenantId, channel: 'totem', type: 'mesa', lines: built.lines!, customerName: `Mesa ${t.table}`, phone: '', address: '',
          zoneId: null, feeCents: 0, table: t.table, note: '', payment: '', changeForCents: null, createdBy: null });
        return { ok: true as const, kind: 'created' as const, id: n.id, number: n.number, itemIds: [] as string[], totalCents: n.totalCents };
      });
      if (!out.ok) return fail(reply, 422, 'invalid_items', out.message);
      await afterOrder(ctx, { tenantId: t.tenantId, storeId: t.storeId }, out.kind === 'created'
        ? { kind: 'created', id: out.id, number: out.number, orderType: 'mesa', status: 'novo', print: ['novo'] }
        : { kind: 'items', id: out.id, number: out.number, orderType: 'mesa', status: 'preparo', print: ['items_added'], itemIds: out.itemIds });
      return reply.status(201).send({ ok: true, totalCents: out.totalCents });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return fail(reply, 409, 'retry', 'A mesa acabou de ser aberta por outro aparelho. Toque em enviar de novo.');
      throw e;
    }
  });

  // chamar o garçom ou pedir a conta: o app do garçom recebe na hora (vibra) e a conta pedida aparece no mapa e no PDV
  app.post(`${T}/call`, { ...g, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    const t = totemOf(req);
    const b = parse(z.object({ kind: z.enum(['garcom', 'conta']) }), req.body, reply); if (!b) return;
    const o = await withTenant(ctx.pools, t.tenantId, async (q) => {
      const [c] = await openComanda(q, t);
      if (c && b.kind === 'conta') {
        await q`update orders set bill_requested_at = now() where id = ${c.id}`;
        await orderEvent(q, { orderId: c.id, storeId: t.storeId, tenantId: t.tenantId }, 'customer', null, 'bill_requested', { via: 'totem' });
      }
      return c ?? null;
    });
    if (b.kind === 'conta' && !o) return fail(reply, 409, 'no_comanda', 'Ainda não há consumo nesta mesa.');
    bus.emit(t.storeId, { type: 'call', table: t.table, kind: b.kind });
    if (o) await afterOrder(ctx, { tenantId: t.tenantId, storeId: t.storeId }, { kind: 'status', id: o.id, number: o.number, orderType: 'mesa', status: o.status, print: [] });
    return { ok: true };
  });
}
