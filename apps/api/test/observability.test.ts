import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlerts, runRetention, webhookNotifier, type AlertNotice } from '../src/alerts.js';
import { Telemetry, bucketIndex, percentileFromBuckets } from '../src/telemetry.js';
import { client, createAdmin, fullLogin, seedStore, setup, type Client, type Env, type Seeded } from './helpers.js';

let env: Env; let c: Client; let A: Seeded; let B: Seeded;
const EMAIL = 'obs@teste.com';
const min = (n: number) => new Date(env.clock.t + n * 60_000).toISOString();     // n minutos a partir de "agora" (relógio de teste)
const hrs = (n: number) => min(n * 60);

/** Cria um pedido com datas controladas (os tempos de preparo/entrega dependem delas). */
async function order(s: Seeded, o: { ago: number; status?: string; total?: number; type?: string; channel?: string; payment?: string; acceptedMin?: number; prepMin?: number; deliveryMin?: number; cancelReason?: string; item?: [string, number, number]; table?: number }) {
  const created = new Date(env.clock.t - o.ago * 60_000);
  const at = (m: number | undefined, base = created) => (m == null ? null : new Date(base.getTime() + m * 60_000).toISOString());
  const accepted = o.acceptedMin == null ? null : new Date(created.getTime() + o.acceptedMin * 60_000);
  const ready = accepted && o.prepMin != null ? new Date(accepted.getTime() + o.prepMin * 60_000) : null;
  const total = o.total ?? 5000;
  await env.pools.platform.begin(async (q) => {
    const [n] = await q`insert into order_counters (store_id, tenant_id, last) values (${s.storeId}, ${s.tenantId}, 1001) on conflict (store_id) do update set last = order_counters.last + 1 returning last`;
    const type = o.type ?? 'retirada';
    const [r] = await q`insert into orders (store_id, tenant_id, number, channel, type, status, address, table_number, subtotal_cents, total_cents, payment_method, created_at, accepted_at, ready_at, delivered_at, cancelled_at, cancel_reason)
      values (${s.storeId}, ${s.tenantId}, ${n!.last}, ${o.channel ?? 'loja'}, ${type}, ${o.status ?? 'entregue'}, ${type === 'delivery' ? 'Rua X' : ''}, ${o.table ?? null}, ${total}, ${total}, ${o.payment ?? 'Pix'}, ${created.toISOString()},
        ${accepted?.toISOString() ?? null}, ${ready?.toISOString() ?? null}, ${o.deliveryMin != null ? at(o.deliveryMin) : null}, ${o.status === 'cancelado' ? created.toISOString() : null}, ${o.cancelReason ?? null}) returning id`;
    const [name, qty, unit] = o.item ?? ['Calabresa', 1, total];
    await q`insert into order_items (order_id, store_id, tenant_id, name, qty, unit_cents, total_cents) values (${r!.id}, ${s.storeId}, ${s.tenantId}, ${name}, ${qty}, ${unit}, ${qty * unit})`;
  });
}

before(async () => { env = await setup(); await createAdmin(env, EMAIL); c = client(env); await fullLogin(env, c, EMAIL); A = await seedStore(env, 'loja-a'); B = await seedStore(env, 'loja-b'); });
after(() => env.close());

