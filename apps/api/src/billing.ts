import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withPlatform, type Q } from '@pediu/db';
import { checkTransition, decryptSecret, encryptSecret } from '@pediu/shared';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { guard } from './session.js';
import { createStripeClient, verifyStripeSignature, type StripeClient, type StripePrice } from './stripe.js';

const uuid = z.string().uuid();
export const GRACE_DAYS = 5;

// ---- cofre de configuração da plataforma (chaves do Stripe), sempre cifrada ----
async function getSetting(ctx: Ctx, q: Q, key: string): Promise<string | null> {
  const [r] = await q`select value_enc from platform_settings where key = ${key}`;
  return r ? decryptSecret(r.value_enc, ctx.ring) : null;
}
const setSetting = (ctx: Ctx, q: Q, key: string, value: string, adminId: string) => q`
  insert into platform_settings (key, value_enc, updated_by) values (${key}, ${encryptSecret(value, ctx.ring)}, ${adminId})
  on conflict (key) do update set value_enc = excluded.value_enc, updated_by = excluded.updated_by, updated_at = now()`;

async function stripeFor(ctx: Ctx, q: Q): Promise<{ client: StripeClient; mode: 'test' | 'live' } | null> {
  const mode = (await getSetting(ctx, q, 'stripe.mode')) as 'test' | 'live' | null;
  if (ctx.stripe) return { client: ctx.stripe, mode: mode ?? 'test' };
  const key = await getSetting(ctx, q, 'stripe.secret_key');
  return key && mode ? { client: createStripeClient(key), mode } : null;
}

/** Confere cada price no Stripe: existe, está ativo, é em BRL, tem o tipo/intervalo certo e é do mesmo modo (teste/produção) da chave. */
export async function validatePrices(client: StripeClient, mode: 'test' | 'live', prices: { field: string; id: string; kind: 'month' | 'year' | 'setup' }[]): Promise<string[]> {
  const errors: string[] = [];
  await Promise.all(prices.map(async ({ field, id, kind }) => {
    let p: StripePrice;
    try { p = await client.getPrice(id); } catch (e) { errors.push(`${field}: price não encontrado no Stripe (${(e as Error).message})`); return; }
    if (!p.active) errors.push(`${field}: o price está arquivado no Stripe`);
    if (p.currency !== 'brl') errors.push(`${field}: a moeda deve ser BRL (veio ${p.currency.toUpperCase()})`);
    if (p.livemode !== (mode === 'live')) errors.push(`${field}: price de ${p.livemode ? 'produção' : 'teste'} com a chave em modo ${mode === 'live' ? 'produção' : 'teste'}`);
    if (kind === 'setup') { if (p.type !== 'one_time') errors.push(`${field}: a taxa de implantação deve ser um price único (não recorrente)`); }
    else if (p.type !== 'recurring' || p.interval !== kind) errors.push(`${field}: deve ser recorrente ${kind === 'month' ? 'mensal' : 'anual'}`);
  }));
  return errors;
}

const REVIVE_NOTE = 'cobrança regularizada';

/** Reativa lojas suspensas da conta quando a assinatura volta a ficar em dia. */
async function reactivate(q: Q, tenantId: string) {
  const stores = await q`select id, status from stores where tenant_id = ${tenantId} and status = 'suspensa' for update`;
  for (const s of stores) {
    if (!checkTransition('suspensa', 'producao', { actor: { kind: 'billing' } }).ok) continue;
    await q`update stores set status = 'producao', status_reason = ${REVIVE_NOTE} where id = ${s.id}`;
    await audit(q, { actorKind: 'billing', tenantId, storeId: s.id, action: 'store.reactivated', before: { status: 'suspensa' }, after: { status: 'producao' } });
  }
}

/** Régua de cobrança: após GRACE_DAYS em atraso, as lojas no ar da conta passam para "suspensa". Chamada por um agendador (a cada hora). */
export async function runDunning(ctx: Ctx, nowMs = ctx.clock.now().getTime()): Promise<{ suspended: string[] }> {
  const cutoff = new Date(nowMs - GRACE_DAYS * 86_400_000).toISOString();
  return withPlatform(ctx.pools, async (q) => {
    const stores = await q`
      select s.id, s.tenant_id from stores s
      where s.status = 'producao' and exists (
        select 1 from subscriptions x where x.tenant_id = s.tenant_id and x.status in ('past_due', 'unpaid') and x.past_due_since <= ${cutoff}::timestamptz)
      and not exists (select 1 from subscriptions y where y.tenant_id = s.tenant_id and y.status in ('active', 'trialing'))
      for update of s`;
    const suspended: string[] = [];
    for (const s of stores) {
      await q`update stores set status = 'suspensa', status_reason = 'pagamento em atraso' where id = ${s.id}`;
      await audit(q, { actorKind: 'billing', tenantId: s.tenant_id, storeId: s.id, action: 'store.suspended', before: { status: 'producao' }, after: { status: 'suspensa' }, meta: { graceDays: GRACE_DAYS } });
      suspended.push(s.id);
    }
    return { suspended };
  });
}

