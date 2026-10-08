import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { withPlatform, withTenant } from '@pediu/db';
import { hashToken } from '@pediu/shared';
import type { Ctx } from './context.js';
import { loginCodeEmail } from './customerEmail.js';
import { audit, fail, parse } from './http.js';
import { guard } from './session.js';
import { resolveStore, staffGuard, type StoreRef } from './staff.js';

export const CUSTOMER_COOKIE = 'pediu_cust';
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;               // erros por código
const MAX_CODES_PER_HOUR = 5;         // códigos pedidos por e-mail/loja
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CustomerSession { sessionId: string; id: string; email: string; name: string; phone: string }

const email = z.string().trim().toLowerCase().email().max(160);
const code = z.string().regex(/^\d{6}$/, 'O código tem 6 dígitos.');
const pub = (c: { id: string; email: string; name: string; phone: string }) => ({ id: c.id, email: c.email, name: c.name, phone: c.phone });
const codeHash = (storeId: string, mail: string, c: string) => hashToken(`${storeId}:${mail}:${c}`);

/** A área do cliente só existe para lojas no ar (a mesma regra da vitrine). */
export async function publicStore(ctx: Ctx, slug: string): Promise<StoreRef | null> {
  const s = await resolveStore(ctx, slug);
  return s && s.status === 'producao' ? s : null;
}

/** Sessão do cliente da loja (cookie). A conta vem sempre da loja resolvida, nunca do pedido. */
export async function loadCustomer(ctx: Ctx, req: FastifyRequest, store: StoreRef): Promise<CustomerSession | null> {
  const token = req.cookies[CUSTOMER_COOKIE];
  if (!token) return null;
  const now = ctx.clock.now();
  return withTenant(ctx.pools, store.tenantId, async (q) => {
    const [r] = await q`
      select s.id as session_id, c.id, c.email, c.name, c.phone
      from customer_sessions s join store_customers c on c.id = s.customer_id and c.store_id = s.store_id
      where s.token_hash = ${hashToken(token)} and s.store_id = ${store.storeId} and s.revoked_at is null
        and s.expires_at > ${now.toISOString()}::timestamptz and s.last_seen_at > ${new Date(now.getTime() - SESSION_IDLE_MS).toISOString()}::timestamptz`;
    if (!r) return null;
    await q`update customer_sessions set last_seen_at = ${now.toISOString()}::timestamptz where id = ${r.session_id}`;
    return { sessionId: r.session_id as string, id: r.id as string, email: r.email as string, name: r.name as string, phone: r.phone as string };
  });
}