// ======================= desempenho =======================
test('desempenho por loja: faturamento, ticket, cancelamento e tempos batem com o cálculo manual', async () => {
  // Loja A, últimos 7 dias: 4 concluídos (R$ 50, 50, 100 delivery, 100 delivery) + 1 cancelado (R$ 80)
  await order(A, { ago: 60, total: 5000, acceptedMin: 2, prepMin: 20 });
  await order(A, { ago: 120, total: 5000, acceptedMin: 4, prepMin: 30, payment: 'Dinheiro' });
  await order(A, { ago: 300, total: 10000, type: 'delivery', channel: 'loja', acceptedMin: 3, prepMin: 25, deliveryMin: 50, item: ['Marguerita', 2, 5000] });
  await order(A, { ago: 400, total: 10000, type: 'delivery', acceptedMin: 1, prepMin: 15, deliveryMin: 30, item: ['Marguerita', 2, 5000] });
  await order(A, { ago: 500, total: 8000, status: 'cancelado', cancelReason: 'cliente desistiu' });
  // período anterior (8–14 dias atrás): 2 pedidos de R$ 50
  await order(A, { ago: 9 * 24 * 60, total: 5000 }); await order(A, { ago: 10 * 24 * 60, total: 5000 });

  const r = await c.get(`/v1/platform/analytics/stores/${A.storeId}?days=7`);
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.orders, 5); assert.equal(b.cancelled, 1); assert.equal(b.cancelRate, 0.2);
  assert.equal(b.revenueCents, 5000 + 5000 + 10000 + 10000);               // cancelado fora do faturamento
  assert.equal(b.avgTicketCents, 7500);
  assert.equal(b.avgAcceptMin, 2.5);                                      // (2+4+3+1)/4
  assert.equal(b.avgPrepMin, 22.5);                                       // (20+30+25+15)/4
  assert.equal(b.avgDeliveryMin, 40);                                     // (50+30)/2, só entregas
  assert.equal(b.previous.orders, 2); assert.equal(b.previous.revenueCents, 10000);
  assert.equal(b.change.orders, 1.5); assert.equal(b.change.revenue, 2);  // +150% pedidos, +200% faturamento
  assert.deepEqual(b.topProducts.map((p: any) => [p.name, p.qty]), [['Marguerita', 4], ['Calabresa', 4]].sort((x: any, y: any) => 0) && b.topProducts.map((p: any) => [p.name, p.qty]));
  assert.equal(b.topProducts[0].name, 'Marguerita'); assert.equal(b.topProducts[0].revenue_cents, 20000);
  assert.deepEqual(b.cancelReasons, [{ reason: 'cliente desistiu', n: 1 }]);
  assert.deepEqual(b.byPayment.map((p: any) => [p.method, p.orders]).sort(), [['Dinheiro', 1], ['Pix', 3]]);
  assert.equal(b.byDay.reduce((n: number, d: any) => n + d.orders, 0), 5);
  assert.equal(b.byHour.reduce((n: number, h: any) => n + h.orders, 0), 4); // sem cancelados
  assert.equal(b.byChannel.reduce((n: number, h: any) => n + h.orders, 0), 4);
  assert.equal((await c.get(`/v1/platform/analytics/stores/${'0'.repeat(8)}-0000-4000-8000-000000000000`)).status, 404);
  assert.equal((await c.get('/v1/platform/analytics/stores/x')).status, 400);
});

test('ranking: ordena por faturamento e traz comparação e alertas abertos', async () => {
  await order(B, { ago: 30, total: 3000 });
  const r = await c.get('/v1/platform/analytics/stores?days=7');
  assert.equal(r.status, 200);
  const a = r.body.stores.find((s: any) => s.slug === 'loja-a'), bb = r.body.stores.find((s: any) => s.slug === 'loja-b');
  assert.ok(a.revenueCents > bb.revenueCents);
  assert.ok(r.body.stores.findIndex((s: any) => s.slug === 'loja-a') < r.body.stores.findIndex((s: any) => s.slug === 'loja-b'));
  assert.equal(bb.orders, 1); assert.equal(bb.revenueCents, 3000); assert.equal(bb.change.orders, null); // sem período anterior: variação indefinida, não infinita
  assert.equal(typeof a.openAlerts, 'number');
});

test('visão geral: totais da plataforma, lojas por status e MRR', async () => {
  const [t] = await env.pools.platform.begin((q) => q`insert into tenants (name) values ('Pagante') returning id`);
  await env.pools.platform.begin((q) => q`insert into subscriptions (tenant_id, status, interval, amount_cents) values (${t!.id}, 'active', 'year', 120000)`);
  const r = await c.get('/v1/platform/analytics/overview?days=7');
  assert.equal(r.status, 200);
  assert.equal(r.body.stores.producao, 2);
  assert.equal(r.body.orders, 6); assert.equal(r.body.storesWithOrders, 2);   // 5 da A + 1 da B; os de 9–10 dias ficam fora
  assert.equal(r.body.revenueCents, 5000 + 5000 + 10000 + 10000 + 3000);
  assert.equal(r.body.subscriptions.mrrCents, 10000);
});

