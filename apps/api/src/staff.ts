import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { withTenant, type Q } from '@pediu/db';
import { can, hashPassword, hashToken, ROLES, verifyPassword, type Perm, type Role } from '@pediu/shared';
import { LOCK_MS, MAX_FAILED, type Ctx } from './context.js';
import { audit, fail, parse } from './http.js';

export const STAFF_COOKIE = 'pediu_staff';
export const STAFF_TTL_MS = 12 * 60 * 60 * 1000;
export const STAFF_IDLE_MS = 2 * 60 * 60 * 1000;

export interface StaffSession { id: string; staffId: string; tenantId: string; storeId: string; role: Role; name: string }
declare module 'fastify' { interface FastifyRequest { staff?: StaffSession } }

let dummy: Promise<string> | undefined;

export interface StoreRef { storeId: string; tenantId: string; name: string; status: string }

/** Resolve a loja pelo slug (cabeçalho X-Store ou corpo). Não revela lojas arquivadas. */
export async function resolveStore(ctx: Ctx, slug: string): Promise<StoreRef | null> {
  const [r] = await ctx.pools.app.begin((q) => q`select store_id, tenant_id, name, status from app.resolve_store(${slug})`);
  return r ? { storeId: r.store_id, tenantId: r.tenant_id, name: r.name, status: r.status } : null;
}

export async function loadStaff(ctx: Ctx, req: FastifyRequest): Promise<StaffSession | null> {
  const token = req.cookies[STAFF_COOKIE];
  if (!token) return null;
  const [r] = await ctx.pools.app.begin((q) => q`select * from app.staff_session(${hashToken(token)}, ${ctx.clock.now().toISOString()}::timestamptz, ${STAFF_IDLE_MS / 1000})`);
  return r ? { id: r.session_id, staffId: r.staff_id, tenantId: r.tenant_id, storeId: r.store_id, role: r.role, name: r.name } : null;
}

/** Exige sessão da equipe e a permissão da rota. A conta (tenant) vem SEMPRE da sessão, nunca do pedido. */
export function staffGuard(ctx: Ctx, perm?: Perm): preHandlerAsyncHookHandler {
  return async (req, reply) => {
    const s = await loadStaff(ctx, req);
    if (!s) return fail(reply, 401, 'unauthenticated', 'Entre para continuar.');
    if (perm && !can(s.role, perm)) return fail(reply, 403, 'forbidden', 'Seu perfil não tem acesso a esta função.');
    req.staff = s;
  };
}

async function openSession(ctx: Ctx, q: Q, staff: { id: string; tenant_id: string; store_id: string }, req: FastifyRequest, reply: FastifyReply) {
  const token = randomBytes(32).toString('base64url');
  const now = ctx.clock.now();
  await q`insert into staff_sessions (tenant_id, store_id, staff_id, token_hash, ip, user_agent, expires_at, created_at, last_seen_at)
          values (${staff.tenant_id}, ${staff.store_id}, ${staff.id}, ${hashToken(token)}, ${req.ip ?? null}, ${String(req.headers['user-agent'] ?? '').slice(0, 300)},
                  ${new Date(now.getTime() + STAFF_TTL_MS).toISOString()}, ${now.toISOString()}, ${now.toISOString()})`;
  await q`update staff_users set failed_attempts = 0, locked_until = null, last_login_at = ${now.toISOString()} where id = ${staff.id}`;
  reply.setCookie(STAFF_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: ctx.cookieSecure, path: '/', maxAge: STAFF_TTL_MS / 1000 });
}

async function fail1(ctx: Ctx, q: Q, tenantId: string, staffId: string, ip: string, why: string) {
  await q`update staff_users set failed_attempts = failed_attempts + 1,
            locked_until = case when failed_attempts + 1 >= ${MAX_FAILED} then ${new Date(ctx.clock.now().getTime() + LOCK_MS).toISOString()}::timestamptz else locked_until end
          where id = ${staffId}`;
  await audit(q, { actorKind: 'staff', actorId: staffId, tenantId, action: 'staff.login_failed', ip, meta: { why } });
}

const slugSchema = z.string().min(3).max(40);

