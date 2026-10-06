import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { runDunning } from '../src/billing.js';
import type { StripePrice } from '../src/stripe.js';
import { encodeForm, verifyStripeSignature } from '../src/stripe.js';
import { client, createAdmin, fullLogin, setup, signStripe, stepUp, type Client, type Env } from './helpers.js';

let env: Env; let c: Client;
const EMAIL = 'cobranca@teste.com';
const WHSEC = 'whsec_testsecret123';
const price = (o: Partial<StripePrice> = {}): StripePrice => ({ id: 'price_x', active: true, currency: 'brl', type: 'recurring', interval: 'month', unitAmount: 19900, product: 'prod_1', livemode: false, ...o });

before(async () => {
  env = await setup(); await createAdmin(env, EMAIL); c = client(env); await fullLogin(env, c, EMAIL);
  await stepUp(env, c, EMAIL);
  assert.equal((await c.put('/v1/platform/stripe/config', { secretKey: 'sk_test_abc123', webhookSecret: WHSEC })).status, 200);
});
after(() => env.close());

const plano = (over: object = {}) => ({ name: 'Completo', modules: ['pdv', 'garcom'], priceMonthly: 'price_m', priceYearly: 'price_y', priceSetup: 'price_s', trialDays: 7, sort: 2, ...over });
const ensureStepUp = async () => { env.clock.advance(6 * 60_000); await stepUp(env, c, EMAIL); };

test('config do Stripe: não devolve segredos e rejeita chave malformada', async () => {
  const g = await c.get('/v1/platform/stripe/config');
  assert.deepEqual({ ...g.body }, { configured: true, mode: 'test', secretHint: '…c123', webhookConfigured: true });
  assert.equal(JSON.stringify(g.body).includes('sk_test_abc123'), false);
  await ensureStepUp();
  assert.equal((await c.put('/v1/platform/stripe/config', { secretKey: 'qualquer', webhookSecret: WHSEC })).status, 400);
  const [row] = await env.pools.platform.begin((q) => q`select value_enc from platform_settings where key = 'stripe.secret_key'`);
  assert.equal(row!.value_enc.includes('sk_test'), false); // guardado cifrado
});

test('plano: cada price é conferido no Stripe antes de salvar', async () => {
  env.prices.price_m = price({ id: 'price_m' });
  env.prices.price_y = price({ id: 'price_y', interval: 'year', unitAmount: 199000 });
  env.prices.price_s = price({ id: 'price_s', type: 'one_time', interval: null, unitAmount: 50000 });
  await ensureStepUp();
  assert.equal((await c.put('/v1/platform/plans/completo', plano())).status, 200);

  // moeda errada, modo errado, tipo/intervalo errados, arquivado, inexistente
  env.prices.price_m = price({ id: 'price_m', currency: 'usd' });
  env.prices.price_y = price({ id: 'price_y', interval: 'month' });
  env.prices.price_s = price({ id: 'price_s', livemode: true, active: false });
  const bad = await c.put('/v1/platform/plans/completo', plano());
  assert.equal(bad.status, 422);
  for (const frag of ['BRL', 'anual', 'produção', 'arquivado', 'implantação|único']) assert.match(bad.body.error.message, new RegExp(frag), `faltou: ${frag}`);
  const ghost = await c.put('/v1/platform/plans/completo', plano({ priceMonthly: 'price_naoexiste' }));
  assert.match(ghost.body.error.message, /não encontrado/);
  assert.equal((await c.put('/v1/platform/plans/completo', plano({ priceMonthly: 'abc' }))).status, 400);

  env.prices.price_m = price({ id: 'price_m' }); env.prices.price_y = price({ id: 'price_y', interval: 'year' }); env.prices.price_s = price({ id: 'price_s', type: 'one_time', interval: null });
  const [p] = await env.pools.platform.begin((q) => q`select stripe_price_monthly, stripe_price_yearly, stripe_price_setup, modules, trial_days from plans where code = 'completo'`);
  assert.equal(p!.stripe_price_monthly, 'price_m'); assert.deepEqual(p!.modules, ['pdv', 'garcom']); assert.equal(p!.trial_days, 7);
});

