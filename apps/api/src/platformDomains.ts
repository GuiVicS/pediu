import { resolve4 } from 'node:dns/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { withPlatform, type Q } from '@pediu/db';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { guard } from './session.js';

/** Papéis de um endereço da plataforma. 'stores' é o domínio-base das lojas (slug.dominio); os outros são um endereço só. */
export const PLATFORM_ROLES = ['admin', 'api', 'mcp', 'stores'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

const uuid = z.string().uuid();
const HOST_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const hostOf = (req: FastifyRequest) => String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0]!.split(':')[0]!.trim().toLowerCase();
const lookupA = (ctx: Ctx, name: string): Promise<string[]> => (ctx.dns?.a ?? resolve4)(name);

/** Loja de um endereço slug.dominio-base, para os domínios-base cadastrados no super admin (o domínio do servidor já tem linha própria em store_domains). */
export async function storeBySubdomain(q: Q, host: string) {
  const dot = host.indexOf('.'); if (dot < 1) return null;
  const slug = host.slice(0, dot), base = host.slice(dot + 1);
  if (!SLUG_RE.test(slug)) return null;
  const [d] = await q`select 1 as x from platform_domains where role = 'stores' and hostname = ${base} and verified_at is not null`;
  if (!d) return null;
  return (await q`select id, slug, name, status from stores where slug = ${slug} and status <> 'arquivada'`)[0] ?? null;
}

/** Endereço verificado da plataforma (super admin, API ou MCP)? Devolve o papel. */
export async function platformRoleOf(q: Q, host: string): Promise<PlatformRole | null> {
  const [d] = await q`select role from platform_domains where hostname = ${host} and role <> 'stores' and verified_at is not null`;
  return (d?.role as PlatformRole | undefined) ?? null;
}