const MAP_STATUS: Record<string, string> = { incomplete: 'incomplete', incomplete_expired: 'canceled', trialing: 'trialing', active: 'active', past_due: 'past_due', canceled: 'canceled', unpaid: 'unpaid', paused: 'paused' };
const ts = (n: unknown) => (typeof n === 'number' ? new Date(n * 1000).toISOString() : null);

/** Aplica um evento do Stripe. Já roda dentro da transação que gravou o evento no webhook_inbox. */
export async function handleStripeEvent(q: Q, evt: any): Promise<void> {
  const obj = evt.data?.object ?? {};
  switch (evt.type) {
    case 'checkout.session.completed': {
      const tenantId = obj.metadata?.tenant_id ?? obj.client_reference_id;
      if (tenantId && obj.customer) await q`update tenants set stripe_customer_id = ${obj.customer} where id = ${tenantId}`;
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      let tenantId: string | null = obj.metadata?.tenant_id ?? null;
      if (!tenantId && obj.customer) tenantId = (await q`select id from tenants where stripe_customer_id = ${obj.customer}`)[0]?.id ?? null;
      if (!tenantId) return;
      const status = evt.type === 'customer.subscription.deleted' ? 'canceled' : MAP_STATUS[obj.status] ?? 'incomplete';
      const item = obj.items?.data?.[0];
      const interval = item?.price?.recurring?.interval ?? null;
      const [plan] = obj.metadata?.plan_code ? await q`select id from plans where code = ${obj.metadata.plan_code}` : [];
      const periodEnd = ts(obj.current_period_end ?? item?.current_period_end);
      await q`
        insert into subscriptions (tenant_id, plan_id, stripe_subscription_id, status, interval, amount_cents, current_period_end, trial_end, cancel_at_period_end, past_due_since)
        values (${tenantId}, ${plan?.id ?? null}, ${obj.id}, ${status}, ${interval}, ${item?.price?.unit_amount ?? null}, ${periodEnd}, ${ts(obj.trial_end)}, ${!!obj.cancel_at_period_end},
                ${status === 'past_due' || status === 'unpaid' ? new Date().toISOString() : null})
        on conflict (stripe_subscription_id) do update set
          plan_id = coalesce(excluded.plan_id, subscriptions.plan_id), status = excluded.status, interval = coalesce(excluded.interval, subscriptions.interval),
          amount_cents = coalesce(excluded.amount_cents, subscriptions.amount_cents), current_period_end = excluded.current_period_end, trial_end = excluded.trial_end,
          cancel_at_period_end = excluded.cancel_at_period_end,
          past_due_since = case when excluded.status in ('past_due', 'unpaid') then coalesce(subscriptions.past_due_since, excluded.past_due_since) else null end`;
      if (status === 'active' || status === 'trialing') await reactivate(q, tenantId);
      break;
    }
    case 'invoice.paid': {
      const subId = obj.subscription ?? obj.parent?.subscription_details?.subscription;
      if (!subId) return;
      const [s] = await q`update subscriptions set status = 'active', past_due_since = null where stripe_subscription_id = ${subId} returning tenant_id`;
      if (s) await reactivate(q, s.tenant_id);
      break;
    }
    case 'invoice.payment_failed': {
      const subId = obj.subscription ?? obj.parent?.subscription_details?.subscription;
      if (!subId) return;
      await q`update subscriptions set status = 'past_due', past_due_since = coalesce(past_due_since, now()) where stripe_subscription_id = ${subId}`;
      break;
    }
  }
}