export function staffRoutes(app: FastifyInstance, ctx: Ctx) {
  const P = '/v1/staff';

  // login com e-mail e senha
  app.post(`${P}/login`, { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({ store: slugSchema, email: z.string().email().transform((s) => s.toLowerCase()), password: z.string().min(1).max(200) }), req.body, reply); if (!b) return;
    const store = await resolveStore(ctx, b.store);
    const generic = () => fail(reply, 401, 'invalid_credentials', 'Dados de acesso incorretos.');
    if (!store) { await verifyPassword(b.password, await (dummy ??= hashPassword('dummy'))); return generic(); }
    const out = await withTenant(ctx.pools, store.tenantId, async (q) => {
      const [u] = await q`select id, tenant_id, store_id, role, name, password_hash, active, locked_until from staff_users
                          where email = ${b.email} and (store_id = ${store.storeId} or store_id is null) for update`;
      if (!u || !u.active || !u.password_hash) { await verifyPassword(b.password, await (dummy ??= hashPassword('dummy'))); return { error: 'invalid' as const }; }
      if (u.locked_until && new Date(u.locked_until) > ctx.clock.now()) return { error: 'locked' as const };
      if (!(await verifyPassword(b.password, u.password_hash))) { await fail1(ctx, q, store.tenantId, u.id, req.ip, 'password'); return { error: 'invalid' as const }; }
      await openSession(ctx, q, { id: u.id, tenant_id: u.tenant_id, store_id: store.storeId }, req, reply);
      await audit(q, { actorKind: 'staff', actorId: u.id, tenantId: store.tenantId, storeId: store.storeId, action: 'staff.login', ip: req.ip });
      return { user: { name: u.name, role: u.role as Role } };
    });
    if ('error' in out) return out.error === 'locked' ? fail(reply, 423, 'locked', 'Acesso bloqueado por tentativas erradas. Tente em 15 minutos.') : generic();
    return { name: out.user.name, role: out.user.role };
  });

  app.get(`${P}/me`, { preHandler: staffGuard(ctx) }, async (req) => {
    const s = req.staff!;
    return { name: s.name, role: s.role, storeId: s.storeId };
  });

  app.post(`${P}/logout`, async (req, reply) => {
    const token = req.cookies[STAFF_COOKIE];
    const s = token ? await loadStaff(ctx, req) : null;
    if (s) await withTenant(ctx.pools, s.tenantId, (q) => q`update staff_sessions set revoked_at = now() where id = ${s.id}`);
    reply.clearCookie(STAFF_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---- gestão da equipe (somente quem tem admin.usuarios) ----
  app.get(`${P}/users`, { preHandler: staffGuard(ctx, 'admin.usuarios') }, async (req) => {
    const s = req.staff!;
    return { users: await withTenant(ctx.pools, s.tenantId, (q) => q`select id, name, email, role, active, last_login_at, (pin_hash is not null) as has_pin, (password_hash is not null) as has_password
                                                                  from staff_users where store_id = ${s.storeId} or store_id is null order by name`) };
  });

  const userBody = z.object({ name: z.string().min(2).max(80), email: z.string().email().transform((e) => e.toLowerCase()), role: z.enum(ROLES), active: z.boolean().default(true),
    password: z.string().min(10).max(200).optional(), pin: z.string().regex(/^\d{4,6}$/, 'PIN de 4 a 6 dígitos').optional() });

  app.post(`${P}/users`, { preHandler: staffGuard(ctx, 'admin.usuarios') }, async (req, reply) => {
    const b = parse(userBody, req.body, reply); if (!b) return;
    const s = req.staff!;
    if (b.role === 'admin' && s.role !== 'admin') return fail(reply, 403, 'forbidden', 'Só um administrador cria outro administrador.');
    try {
      const id = await withTenant(ctx.pools, s.tenantId, async (q) => {
        const [u] = await q`insert into staff_users (tenant_id, store_id, email, name, role, active, password_hash, pin_hash)
          values (${s.tenantId}, ${s.storeId}, ${b.email}, ${b.name}, ${b.role}, ${b.active}, ${b.password ? await hashPassword(b.password) : null}, ${b.pin ? await hashPassword(b.pin) : null}) returning id`;
        await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'staff.user_created', ip: req.ip, after: { id: u!.id, email: b.email, role: b.role } });
        return u!.id as string;
      });
      return reply.status(201).send({ id });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return fail(reply, 409, 'email_taken', 'Já existe um usuário com este e-mail.');
      throw e;
    }
  });

  app.put(`${P}/users/:id`, { preHandler: staffGuard(ctx, 'admin.usuarios') }, async (req, reply) => {
    const id = parse(z.string().uuid(), (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(userBody.partial(), req.body, reply); if (!b) return;
    const s = req.staff!;
    const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [u] = await q`select id, role, active from staff_users where id = ${id} and (store_id = ${s.storeId} or store_id is null) for update`;
      if (!u) return { status: 404, code: 'not_found', message: 'Usuário não encontrado.' };
      if ((u.role === 'admin' || b.role === 'admin') && s.role !== 'admin') return { status: 403, code: 'forbidden', message: 'Só um administrador altera administradores.' };
      const losesAdmin = u.role === 'admin' && u.active && (b.role && b.role !== 'admin' || b.active === false);
      if (losesAdmin || (id === s.staffId && b.active === false)) {
        const [n] = await q`select count(*)::int as n from staff_users where role = 'admin' and active and (store_id = ${s.storeId} or store_id is null) and id <> ${id}`;
        if (!n!.n) return { status: 422, code: 'last_admin', message: 'Mantenha ao menos um administrador ativo.' };
      }
      await q`update staff_users set name = coalesce(${b.name ?? null}, name), email = coalesce(${b.email ?? null}, email), role = coalesce(${b.role ?? null}::app_role, role),
              active = coalesce(${b.active ?? null}::boolean, active),
              password_hash = coalesce(${b.password ? await hashPassword(b.password) : null}, password_hash), pin_hash = coalesce(${b.pin ? await hashPassword(b.pin) : null}, pin_hash),
              failed_attempts = case when ${b.password ?? b.pin ?? null}::text is not null then 0 else failed_attempts end,
              locked_until = case when ${b.password ?? b.pin ?? null}::text is not null then null else locked_until end where id = ${id}`;
      // desativar ou trocar a senha derruba as sessões abertas da pessoa
      if (b.active === false || b.password) await q`update staff_sessions set revoked_at = now() where staff_id = ${id} and revoked_at is null`;
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'staff.user_updated', ip: req.ip, meta: { id, fields: Object.keys(b).filter((k) => k !== 'password' && k !== 'pin') } });
      return { ok: true as const };
    });
    return out.ok ? { ok: true } : fail(reply, out.status, out.code, out.message);
  });
}