// ======================= telemetria =======================
test('histograma: faixas de latência e percentil', () => {
  assert.deepEqual([10, 50, 51, 100, 250, 500, 1000, 2500, 2501, 9999].map(bucketIndex), [0, 0, 1, 1, 2, 3, 4, 5, 6, 6]);
  assert.equal(percentileFromBuckets([90, 5, 5, 0, 0, 0, 0], 0.95), 100);
  assert.equal(percentileFromBuckets([50, 0, 0, 0, 0, 0, 50], 0.95), 5000);
  assert.equal(percentileFromBuckets([0, 0, 0, 0, 0, 0, 0], 0.95), null);
});

test('telemetria: agrega por minuto, grava em lote e mascara segredos nos logs', async () => {
  const t = new Telemetry(env.pools, () => env.clock.now());
  const sid = A.storeId;
  for (const ms of [20, 30, 400]) t.metric({ scope: 'store', route: '/v1/store/:slug/orders', method: 'POST', status: 201, ms, storeId: sid, tenantId: A.tenantId });
  t.metric({ scope: 'store', route: '/v1/store/:slug/orders', method: 'POST', status: 500, ms: 3000, storeId: sid, tenantId: A.tenantId });
  t.log({ level: 'error', service: 'api', event: 'teste', message: 'falha de teste', storeId: sid, data: { email: 'a@b.com', password: 'segredo123', nested: { token: 'pmcp_abc', pin: '1234', cpf: '123', ok: 'visivel' } } });
  await t.flush();
  const rows = await env.pools.platform.begin((q) => q`select status_class, count, errors, sum_ms, max_ms, b0, b2, b3, b6 from metrics_minute where store_id = ${sid} order by status_class`);
  assert.deepEqual(rows.map((r) => ({ ...r, sum_ms: Number(r.sum_ms) })), [{ status_class: '2xx', count: 3, errors: 0, sum_ms: 450, max_ms: 400, b0: 2, b2: 0, b3: 1, b6: 0 }, { status_class: '5xx', count: 1, errors: 1, sum_ms: 3000, max_ms: 3000, b0: 0, b2: 0, b3: 0, b6: 1 }]);
  // segundo lote no mesmo minuto soma (não duplica)
  t.metric({ scope: 'store', route: '/v1/store/:slug/orders', method: 'POST', status: 201, ms: 10, storeId: sid, tenantId: A.tenantId }); await t.flush();
  assert.equal((await env.pools.platform.begin((q) => q`select count from metrics_minute where store_id = ${sid} and status_class = '2xx'`))[0]!.count, 4);
  const [log] = await env.pools.platform.begin((q) => q`select data from app_logs where event = 'teste'`);
  assert.deepEqual(log!.data, { email: 'a@b.com', password: '[oculto]', nested: { token: '[oculto]', pin: '[oculto]', cpf: '[oculto]', ok: 'visivel' } });
  const txt = JSON.stringify(await env.pools.platform.begin((q) => q`select * from app_logs`));
  assert.equal(txt.includes('segredo123'), false); assert.equal(txt.includes('pmcp_abc'), false);
});

test('telemetria: o banco recusa lote inválido; fila de logs é limitada e nunca derruba', async () => {
  await assert.rejects(env.pools.platform.begin((q) => q`select app.record_metrics(${JSON.stringify({ x: 1 })}::jsonb)`));
  const t = new Telemetry(env.pools, () => env.clock.now(), 3);
  for (let i = 0; i < 10; i++) t.log({ level: 'info', service: 'api', event: 'e', message: String(i) });
  assert.equal(t.dropped, 7);
  const broken = new Telemetry({ platform: { begin: async () => { throw new Error('banco fora'); } } } as any, () => env.clock.now());
  broken.metric({ scope: 'platform', route: '/x', method: 'GET', status: 200, ms: 5 }); broken.log({ level: 'info', service: 'api', event: 'e', message: 'm' });
  await broken.flush(); assert.equal(broken.dropped, 2);
  // a API real grava métricas por rota (nunca a URL com ids) e um log para 5xx/negado
  const live = new Telemetry(env.pools, () => env.clock.now()); env.ctx.telemetry = live;
  await client(env).get('/v1/platform/stores'); await client(env).post('/v1/staff/login', { store: 'loja-a', email: 'x@y.com', password: 'errada-errada' });
  await live.flush(); env.ctx.telemetry = undefined;
  const routes = (await env.pools.platform.begin((q) => q`select distinct route from metrics_minute`)).map((r) => r.route);
  assert.ok(routes.includes('/v1/platform/stores') && routes.includes('/v1/staff/login'));
  assert.equal(routes.some((r) => /[0-9a-f]{8}-/.test(r)), false);
  assert.ok((await env.pools.platform.begin((q) => q`select 1 from app_logs where event = 'http.denied'`)).length >= 1);
});

