import { resolveTxt } from 'node:dns/promises';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withPlatform, withTenant, type Q } from '@pediu/db';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { guard } from './session.js';
import { staffGuard } from './staff.js';

const uuid = z.string().uuid();
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
export const semverCompare = (a: string, b: string) => {
  const pa = SEMVER.exec(a), pb = SEMVER.exec(b);
  if (!pa || !pb) return a.localeCompare(b);
  for (let i = 1; i <= 3; i++) { const d = Number(pa[i]) - Number(pb[i]); if (d) return d; }
  if (pa[4] && !pb[4]) return -1;            // 1.0.0-beta < 1.0.0
  if (!pa[4] && pb[4]) return 1;
  return (pa[4] ?? '').localeCompare(pb[4] ?? '');
};

/** Faixa 0–99 estável de uma loja: o mesmo store_id cai sempre no mesmo "anel" do rollout. */
export const rolloutBucket = (storeId: string) => parseInt(createHash('sha256').update(storeId).digest('hex').slice(0, 8), 16) % 100;

export interface Resolved { version: string | null; source: 'pin' | 'channel' | 'builtin'; supportEnded: boolean }

/** Qual versão do app uma loja usa: a fixada (pin) ou a mais recente do canal dela; sem nenhuma publicada, a que vem embutida na imagem. */
export async function resolveVersion(q: Q, storeId: string, app: 'web' | 'print-agent' = 'web', nowMs = Date.now()): Promise<Resolved> {
  const [pin] = await q`select version, channel from store_release_pins where store_id = ${storeId} and app = ${app}`;
  const releases = await q`select version, channel, support_ends_at from releases where app = ${app}`;
  const ended = (r?: Record<string, any>) => !!r?.support_ends_at && new Date(r.support_ends_at).getTime() < nowMs;
  if (pin?.version) {
    const r = releases.find((x) => x.version === pin.version);
    if (r) return { version: r.version, source: 'pin', supportEnded: ended(r) };
  }
  const channel = pin?.channel ?? 'estavel';
  const best = releases.filter((r) => channel === 'beta' ? true : r.channel === 'estavel').sort((a, b) => semverCompare(b.version, a.version))[0];
  return best ? { version: best.version, source: 'channel', supportEnded: ended(best) } : { version: null, source: 'builtin', supportEnded: false };
}

const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface DnsLookup { txt(name: string): Promise<string[][]> }
const realDns: DnsLookup = { txt: (n) => resolveTxt(n) };