/** IPs deste servidor: PUBLIC_IPS (se definido) ou para onde apontam o endereço em uso agora e o endereço público da API. */
async function serverIps(ctx: Ctx, req: FastifyRequest): Promise<string[]> {
  const fixed = (process.env.PUBLIC_IPS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (fixed.length) return fixed;
  const hosts = new Set<string>([hostOf(req)]);
  try { if (ctx.publicUrl) hosts.add(new URL(ctx.publicUrl).hostname); } catch { /* endereço público inválido: segue só com o atual */ }
  const ips = new Set<string>();
  for (const h of hosts) { if (!HOST_RE.test(h)) continue; try { for (const ip of await lookupA(ctx, h)) ips.add(ip); } catch { /* este não resolve: tenta o próximo */ } }
  return [...ips];
}

export function platformDomainRoutes(app: FastifyInstance, ctx: Ctx) {
  const P = '/v1/platform/domains';
  /** O que criar no DNS: lojas precisam do curinga (*.dominio); os outros, do próprio endereço. */
  const dnsName = (d: { role: string; hostname: string }) => (d.role === 'stores' ? `*.${d.hostname}` : d.hostname);
  const view = (d: Record<string, any>, ips: string[], current: string) => ({
    id: d.id, role: d.role, hostname: d.hostname, verified: !!d.verified_at, verifyError: d.verify_error, inUse: d.hostname === current,
    dns: { type: 'A', name: dnsName(d as never), values: ips },
  });

  // o edge pergunta quais endereços são da plataforma (para mandar à API ou ao MCP em vez de procurar uma loja)
  app.get('/v1/edge/platform-hosts', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } }, async (req, reply) => {
    const secret = process.env.EDGE_SECRET ?? '';
    if (!secret || !safeEqual(String(req.headers['x-edge-secret'] ?? ''), secret)) return fail(reply, 401, 'unauthenticated', 'Segredo do edge inválido.');
    return { hosts: await withPlatform(ctx.pools, (q) => q`select hostname, role from platform_domains where role <> 'stores' and verified_at is not null order by hostname`) };
  });

  app.get(P, { preHandler: guard(ctx) }, async (req) => {
    const ips = await serverIps(ctx, req); const current = hostOf(req);
    const rows = await withPlatform(ctx.pools, (q) => q`select id, role, hostname, verified_at, verify_error from platform_domains order by role, created_at`);
    // endereços que vêm da configuração do servidor: aparecem na tela só para leitura (continuam valendo como entrada de emergência)
    const server: { role: PlatformRole; hostname: string }[] = [{ role: 'stores', hostname: ctx.baseDomain }];
    if (process.env.PREVIEW_DOMAIN && process.env.PREVIEW_DOMAIN !== ctx.baseDomain) server.push({ role: 'stores', hostname: process.env.PREVIEW_DOMAIN });
    try { if (ctx.publicUrl) server.push({ role: 'api', hostname: new URL(ctx.publicUrl).hostname }); } catch { /* sem endereço público */ }
    return { domains: rows.map((d) => view(d, ips, current)), server, serverIps: ips, current };
  });

  app.post(P, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const b = parse(z.object({ role: z.enum(PLATFORM_ROLES), hostname: z.string().trim().toLowerCase().regex(HOST_RE, 'Domínio inválido') }), req.body, reply); if (!b) return;
    try {
      const out = await withPlatform(ctx.pools, async (q) => {
        if ((await q`select 1 as x from store_domains where hostname = ${b.hostname}`)[0]) return 'store' as const;
        if (b.role === 'stores') {
          if (b.hostname === ctx.baseDomain) return 'server' as const;
        } else {
          // endereço que cairia em cima de uma loja (slug.dominio-base): recusa, senão a loja sumiria
          const dot = b.hostname.indexOf('.'); const slug = b.hostname.slice(0, dot), base = b.hostname.slice(dot + 1);
          const isBase = base === ctx.baseDomain || !!(await q`select 1 as x from platform_domains where role = 'stores' and hostname = ${base}`)[0];
          if (isBase && (await q`select 1 as x from stores where slug = ${slug}`)[0]) return 'store' as const;
        }
        const [row] = await q`insert into platform_domains (role, hostname, created_by) values (${b.role}, ${b.hostname}, ${req.session!.adminId}) returning id, role, hostname, verified_at, verify_error`;
        await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'platform_domain.added', ip: req.ip, meta: { role: b.role, hostname: b.hostname } });
        return row!;
      });
      if (out === 'store') return fail(reply, 409, 'taken', 'Este endereço já é de uma loja.');
      if (out === 'server') return fail(reply, 409, 'taken', 'Este já é o domínio das lojas configurado no servidor.');
      return reply.status(201).send(view(out, await serverIps(ctx, req), hostOf(req)));
    } catch (e) { if ((e as { code?: string }).code === '23505') return fail(reply, 409, 'taken', 'Este endereço já está cadastrado.'); throw e; }
  });

  // Verificar = o DNS já aponta para este servidor? (para lojas, testa um subdomínio qualquer: precisa do registro curinga)
  app.post(`${P}/:id/verify`, { preHandler: guard(ctx), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const d = await withPlatform(ctx.pools, async (q) => (await q`select id, role, hostname, verified_at from platform_domains where id = ${id}`)[0]);
    if (!d) return fail(reply, 404, 'not_found', 'Endereço não encontrado.');
    const ips = await serverIps(ctx, req);
    const probe = d.role === 'stores' ? `pediu-verifica-${randomBytes(4).toString('hex')}.${d.hostname}` : d.hostname as string;
    let ok = false, why = '';
    if (!ips.length) why = 'Não consegui descobrir o IP deste servidor. Defina PUBLIC_IPS na configuração do servidor.';
    else {
      try {
        const got = await lookupA(ctx, probe);
        ok = got.length > 0 && got.every((ip) => ips.includes(ip));
        if (!ok) why = `${dnsName(d as never)} aponta para ${got.join(', ') || 'lugar nenhum'}, mas o servidor está em ${ips.join(', ')}. Corrija o registro A no provedor de DNS.`;
      } catch { why = `O registro A de ${dnsName(d as never)} ainda não existe no DNS (aponte para ${ips.join(', ')}). A propagação pode levar de minutos a horas.`; }
    }
    await withPlatform(ctx.pools, async (q) => {
      // um endereço já verificado continua valendo se o DNS falhar agora (não derruba o que está no ar): só registra o aviso
      await q`update platform_domains set verified_at = ${ok ? (d.verified_at ?? ctx.clock.now().toISOString()) : d.verified_at}, verify_error = ${ok ? null : why}, verified_checked_at = now() where id = ${id}`;
      if (ok && !d.verified_at) await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'platform_domain.verified', ip: req.ip, meta: { role: d.role, hostname: d.hostname } });
    });
    return ok ? { verified: true } : fail(reply, 422, 'not_verified', why);
  });

  app.delete(`${P}/:id`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const current = hostOf(req);
    const out = await withPlatform(ctx.pools, async (q) => {
      const [d] = await q`select role, hostname from platform_domains where id = ${id}`;
      if (!d) return 'none' as const;
      if (d.hostname === current) return 'in_use' as const;      // não deixa remover o endereço por onde a pessoa está entrando agora
      await q`delete from platform_domains where id = ${id}`;
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'platform_domain.removed', ip: req.ip, meta: { role: d.role, hostname: d.hostname } });
      return 'ok' as const;
    });
    if (out === 'none') return fail(reply, 404, 'not_found', 'Endereço não encontrado.');
    if (out === 'in_use') return fail(reply, 409, 'in_use', 'Você está usando este endereço agora. Entre por outro endereço para remover este.');
    return { ok: true };
  });
}