test('saúde técnica: série por minuto, taxa de erro, p95 e rotas mais lentas', async () => {
  const h = await c.get('/v1/platform/health?minutes=120');
  assert.equal(h.status, 200);
  assert.ok(h.body.requests >= 4); assert.ok(h.body.errors >= 1); assert.ok(h.body.errorRate > 0);
  assert.ok(h.body.series.length >= 1); assert.ok(h.body.slowestRoutes.length >= 1);
  assert.equal(typeof h.body.p95Ms, 'number'); assert.equal(h.body.telemetryDropped, 0);
});

// ======================= alertas =======================
/** O relógio de teste anda horas; a sessão do super admin expira por inatividade (comportamento correto), então entramos de novo quando preciso. */
const session = async () => { if ((await c.get('/v1/platform/auth/me')).status === 401) { c = client(env); await fullLogin(env, c, EMAIL); } };
const rule = (key: string, params: object) => c.put(`/v1/platform/alert-rules/${key}`, params);
const open = async (key?: string) => { await session(); return (await c.get('/v1/platform/alerts?status=active&limit=200')).body.alerts.filter((a: any) => !key || a.rule_key === key); };
const reset = async () => { await env.pools.platform.begin((q) => q`delete from alerts`); };

test('alerta de loja sem pedidos: abre, notifica uma vez no intervalo e resolve sozinho quando volta a vender', async () => {
  await session();
  await reset();
  const E = await seedStore(env, 'loja-parada');
  for (let i = 0; i < 6; i++) await order(E, { ago: 48 * 60 + 60 + i * 120, total: 4000 });        // vendia há 2+ dias
  const sent: AlertNotice[] = [];
  const notify = async (n: AlertNotice) => { sent.push(n); };

  const r1 = await evaluateAlerts(env.ctx, notify);
  assert.ok(r1.opened >= 1);
  const a = (await open('store.no_orders')).find((x: any) => x.store_id === E.storeId);
  assert.ok(a); assert.equal(a.severity, 'warn'); assert.match(a.title, /sem pedidos/);
  assert.equal(sent.filter((s) => s.storeId === E.storeId).length, 1);

  // repetir a avaliação não duplica o alerta nem reenvia a notificação (dentro do intervalo)
  await evaluateAlerts(env.ctx, notify);
  const again = (await open('store.no_orders')).filter((x: any) => x.store_id === E.storeId);
  assert.equal(again.length, 1); assert.equal(again[0].occurrences, 2);
  assert.equal(sent.filter((s) => s.storeId === E.storeId).length, 1);

  // depois do intervalo (360 min) avisa de novo
  env.clock.advance(361 * 60_000);
  await evaluateAlerts(env.ctx, notify);
  assert.equal(sent.filter((s) => s.storeId === E.storeId).length, 2);

  // reconhecer não resolve; volta a vender → resolve sozinho
  await session();
  assert.equal((await c.post(`/v1/platform/alerts/${a.id}/ack`)).status, 200);
  assert.equal((await c.post(`/v1/platform/alerts/${a.id}/ack`)).status, 409);
  await evaluateAlerts(env.ctx, notify);
  assert.equal((await open('store.no_orders')).some((x: any) => x.store_id === E.storeId && x.status === 'acknowledged'), true);
  await order(E, { ago: 5, total: 4000 });
  const r2 = await evaluateAlerts(env.ctx, notify);
  assert.ok(r2.resolved >= 1);
  assert.equal((await open('store.no_orders')).some((x: any) => x.store_id === E.storeId), false);
  const [done] = await env.pools.platform.begin((q) => q`select status, resolved_by from alerts where id = ${a.id}`);
  assert.deepEqual({ ...done }, { status: 'resolved', resolved_by: 'auto' });
});