export function releaseRoutes(app: FastifyInstance, ctx: Ctx, dns: DnsLookup = realDns) {
  const P = '/v1/platform';

  app.get(`${P}/releases`, { preHandler: guard(ctx) }, async (req, reply) => {
    const qs = parse(z.object({ app: z.enum(['web', 'print-agent']).optional() }), req.query, reply); if (!qs) return;
    return withPlatform(ctx.pools, async (q) => {
      const rows = await q`select r.*, (select count(*)::int from store_release_pins p where p.app = r.app and p.version = r.version) as pinned_stores
        from releases r where (${qs.app ?? null}::text is null or r.app = ${qs.app ?? null}) order by r.created_at desc limit 200`;
      return { releases: rows.sort((a, b) => a.app.localeCompare(b.app) || semverCompare(b.version, a.version)) };
    });
  });

  app.post(`${P}/releases`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const b = parse(z.object({ app: z.enum(['web', 'print-agent']), version: z.string().regex(SEMVER, 'Use semver, ex.: 1.4.0'), channel: z.enum(['beta', 'estavel']).default('beta'), changelog: z.string().max(4000).default(''), minApi: z.string().regex(SEMVER).optional(), supportEndsAt: z.string().datetime().optional() }), req.body, reply); if (!b) return;
    try {
      await withPlatform(ctx.pools, async (q) => {
        await q`insert into releases (app, version, channel, changelog, min_api, support_ends_at) values (${b.app}, ${b.version}, ${b.channel}, ${b.changelog}, ${b.minApi ?? null}, ${b.supportEndsAt ?? null})`;
        await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'release.created', ip: req.ip, meta: b });
      });
      return reply.status(201).send({ ok: true });
    } catch (e) { if ((e as { code?: string }).code === '23505') return fail(reply, 409, 'exists', 'Esta versão já existe.'); throw e; }
  });

  // promover (beta → estável), definir fim de suporte
  app.put(`${P}/releases/:app/:version`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const { app: appName, version } = req.params as { app: string; version: string };
    const b = parse(z.object({ channel: z.enum(['beta', 'estavel']).optional(), supportEndsAt: z.string().datetime().nullable().optional(), changelog: z.string().max(4000).optional() }), req.body, reply); if (!b) return;
    const n = await withPlatform(ctx.pools, async (q) => {
      const r = await q`update releases set channel = coalesce(${b.channel ?? null}, channel), changelog = coalesce(${b.changelog ?? null}, changelog),
          support_ends_at = case when ${b.supportEndsAt === undefined} then support_ends_at else ${b.supportEndsAt ?? null}::timestamptz end where app = ${appName} and version = ${version} returning id`;
      if (r.length) await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'release.updated', ip: req.ip, meta: { app: appName, version, ...b } });
      return r.length;
    });
    return n ? { ok: true } : fail(reply, 404, 'not_found', 'Versão não encontrada.');
  });

  // fixar a versão (ou o canal) de UMA loja; null = volta a seguir o canal. Serve também para rollback.
  app.put(`${P}/stores/:id/pin`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ app: z.literal('web').default('web'), version: z.string().regex(SEMVER).nullable(), channel: z.enum(['beta', 'estavel']).default('estavel') }), req.body, reply); if (!b) return;
    const out = await withPlatform(ctx.pools, async (q) => {
      const [st] = await q`select id from stores where id = ${id}`;
      if (!st) return 'store' as const;
      if (b.version) { const [r] = await q`select 1 as x from releases where app = ${b.app} and version = ${b.version}`; if (!r) return 'release' as const; }
      const [before] = await q`select version, channel from store_release_pins where store_id = ${id} and app = ${b.app}`;
      await q`insert into store_release_pins (store_id, app, version, channel) values (${id}, ${b.app}, ${b.version}, ${b.channel})
              on conflict (store_id, app) do update set version = excluded.version, channel = excluded.channel, updated_at = now()`;
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, storeId: id, action: 'release.pin', ip: req.ip, before, after: { version: b.version, channel: b.channel } });
      return 'ok' as const;
    });
    return out === 'ok' ? { ok: true } : fail(reply, out === 'store' ? 404 : 422, out === 'store' ? 'not_found' : 'unknown_release', out === 'store' ? 'Loja não encontrada.' : 'Essa versão não foi publicada.');
  });

  // rollout em anéis: fixa a versão nas lojas cujo "balde" (0–99) é menor que o percentual; lojas já em versão igual ou mais nova não são rebaixadas
  app.post(`${P}/releases/:app/:version/rollout`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const { app: appName, version } = req.params as { app: string; version: string };
    const b = parse(z.object({ percent: z.number().int().min(0).max(100), dryRun: z.boolean().default(false), onlyChannel: z.enum(['beta', 'estavel']).optional() }), req.body, reply); if (!b) return;
    if (appName !== 'web') return fail(reply, 400, 'invalid_input', 'Rollout vale para o app web.');
    const out = await withPlatform(ctx.pools, async (q) => {
      const [r] = await q`select 1 as x from releases where app = ${appName} and version = ${version}`;
      if (!r) return null;
      const stores = await q`select s.id, p.version as pinned, p.channel from stores s left join store_release_pins p on p.store_id = s.id and p.app = ${appName} where s.status <> 'arquivada'`;
      const targets = stores.filter((s) => rolloutBucket(s.id) < b.percent && (!b.onlyChannel || (s.channel ?? 'estavel') === b.onlyChannel) && (!s.pinned || semverCompare(s.pinned, version) < 0));
      if (!b.dryRun) {
        for (const s of targets) await q`insert into store_release_pins (store_id, app, version, channel) values (${s.id}, ${appName}, ${version}, ${s.channel ?? 'estavel'}) on conflict (store_id, app) do update set version = excluded.version, updated_at = now()`;
        await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'release.rollout', ip: req.ip, meta: { app: appName, version, percent: b.percent, stores: targets.length } });
      }
      return { total: stores.length, affected: targets.length, dryRun: b.dryRun };
    });
    return out ?? fail(reply, 404, 'not_found', 'Versão não encontrada.');
  });

  // lojas rodando versão cujo suporte acabou
  app.get(`${P}/releases/support-ended`, { preHandler: guard(ctx) }, async () => withPlatform(ctx.pools, async (q) => ({
    stores: await q`select s.id, s.slug, s.name, p.version, r.support_ends_at from store_release_pins p join releases r on r.app = p.app and r.version = p.version join stores s on s.id = p.store_id
                    where r.support_ends_at < now() and s.status <> 'arquivada' order by r.support_ends_at`,
  })));

  // ---- para o web-edge: descobrir a loja e a versão pelo domínio. Protegido por segredo compartilhado ----
  app.get('/v1/edge/resolve', { config: { rateLimit: { max: 2000, timeWindow: '1 minute' } } }, async (req, reply) => {
    const secret = process.env.EDGE_SECRET ?? '';
    if (!secret || !safeEqual(String(req.headers['x-edge-secret'] ?? ''), secret)) return fail(reply, 401, 'unauthenticated', 'Segredo do edge inválido.');
    const host = parse(z.string().min(3).max(253), (req.query as { host?: string }).host, reply); if (!host) return;
    return withPlatform(ctx.pools, async (q) => {
      const [h] = await q`select s.id, s.slug, s.name, s.status from stores s join store_domains d on d.store_id = s.id where d.hostname = ${host.toLowerCase()} and d.verified_at is not null and s.status <> 'arquivada'`;
      if (!h) return fail(reply, 404, 'not_found', 'Domínio desconhecido.');
      const v = await resolveVersion(q, h.id, 'web');
      const [theme] = await q`select data from store_themes where store_id = ${h.id}`;
      return { storeId: h.id, slug: h.slug, name: h.name, status: h.status, version: v.version, source: v.source, supportEnded: v.supportEnded, themeColor: theme?.data?.primary ?? null, iconUrl: theme?.data?.faviconUrl || theme?.data?.logoUrl || null, description: theme?.data?.seoDescription ?? null, title: theme?.data?.seoTitle ?? null };
    });
  });

  // Caddy "on-demand TLS": só emite certificado para domínio verificado
  app.get('/v1/edge/tls-check', async (req, reply) => {
    const secret = process.env.EDGE_SECRET ?? '';
    if (secret && !safeEqual(String(req.headers['x-edge-secret'] ?? (req.query as { secret?: string }).secret ?? ''), secret)) return fail(reply, 401, 'unauthenticated', 'Segredo do edge inválido.');
    const domain = String((req.query as { domain?: string }).domain ?? '').toLowerCase();
    if (!HOST_RE.test(domain)) return fail(reply, 404, 'not_found', 'Domínio inválido.');
    const ok = await withPlatform(ctx.pools, async (q) => !!(await q`select 1 as x from store_domains d join stores s on s.id = d.store_id where d.hostname = ${domain} and d.verified_at is not null and s.status <> 'arquivada'`)[0]);
    return ok ? { ok: true } : fail(reply, 404, 'not_found', 'Domínio não verificado.');
  });

  // ---- domínios próprios (lojista) ----
  const S = '/v1/staff/domains'; const adm = staffGuard(ctx, 'admin.loja');
  const cname = `cname.${ctx.baseDomain}`;
  const withInstructions = (d: Record<string, any>) => ({ id: d.id, hostname: d.hostname, kind: d.kind, verified: !!d.verified_at, verifyError: d.verify_error,
    instructions: d.kind === 'custom' && !d.verified_at ? { cname: { name: d.hostname, value: cname }, txt: { name: `_pediu-verify.${d.hostname}`, value: d.verify_token } } : null });

  app.get(S, { preHandler: staffGuard(ctx) }, async (req) => {
    const s = req.staff!;
    return { domains: (await withTenant(ctx.pools, s.tenantId, (q) => q`select id, hostname, kind, verified_at, verify_token, verify_error from store_domains where store_id = ${s.storeId} order by created_at`)).map(withInstructions) };
  });

  app.post(S, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!;
    const b = parse(z.object({ hostname: z.string().trim().toLowerCase().regex(HOST_RE, 'Domínio inválido') }), req.body, reply); if (!b) return;
    if (b.hostname === ctx.baseDomain || b.hostname.endsWith(`.${ctx.baseDomain}`)) return fail(reply, 422, 'reserved', `Domínios de ${ctx.baseDomain} são gerenciados pela plataforma.`);
    try {
      const d = await withTenant(ctx.pools, s.tenantId, async (q) => {
        const [n] = await q`select count(*)::int as n from store_domains where store_id = ${s.storeId} and kind = 'custom'`;
        if (n!.n >= 5) return 'limit' as const;
        const [row] = await q`insert into store_domains (tenant_id, store_id, hostname, kind, verify_token) values (${s.tenantId}, ${s.storeId}, ${b.hostname}, 'custom', ${randomBytes(16).toString('hex')}) returning id, hostname, kind, verified_at, verify_token, verify_error`;
        await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'domain.added', ip: req.ip, meta: { hostname: b.hostname } });
        return row!;
      });
      return d === 'limit' ? fail(reply, 422, 'limit', 'Máximo de 5 domínios próprios por loja.') : reply.status(201).send(withInstructions(d));
    } catch (e) { if ((e as { code?: string }).code === '23505') return fail(reply, 409, 'taken', 'Este domínio já está em uso.'); throw e; }
  });

  app.post(`${S}/:id/verify`, { preHandler: adm, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const s = req.staff!; const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const d = await withTenant(ctx.pools, s.tenantId, async (q) => (await q`select id, hostname, kind, verified_at, verify_token from store_domains where id = ${id} and store_id = ${s.storeId}`)[0]);
    if (!d) return fail(reply, 404, 'not_found', 'Domínio não encontrado.');
    if (d.verified_at) return { verified: true };
    let ok = false, why = '';
    try { ok = (await (ctx.dns ?? dns).txt(`_pediu-verify.${d.hostname}`)).some((r) => r.join('') === d.verify_token); if (!ok) why = `Não encontrei o registro TXT _pediu-verify.${d.hostname} com o valor esperado. A propagação do DNS pode levar alguns minutos.`; }
    catch { why = `O registro TXT _pediu-verify.${d.hostname} ainda não existe no DNS.`; }
    await withTenant(ctx.pools, s.tenantId, async (q) => {
      await q`update store_domains set verified_at = ${ok ? ctx.clock.now().toISOString() : null}, verify_error = ${ok ? null : why}, verified_checked_at = now() where id = ${id}`;
      if (ok) await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'domain.verified', ip: req.ip, meta: { hostname: d.hostname } });
    });
    return ok ? { verified: true } : fail(reply, 422, 'not_verified', why);
  });

  app.delete(`${S}/:id`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!; const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const n = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const r = await q`delete from store_domains where id = ${id} and store_id = ${s.storeId} and kind = 'custom' returning hostname`;
      if (r.length) await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'domain.removed', ip: req.ip, meta: { hostname: r[0]!.hostname } });
      return r.length;
    });
    return n ? { ok: true } : fail(reply, 404, 'not_found', 'Domínio próprio não encontrado (o domínio padrão não pode ser removido).');
  });

  // ---- super admin: domínios de qualquer loja (adicionar, verificar, remover) ----
  const PD = '/v1/platform/stores/:id/domains';
  const storeRow = async (q: Q, id: string) => (await q`select id, tenant_id, slug from stores where id = ${id}`)[0];

  app.get(PD, { preHandler: guard(ctx) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const out = await withPlatform(ctx.pools, async (q) => {
      if (!(await storeRow(q, id))) return null;
      return (await q`select id, hostname, kind, verified_at, verify_token, verify_error from store_domains where store_id = ${id} order by created_at`).map(withInstructions);
    });
    return out ? { domains: out } : fail(reply, 404, 'not_found', 'Loja não encontrada.');
  });

  app.post(PD, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ hostname: z.string().trim().toLowerCase().regex(HOST_RE, 'Domínio inválido'), markVerified: z.boolean().default(false) }), req.body, reply); if (!b) return;
    if (b.hostname === ctx.baseDomain || b.hostname.endsWith(`.${ctx.baseDomain}`)) return fail(reply, 422, 'reserved', `Domínios de ${ctx.baseDomain} são gerenciados pela plataforma.`);
    try {
      const out = await withPlatform(ctx.pools, async (q) => {
        const st = await storeRow(q, id); if (!st) return 'store' as const;
        const [n] = await q`select count(*)::int as n from store_domains where store_id = ${id} and kind = 'custom'`;
        if (n!.n >= 5) return 'limit' as const;
        const [row] = await q`insert into store_domains (tenant_id, store_id, hostname, kind, verify_token, verified_at) values (${st.tenant_id}, ${id}, ${b.hostname}, 'custom', ${randomBytes(16).toString('hex')}, ${b.markVerified ? ctx.clock.now().toISOString() : null})
                              returning id, hostname, kind, verified_at, verify_token, verify_error`;
        await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, tenantId: st.tenant_id, storeId: id, action: 'domain.added', ip: req.ip, meta: { hostname: b.hostname, byPlatform: true, markedVerified: b.markVerified } });
        return row!;
      });
      if (out === 'store') return fail(reply, 404, 'not_found', 'Loja não encontrada.');
      return out === 'limit' ? fail(reply, 422, 'limit', 'Máximo de 5 domínios próprios por loja.') : reply.status(201).send(withInstructions(out));
    } catch (e) { if ((e as { code?: string }).code === '23505') return fail(reply, 409, 'taken', 'Este domínio já está em uso.'); throw e; }
  });

  app.post(`${PD}/:domainId/verify`, { preHandler: guard(ctx), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id: sid, domainId } = req.params as { id: string; domainId: string };
    const storeId = parse(uuid, sid, reply); if (!storeId) return; const did = parse(uuid, domainId, reply); if (!did) return;
    const d = await withPlatform(ctx.pools, async (q) => (await q`select id, hostname, verified_at, verify_token, tenant_id from store_domains where id = ${did} and store_id = ${storeId} and kind = 'custom'`)[0]);
    if (!d) return fail(reply, 404, 'not_found', 'Domínio não encontrado.');
    if (d.verified_at) return { verified: true };
    let ok = false, why = '';
    try { ok = (await (ctx.dns ?? dns).txt(`_pediu-verify.${d.hostname}`)).some((r) => r.join('') === d.verify_token); if (!ok) why = `Não encontrei o registro TXT _pediu-verify.${d.hostname} com o valor esperado. A propagação do DNS pode levar alguns minutos.`; }
    catch { why = `O registro TXT _pediu-verify.${d.hostname} ainda não existe no DNS.`; }
    await withPlatform(ctx.pools, async (q) => {
      await q`update store_domains set verified_at = ${ok ? ctx.clock.now().toISOString() : null}, verify_error = ${ok ? null : why}, verified_checked_at = now() where id = ${did}`;
      if (ok) await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, tenantId: d.tenant_id, storeId, action: 'domain.verified', ip: req.ip, meta: { hostname: d.hostname, byPlatform: true } });
    });
    return ok ? { verified: true } : fail(reply, 422, 'not_verified', why);
  });

  app.delete(`${PD}/:domainId`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const { id: sid, domainId } = req.params as { id: string; domainId: string };
    const storeId = parse(uuid, sid, reply); if (!storeId) return; const did = parse(uuid, domainId, reply); if (!did) return;
    const n = await withPlatform(ctx.pools, async (q) => {
      const r = await q`delete from store_domains where id = ${did} and store_id = ${storeId} and kind = 'custom' returning hostname, tenant_id`;
      if (r.length) await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, tenantId: r[0]!.tenant_id, storeId, action: 'domain.removed', ip: req.ip, meta: { hostname: r[0]!.hostname, byPlatform: true } });
      return r.length;
    });
    return n ? { ok: true } : fail(reply, 404, 'not_found', 'Domínio próprio não encontrado (o domínio padrão não pode ser removido).');
  });
}
