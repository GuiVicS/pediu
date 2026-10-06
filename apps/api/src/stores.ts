import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withPlatform, type Q } from '@pediu/db';
import { checkTransition, generateToken, hashPassword, Slug, STORE_STATUS, type StoreStatus } from '@pediu/shared';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { guard } from './session.js';

const uuid = z.string().uuid();
const isUnique = (e: unknown) => (e as { code?: string })?.code === '23505';

type Applied = { ok: true; before: StoreStatus; after: StoreStatus } | { ok: false; status: number; code: string; message: string };

/** Troca o status respeitando as regras de @pediu/shared. Usada pela rota de status e pela aprovação de publicação. */
export async function applyStatus(q: Q, storeId: string, to: StoreStatus, o: { adminId: string; ip: string; reason?: string; waiverReason?: string }): Promise<Applied> {
  const [s] = await q`select id, tenant_id, status from stores where id = ${storeId} for update`;
  if (!s) return { ok: false, status: 404, code: 'not_found', message: 'Loja não encontrada.' };
  const [sub] = await q`select 1 as ok from subscriptions where tenant_id = ${s.tenant_id} and status in ('active', 'trialing') limit 1`;
  const r = checkTransition(s.status, to, { actor: { kind: 'superadmin', stepUp: true }, hasActiveSubscription: !!sub, reason: o.reason, waiverReason: o.waiverReason });
  if (!r.ok) return { ok: false, status: 422, code: 'transition_denied', message: r.error };
  await q`update stores set status = ${to}, status_reason = ${o.reason ?? o.waiverReason ?? null},
          published_at = case when ${to} = 'producao' and published_at is null then now() else published_at end where id = ${storeId}`;
  await audit(q, { actorKind: 'superadmin', actorId: o.adminId, tenantId: s.tenant_id, storeId, action: 'store.status', ip: o.ip, before: { status: s.status }, after: { status: to }, meta: { reason: o.reason, waiverReason: o.waiverReason, viaSubscription: !!sub } });
  return { ok: true, before: s.status, after: to };
}