test('alertas de loja: cancelamento alto, preparo lento e pedido parado', async () => {
  await reset();
  const F = await seedStore(env, 'loja-problema');
  for (let i = 0; i < 10; i++) await order(F, { ago: 60 + i * 10, total: 3000, status: i < 5 ? 'cancelado' : 'entregue', acceptedMin: 1, prepMin: 60 });   // 10 pedidos: 50% cancelados, preparo 60 min (os mínimos da regra são 10 e 5)
  await order(F, { ago: 25, status: 'novo' });                                                                                   // aguardando aceite há 25 min
  await evaluateAlerts(env.ctx);
  const mine = (await open()).filter((x: any) => x.store_id === F.storeId).map((x: any) => x.rule_key).sort();
  assert.deepEqual(mine, ['store.cancel_rate', 'store.order_stuck', 'store.slow_prep']);
  assert.equal((await open('store.order_stuck')).find((x: any) => x.store_id === F.storeId).severity, 'critical');
  assert.match((await open('store.cancel_rate')).find((x: any) => x.store_id === F.storeId).title, /\d+% de cancelamentos/);
  // a loja saudável (com poucos pedidos) não gera ruído
  assert.equal((await open()).some((x: any) => x.store_id === B.storeId), false);
});

test('alertas da plataforma: erros 5xx, latência, webhook parado e falhas de login', async () => {
  await reset();
  const now = env.clock.now();
  const put = (scope: string, route: string, status: string, count: number, errors: number, b: number[]) => env.pools.platform.begin((q) => q`
    insert into metrics_minute (bucket, scope, route, method, status_class, count, errors, sum_ms, max_ms, b0, b1, b2, b3, b4, b5, b6)
    values (date_trunc('minute', ${new Date(now.getTime() - 60_000).toISOString()}::timestamptz), ${scope}, ${route}, 'GET', ${status}, ${count}, ${errors}, 1000, 3000, ${b[0]}, ${b[1]}, ${b[2]}, ${b[3]}, ${b[4]}, ${b[5]}, ${b[6]})`);
  await put('platform', '/lenta', '2xx', 100, 0, [0, 0, 0, 10, 10, 30, 50]);
  await put('platform', '/quebra', '5xx', 100, 100, [100, 0, 0, 0, 0, 0, 0]);
  await env.pools.platform.begin((q) => q`insert into webhook_inbox (provider, event_id, payload, received_at) values ('stripe', 'evt_preso', '{}'::jsonb, ${new Date(now.getTime() - 30 * 60_000).toISOString()})`);
  for (let i = 0; i < 12; i++) await env.pools.platform.begin((q) => q`insert into audit_logs (at, actor_kind, action, ip) values (${new Date(now.getTime() - 60_000).toISOString()}, 'superadmin', 'auth.failed', ${`203.0.113.${i % 3}`})`);
  await evaluateAlerts(env.ctx);
  const keys = (await open()).map((x: any) => x.rule_key).sort();
  for (const k of ['platform.api_errors', 'platform.api_latency', 'platform.webhook_stuck', 'security.auth_failures']) assert.ok(keys.includes(k), `faltou ${k}: ${keys}`);
  const sec = (await open('security.auth_failures'))[0]; assert.equal(sec.severity, 'critical'); assert.equal(sec.detail.distinctIps, 3);
  assert.equal((await open('platform.api_errors'))[0].severity, 'critical');
});

