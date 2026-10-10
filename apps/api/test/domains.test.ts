import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { client, createAdmin, fullLogin, seedStore, setup, staffLogin, stepUp, type Client, type Env, type Seeded } from './helpers.js';

let env: Env; let A: Seeded; let B: Seeded; let admin: Client; let balcao: Client;
const txt: Record<string, string[][]> = {};          // DNS falso: nome → registros TXT
before(async () => {
  env = await setup(); env.ctx.dns = { txt: async (n) => { if (!txt[n]) throw new Error('ENOTFOUND'); return txt[n]!; } };
  A = await seedStore(env, 'loja-dom-a'); B = await seedStore(env, 'loja-dom-b');
  admin = client(env); await staffLogin(env, admin, A, 'admin'); balcao = client(env); await staffLogin(env, balcao, A, 'balcao');
});
after(() => env.close());

test('lojista: adiciona domínio próprio (sem "Erro interno"), vê as instruções de DNS, verifica e remove', async () => {
  const r = await admin.post('/v1/staff/domains', { hostname: 'Pedidos.LojaA.com.br' });
  assert.equal(r.status, 201); assert.equal(r.body.hostname, 'pedidos.lojaa.com.br'); assert.equal(r.body.verified, false);
  assert.equal(r.body.instructions.cname.value, 'cname.pediu.test'); assert.equal(r.body.instructions.txt.name, '_pediu-verify.pedidos.lojaa.com.br');
  const list = (await admin.get('/v1/staff/domains')).body.domains as { hostname: string; kind: string }[];
  assert.deepEqual(list.map((d) => d.kind).sort(), ['custom']);                         // (a loja de teste não tem o subdomínio padrão)
  // sem o TXT no DNS: não verifica e explica
  const no = await admin.post(`/v1/staff/domains/${r.body.id}/verify`);
  assert.equal(no.status, 422); assert.match(no.body.error.message, /_pediu-verify\.pedidos\.lojaa\.com\.br/);
  txt['_pediu-verify.pedidos.lojaa.com.br'] = [[r.body.instructions.txt.value]];
  assert.deepEqual((await admin.post(`/v1/staff/domains/${r.body.id}/verify`)).body, { verified: true });
  assert.equal((await admin.get('/v1/staff/domains')).body.domains[0].verified, true);
  assert.equal((await admin.del(`/v1/staff/domains/${r.body.id}`)).status, 200);
  assert.equal((await admin.del(`/v1/staff/domains/${r.body.id}`)).status, 404);
});

test('lojista: regras (domínio da plataforma, duplicado, limite de 5, perfil sem permissão)', async () => {
  assert.equal((await admin.post('/v1/staff/domains', { hostname: 'minha.pediu.test' })).status, 422);          // domínio da plataforma
  assert.equal((await admin.post('/v1/staff/domains', { hostname: 'sem-ponto' })).status, 400);
  assert.equal((await balcao.post('/v1/staff/domains', { hostname: 'x.lojaa.com.br' })).status, 403);          // caixa não mexe em domínios
  assert.equal((await admin.post('/v1/staff/domains', { hostname: 'um.lojaa.com.br' })).status, 201);
  assert.equal((await admin.post('/v1/staff/domains', { hostname: 'um.lojaa.com.br' })).status, 409);           // já em uso (mesma loja)
  const outra = client(env); await staffLogin(env, outra, B, 'admin');
  assert.equal((await outra.post('/v1/staff/domains', { hostname: 'um.lojaa.com.br' })).status, 409);           // já em uso (outra loja)
  for (const n of ['dois', 'tres', 'quatro', 'cinco']) assert.equal((await admin.post('/v1/staff/domains', { hostname: `${n}.lojaa.com.br` })).status, 201);
  assert.equal((await admin.post('/v1/staff/domains', { hostname: 'seis.lojaa.com.br' })).status, 422);          // limite
  assert.equal((await outra.get('/v1/staff/domains')).body.domains.every((d: any) => !d.hostname.endsWith('lojaa.com.br')), true);   // não vê domínios de outra loja
});

test('super admin: lista, adiciona (pede o autenticador), verifica, marca como verificado e remove domínios de qualquer loja', async () => {
  await createAdmin(env, 'sa-dom@pediu.test'); const sa = client(env); await fullLogin(env, sa, 'sa-dom@pediu.test');
  const D = `/v1/platform/stores/${B.storeId}/domains`;
  assert.deepEqual((await sa.get(D)).body.domains, []);
  assert.equal((await sa.post(D, { hostname: 'loja.lojab.com.br' })).status, 403);                                // mutação exige step-up
  await stepUp(env, sa, 'sa-dom@pediu.test');
  const r = await sa.post(D, { hostname: 'loja.lojab.com.br' });
  assert.equal(r.status, 201); assert.equal(r.body.verified, false); assert.ok(r.body.instructions.txt.value);
  assert.equal((await sa.post(D, { hostname: 'loja.lojab.com.br' })).status, 409);
  assert.equal((await sa.post(D, { hostname: 'x.pediu.test' })).status, 422);
  assert.equal((await sa.post(`/v1/platform/stores/00000000-0000-4000-8000-000000000000/domains`, { hostname: 'a.b.com' })).status, 404);

  assert.equal((await sa.post(`${D}/${r.body.id}/verify`)).status, 422);                                           // DNS ainda não aponta
  txt['_pediu-verify.loja.lojab.com.br'] = [[r.body.instructions.txt.value]];
  assert.deepEqual((await sa.post(`${D}/${r.body.id}/verify`)).body, { verified: true });

  const forced = await sa.post(D, { hostname: 'ja-apontado.lojab.com.br', markVerified: true });                    // o super admin garante que já está certo
  assert.equal(forced.body.verified, true);
  const [row] = await env.pools.platform.begin((q) => q`select tenant_id from store_domains where id = ${forced.body.id}`);
  assert.equal(row!.tenant_id, B.tenantId);                                                                          // o domínio nasce no tenant certo
  const audit = await env.pools.platform.begin((q) => q`select meta from audit_logs where action = 'domain.added' and store_id = ${B.storeId} order by at desc limit 1`);
  assert.deepEqual(audit[0]!.meta, { hostname: 'ja-apontado.lojab.com.br', byPlatform: true, markedVerified: true });

  assert.equal((await sa.del(`${D}/${r.body.id}`)).status, 200);
  assert.equal((await sa.del(`${D}/${r.body.id}`)).status, 404);
  assert.equal((await sa.del(`/v1/platform/stores/${A.storeId}/domains/${forced.body.id}`)).status, 404);          // domínio de outra loja não é removido por esta rota
  assert.equal((await client(env).get(D)).status, 401);
});
