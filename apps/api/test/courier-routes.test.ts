import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { client, seedStore, setup, staffLogin, type Client, type Env, type Seeded } from './helpers.js';

let env: Env; let seed: Seeded; let admin: Client; let moto: Client; let moto2: Client;
before(async () => {
  env = await setup(); seed = await seedStore(env, 'rotas');
  admin = client(env); await staffLogin(env, admin, seed, 'admin');
  moto = client(env); await staffLogin(env, moto, seed, 'entregador');
  moto2 = client(env); await staffLogin(env, moto2, seed, 'gerente');     // gerente também faz entregas
});
after(() => env.close());

/** Entrega pronta para sair (novo → preparo → pronto). */
async function pronta(address: string) {
  const r = await admin.post('/v1/staff/orders', { type: 'delivery', customerName: 'Cliente', phone: '16999990000', address, zoneId: seed.zone, lines: [{ productId: seed.prod, qty: 1, addons: [] }] });
  assert.equal(r.status, 201);
  for (const to of ['preparo', 'pronto']) assert.equal((await admin.post(`/v1/staff/orders/${r.body.id}/status`, { to })).status, 200);
  return { id: r.body.id as string, number: r.body.number as number };
}
const orderOf = async (c: Client, id: string) => (await c.get('/v1/staff/orders?limit=100')).body.orders.find((o: any) => o.id === id);

test('sugestão: ordena por região › CEP › rua › número e avisa o que não está disponível', async () => {
  const a = await pronta('Rua Z, 10, Vila Nova, Franca-SP, CEP 14500-000');
  const b = await pronta('Rua A, 50, Jardim Palma, Franca-SP, CEP 14402-151');
  const c = await pronta('Rua A, 20, Jardim Palma, Franca-SP, CEP 14402-151');
  const naoPronta = await admin.post('/v1/staff/orders', { type: 'delivery', customerName: 'X', phone: '16999990000', address: 'Rua Y, 1', zoneId: seed.zone, lines: [{ productId: seed.prod, qty: 1, addons: [] }] });
  const r = await moto.post('/v1/staff/routes/suggest', { orderIds: [a.id, b.id, c.id, naoPronta.body.id] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.stops.map((s: any) => s.id), [c.id, b.id, a.id]);                  // CEP 14402-151 (nº 20, 50) antes de 14500-000
  assert.deepEqual(r.body.unavailable, [naoPronta.body.id]);
  assert.equal(r.body.stops[0].group, 'Jardim Palma'); assert.ok(r.body.stops[0].toCollectCents > 0);
});

test('iniciar a rota assume todas na ordem, grava as paradas e registra no histórico', async () => {
  const a = await pronta('Rua A, 1, B1, Franca-SP, CEP 14000-001'); const b = await pronta('Rua B, 2, B2, Franca-SP, CEP 14000-002'); const c = await pronta('Rua C, 3, B3, Franca-SP, CEP 14000-003');
  const r = await moto.post('/v1/staff/routes', { orderIds: [b.id, c.id, a.id] });
  assert.equal(r.status, 201); assert.deepEqual(r.body.stops.map((s: any) => s.id), [b.id, c.id, a.id]); assert.deepEqual(r.body.unavailable, []);
  const stops = await Promise.all([b, c, a].map((x) => orderOf(moto, x.id)));
  assert.deepEqual(stops.map((o) => [o.status, o.route_stop, o.route_id === r.body.routeId]), [['saiu', 1, true], ['saiu', 2, true], ['saiu', 3, true]]);
  const ev = (await admin.get(`/v1/staff/orders/${c.id}/events`)).body.events.find((e: any) => e.event === 'status:saiu');
  assert.deepEqual(ev.data.route, { id: r.body.routeId, stop: 2, of: 3 }); assert.equal(ev.actor_name, 'Pessoa entregador');
  // as mesmas entregas não podem ser assumidas por outro
  const outro = await moto2.post('/v1/staff/routes', { orderIds: [a.id, b.id] });
  assert.equal(outro.status, 409); assert.equal(outro.body.error.code, 'taken');
});

test('corrida entre entregadores: leva só o que ainda está livre e avisa o resto', async () => {
  const a = await pronta('Rua A, 1, CEP 14000-001'); const b = await pronta('Rua B, 2, CEP 14000-002'); const c = await pronta('Rua C, 3, CEP 14000-003');
  assert.equal((await moto2.post('/v1/staff/orders/' + b.id + '/status', { to: 'saiu' })).status, 200);   // outro assumiu a do meio
  const r = await moto.post('/v1/staff/routes', { orderIds: [a.id, b.id, c.id] });
  assert.equal(r.status, 201); assert.deepEqual(r.body.stops.map((s: any) => s.id), [a.id, c.id]); assert.deepEqual(r.body.unavailable.map((u: any) => u.id), [b.id]);
  assert.deepEqual((await Promise.all([a, c].map((x) => orderOf(moto, x.id)))).map((o) => o.route_stop), [1, 2]);   // paradas contínuas
});

test('reordenar as paradas que faltam; só a própria rota; entregue sai da conta', async () => {
  const a = await pronta('Rua A, 1, CEP 14000-001'); const b = await pronta('Rua B, 2, CEP 14000-002'); const c = await pronta('Rua C, 3, CEP 14000-003');
  const { body } = await moto.post('/v1/staff/routes', { orderIds: [a.id, b.id, c.id] });
  assert.equal((await moto.put(`/v1/staff/routes/${body.routeId}/order`, { orderIds: [c.id, a.id, b.id] })).status, 200);
  assert.deepEqual((await Promise.all([c, a, b].map((x) => orderOf(moto, x.id)))).map((o) => o.route_stop), [1, 2, 3]);
  assert.equal((await moto2.put(`/v1/staff/routes/${body.routeId}/order`, { orderIds: [a.id] })).status, 404);      // outro entregador não mexe
  assert.equal((await moto.post(`/v1/staff/orders/${c.id}/status`, { to: 'entregue' })).status, 200);               // primeira parada entregue
  assert.equal((await moto.put(`/v1/staff/routes/${body.routeId}/order`, { orderIds: [c.id, b.id] })).status, 422); // entregue não faz mais parte
  assert.equal((await moto.put(`/v1/staff/routes/${body.routeId}/order`, { orderIds: [b.id] })).status, 200);       // só cita a b: ela vai para a frente
  assert.deepEqual((await Promise.all([b, a].map((x) => orderOf(moto, x.id)))).map((o) => o.route_stop), [2, 3]);   // ocupam os lugares que restavam
});

test('só entregador/gerente montam rota; entrada inválida é recusada', async () => {
  const garcom = client(env); await staffLogin(env, garcom, seed, 'garcom');
  const a = await pronta('Rua A, 1');
  assert.equal((await garcom.post('/v1/staff/routes/suggest', { orderIds: [a.id] })).status, 403);
  assert.equal((await client(env).post('/v1/staff/routes', { orderIds: [a.id] })).status, 401);
  assert.equal((await moto.post('/v1/staff/routes', { orderIds: [] })).status, 400);
  assert.equal((await moto.post('/v1/staff/routes', { orderIds: [a.id, a.id] })).status, 400);
  assert.equal((await moto.post('/v1/staff/routes', { orderIds: ['x'] })).status, 400);
});