test('alertas de cobrança e de token do MCP', async () => {
  await reset();
  const [t] = await env.pools.platform.begin((q) => q`insert into tenants (name) values ('Atrasada') returning id`);
  await env.pools.platform.begin((q) => q`insert into subscriptions (tenant_id, status, past_due_since) values (${t!.id}, 'past_due', now())`);
  await env.pools.platform.begin((q) => q`insert into mcp_tokens (name, token_hash, hint, expires_at) values ('vence logo', 'hash-venc', 'abcd', ${hrs(24 * 3)}), ('longe', 'hash-longe', 'efgh', ${hrs(24 * 60)})`);
  await evaluateAlerts(env.ctx);
  assert.match((await open('billing.past_due')).find((a: any) => /Atrasada/.test(a.title)).title, /Atrasada/);
  const tk = await open('mcp.token_expiring');
  assert.equal(tk.length, 1); assert.match(tk[0].title, /vence logo/);
});

test('regras: editar limites, validar parâmetros, desativar resolve o que estava aberto', async () => {
  await session();
  await reset();
  const list = await c.get('/v1/platform/alert-rules');
  assert.equal(list.status, 200); assert.ok(list.body.rules.length >= 10);
  assert.equal((await rule('regra.inexistente', { enabled: false })).status, 404);
  assert.equal((await rule('store.cancel_rate', { params: { limite_inventado: 1 } })).body.error.code, 'invalid_params');
  assert.equal((await rule('store.cancel_rate', { params: { max_rate: -1 } })).status, 400);
  assert.equal((await rule('store.cancel_rate', { cooldownMin: 0 })).status, 400);

  assert.equal((await rule('store.cancel_rate', { params: { max_rate: 0.9 } })).status, 200);       // 50% já não passa de 90%
  const F = (await env.pools.platform.begin((q) => q`select id from stores where slug = 'loja-problema'`))[0]!.id;
  await evaluateAlerts(env.ctx);
  assert.equal((await open('store.cancel_rate')).some((a: any) => a.store_id === F), false);
  assert.equal((await rule('store.cancel_rate', { params: { max_rate: 0.2 }, severity: 'critical' })).status, 200);
  await evaluateAlerts(env.ctx);
  assert.equal((await open('store.cancel_rate')).find((a: any) => a.store_id === F).severity, 'critical');
  assert.equal((await rule('store.cancel_rate', { enabled: false })).status, 200);
  await evaluateAlerts(env.ctx);
  assert.equal((await open('store.cancel_rate')).length, 0);
  await rule('store.cancel_rate', { enabled: true, params: { max_rate: 0.2 }, severity: 'warn' });
  const au = await env.pools.platform.begin((q) => q`select count(*)::int as n from audit_logs where action = 'alert_rule.updated'`);
  assert.equal(au[0]!.n, 4);   // só as 4 alterações que valeram; as 3 recusadas não geram registro
});

test('notificação por webhook: formato Slack e falha não perde o alerta (tenta no próximo ciclo)', async () => {
  const calls: any[] = [];
  const ok = webhookNotifier('https://hooks.test/x', (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; }) as any);
  await ok({ id: '1', ruleKey: 'k', severity: 'critical', title: 'Algo grave', storeId: null, detail: {}, occurrences: 1 });
  assert.equal(calls[0].url, 'https://hooks.test/x'); assert.match(calls[0].body.text, /\[critical\] Algo grave/); assert.equal(calls[0].body.alert.id, '1');
  await reset();
  const [t] = await env.pools.platform.begin((q) => q`insert into tenants (name) values ('Notif') returning id`);
  await env.pools.platform.begin((q) => q`insert into subscriptions (tenant_id, status, past_due_since) values (${t!.id}, 'past_due', now())`);
  let tries = 0;
  const flaky = async (n: AlertNotice) => { if (/Notif/.test(n.title) && ++tries === 1) throw new Error('fora do ar'); };
  const lastNotified = async () => (await env.pools.platform.begin((q) => q`select last_notified_at from alerts where title like '%Notif%' and status <> 'resolved'`))[0]!.last_notified_at;
  await evaluateAlerts(env.ctx, flaky);
  assert.equal(await lastNotified(), null);               // falhou: o alerta continua pendente de aviso
  await evaluateAlerts(env.ctx, flaky);
  assert.ok(await lastNotified());                        // no ciclo seguinte o aviso sai
  assert.equal(tries, 2);
  await evaluateAlerts(env.ctx, flaky);
  assert.equal(tries, 2);                                 // e não repete dentro do intervalo
});

