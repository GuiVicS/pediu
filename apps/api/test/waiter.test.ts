import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { client, seedStore, setup, staffLogin, type Client, type Env, type Seeded } from './helpers.js';

let env: Env; let seed: Seeded; let garcom: Client;
before(async () => { env = await setup(); seed = await seedStore(env, 'salao'); garcom = client(env); await staffLogin(env, garcom, seed, 'garcom'); });
after(() => env.close());

const abrir = (table: number, extra: object = {}) => garcom.post('/v1/staff/orders', { type: 'mesa', table, lines: [{ productId: seed.prod, qty: 1, addons: [] }], ...extra });
const comanda = async (id: string) => (await garcom.get('/v1/staff/orders?open=1&limit=50')).body.orders.find((o: any) => o.id === id);

test('cardápio da equipe traz a quantidade de mesas da loja (padrão 20)', async () => {
  assert.equal((await garcom.get('/v1/staff/menu')).body.tables, 20);
  await env.pools.platform.begin((q) => q`update store_settings set data = data || '{"tables": 8}'::jsonb where store_id = ${seed.storeId}`);
  assert.equal((await garcom.get('/v1/staff/menu')).body.tables, 8);
});

test('comanda: pessoas na abertura, itens com horário (rodadas) e mesa já ocupada', async () => {
  const r = await abrir(1, { guests: 3 });
  assert.equal(r.status, 201);
  const c = await comanda(r.body.id);
  assert.equal(c.guests, 3); assert.equal(c.bill_requested_at, null); assert.ok(c.items[0].created_at);
  const dup = await abrir(1);
  assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'table_busy');
});

test('pedir conta, e novos itens desfazem o pedido de conta', async () => {
  const { body } = await abrir(2);
  assert.equal((await garcom.post(`/v1/staff/orders/${body.id}/mesa`, { bill: true })).status, 200);
  assert.ok((await comanda(body.id)).bill_requested_at);
  await garcom.post(`/v1/staff/orders/${body.id}/items`, { lines: [{ productId: seed.prodB, qty: 1, addons: [] }] });
  assert.equal((await comanda(body.id)).bill_requested_at, null);   // a mesa pediu mais coisa: a conta deixa de estar pedida
  const ev = await env.pools.platform.begin((q) => q`select event from order_events where order_id = ${body.id} order by id`);
  assert.ok(ev.some((e) => e.event === 'bill_requested'));
});

test('transferir para mesa livre; mesa ocupada é recusada; pessoas ajustáveis', async () => {
  const a = (await abrir(3)).body; await abrir(4);
  const busy = await garcom.post(`/v1/staff/orders/${a.id}/mesa`, { table: 4 });
  assert.equal(busy.status, 409); assert.match(busy.body.error.message, /mesa 4/);
  assert.equal((await garcom.post(`/v1/staff/orders/${a.id}/mesa`, { table: 5, guests: 2 })).status, 200);
  const c = await comanda(a.id);
  assert.equal(c.table_number, 5); assert.equal(c.guests, 2); assert.equal(c.customer_name, 'Mesa 5');
  assert.equal((await abrir(3)).status, 201);   // a mesa 3 ficou livre
  assert.equal((await garcom.post(`/v1/staff/orders/${a.id}/mesa`, {})).status, 400);   // nada para alterar
});

test('só garçom/caixa mexem na mesa; comanda de delivery e encerrada são recusadas', async () => {
  const { body } = await abrir(6);
  const entregador = client(env); await staffLogin(env, entregador, seed, 'entregador');
  assert.equal((await entregador.post(`/v1/staff/orders/${body.id}/mesa`, { bill: true })).status, 403);
  await env.pools.platform.begin((q) => q`update orders set status = 'entregue' where id = ${body.id}`);
  assert.equal((await garcom.post(`/v1/staff/orders/${body.id}/mesa`, { bill: true })).status, 422);
});
