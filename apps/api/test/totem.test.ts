import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { client, seedStore, setup, staffLogin, type Client, type Env, type Seeded } from './helpers.js';

let env: Env; let seed: Seeded; let adm: Client;
const HOST = 'mesa-loja.pediu.test';
before(async () => {
  env = await setup(); seed = await seedStore(env, 'mesa-loja');
  await env.pools.platform.begin((q) => q`insert into store_domains (tenant_id, store_id, hostname, kind, verified_at) values (${seed.tenantId}, ${seed.storeId}, ${HOST}, 'subdomain', now())`);
  adm = client(env); await staffLogin(env, adm, seed, 'admin');
});
after(() => env.close());

/** Tablet: cliente com cookie próprio, sempre pelo domínio da loja. */
function tablet() {
  let cookie = '';
  const call = async (method: 'GET' | 'POST', url: string, payload?: object) => {
    const r = await env.app.inject({ method, url, payload, headers: { host: HOST, ...(cookie ? { cookie } : {}) } });
    const sc = r.headers['set-cookie']; const c = Array.isArray(sc) ? sc[0] : sc; if (c) cookie = c.split(';')[0]!;
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
  return { get: (u: string) => call('GET', u), post: (u: string, b: object = {}) => call('POST', u, b) };
}
const feature = (on: boolean) => env.pools.platform.begin((q) => q`insert into store_features (store_id, tenant_id, feature, enabled) values (${seed.storeId}, ${seed.tenantId}, 'table_totem', ${on})
  on conflict (store_id, feature) do update set enabled = excluded.enabled`);

test('sem a liberação do super admin, a loja não cria totem', async () => {
  const r = await adm.get('/v1/staff/totems');
  assert.equal(r.body.enabled, false);
  assert.equal((await adm.post('/v1/staff/totems', { table: 1 })).status, 403);
});

test('parear com o código (uso único) e pedir: abre a comanda da mesa e depois acrescenta rodadas', async () => {
  await feature(true);
  const novo = await adm.post('/v1/staff/totems', { table: 7, name: 'Varanda' });
  assert.equal(novo.status, 201); assert.match(novo.body.code, /^\d{6}$/);
  const t = tablet();
  assert.equal((await t.get('/v1/totem/me')).status, 401);
  assert.equal((await t.post('/v1/totem/pair', { code: '000000' === novo.body.code ? '111111' : '000000' })).status, 401);
  const p = await t.post('/v1/totem/pair', { code: novo.body.code });
  assert.equal(p.status, 200); assert.equal(p.body.table, 7);
  assert.equal((await tablet().post('/v1/totem/pair', { code: novo.body.code })).status, 401);   // código já usado
  const me = await t.get('/v1/totem/me');
  assert.equal(me.body.table, 7); assert.equal(me.body.store.name, 'Loja mesa-loja');
  assert.ok((await t.get('/v1/totem/menu')).body.products.length > 0);
  assert.equal((await t.get('/v1/totem/comanda')).body.comanda, null);

  assert.equal((await t.post('/v1/totem/orders', { lines: [{ productId: seed.prod, qty: 2, addons: [] }] })).status, 201);
  let c = (await t.get('/v1/totem/comanda')).body.comanda;
  assert.equal(c.items.length, 1); assert.equal(c.totalCents, 9980);
  const [o] = await env.pools.platform.begin((q) => q`select channel, type, table_number, status from orders where store_id = ${seed.storeId} and table_number = 7`);
  assert.deepEqual({ ...o }, { channel: 'totem', type: 'mesa', table_number: 7, status: 'novo' });
  await t.post('/v1/totem/orders', { lines: [{ productId: seed.prodB, qty: 1, addons: [] }] });
  c = (await t.get('/v1/totem/comanda')).body.comanda;
  assert.equal(c.items.length, 2);   // mesma comanda, nova rodada
  // preço sempre do servidor
  assert.equal((await t.post('/v1/totem/orders', { lines: [{ productId: '00000000-0000-4000-8000-000000000000', qty: 1, addons: [] }] })).status, 422);
});

test('pedir a conta e chamar o garçom; o totem só vê a própria mesa', async () => {
  const novo = await adm.post('/v1/staff/totems', { table: 8 });
  const t = tablet(); await t.post('/v1/totem/pair', { code: novo.body.code });
  assert.equal((await t.post('/v1/totem/call', { kind: 'conta' })).status, 409);   // mesa sem consumo
  assert.equal((await t.post('/v1/totem/call', { kind: 'garcom' })).status, 200);
  await adm.post('/v1/staff/orders', { type: 'mesa', table: 8, lines: [{ productId: seed.prod, qty: 1, addons: [] }] });   // o garçom abriu a mesa
  assert.equal((await t.post('/v1/totem/call', { kind: 'conta' })).status, 200);
  const [o] = await env.pools.platform.begin((q) => q`select bill_requested_at from orders where store_id = ${seed.storeId} and table_number = 8`);
  assert.ok(o!.bill_requested_at);
  const c = (await t.get('/v1/totem/comanda')).body.comanda;
  assert.equal(c.billRequested, true); assert.equal(c.items.length, 1);   // só a mesa 8, nada da mesa 7
  // o totem não acessa nada da equipe
  assert.equal((await t.get('/v1/staff/orders')).status, 401);
});

test('remover o totem ou desligar a funcionalidade bloqueia o tablet na hora', async () => {
  const novo = await adm.post('/v1/staff/totems', { table: 9 });
  const t = tablet(); await t.post('/v1/totem/pair', { code: novo.body.code });
  assert.equal((await t.get('/v1/totem/me')).status, 200);
  await feature(false);
  assert.equal((await t.get('/v1/totem/me')).status, 403);
  await feature(true);
  assert.equal((await adm.del(`/v1/staff/totems/${novo.body.id}`)).status, 200);
  assert.equal((await t.get('/v1/totem/me')).status, 401);
  const lista = (await adm.get('/v1/staff/totems')).body.totems;
  assert.equal(lista.some((x: any) => x.id === novo.body.id), false);
});
