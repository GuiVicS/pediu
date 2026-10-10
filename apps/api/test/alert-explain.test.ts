import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlerts } from '../src/alerts.js';
import { explainAlert, fmtMinutes } from '../src/alertExplain.js';
import { client, createAdmin, fullLogin, seedStore, setup, staffLogin, type Client, type Env, type Seeded } from './helpers.js';

const now = new Date('2026-10-10T15:00:00Z');
const mins = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

test('tempo em português: minutos, horas e zero', () => {
  assert.equal(fmtMinutes(0.2), 'menos de 1 min'); assert.equal(fmtMinutes(40), '40 min'); assert.equal(fmtMinutes(95), '1h35'); assert.equal(fmtMinutes(125), '2h05');
});

test('explicações dizem o que aconteceu com os números do alerta, por que importa e o que fazer', () => {
  const stuck = explainAlert({ ruleKey: 'store.order_stuck', detail: { orders: 2, oldest: mins(35) }, params: { max_minutes: 10 }, storeName: 'Pizzaria do Gaúcho', now });
  assert.match(stuck.what, /Pizzaria do Gaúcho tem 2 pedidos novos que ninguém aceitou há mais de 10 min/); assert.match(stuck.what, /35 min/);
  assert.ok(stuck.why.length > 40 && stuck.steps.length >= 3);
  assert.match(explainAlert({ ruleKey: 'store.order_stuck', detail: { orders: 1 }, params: null, storeName: 'X', now }).what, /1 pedido novo/);      // singular, sem tempo conhecido
  assert.match(explainAlert({ ruleKey: 'store.cancel_rate', detail: { rate: 0.4, cancelled: 4, orders: 10 }, params: { window_hours: 24 }, storeName: 'L', now }).what, /40% dos pedidos recentes \(4 de 10\).*24h/);
  assert.match(explainAlert({ ruleKey: 'platform.api_errors', detail: { errors: 12, requests: 200 }, params: { window_min: 10 }, now }).what, /12 de 200 chamadas.*10 min/);
  assert.match(explainAlert({ ruleKey: 'security.auth_failures', detail: { failures: 9, distinctIps: 4 }, params: { window_min: 15 }, now }).what, /9 tentativas de login falharam.*4 endereços/);
  assert.match(explainAlert({ ruleKey: 'billing.past_due', detail: { since: mins(3 * 1440) }, params: null, storeName: 'Loja', now }).what, /3 dias/);
  assert.match(explainAlert({ ruleKey: 'platform.webhook_stuck', detail: { provider: 'mercadopago', count: 3, oldest: mins(90) }, params: null, now }).what, /3 avisos do mercadopago.*1h30/);
  assert.match(explainAlert({ ruleKey: 'regra.desconhecida', detail: null, params: null, now }).what, /gerado automaticamente/);                 // regra nova nunca quebra a tela
});

let env: Env; let sa: Client; let A: Seeded;
before(async () => { env = await setup(); await createAdmin(env, 'sa-alertas@pediu.test'); sa = client(env); await fullLogin(env, sa, 'sa-alertas@pediu.test'); A = await seedStore(env, 'gaucho'); });
after(() => env.close());

test('alerta com logs associados: texto simples na lista; "Entender" traz explicação, pedidos parados e só os logs certos', async () => {
  const admin = client(env); await staffLogin(env, admin, A, 'admin');
  const o = await admin.post('/v1/staff/orders', { type: 'retirada', customerName: 'Cliente', lines: [{ productId: A.prod, qty: 1, addons: [] }] });
  assert.equal(o.status, 201);
  const other = await seedStore(env, 'outra-loja');
  await env.pools.platform.begin(async (q) => {
    await q`insert into app_logs (level, service, store_id, tenant_id, event, message) values
      ('error', 'print', ${A.storeId}, ${A.tenantId}, 'print.agent_offline', 'Agente de impressão desconectado'),
      ('warn', 'payments', ${A.storeId}, ${A.tenantId}, 'payment.retry', 'Pagamento tentou de novo'),
      ('info', 'api', ${A.storeId}, ${A.tenantId}, 'order.created', 'Pedido criado (info não entra)'),
      ('error', 'api', ${other.storeId}, ${other.tenantId}, 'x.other_store', 'Erro de OUTRA loja (não entra)')`;
  });
  env.clock.advance(60 * 60_000);                                   // o pedido ficou 1h sem aceite
  await evaluateAlerts(env.ctx);
  sa = client(env); await fullLogin(env, sa, 'sa-alertas@pediu.test');          // a sessão expira por inatividade enquanto o relógio de teste avançou

  const list = (await sa.get('/v1/platform/alerts?status=active')).body.alerts.find((a: any) => a.rule_key === 'store.order_stuck' && a.store_id === A.storeId);
  assert.ok(list); assert.match(list.plain, /Loja gaucho tem 1 pedido novo que ninguém aceitou/); assert.equal(list.rule_params, undefined);   // parâmetros internos não vazam

  const ctx = (await sa.get(`/v1/platform/alerts/${list.id}/context`)).body;
  assert.equal(ctx.alert.store_name, 'Loja gaucho'); assert.equal(ctx.explanation.steps.length >= 3, true); assert.match(ctx.explanation.why, /cliente/);
  assert.equal(ctx.facts.length, 1); assert.match(ctx.facts[0].label, new RegExp(`Pedido #${o.body.number} \\(retirada`)); assert.match(ctx.facts[0].value, /esperando há/);
  assert.deepEqual(ctx.logs.map((l: any) => l.event).sort(), ['payment.retry', 'print.agent_offline']);           // só warn/error e só da loja
  assert.equal((await sa.get('/v1/platform/alerts/00000000-0000-4000-8000-000000000000/context')).status, 404);
  assert.equal((await client(env).get(`/v1/platform/alerts/${list.id}/context`)).status, 401);                    // só super admin
});
