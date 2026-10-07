import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { client, seedStore, setup, staffLogin, type Client, type Env, type Seeded } from './helpers.js';

let env: Env; let A: Seeded; let B: Seeded;
before(async () => { env = await setup(); A = await seedStore(env, 'zap-a'); B = await seedStore(env, 'zap-b'); });
after(() => env.close());

const liberar = (s: Seeded, on = true) => env.pools.platform.begin((q) => q`
  insert into store_features (store_id, tenant_id, feature, enabled) values (${s.storeId}, ${s.tenantId}, 'whatsapp_support', ${on})
  on conflict (store_id, feature) do update set enabled = excluded.enabled`);

async function pareia(s: Seeded, role = 'admin') {
  const staff = client(env); await staffLogin(env, staff, s, role);
  const p = await staff.post('/v1/staff/extension/pairing');
  return { staff, p };
}
const ext = (token: string) => (url: string) => env.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } }).then((r) => ({ status: r.statusCode, body: r.body ? JSON.parse(r.body) : null }));

test('sem a funcionalidade liberada não gera código', async () => {
  const { p } = await pareia(A);
  assert.equal(p.status, 403);
  assert.equal(p.body.error.code, 'feature_disabled');
});

test('pareamento: código de uso único vira credencial própria; replay falha', async () => {
  await liberar(A);
  const { p } = await pareia(A);
  assert.equal(p.status, 200);
  assert.match(p.body.code, /^[A-Z2-9]{8}$/);
  const e = client(env);
  const ok = await e.post('/v1/extension/pair', { code: p.body.code.toLowerCase(), name: 'Chrome do balcão' });
  assert.equal(ok.status, 201);
  assert.match(ok.body.token, /^pext_/);
  assert.equal(ok.body.storeName, 'Loja zap-a');
  assert.equal((await e.post('/v1/extension/pair', { code: p.body.code })).status, 400);       // replay
  assert.equal((await e.post('/v1/extension/pair', { code: 'ZZZZZZZZ' })).status, 400);        // inexistente
  const me = await ext(ok.body.token)('/v1/extension/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.features, ['whatsapp_support']);
  assert.equal((await ext('pext_invalido-invalido-invalido')('/v1/extension/me')).status, 401);
  // o banco guarda só hashes
  const rows = await env.pools.platform.begin((q) => q`select token_hash from extension_devices where token_hash = ${ok.body.token}`);
  assert.equal(rows.length, 0);
});

test('código vence em 5 minutos e novo código invalida o anterior', async () => {
  await liberar(A);
  const { staff, p } = await pareia(A);
  const p2 = await staff.post('/v1/staff/extension/pairing');
  assert.equal((await client(env).post('/v1/extension/pair', { code: p.body.code })).status, 400);
  (env.clock as any).advance(6 * 60 * 1000);
  assert.equal((await client(env).post('/v1/extension/pair', { code: p2.body.code })).status, 400);
});

test('logout do lojista, revogação e desativação do recurso cortam a extensão', async () => {
  await liberar(A);
  const pair = async () => { const r = await pareia(A); const t = (await client(env).post('/v1/extension/pair', { code: r.p.body.code })).body.token as string; return { ...r, t }; };

  const a = await pair();
  assert.equal((await ext(a.t)('/v1/extension/me')).status, 200);
  await a.staff.post('/v1/staff/logout');
  assert.equal((await ext(a.t)('/v1/extension/me')).status, 401);

  const b = await pair();
  const devs = await b.staff.get('/v1/staff/extension/devices');
  assert.equal(devs.body.devices.length >= 1, true);
  const id = devs.body.devices[0].id;
  assert.equal((await b.staff.del(`/v1/staff/extension/devices/${id}`)).status, 200);
  assert.equal((await b.staff.del(`/v1/staff/extension/devices/${id}`)).status, 404);

  const c = await pair();
  assert.equal((await ext(c.t)('/v1/extension/me')).status, 200);
  await liberar(A, false);
  assert.equal((await ext(c.t)('/v1/extension/me')).status, 401);
  await liberar(A);
});

test('isolamento: gerente de outra loja não revoga dispositivo alheio; perfil sem permissão não gera código', async () => {
  await liberar(A); await liberar(B);
  const r = await pareia(A);
  await client(env).post('/v1/extension/pair', { code: r.p.body.code });
  const id = (await r.staff.get('/v1/staff/extension/devices')).body.devices[0].id;
  const other = client(env); await staffLogin(env, other, B, 'admin');
  assert.equal((await other.del(`/v1/staff/extension/devices/${id}`)).status, 404);
  assert.equal((await other.get('/v1/staff/extension/devices')).body.devices.length, 0);
  const garcom = client(env); await staffLogin(env, garcom, A, 'garcom');
  assert.equal((await garcom.post('/v1/staff/extension/pairing')).status, 403);
});
