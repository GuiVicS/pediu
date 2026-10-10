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

test('histórico da mesa: quem abriu, quem adicionou, quem pediu a conta, e a transferência — com nomes', async () => {
  const caixa = client(env); await staffLogin(env, caixa, seed, 'balcao');
  const { body } = await abrir(9, { guests: 2 });                                                     // garçom abre a mesa
  await caixa.post(`/v1/staff/orders/${body.id}/items`, { lines: [{ productId: seed.prodB, qty: 2, addons: [] }] });   // outra pessoa lança mais
  await garcom.post(`/v1/staff/orders/${body.id}/mesa`, { bill: true });
  await garcom.post(`/v1/staff/orders/${body.id}/mesa`, { table: 12 });

  const c = await comanda(body.id);
  assert.equal(c.opened_by_name, 'Pessoa garcom');                                                    // quem montou a comanda
  assert.deepEqual(c.staff_names, ['Pessoa balcao', 'Pessoa garcom']);                                // todo mundo que mexeu nela

  const ev = (await garcom.get(`/v1/staff/orders/${body.id}/events`)).body.events as { event: string; actor_name: string | null; data: any }[];
  assert.deepEqual(ev.map((e) => e.event), ['created', 'items_added', 'bill_requested', 'table_moved']);
  assert.deepEqual(ev.map((e) => e.actor_name), ['Pessoa garcom', 'Pessoa balcao', 'Pessoa garcom', 'Pessoa garcom']);
  assert.deepEqual(ev[0]!.data.items, [{ name: 'Calabresa', qty: 1 }]); assert.equal(ev[0]!.data.table, 9);
  assert.deepEqual(ev[1]!.data.items, [{ name: 'Marguerita', qty: 2 }]);
  assert.deepEqual(ev[3]!.data, { from: 9, to: 12 });
});

test('histórico: garçom vê o das mesas, não o de delivery; sem login não vê', async () => {
  const pdv = client(env); await staffLogin(env, pdv, seed, 'balcao');
  const entrega = await pdv.post('/v1/staff/orders', { type: 'delivery', customerName: 'Ana', phone: '16999990000', address: 'Rua A, 1', zoneId: seed.zone, lines: [{ productId: seed.prod, qty: 1, addons: [] }] });
  assert.equal(entrega.status, 201);
  assert.equal((await garcom.get(`/v1/staff/orders/${entrega.body.id}/events`)).status, 404);        // delivery: só o caixa/painel
  assert.equal((await pdv.get(`/v1/staff/orders/${entrega.body.id}/events`)).status, 200);
  const { body } = await abrir(15);
  assert.equal((await client(env).get(`/v1/staff/orders/${body.id}/events`)).status, 401);
});

test('o histórico é da comanda, não da mesa: outro cliente na mesma mesa começa com histórico limpo', async () => {
  const caixa = client(env); await staffLogin(env, caixa, seed, 'gerente');   // quem pode cancelar/encerrar
  const a = await abrir(18);                                                                          // 1º cliente
  await garcom.post(`/v1/staff/orders/${a.body.id}/mesa`, { bill: true });
  assert.equal((await caixa.post(`/v1/staff/orders/${a.body.id}/status`, { to: 'cancelado', reason: 'cliente saiu' })).status, 200);   // comanda encerrada, mesa livre
  const b = await abrir(18);                                                                          // 2º cliente, mesma mesa
  assert.equal(b.status, 201); assert.notEqual(b.body.id, a.body.id);
  const evB = (await garcom.get(`/v1/staff/orders/${b.body.id}/events`)).body.events as { event: string }[];
  assert.deepEqual(evB.map((e) => e.event), ['created']);                                             // nada da comanda anterior
  const evA = (await caixa.get(`/v1/staff/orders/${a.body.id}/events`)).body.events as { event: string }[];
  assert.deepEqual(evA.map((e) => e.event), ['created', 'bill_requested', 'status:cancelado']);       // e a anterior continua guardada
});