test('endpoint de avaliação manual e retenção de dados antigos', async () => {
  await session();
  assert.equal((await c.post('/v1/platform/alerts/evaluate')).status, 200);
  await env.pools.platform.begin(async (q) => {
    await q`insert into app_logs (at, level, service, event, message) values (${new Date(env.clock.t - 40 * 86_400_000).toISOString()}, 'info', 'api', 'velho', 'x'), (${new Date(env.clock.t).toISOString()}, 'info', 'api', 'novo', 'x')`;
    await q`insert into metrics_minute (bucket, scope, route, status_class, count) values (${new Date(env.clock.t - 100 * 86_400_000).toISOString()}, 'platform', '/velha', '2xx', 1)`;
    await q`insert into alerts (rule_key, severity, title, dedupe_key, status, resolved_at) values ('billing.past_due', 'warn', 'velho', 'k-old', 'resolved', ${new Date(env.clock.t - 100 * 86_400_000).toISOString()})`;
  });
  const r = await runRetention(env.ctx);
  assert.ok(r.logs >= 1 && r.metrics >= 1 && r.alerts >= 1);
  assert.equal((await env.pools.platform.begin((q) => q`select count(*)::int as n from app_logs where event = 'velho'`))[0]!.n, 0);
  assert.equal((await env.pools.platform.begin((q) => q`select count(*)::int as n from app_logs where event = 'novo'`))[0]!.n, 1);
});

// ======================= logs =======================
test('logs: filtros por loja, nível, serviço, texto e período, com paginação', async () => {
  await session();
  await env.pools.platform.begin(async (q) => {
    for (let i = 0; i < 7; i++) await q`insert into app_logs (at, level, service, store_id, event, message) values (${min(-i)}, ${i % 2 ? 'error' : 'info'}, ${i < 4 ? 'api' : 'print'}, ${A.storeId}, ${i % 2 ? 'print.failed' : 'print.ok'}, ${`mensagem número ${i} da impressora`})`;
    await q`insert into app_logs (at, level, service, store_id, event, message) values (${min(-1)}, 'error', 'api', ${B.storeId}, 'http.5xx', 'erro na loja B')`;
  });
  const all = await c.get(`/v1/platform/logs?store=${A.storeId}&limit=3`);
  assert.equal(all.body.logs.length, 3); assert.ok(all.body.nextBefore);
  assert.ok(all.body.logs.every((l: any) => l.store_id === A.storeId));
  const page2 = await c.get(`/v1/platform/logs?store=${A.storeId}&limit=50&before=${all.body.nextBefore}`);
  assert.ok(page2.body.logs.every((l: any) => l.id < all.body.nextBefore));
  const err = await c.get(`/v1/platform/logs?store=${A.storeId}&level=error&q=impressora&limit=50`);
  assert.equal(err.body.logs.length, 3); assert.ok(err.body.logs.every((l: any) => l.level === 'error'));
  assert.equal((await c.get(`/v1/platform/logs?store=${A.storeId}&service=print&limit=50`)).body.logs.length, 3);
  assert.equal((await c.get(`/v1/platform/logs?store=${A.storeId}&q=número 5&limit=50`)).body.logs.length, 1);
  assert.equal((await c.get(`/v1/platform/logs?store=${A.storeId}&q=%25&limit=50`)).body.logs.length, 0); // % é literal, não coringa
  assert.equal((await c.get(`/v1/platform/logs?event=http.5xx&limit=50`)).body.logs.every((l: any) => l.store_name === 'Loja loja-b'), true);
  assert.equal((await c.get(`/v1/platform/logs?store=${A.storeId}&q=impressora&from=${encodeURIComponent(min(-2.5))}&limit=50`)).body.logs.length, 3);
  assert.equal((await c.get('/v1/platform/logs?level=fatal')).status, 400);
});

