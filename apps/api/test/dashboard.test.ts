import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { client, seedStore, setup, staffLogin, type Client, type Env, type Seeded } from './helpers.js';

let env: Env; let A: Seeded; let B: Seeded;
before(async () => { env = await setup(); A = await seedStore(env, 'loja-a'); B = await seedStore(env, 'loja-b'); });
after(() => env.close());

const order = (c: Client, s: Seeded, name: string, o: object = {}) => c.post(`/v1/store/${s.slug}/orders`, { type: 'retirada', customerName: name, phone: '16999990000', paymentId: s.payPix, lines: [{ productId: s.prod, qty: 2 }, { productId: s.prodB, qty: 1 }], ...o });

test('dashboard do lojista: ontem, pedidos de hoje por status e últimos pedidos (só da própria loja)', async () => {
  const kitchen = client(env); await staffLogin(env, kitchen, A, 'admin');
  const empty = await kitchen.get('/v1/staff/dashboard');
  assert.equal(empty.status, 200);
  assert.deepEqual([empty.body.today.orders, empty.body.yesterday.orders, empty.body.recent.length, empty.body.todayByStatus], [0, 0, 0, {}]);

  const a = await order(client(env), A, 'Mariana Silva'); const b = await order(client(env), A, 'Carlos Eduardo'); await order(client(env), A, 'Ana Beatriz');
  await order(client(env), B, 'Cliente da Loja B');
  const list = await kitchen.get('/v1/staff/orders?open=1');
  const idOf = (n: number) => list.body.orders.find((o: { number: number }) => o.number === n).id as string;
  assert.equal((await kitchen.post(`/v1/staff/orders/${idOf(b.body.number)}/status`, { to: 'preparo' })).status, 200);

  env.clock.advance(60_000);   // o relógio do teste é fixo: avança para os pedidos recém-criados entrarem em "até agora"
  const d = await kitchen.get('/v1/staff/dashboard');
  assert.equal(d.body.today.orders, 3);
  assert.deepEqual(d.body.todayByStatus, { novo: 2, preparo: 1 });
  assert.equal(d.body.yesterday.orders, 0);
  assert.equal(d.body.recent.length, 3);
  const first = d.body.recent[0];
  assert.equal(first.customer_name, 'Ana Beatriz');                       // o mais recente primeiro
  assert.equal(first.items, '2 Calabresa + 1 Marguerita');                // resumo dos itens
  assert.ok(first.total_cents > 0 && first.number && first.status === 'novo');
  assert.equal(JSON.stringify(d.body.recent).includes('Cliente da Loja B'), false);   // isolamento entre lojas
  assert.ok(a.body.number);

  // pedidos antigos não entram em "hoje" mas entram em "ontem"
  await env.pools.platform.begin((q) => q`update orders set created_at = created_at - interval '1 day' where store_id = ${A.storeId} and number = ${a.body.number}`);
  const y = await kitchen.get('/v1/staff/dashboard');
  assert.deepEqual([y.body.today.orders, y.body.yesterday.orders], [2, 1]);

  // quem não tem permissão de dashboard continua barrado
  const balcao = client(env); await staffLogin(env, balcao, A, 'balcao');
  assert.equal((await balcao.get('/v1/staff/dashboard')).status, 403);
});

test('/me traz logo e se a loja está aberta; busca rápida acha pedidos, clientes e produtos só da própria loja', async () => {
  await env.pools.platform.begin(async (q) => {
    await q`insert into store_themes (store_id, tenant_id, data) values (${A.storeId}, ${A.tenantId}, ${JSON.stringify({ logoUrl: 'https://cdn.test/logo-a.png' })}::jsonb) on conflict (store_id) do update set data = excluded.data`;
    await q`insert into store_customers (store_id, tenant_id, email, name, phone) values (${A.storeId}, ${A.tenantId}, 'joana@a.test', 'Joana Prado', '16911112222'), (${B.storeId}, ${B.tenantId}, 'joana@b.test', 'Joana da B', '16933334444')`;
  });
  const admin = client(env); await staffLogin(env, admin, A, 'admin');
  const me = await admin.get('/v1/staff/me');
  assert.deepEqual([me.body.store.logoUrl, me.body.store.open, me.body.store.status], ['https://cdn.test/logo-a.png', true, 'producao']);   // horário aberto o tempo todo

  const byName = await admin.get('/v1/staff/search?q=joana');
  assert.deepEqual(byName.body.customers.map((c: { email: string }) => c.email), ['joana@a.test']);   // a "Joana da B" é de outra loja
  const prod = await admin.get('/v1/staff/search?q=marg');
  assert.deepEqual(prod.body.products.map((p: { name: string }) => p.name), ['Marguerita']);
  const num = await admin.get('/v1/staff/search?q=%23' + (await admin.get('/v1/staff/dashboard')).body.recent[0].number);
  assert.equal(num.body.orders.length, 1);
  assert.equal((await admin.get('/v1/staff/search?q=ana')).body.orders[0].customer_name, 'Ana Beatriz');
  assert.equal((await admin.get('/v1/staff/search?q=%25%25')).body.customers.length, 0);   // %% não vira curinga
  assert.equal((await admin.get('/v1/staff/search?q=a')).status, 400);                 // mínimo de 2 letras
  const balcao = client(env); await staffLogin(env, balcao, A, 'balcao');
  assert.equal((await balcao.get('/v1/staff/search?q=joana')).status, 200);        // o operador de caixa escolhe o cliente da venda
  const entregador = client(env); await staffLogin(env, entregador, A, 'entregador');
  assert.equal((await entregador.get('/v1/staff/search?q=joana')).status, 403);
});