/** Endereço público da loja, para links e imagens do e-mail (usa o host que o cliente acessou). */
function originOf(ctx: Ctx, req: FastifyRequest): string {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.origin?.toString().replace(/^https?:\/\//, '') ?? req.headers.host ?? '').split(',')[0]!.trim();
  const proto = String(req.headers['x-forwarded-proto'] ?? (ctx.cookieSecure ? 'https' : 'http')).split(',')[0]!.trim();
  return /^[a-z0-9.:-]+$/i.test(host) ? `${proto}://${host}` : '';
}

const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export function customerRoutes(app: FastifyInstance, ctx: Ctx) {
  const C = '/v1/store/:slug/customer';
  const slugOf = (req: FastifyRequest) => (req.params as { slug: string }).slug;

  // 1) pede o código: sempre responde igual, exista a conta ou não (não revela quem é cliente)
  app.post(`${C}/code`, { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({ email, name: z.string().trim().max(80).default(''), phone: z.string().trim().max(20).default('') }), req.body, reply); if (!b) return;
    const store = await publicStore(ctx, slugOf(req));
    if (!store) return fail(reply, 404, 'not_found', 'Loja não encontrada.');
    if (!ctx.mailer) return fail(reply, 503, 'mail_unavailable', 'O envio de e-mail não está configurado nesta plataforma.');
    const plain = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = ctx.clock.now();
    const out = await withTenant(ctx.pools, store.tenantId, async (q) => {
      const [n] = await q`select count(*)::int as n from customer_login_codes where store_id = ${store.storeId} and email = ${b.email} and created_at > ${new Date(now.getTime() - 3_600_000).toISOString()}::timestamptz`;
      if ((n?.n ?? 0) >= MAX_CODES_PER_HOUR) return { limited: true as const };
      await q`insert into customer_login_codes (store_id, tenant_id, email, name, phone, code_hash, expires_at)
              values (${store.storeId}, ${store.tenantId}, ${b.email}, ${b.name}, ${b.phone}, ${codeHash(store.storeId, b.email, plain)}, ${new Date(now.getTime() + CODE_TTL_MIN * 60_000).toISOString()}::timestamptz)`;
      const [theme] = await q`select data from store_themes where store_id = ${store.storeId}`;
      const [land] = await q`select value from platform_public_settings where key = 'landing_url'`;
      return { limited: false as const, theme: (theme?.data ?? {}) as Record<string, string>, landing: (land?.value ?? '') as string };
    });
    if (out.limited) return fail(reply, 429, 'too_many_codes', 'Você pediu códigos demais. Aguarde um pouco e tente de novo.');
    const origin = originOf(ctx, req);
    const mail = loginCodeEmail({
      storeName: store.name, storeUrl: origin ? `${origin}/` : '', logoUrl: out.theme.logoUrl?.startsWith('/') && origin ? `${origin}${out.theme.logoUrl}` : out.theme.logoUrl, primary: out.theme.primary, primaryFg: out.theme.primaryFg,
      code: plain, minutes: CODE_TTL_MIN, landingUrl: out.landing, poweredByLogoUrl: origin ? `${origin}/brand/logo-allblack.png` : '',
    });
    try { await ctx.mailer.send({ to: b.email, ...mail }); }
    catch (e) {
      ctx.telemetry?.log({ level: 'error', service: 'api', event: 'customer.mail_failed', message: String((e as Error).message).slice(0, 300), storeId: store.storeId, tenantId: store.tenantId });
      return fail(reply, 502, 'mail_failed', 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.');
    }
    return { ok: true, expiresInMinutes: CODE_TTL_MIN };
  });

  // 2) confirma o código, cria/atualiza o cliente e abre a sessão
  app.post(`${C}/verify`, { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({ email, code }), req.body, reply); if (!b) return;
    const store = await publicStore(ctx, slugOf(req));
    if (!store) return fail(reply, 404, 'not_found', 'Loja não encontrada.');
    const now = ctx.clock.now();
    const token = randomBytes(32).toString('base64url');
    const out = await withTenant(ctx.pools, store.tenantId, async (q) => {
      const [c] = await q`select id, code_hash, attempts, name, phone from customer_login_codes
                          where store_id = ${store.storeId} and email = ${b.email} and consumed_at is null and expires_at > ${now.toISOString()}::timestamptz
                          order by created_at desc limit 1 for update`;
      if (!c || c.attempts >= MAX_ATTEMPTS) return null;
      const a = Buffer.from(c.code_hash as string), h = Buffer.from(codeHash(store.storeId, b.email, b.code));
      if (a.length !== h.length || !timingSafeEqual(a, h)) { await q`update customer_login_codes set attempts = attempts + 1 where id = ${c.id}`; return null; }
      await q`update customer_login_codes set consumed_at = ${now.toISOString()}::timestamptz where id = ${c.id}`;
      const [cu] = await q`
        insert into store_customers (store_id, tenant_id, email, name, phone, email_verified_at, last_login_at)
        values (${store.storeId}, ${store.tenantId}, ${b.email}, ${c.name}, ${c.phone}, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
        on conflict (store_id, email) do update set
          email_verified_at = coalesce(store_customers.email_verified_at, excluded.email_verified_at), last_login_at = excluded.last_login_at,
          name = case when store_customers.name = '' then excluded.name else store_customers.name end,
          phone = case when store_customers.phone = '' then excluded.phone else store_customers.phone end
        returning id, email, name, phone`;
      await q`insert into customer_sessions (store_id, tenant_id, customer_id, token_hash, ip, user_agent, expires_at, created_at, last_seen_at)
              values (${store.storeId}, ${store.tenantId}, ${cu!.id}, ${hashToken(token)}, ${req.ip ?? null}, ${String(req.headers['user-agent'] ?? '').slice(0, 300)},
                      ${new Date(now.getTime() + SESSION_TTL_MS).toISOString()}::timestamptz, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)`;
      return cu!;
    });
    if (!out) return fail(reply, 401, 'invalid_code', 'Código inválido ou vencido. Peça um novo código.');
    reply.setCookie(CUSTOMER_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: ctx.cookieSecure, path: '/', maxAge: SESSION_TTL_MS / 1000 });
    return { customer: pub(out as { id: string; email: string; name: string; phone: string }) };
  });

  // sem login = 200 com customer null (a tela não trata como erro nem derruba a sessão da equipe)
  app.get(`${C}/me`, async (req, reply) => {
    const store = await publicStore(ctx, slugOf(req));
    if (!store) return fail(reply, 404, 'not_found', 'Loja não encontrada.');
    const c = await loadCustomer(ctx, req, store);
    return { customer: c ? pub(c) : null };
  });

  app.put(`${C}/me`, async (req, reply) => {
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().max(20).default('') }), req.body, reply); if (!b) return;
    const store = await publicStore(ctx, slugOf(req));
    if (!store) return fail(reply, 404, 'not_found', 'Loja não encontrada.');
    const c = await loadCustomer(ctx, req, store);
    if (!c) return fail(reply, 401, 'unauthenticated', 'Entre para continuar.');
    const [u] = await withTenant(ctx.pools, store.tenantId, (q) => q`update store_customers set name = ${b.name}, phone = ${b.phone} where id = ${c.id} and store_id = ${store.storeId} returning id, email, name, phone`);
    return { customer: pub(u as { id: string; email: string; name: string; phone: string }) };
  });

  app.post(`${C}/logout`, async (req, reply) => {
    const store = await publicStore(ctx, slugOf(req));
    const c = store ? await loadCustomer(ctx, req, store) : null;
    if (store && c) await withTenant(ctx.pools, store.tenantId, (q) => q`update customer_sessions set revoked_at = now() where id = ${c.sessionId}`);
    reply.clearCookie(CUSTOMER_COOKIE, { path: '/' });
    return { ok: true };
  });

  // pedidos do cliente (mesmo formato do acompanhamento por token, mais o token para atualizar o status)
  app.get(`${C}/orders`, async (req, reply) => {
    const store = await publicStore(ctx, slugOf(req));
    if (!store) return fail(reply, 404, 'not_found', 'Loja não encontrada.');
    const c = await loadCustomer(ctx, req, store);
    if (!c) return fail(reply, 401, 'unauthenticated', 'Entre para continuar.');
    const rows = await withTenant(ctx.pools, store.tenantId, (q) => q`
      select o.number, o.status, o.type, o.total_cents, o.created_at, o.tracking_token as token, ${store.name}::text as store_name,
             coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty) order by i.created_at) from order_items i where i.order_id = o.id), '[]'::jsonb) as items
      from orders o where o.store_id = ${store.storeId} and o.customer_id = ${c.id} order by o.created_at desc limit 50`);
    return { orders: rows };
  });

  // ---- lojista: lista de clientes da loja ----
  app.get('/v1/staff/customers', { preHandler: staffGuard(ctx, 'admin.pedidos') }, async (req, reply) => {
    const s = req.staff!;
    const b = parse(z.object({ q: z.string().trim().max(80).default(''), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) }), req.query, reply); if (!b) return;
    const pat = b.q ? like(b.q) : null;
    return withTenant(ctx.pools, s.tenantId, async (q) => {
      const [t] = await q`select count(*)::int as n from store_customers c where c.store_id = ${s.storeId}
                          and (${pat}::text is null or c.name ilike ${pat} or c.email ilike ${pat} or c.phone ilike ${pat})`;
      const customers = await q`
        select c.id, c.name, c.email, c.phone, c.created_at, c.last_login_at, c.marketing_opt_in,
               count(o.id) filter (where o.status <> 'cancelado')::int as orders_count,
               coalesce(sum(o.total_cents) filter (where o.status not in ('cancelado', 'aguardando')), 0)::int as spent_cents,
               max(o.created_at) as last_order_at
        from store_customers c left join orders o on o.customer_id = c.id and o.store_id = c.store_id
        where c.store_id = ${s.storeId} and (${pat}::text is null or c.name ilike ${pat} or c.email ilike ${pat} or c.phone ilike ${pat})
        group by c.id order by coalesce(max(o.created_at), c.created_at) desc limit ${b.limit} offset ${b.offset}`;
      return { total: t?.n ?? 0, customers };
    });
  });

  app.get('/v1/staff/customers/:id/orders', { preHandler: staffGuard(ctx, 'admin.pedidos') }, async (req, reply) => {
    const s = req.staff!;
    const b = parse(z.object({ id: z.string().uuid() }), req.params, reply); if (!b) return;
    const orders = await withTenant(ctx.pools, s.tenantId, (q) => q`
      select number, status, type, total_cents, created_at from orders where store_id = ${s.storeId} and customer_id = ${b.id} order by created_at desc limit 20`);
    return { orders };
  });

  // ---- super admin: configurações públicas da plataforma (link da landing page no rodapé de todas as lojas) ----
  app.get('/v1/platform/public-settings', { preHandler: guard(ctx) }, async () => {
    const rows = await withPlatform(ctx.pools, (q) => q`select key, value from platform_public_settings`);
    return { settings: Object.fromEntries(rows.map((r) => [r.key as string, r.value as string])) };
  });

  // o link aparece em todas as lojas: exige o código do autenticador reconfirmado (step-up) e só aceita http(s)
  app.put('/v1/platform/public-settings', { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const b = parse(z.object({ landingUrl: z.string().trim().max(500).refine((u) => /^https?:\/\/[^\s]+$/i.test(u), 'Informe um endereço http(s) válido.') }), req.body, reply); if (!b) return;
    await withPlatform(ctx.pools, async (q) => {
      await q`insert into platform_public_settings (key, value, updated_by) values ('landing_url', ${b.landingUrl}, ${req.session!.adminId})
              on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'platform.public_settings_updated', ip: req.ip, meta: { landingUrl: b.landingUrl } });
    });
    return { ok: true };
  });
}
