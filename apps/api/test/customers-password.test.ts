import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { client, seedStore, setup, type Env, type Seeded } from './helpers.js';

let env: Env; let seed: Seeded;
before(async () => { env = await setup(); seed = await seedStore(env, 'cliente-senha'); });
after(() => env.close());
const C = () => `/v1/store/${seed.slug}/customer`;

test('criar conta com e-mail e senha já entra; e-mail repetido não "assume" a conta', async () => {
  const c = client(env);
  assert.equal((await c.post(`${C()}/register`, { name: 'Ana', email: 'ana@x.com', password: 'curta' })).status, 400);
  const r = await c.post(`${C()}/register`, { name: 'Ana Souza', email: 'Ana@X.com', phone: '16999990000', password: 'senha-da-ana' });
  assert.equal(r.status, 201); assert.equal(r.body.customer.email, 'ana@x.com'); assert.equal(r.body.customer.hasPassword, true);
  const me = await c.get(`${C()}/me`);
  assert.equal(me.body.customer.email, 'ana@x.com'); assert.equal(me.body.customer.via, 'password');
  assert.equal(JSON.stringify(me.body).includes('password_hash'), false);
  const dup = await client(env).post(`${C()}/register`, { name: 'Outra', email: 'ana@x.com', password: 'outra-senha-1' });
  assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'email_taken');
  // conta antiga (criada pelo código do e-mail, sem senha): cadastro não toma a conta
  await env.pools.platform.begin((q) => q`insert into store_customers (store_id, tenant_id, email, name) values (${seed.storeId}, ${seed.tenantId}, 'antiga@x.com', 'Antiga')`);
  assert.equal((await client(env).post(`${C()}/register`, { name: 'Invasor', email: 'antiga@x.com', password: 'senha-invasor' })).body.error.code, 'email_taken_code');
});

test('login: senha certa entra; errada e inexistente dão a mesma resposta; 5 erros bloqueiam', async () => {
  await client(env).post(`${C()}/register`, { name: 'Bia', email: 'bia@x.com', password: 'senha-da-bia' });
  const ok = client(env);
  const r = await ok.post(`${C()}/login`, { email: 'BIA@x.com', password: 'senha-da-bia' });
  assert.equal(r.status, 200); assert.equal(r.body.customer.email, 'bia@x.com');
  assert.equal((await ok.get(`${C()}/me`)).body.customer.email, 'bia@x.com');
  const errada = await client(env).post(`${C()}/login`, { email: 'bia@x.com', password: 'errada-123' });
  const ninguem = await client(env).post(`${C()}/login`, { email: 'ninguem@x.com', password: 'errada-123' });
  assert.equal(errada.status, 401); assert.deepEqual(errada.body, ninguem.body);
  for (let i = 0; i < 4; i++) await client(env).post(`${C()}/login`, { email: 'bia@x.com', password: 'errada-123' });   // 5 erros no total
  const bloq = await client(env).post(`${C()}/login`, { email: 'bia@x.com', password: 'senha-da-bia' });
  assert.equal(bloq.status, 423);
  env.clock.advance(16 * 60_000);
  assert.equal((await client(env).post(`${C()}/login`, { email: 'bia@x.com', password: 'senha-da-bia' })).status, 200);
});

test('trocar senha exige a atual e derruba as outras sessões', async () => {
  const a = client(env); const b = client(env);
  await a.post(`${C()}/register`, { name: 'Caio', email: 'caio@x.com', password: 'senha-do-caio' });
  await b.post(`${C()}/login`, { email: 'caio@x.com', password: 'senha-do-caio' });
  assert.equal((await a.put(`${C()}/password`, { password: 'nova-senha-caio' })).status, 401);
  assert.equal((await a.put(`${C()}/password`, { password: 'nova-senha-caio', currentPassword: 'senha-do-caio' })).status, 200);
  assert.equal((await b.get(`${C()}/me`)).body.customer, null);                        // a outra sessão caiu
  assert.equal((await a.get(`${C()}/me`)).body.customer.email, 'caio@x.com');          // a atual continua
  assert.equal((await client(env).post(`${C()}/login`, { email: 'caio@x.com', password: 'senha-do-caio' })).status, 401);
  assert.equal((await client(env).post(`${C()}/login`, { email: 'caio@x.com', password: 'nova-senha-caio' })).status, 200);
});

test('quem entrou pelo código do e-mail define a senha sem a atual ("esqueci a senha")', async () => {
  const [cu] = await env.pools.platform.begin((q) => q`insert into store_customers (store_id, tenant_id, email, name) values (${seed.storeId}, ${seed.tenantId}, 'duda@x.com', 'Duda') returning id`);
  // sessão aberta pelo código (simulada direto no banco, como faz a rota /verify)
  const { hashToken } = await import('@pediu/shared');
  await env.pools.platform.begin((q) => q`insert into customer_sessions (store_id, tenant_id, customer_id, token_hash, expires_at, via) values (${seed.storeId}, ${seed.tenantId}, ${cu!.id}, ${hashToken('tok-duda')}, now() + interval '1 day', 'code')`);
  const r = await env.app.inject({ method: 'PUT', url: `${C()}/password`, payload: { password: 'senha-da-duda' }, headers: { cookie: 'pediu_cust=tok-duda' } });
  assert.equal(r.statusCode, 200);
  assert.equal((await client(env).post(`${C()}/login`, { email: 'duda@x.com', password: 'senha-da-duda' })).status, 200);
});