export function billingRoutes(app: FastifyInstance, ctx: Ctx) {
  const P = '/v1/platform';

  // ---- chaves do Stripe ----
  app.get(`${P}/stripe/config`, { preHandler: guard(ctx) }, async () => withPlatform(ctx.pools, async (q) => {
    const key = await getSetting(ctx, q, 'stripe.secret_key');
    return { configured: !!key, mode: await getSetting(ctx, q, 'stripe.mode'), secretHint: key ? `…${key.slice(-4)}` : null, webhookConfigured: !!(await getSetting(ctx, q, 'stripe.webhook_secret')) };
  }));

  app.put(`${P}/stripe/config`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const b = parse(z.object({ secretKey: z.string().regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/, 'Chave do Stripe inválida'), webhookSecret: z.string().regex(/^whsec_[A-Za-z0-9]+$/, 'Segredo de webhook inválido (whsec_...)') }), req.body, reply);
    if (!b) return;
    const mode = b.secretKey.includes('_live_') ? 'live' : 'test';
    await withPlatform(ctx.pools, async (q) => {
      await setSetting(ctx, q, 'stripe.secret_key', b.secretKey, req.session!.adminId);
      await setSetting(ctx, q, 'stripe.webhook_secret', b.webhookSecret, req.session!.adminId);
      await setSetting(ctx, q, 'stripe.mode', mode, req.session!.adminId);
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'stripe.config_updated', ip: req.ip, meta: { mode } });
    });
    return { ok: true, mode };
  });

  // ---- planos (os price IDs são validados no Stripe ao salvar) ----
  app.get(`${P}/plans`, { preHandler: guard(ctx) }, async () => ({ plans: await withPlatform(ctx.pools, (q) => q`select * from plans order by sort, code`) }));

  app.put(`${P}/plans/:code`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const code = parse(z.string().regex(/^[a-z0-9-]{2,30}$/), (req.params as { code: string }).code, reply); if (!code) return;
    const price = z.string().regex(/^price_[A-Za-z0-9]+$/, 'ID de price inválido (price_...)').nullish();
    const b = parse(z.object({
      name: z.string().min(2).max(60), description: z.string().max(300).default(''), modules: z.array(z.string().max(40)).max(30).default([]),
      stripeProductId: z.string().regex(/^prod_[A-Za-z0-9]+$/).nullish(), priceMonthly: price, priceYearly: price, priceSetup: price,
      trialDays: z.number().int().min(0).max(90).default(0), active: z.boolean().default(true), sort: z.number().int().default(0),
    }), req.body, reply);
    if (!b) return;
    const out = await withPlatform(ctx.pools, async (q) => {
      const st = await stripeFor(ctx, q);
      const toCheck = [
        b.priceMonthly && { field: 'priceMonthly', id: b.priceMonthly, kind: 'month' as const },
        b.priceYearly && { field: 'priceYearly', id: b.priceYearly, kind: 'year' as const },
        b.priceSetup && { field: 'priceSetup', id: b.priceSetup, kind: 'setup' as const },
      ].filter(Boolean) as { field: string; id: string; kind: 'month' | 'year' | 'setup' }[];
      if (toCheck.length) {
        if (!st) return { errors: ['Configure as chaves do Stripe antes de vincular prices.'] };
        const errors = await validatePrices(st.client, st.mode, toCheck);
        if (errors.length) return { errors };
      }
      await q`
        insert into plans (code, name, description, modules, stripe_product_id, stripe_price_monthly, stripe_price_yearly, stripe_price_setup, trial_days, active, sort)
        values (${code}, ${b.name}, ${b.description}, (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(${JSON.stringify(b.modules)}::jsonb) x),
                ${b.stripeProductId ?? null}, ${b.priceMonthly ?? null}, ${b.priceYearly ?? null}, ${b.priceSetup ?? null}, ${b.trialDays}, ${b.active}, ${b.sort})
        on conflict (code) do update set name = excluded.name, description = excluded.description, modules = excluded.modules, stripe_product_id = excluded.stripe_product_id,
          stripe_price_monthly = excluded.stripe_price_monthly, stripe_price_yearly = excluded.stripe_price_yearly, stripe_price_setup = excluded.stripe_price_setup,
          trial_days = excluded.trial_days, active = excluded.active, sort = excluded.sort`;
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'plan.saved', ip: req.ip, meta: { code, prices: toCheck.map((p) => p.id) } });
      return { ok: true as const };
    });
    return out.errors ? fail(reply, 422, 'invalid_prices', out.errors.join(' | ')) : { ok: true };
  });

  // ---- assinaturas ----
  app.get(`${P}/subscriptions`, { preHandler: guard(ctx) }, async () => withPlatform(ctx.pools, async (q) => {
    const rows = await q`
      select s.id, s.status, s.interval, s.amount_cents, s.current_period_end, s.trial_end, s.cancel_at_period_end, s.past_due_since,
             t.id as tenant_id, t.name as tenant_name, p.code as plan_code, p.name as plan_name
      from subscriptions s join tenants t on t.id = s.tenant_id left join plans p on p.id = s.plan_id order by s.created_at desc`;
    const mrrCents = rows.filter((r) => r.status === 'active' && r.amount_cents != null).reduce((sum, r) => sum + (r.interval === 'year' ? Math.round(r.amount_cents / 12) : r.amount_cents), 0);
    const in7 = ctx.clock.now().getTime() + 7 * 86_400_000;
    return {
      subscriptions: rows,
      summary: { mrrCents, active: rows.filter((r) => r.status === 'active').length, trialing: rows.filter((r) => r.status === 'trialing').length, pastDue: rows.filter((r) => r.status === 'past_due' || r.status === 'unpaid').length,
                 canceled: rows.filter((r) => r.status === 'canceled').length, trialsEndingIn7Days: rows.filter((r) => r.status === 'trialing' && r.trial_end && new Date(r.trial_end).getTime() <= in7).length },
    };
  }));

  app.post(`${P}/subscriptions/checkout`, { preHandler: guard(ctx) }, async (req, reply) => {
    const b = parse(z.object({ tenantId: uuid, planCode: z.string().max(30), interval: z.enum(['month', 'year']), email: z.string().email().optional() }), req.body, reply); if (!b) return;
    const out = await withPlatform(ctx.pools, async (q) => {
      const st = await stripeFor(ctx, q);
      if (!st) return { status: 409, code: 'stripe_not_configured', message: 'Configure as chaves do Stripe primeiro.' };
      const [plan] = await q`select * from plans where code = ${b.planCode} and active`;
      const [tenant] = await q`select id, name, stripe_customer_id from tenants where id = ${b.tenantId}`;
      if (!plan || !tenant) return { status: 404, code: 'not_found', message: 'Plano ou conta não encontrado.' };
      const recurring = b.interval === 'month' ? plan.stripe_price_monthly : plan.stripe_price_yearly;
      if (!recurring) return { status: 422, code: 'no_price', message: `O plano não tem price ${b.interval === 'month' ? 'mensal' : 'anual'} configurado.` };
      const session = await st.client.createCheckoutSession({
        customerId: tenant.stripe_customer_id ?? undefined, customerEmail: b.email, tenantId: tenant.id, planCode: plan.code,
        prices: [recurring, ...(plan.stripe_price_setup ? [plan.stripe_price_setup] : [])], trialDays: plan.trial_days,
        successUrl: `https://admin.${ctx.baseDomain}/assinaturas?checkout=ok`, cancelUrl: `https://admin.${ctx.baseDomain}/assinaturas?checkout=cancelado`,
      });
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, tenantId: tenant.id, action: 'billing.checkout_created', ip: req.ip, meta: { plan: plan.code, interval: b.interval, sessionId: session.id } });
      return { url: session.url, sessionId: session.id };
    });
    return 'url' in out ? out : fail(reply, out.status, out.code, out.message);
  });

  app.post(`${P}/subscriptions/portal`, { preHandler: guard(ctx) }, async (req, reply) => {
    const b = parse(z.object({ tenantId: uuid }), req.body, reply); if (!b) return;
    const out = await withPlatform(ctx.pools, async (q) => {
      const st = await stripeFor(ctx, q);
      const [t] = await q`select stripe_customer_id from tenants where id = ${b.tenantId}`;
      if (!st || !t?.stripe_customer_id) return null;
      return st.client.createPortalSession(t.stripe_customer_id, `https://admin.${ctx.baseDomain}/assinaturas`);
    });
    return out ?? fail(reply, 409, 'no_customer', 'Esta conta ainda não tem cliente no Stripe (nenhum checkout concluído).');
  });

  // ---- webhook (corpo cru para conferir a assinatura; idempotente pelo id do evento) ----
  app.register(async (hook) => {
    hook.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    hook.post('/v1/webhooks/stripe', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
      const raw = req.body as string;
      const out = await withPlatform(ctx.pools, async (q) => {
        const secret = await getSetting(ctx, q, 'stripe.webhook_secret');
        if (!secret || !verifyStripeSignature(raw, req.headers['stripe-signature'] as string | undefined, secret, ctx.clock.now().getTime())) return 'bad_signature' as const;
        const evt = JSON.parse(raw);
        const ins = await q`insert into webhook_inbox (provider, event_id, payload) values ('stripe', ${evt.id}, ${raw}::jsonb) on conflict (provider, event_id) do nothing returning id`;
        if (!ins.length) return 'duplicate' as const;
        await handleStripeEvent(q, evt);
        await q`update webhook_inbox set processed_at = now() where id = ${ins[0]!.id}`;
        return 'ok' as const;
      });
      if (out === 'bad_signature') return fail(reply, 400, 'bad_signature', 'Assinatura inválida.');
      return { received: true, duplicate: out === 'duplicate' };
    });
  });
}