export function storeRoutes(app: FastifyInstance, ctx: Ctx) {
  const P = '/v1/platform';

  app.get(`${P}/stores`, { preHandler: guard(ctx) }, async (req, reply) => {
    const qs = parse(z.object({ status: z.enum(STORE_STATUS).optional() }), req.query, reply); if (!qs) return;
    const rows = await withPlatform(ctx.pools, (q) => q`
      select s.id, s.slug, s.name, s.status, s.created_by, s.published_at, s.created_at, t.id as tenant_id, t.name as tenant_name,
        (select hostname from store_domains d where d.store_id = s.id order by d.created_at limit 1) as domain,
        (select status from subscriptions x where x.tenant_id = t.id order by x.created_at desc limit 1) as subscription
      from stores s join tenants t on t.id = s.tenant_id
      where (${qs.status ?? null}::text is null or s.status::text = ${qs.status ?? null}) order by s.created_at desc`);
    return { stores: rows };
  });

  app.post(`${P}/stores`, { preHandler: guard(ctx) }, async (req, reply) => {
    const b = parse(z.object({ slug: Slug, name: z.string().min(2).max(80), tenantId: uuid.optional(), tenantName: z.string().min(2).max(120).optional() })
      .refine((v) => v.tenantId || v.tenantName, 'Informe tenantId ou tenantName'), req.body, reply);
    if (!b) return;
    try {
      const out = await withPlatform(ctx.pools, async (q) => {
        const tenantId = b.tenantId ?? (await q`insert into tenants (name) values (${b.tenantName!}) returning id`)[0]!.id;
        const [s] = await q`insert into stores (tenant_id, slug, name, created_by) values (${tenantId}, ${b.slug}, ${b.name}, 'superadmin') returning id, slug, status`;
        const host = `${b.slug}.${ctx.baseDomain}`;
        await q`insert into store_domains (tenant_id, store_id, hostname, kind, verified_at) values (${tenantId}, ${s!.id}, ${host}, 'subdomain', now())`;
        await q`insert into store_themes (store_id, tenant_id) values (${s!.id}, ${tenantId})`;
        await q`insert into store_settings (store_id, tenant_id) values (${s!.id}, ${tenantId})`;
        await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, tenantId, storeId: s!.id, action: 'store.create', ip: req.ip, after: { slug: b.slug, name: b.name } });
        return { id: s!.id, tenantId, slug: s!.slug, status: s!.status, domain: host };
      });
      return reply.status(201).send(out);
    } catch (e) {
      if (isUnique(e)) return fail(reply, 409, 'slug_taken', 'Já existe uma loja com este endereço.');
      throw e;
    }
  });

  // mudar status (publicar, voltar para desenvolvimento, suspender, arquivar) — sempre com autenticador reconfirmado
  app.post(`${P}/stores/:id/status`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ to: z.enum(STORE_STATUS), reason: z.string().max(300).optional(), waiverReason: z.string().max(300).optional() }), req.body, reply); if (!b) return;
    const r = await withPlatform(ctx.pools, (q) => applyStatus(q, id, b.to, { adminId: req.session!.adminId, ip: req.ip, reason: b.reason, waiverReason: b.waiverReason }));
    return r.ok ? { ok: true, status: r.after } : fail(reply, r.status, r.code, r.message);
  });

  // primeiro administrador da loja (ou redefinição da senha do dono). Depois disso, o próprio administrador cria a equipe.
  app.post(`${P}/stores/:id/admin-user`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ name: z.string().min(2).max(80), email: z.string().email().transform((e) => e.toLowerCase()), password: z.string().min(10).max(200) }), req.body, reply); if (!b) return;
    const hash = await hashPassword(b.password);
    const out = await withPlatform(ctx.pools, async (q) => {
      const [s] = await q`select id, tenant_id, status from stores where id = ${id}`;
      if (!s || s.status === 'arquivada') return null;
      const [prev] = await q`select id from staff_users where tenant_id = ${s.tenant_id} and email = ${b.email}`;
      const [u] = await q`
        insert into staff_users (tenant_id, store_id, email, name, role, password_hash, active) values (${s.tenant_id}, ${s.id}, ${b.email}, ${b.name}, 'admin', ${hash}, true)
        on conflict (tenant_id, email) do update set password_hash = excluded.password_hash, role = 'admin', active = true, store_id = excluded.store_id, name = excluded.name, failed_attempts = 0, locked_until = null
        returning id`;
      await q`update staff_sessions set revoked_at = now() where staff_id = ${u!.id} and revoked_at is null`;
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, tenantId: s.tenant_id, storeId: s.id, action: prev ? 'staff.admin_reset' : 'staff.admin_created', ip: req.ip, meta: { email: b.email } });
      return { id: u!.id as string, created: !prev };
    });
    return out ? reply.status(out.created ? 201 : 200).send(out) : fail(reply, 404, 'not_found', 'Loja não encontrada.');
  });

  app.get(`${P}/stores/:id/revisions`, { preHandler: guard(ctx) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const rows = await withPlatform(ctx.pools, (q) => q`select id, actor, entity, entity_id, op, created_at from store_config_revisions where store_id = ${id} order by id desc limit 200`);
    return { revisions: rows };
  });

  // ---- pedidos de publicação feitos pelo MCP ----
  app.get(`${P}/publication-requests`, { preHandler: guard(ctx) }, async () => ({
    requests: await withPlatform(ctx.pools, (q) => q`
      select r.id, r.store_id, s.slug, s.name, r.requested_by, r.note, r.checklist, r.status, r.created_at
      from publication_requests r join stores s on s.id = r.store_id order by (r.status = 'pendente') desc, r.created_at desc limit 100`),
  }));

  app.post(`${P}/publication-requests/:id/decide`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ approve: z.boolean(), waiverReason: z.string().max(300).optional() }), req.body, reply); if (!b) return;
    const adminId = req.session!.adminId;
    const out = await withPlatform(ctx.pools, async (q) => {
      const [r] = await q`select id, store_id, status from publication_requests where id = ${id} for update`;
      if (!r) return { ok: false as const, status: 404, code: 'not_found', message: 'Pedido não encontrado.' };
      if (r.status !== 'pendente') return { ok: false as const, status: 409, code: 'already_decided', message: 'Este pedido já foi decidido.' };
      if (b.approve) {
        const a = await applyStatus(q, r.store_id, 'producao', { adminId, ip: req.ip, waiverReason: b.waiverReason });
        if (!a.ok) return a;
      }
      await q`update publication_requests set status = ${b.approve ? 'aprovada' : 'recusada'}, decided_by = ${adminId}, decided_at = now() where id = ${id}`;
      await audit(q, { actorKind: 'superadmin', actorId: adminId, storeId: r.store_id, action: b.approve ? 'publication.approved' : 'publication.rejected', ip: req.ip });
      return { ok: true as const };
    });
    return out.ok ? { ok: true } : fail(reply, out.status, out.code, out.message);
  });

  // ---- tokens do MCP ----
  app.get(`${P}/mcp-tokens`, { preHandler: guard(ctx) }, async () => ({
    tokens: await withPlatform(ctx.pools, (q) => q`
      select id, name, hint, store_limit, expires_at, revoked_at, last_used_at, last_ip::text as last_ip, created_at from mcp_tokens order by created_at desc`),
  }));

  app.post(`${P}/mcp-tokens`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const b = parse(z.object({ name: z.string().min(2).max(80), expiresInDays: z.number().int().min(1).max(365).default(90), storeIds: z.array(uuid).max(200).optional() }), req.body, reply); if (!b) return;
    const t = generateToken('pmcp');
    const expires = new Date(ctx.clock.now().getTime() + b.expiresInDays * 86_400_000).toISOString();
    const limit = b.storeIds?.length ? JSON.stringify(b.storeIds) : null;
    const row = await withPlatform(ctx.pools, async (q) => {
      const [r] = await q`
        insert into mcp_tokens (name, token_hash, hint, store_limit, expires_at, created_by)
        values (${b.name}, ${t.hash}, ${t.hint}, (select array_agg(x::uuid) from jsonb_array_elements_text(${limit}::jsonb) x), ${expires}, ${req.session!.adminId}) returning id`;
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'mcp.token_created', ip: req.ip, meta: { tokenId: r!.id, name: b.name, expires, storeLimit: b.storeIds ?? null } });
      return r!;
    });
    // o token aparece só agora; depois só existe o hash
    return reply.status(201).send({ id: row.id, token: t.token, expiresAt: expires });
  });

  app.delete(`${P}/mcp-tokens/:id`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const n = await withPlatform(ctx.pools, async (q) => {
      const r = await q`update mcp_tokens set revoked_at = now() where id = ${id} and revoked_at is null returning id`;
      if (r.length) await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'mcp.token_revoked', ip: req.ip, meta: { tokenId: id } });
      return r.length;
    });
    return n ? { ok: true } : fail(reply, 404, 'not_found', 'Token não encontrado ou já revogado.');
  });
}
