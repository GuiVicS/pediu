import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createTestPools } from '@pediu/db/testing';
import { hashPassword, parseKeyring, totpAt, decryptSecret } from '@pediu/shared';
import { buildApp } from '../src/app.js';
import type { Ctx } from '../src/context.js';
import type { CheckoutParams, StripeClient, StripePrice } from '../src/stripe.js';

export const PASSWORD = 'senha-bem-longa-123';

export class TestClock { t = Date.now(); now() { return new Date(this.t); } advance(ms: number) { this.t += ms; } }

export async function setup() {
  const pools = await createTestPools();
  const clock = new TestClock();
  const prices: Record<string, StripePrice> = {};
  const checkouts: CheckoutParams[] = [];
  const stripe: StripeClient = {
    async getPrice(id) { const p = prices[id]; if (!p) throw new Error('No such price'); return p; },
    async createCheckoutSession(p) { checkouts.push(p); return { id: `cs_${checkouts.length}`, url: `https://checkout.stripe.test/cs_${checkouts.length}`, customer: null }; },
    async createPortalSession(c) { return { url: `https://portal.stripe.test/${c}` }; },
  };
  const ring = parseKeyring(`k1:${randomBytes(32).toString('base64')}`);
  const ctx: Ctx = { pools, ring, clock, baseDomain: 'pediu.test', cookieSecure: false, stripe };
  const app = buildApp(ctx);
  await app.ready();
  return { app, ctx, pools, clock, prices, checkouts, stripe, close: async () => { await app.close(); await pools.close(); } };
}
export type Env = Awaited<ReturnType<typeof setup>>;

export async function createAdmin(env: Env, email: string, password = PASSWORD) {
  const hash = await hashPassword(password);
  await env.pools.platform.begin((q) => q`insert into platform_admins (email, name, password_hash) values (${email}, 'Admin Teste', ${hash})`);
}

/** Cliente HTTP de teste com jar de cookie. */
export function client(env: Env) {
  let cookie = '';
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const res = await env.app.inject({ method, url, payload: payload as object, headers: { ...(cookie ? { cookie } : {}), ...headers } });
    const sc = res.headers['set-cookie'];
    const c = Array.isArray(sc) ? sc[0] : sc;
    if (c) cookie = c.split(';')[0]!;
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, headers: res.headers };
  };
  return {
    call, get: (u: string) => call('GET', u), post: (u: string, b?: unknown) => call('POST', u, b ?? {}), put: (u: string, b: unknown) => call('PUT', u, b), del: (u: string) => call('DELETE', u),
    get cookie() { return cookie; }, clear() { cookie = ''; },
  };
}
export type Client = ReturnType<typeof client>;

/** Código TOTP atual do admin (lê o segredo cifrado do banco) e avança o relógio para o passo seguinte, evitando anti-replay. */
export async function currentCode(env: Env, email: string, advance = true) {
  if (advance) env.clock.advance(31_000);
  const [a] = await env.pools.platform.begin((q) => q`select totp_secret_enc from platform_admins where email = ${email}`);
  return totpAt(decryptSecret(a!.totp_secret_enc, env.ctx.ring), env.clock.t);
}

/** Entra, cadastra o autenticador (1º acesso) e deixa a sessão pronta. Devolve os códigos de recuperação. */
export async function fullLogin(env: Env, c: Client, email: string) {
  const l = await c.post('/v1/platform/auth/login', { email, password: PASSWORD });
  if (l.body.next === 'enroll') {
    const en = await c.post('/v1/platform/auth/totp/enroll');
    const code = totpAt(en.body.secret, env.clock.t);
    const cf = await c.post('/v1/platform/auth/totp/confirm', { code });
    return cf.body.recoveryCodes as string[];
  }
  await c.post('/v1/platform/auth/totp/verify', { code: await currentCode(env, email) });
  return [];
}
export async function stepUp(env: Env, c: Client, email: string) {
  return c.post('/v1/platform/auth/stepup', { code: await currentCode(env, email) });
}

export function signStripe(payload: string, secret: string, tSec: number) {
  return `t=${tSec},v1=${createHmac('sha256', secret).update(`${tSec}.${payload}`).digest('hex')}`;
}
export type { FastifyInstance };

// ============ fase 1: loja em produção com cardápio, equipe e pedidos ============
import { toCents as _toCents } from '@pediu/shared';
export interface Seeded { tenantId: string; storeId: string; slug: string; cat: string; prod: string; prodB: string; group: string; addonA: string; addonB: string; zone: string; payPix: string; payCash: string; users: Record<string, { id: string; email: string }> }