test('checkout: monta a sessão com o price recorrente + taxa de implantação + trial', async () => {
  const [t] = await env.pools.platform.begin((q) => q`insert into tenants (name) values ('Cliente Checkout') returning id`);
  const r = await c.post('/v1/platform/subscriptions/checkout', { tenantId: t!.id, planCode: 'completo', interval: 'year', email: 'dono@loja.com' });
  assert.equal(r.status, 200);
  assert.match(r.body.url, /^https:\/\/checkout\.stripe\.test\//);
  const last = env.checkouts.at(-1)!;
  assert.deepEqual(last.prices, ['price_y', 'price_s']);
  assert.equal(last.trialDays, 7); assert.equal(last.tenantId, t!.id); assert.equal(last.planCode, 'completo');
  assert.equal((await c.post('/v1/platform/subscriptions/checkout', { tenantId: t!.id, planCode: 'nao-existe', interval: 'month' })).status, 404);
  assert.equal((await c.post('/v1/platform/subscriptions/portal', { tenantId: t!.id })).status, 409); // ainda sem cliente no Stripe
});

const evt = (id: string, type: string, object: object) => JSON.stringify({ id, type, data: { object } });
const send = async (payload: string, secret = WHSEC, t = Math.floor(env.clock.t / 1000)) => {
  const res = await env.app.inject({ method: 'POST', url: '/v1/webhooks/stripe', payload, headers: { 'content-type': 'application/json', 'stripe-signature': signStripe(payload, secret, t) } });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

test('webhook: assinatura inválida ou velha é recusada; evento repetido não processa duas vezes', async () => {
  const p = evt('evt_sig', 'invoice.paid', { subscription: 'sub_nada' });
  assert.equal((await send(p, 'whsec_outrosegredo')).status, 400);
  assert.equal((await send(p, WHSEC, Math.floor(env.clock.t / 1000) - 3600)).status, 400);
  assert.deepEqual((await send(p)).body, { received: true, duplicate: false });
  assert.deepEqual((await send(p)).body, { received: true, duplicate: true });
  const bad = await env.app.inject({ method: 'POST', url: '/v1/webhooks/stripe', payload: p, headers: { 'content-type': 'application/json' } });
  assert.equal(bad.statusCode, 400);
});

test('ciclo completo: checkout → assinatura → publicar → atraso → suspensão após 5 dias → pagamento reativa', async () => {
  const [t] = await env.pools.platform.begin((q) => q`insert into tenants (name) values ('Cliente Ciclo') returning id`);
  const [s] = await env.pools.platform.begin((q) => q`insert into stores (tenant_id, slug, name) values (${t!.id}, 'loja-ciclo', 'Loja Ciclo') returning id`);

  await send(evt('evt_c1', 'checkout.session.completed', { customer: 'cus_ciclo', client_reference_id: t!.id, metadata: { tenant_id: t!.id, plan_code: 'completo' } }));
  const sub = (status: string, extra: object = {}) => ({ id: 'sub_ciclo', customer: 'cus_ciclo', status, metadata: { tenant_id: t!.id, plan_code: 'completo' }, items: { data: [{ price: { unit_amount: 19900, recurring: { interval: 'month' } } }] }, current_period_end: Math.floor(env.clock.t / 1000) + 2_592_000, ...extra });
  await send(evt('evt_s1', 'customer.subscription.created', sub('active')));

  const [row] = await env.pools.platform.begin((q) => q`select s.status, s.amount_cents, s.interval, p.code from subscriptions s join plans p on p.id = s.plan_id where s.stripe_subscription_id = 'sub_ciclo'`);
  assert.deepEqual({ ...row }, { status: 'active', amount_cents: 19900, interval: 'month', code: 'completo' });
  const [tn] = await env.pools.platform.begin((q) => q`select stripe_customer_id from tenants where id = ${t!.id}`);
  assert.equal(tn!.stripe_customer_id, 'cus_ciclo');
  assert.match((await c.post('/v1/platform/subscriptions/portal', { tenantId: t!.id })).body.url, /portal\.stripe\.test\/cus_ciclo/);

  await ensureStepUp();
  assert.equal((await c.post(`/v1/platform/stores/${s!.id}/status`, { to: 'producao' })).status, 200); // assinatura ativa basta

  // pagamento falha → past_due; antes do 5º dia nada acontece
  await send(evt('evt_f1', 'invoice.payment_failed', { subscription: 'sub_ciclo' }));
  assert.deepEqual((await runDunning(env.ctx)).suspended, []);
  env.clock.advance(4 * 86_400_000);
  assert.deepEqual((await runDunning(env.ctx, env.clock.t + 0)).suspended, []);
  // runDunning compara com o relógio do banco (past_due_since = now()), então simulamos o atraso no banco
  await env.pools.platform.begin((q) => q`update subscriptions set past_due_since = now() - interval '6 days' where stripe_subscription_id = 'sub_ciclo'`);
  const r = await runDunning(env.ctx);
  assert.ok(r.suspended.includes(s!.id));
  const [st] = await env.pools.platform.begin((q) => q`select status from stores where id = ${s!.id}`);
  assert.equal(st!.status, 'suspensa');

  // paga a fatura: volta sozinha
  await send(evt('evt_p1', 'invoice.paid', { subscription: 'sub_ciclo' }));
  const [back] = await env.pools.platform.begin((q) => q`select status, status_reason from stores where id = ${s!.id}`);
  assert.equal(back!.status, 'producao'); assert.equal(back!.status_reason, 'cobrança regularizada');
  const acts = (await env.pools.platform.begin((q) => q`select action from audit_logs where store_id = ${s!.id} order by id`)).map((a) => a.action);
  assert.deepEqual(acts.filter((a) => a.startsWith('store.')), ['store.status', 'store.suspended', 'store.reactivated']);
});

test('loja que nunca teve assinatura não é suspensa pela régua; assinatura cancelada não reativa por engano', async () => {
  const [t] = await env.pools.platform.begin((q) => q`insert into tenants (name) values ('Cortesia') returning id`);
  const [s] = await env.pools.platform.begin((q) => q`insert into stores (tenant_id, slug, name, status) values (${t!.id}, 'loja-cortesia', 'Cortesia', 'producao') returning id`);
  await runDunning(env.ctx);
  const [st] = await env.pools.platform.begin((q) => q`select status from stores where id = ${s!.id}`);
  assert.equal(st!.status, 'producao');
});

test('resumo: MRR soma ativas (anual dividido por 12) e conta por status', async () => {
  c = client(env); await fullLogin(env, c, EMAIL); // a sessão anterior expirou por inatividade (o relógio andou dias)
  const [t] = await env.pools.platform.begin((q) => q`insert into tenants (name) values ('Anual') returning id`);
  await env.pools.platform.begin((q) => q`insert into subscriptions (tenant_id, status, interval, amount_cents) values (${t!.id}, 'active', 'year', 120000)`);
  const r = await c.get('/v1/platform/subscriptions');
  assert.equal(r.status, 200);
  const anual = 10000; // 120000 / 12
  assert.ok(r.body.summary.mrrCents >= 19900 + anual);
  assert.ok(r.body.summary.active >= 2);
});

test('utilitários do Stripe: form aninhado e conferência de assinatura', () => {
  assert.equal(encodeForm({ mode: 'subscription', line_items: [{ price: 'p1', quantity: 1 }], metadata: { a: 'b c' } }).join('&'),
    'mode=subscription&line_items%5B0%5D%5Bprice%5D=p1&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Ba%5D=b%20c');
  const body = '{"a":1}', sig = signStripe(body, WHSEC, 1000);
  assert.equal(verifyStripeSignature(body, sig, WHSEC, 1_000_000), true);
  assert.equal(verifyStripeSignature(body + ' ', sig, WHSEC, 1_000_000), false);
  assert.equal(verifyStripeSignature(body, undefined, WHSEC), false);
});