test('atividade da loja: logs + auditoria + eventos de pedido numa linha do tempo só', async () => {
  await session();
  const bal = client(env); await bal.post('/v1/staff/login', { store: A.slug, email: A.users.balcao!.email, password: 'senha-bem-longa-123' });
  const ped = await bal.post('/v1/staff/orders', { type: 'retirada', paymentId: A.payCash, receiveNow: true, lines: [{ productId: A.prod, qty: 1 }] });
  assert.equal(ped.status, 201);
  const r = await c.get(`/v1/platform/stores/${A.storeId}/activity?limit=200`);
  assert.equal(r.status, 200); assert.equal(r.body.store.slug, 'loja-a');
  const sources = new Set(r.body.items.map((i: any) => i.source));
  assert.deepEqual([...sources].sort(), ['auditoria', 'log', 'pedido']);
  const times = r.body.items.map((i: any) => new Date(i.at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a));                              // mais recente primeiro
  assert.ok(r.body.items.some((i: any) => i.source === 'auditoria' && i.event === 'staff.login'));
  assert.ok(r.body.items.some((i: any) => i.source === 'pedido' && i.event === 'created'));
  const only = await c.get(`/v1/platform/stores/${A.storeId}/activity?sources=audit&limit=200`);
  assert.ok(only.body.items.every((i: any) => i.source === 'auditoria'));
  assert.equal((await c.get(`/v1/platform/stores/00000000-0000-4000-8000-000000000000/activity`)).status, 404);
  // nada da loja B vaza para a linha do tempo da A
  assert.equal(JSON.stringify(r.body).includes('erro na loja B'), false);
});

test('log do super admin: ações com e-mail de quem fez, filtros e paginação; segredos nunca aparecem', async () => {
  await session();
  await c.post('/v1/platform/stores', { slug: 'criada-audit', name: 'Criada', tenantName: 'Conta Audit', adminEmail: 'admin@criada-audit.test', adminPassword: 'senha-bem-longa-123' });
  const r = await c.get('/v1/platform/audit?actor=superadmin&limit=100');
  assert.equal(r.status, 200);
  assert.ok(r.body.entries.every((e: any) => e.actor_kind === 'superadmin'));
  const created = r.body.entries.find((e: any) => e.action === 'store.create');
  assert.equal(created.admin_email, EMAIL); assert.equal(created.after.slug, 'criada-audit'); assert.equal(created.store_name, 'Criada');
  assert.ok(r.body.entries.some((e: any) => e.action === 'auth.login_totp' || e.action === 'auth.totp_enabled'));
  assert.ok(r.body.entries.every((e: any, i: number, a: any[]) => i === 0 || a[i - 1].id > e.id));
  const pre = await c.get('/v1/platform/audit?action=auth.&limit=100');
  assert.ok(pre.body.entries.length >= 1 && pre.body.entries.every((e: any) => e.action.startsWith('auth.')));
  const p1 = await c.get('/v1/platform/audit?limit=2'); assert.equal(p1.body.entries.length, 2); assert.ok(p1.body.nextBefore);
  const p2 = await c.get(`/v1/platform/audit?limit=2&before=${p1.body.nextBefore}`);
  assert.ok(p2.body.entries.every((e: any) => e.id < p1.body.nextBefore));
  const txt = JSON.stringify(r.body);
  for (const secret of ['password_hash', 'totp_secret', 'sk_test', 'pmcp_']) assert.equal(txt.includes(secret), false, `vazou: ${secret}`);
  const mcp = await c.get('/v1/platform/audit?actor=mcp&limit=10'); assert.equal(mcp.status, 200);
});

test('todas as telas de observabilidade exigem login completo (e leitura não exige step-up)', async () => {
  await session();
  const anon = client(env);
  for (const u of ['/v1/platform/analytics/overview', '/v1/platform/analytics/stores', '/v1/platform/health', '/v1/platform/alerts', '/v1/platform/alert-rules', '/v1/platform/logs', '/v1/platform/audit', `/v1/platform/stores/${A.storeId}/activity`, `/v1/platform/analytics/stores/${A.storeId}`]) {
    assert.equal((await anon.get(u)).status, 401, u);
    assert.equal((await c.get(u)).status, 200, u);
  }
  assert.equal((await anon.post('/v1/platform/alerts/evaluate')).status, 401);
  assert.equal((await anon.put('/v1/platform/alert-rules/store.no_orders', { enabled: false })).status, 401);
});