/** Cria uma loja em produção completa: cardápio com adicionais, zona, pagamentos, horário aberto o tempo todo e a equipe (um usuário por perfil, senha PASSWORD). */
export async function seedStore(env: Env, slug: string, opts: { status?: string; minOrder?: number } = {}): Promise<Seeded> {
  const hash = await hashPassword(PASSWORD);
  return env.pools.platform.begin(async (q) => {
    const [t] = await q`insert into tenants (name) values (${`Conta ${slug}`}) returning id`;
    const [s] = await q`insert into stores (tenant_id, slug, name, status) values (${t!.id}, ${slug}, ${`Loja ${slug}`}, ${opts.status ?? 'producao'}) returning id`;
    const ids = { tenantId: t!.id as string, storeId: s!.id as string };
    const hours = Array.from({ length: 7 }, (_, day) => ({ day, closed: false, open: '00:00', close: '23:59' }));
    await q`insert into store_settings (store_id, tenant_id, data) values (${ids.storeId}, ${ids.tenantId}, ${JSON.stringify({ hours, minOrder: opts.minOrder ?? 0, phone: '(16) 99999-0000' })}::jsonb)`;
    const [z] = await q`insert into print_zones (store_id, tenant_id, name) values (${ids.storeId}, ${ids.tenantId}, 'Cozinha') returning id`;
    const [c] = await q`insert into categories (store_id, tenant_id, name, print_zone_id) values (${ids.storeId}, ${ids.tenantId}, 'Pizzas', ${z!.id}) returning id`;
    const [g] = await q`insert into addon_groups (store_id, tenant_id, name, min, max, required, pricing) values (${ids.storeId}, ${ids.tenantId}, 'Borda', 0, 1, false, 'sum') returning id`;
    const [a1] = await q`insert into addons (store_id, tenant_id, group_id, name, price) values (${ids.storeId}, ${ids.tenantId}, ${g!.id}, 'Catupiry', 8) returning id`;
    const [a2] = await q`insert into addons (store_id, tenant_id, group_id, name, price) values (${ids.storeId}, ${ids.tenantId}, ${g!.id}, 'Cheddar', 7) returning id`;
    const [p1] = await q`insert into products (store_id, tenant_id, category_id, name, price) values (${ids.storeId}, ${ids.tenantId}, ${c!.id}, 'Calabresa', 49.90) returning id`;
    const [p2] = await q`insert into products (store_id, tenant_id, category_id, name, price) values (${ids.storeId}, ${ids.tenantId}, ${c!.id}, 'Marguerita', 45) returning id`;
    await q`insert into product_addon_groups (store_id, tenant_id, product_id, group_id) values (${ids.storeId}, ${ids.tenantId}, ${p1!.id}, ${g!.id})`;
    const [dz] = await q`insert into delivery_zones (store_id, tenant_id, name, fee, eta) values (${ids.storeId}, ${ids.tenantId}, 'Centro', 6, 35) returning id`;
    const [pp] = await q`insert into payment_methods (store_id, tenant_id, name, type) values (${ids.storeId}, ${ids.tenantId}, 'Pix', 'pix') returning id`;
    const [pc] = await q`insert into payment_methods (store_id, tenant_id, name, type) values (${ids.storeId}, ${ids.tenantId}, 'Dinheiro', 'cash') returning id`;
    const users: Seeded['users'] = {};
    for (const role of ['admin', 'gerente', 'suporte', 'balcao', 'garcom', 'entregador'] as const) {
      const email = `${role}@${slug}.test`;
      const [u] = await q`insert into staff_users (tenant_id, store_id, email, name, role, password_hash) values (${ids.tenantId}, ${ids.storeId}, ${email}, ${`Pessoa ${role}`}, ${role}, ${hash}) returning id`;
      users[role] = { id: u!.id, email };
    }
    return { ...ids, slug, cat: c!.id, prod: p1!.id, prodB: p2!.id, group: g!.id, addonA: a1!.id, addonB: a2!.id, zone: dz!.id, payPix: pp!.id, payCash: pc!.id, users };
  });
}

export async function staffLogin(env: Env, c: Client, seed: Seeded, role: string) {
  const r = await c.post('/v1/staff/login', { store: seed.slug, email: seed.users[role]!.email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login ${role} falhou: ${JSON.stringify(r.body)}`);
  return r;
}
void _toCents;
