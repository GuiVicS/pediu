import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { client, createAdmin, fullLogin, seedStore, setup, stepUp, type Client, type Env, type Seeded } from './helpers.js';

let env: Env; let A: Seeded; let sa: Client;
const dnsA: Record<string, string[]> = { 'entrada.pediu.test': ['203.0.113.10'] };        // DNS falso: nome → IPs
const wildcard: Record<string, string[]> = {};                                           // *.dominio → IPs
const H = { host: 'entrada.pediu.test' };                                                // endereço por onde o super admin está entrando
const E = { 'x-edge-secret': 'segredo-edge' };
before(async () => {
  process.env.EDGE_SECRET = 'segredo-edge'; delete process.env.PUBLIC_IPS;
  env = await setup();
  env.ctx.dns = { txt: async () => { throw new Error('ENOTFOUND'); }, a: async (n) => { const hit = dnsA[n] ?? Object.entries(wildcard).find(([b]) => n.endsWith(`.${b}`))?.[1]; if (!hit) throw new Error('ENOTFOUND'); return hit; } };
  A = await seedStore(env, 'pizzaria-dom');
  await createAdmin(env, 'sa-pd@pediu.test'); sa = client(env); await fullLogin(env, sa, 'sa-pd@pediu.test');
});
after(() => env.close());
const P = '/v1/platform/domains';
const resolve = (host: string) => client(env).call('GET', `/v1/edge/resolve?host=${host}`, undefined, E);
const tls = (domain: string) => client(env).call('GET', `/v1/edge/tls-check?domain=${domain}`, undefined, E);
const hosts = async () => (await client(env).call('GET', '/v1/edge/platform-hosts', undefined, E)).body.hosts as { hostname: string; role: string }[];

test('super admin em outro domínio: cadastra (pede o autenticador), só vale depois que o DNS aponta para o servidor', async () => {
  assert.equal((await client(env).get(P)).status, 401);
  assert.equal((await sa.call('POST', P, { role: 'admin', hostname: 'delivery.serafim.test' }, H)).status, 403);            // mutação exige step-up
  await stepUp(env, sa, 'sa-pd@pediu.test');
  const r = await sa.call('POST', P, { role: 'admin', hostname: 'Delivery.Serafim.test' }, H);
  assert.equal(r.status, 201); assert.equal(r.body.hostname, 'delivery.serafim.test'); assert.equal(r.body.verified, false);
  assert.deepEqual(r.body.dns, { type: 'A', name: 'delivery.serafim.test', values: ['203.0.113.10'] });             // o que criar no DNS
  assert.equal((await sa.call('POST', P, { role: 'api', hostname: 'delivery.serafim.test' }, H)).status, 409);              // já cadastrado
  assert.equal((await sa.call('POST', P, { role: 'admin', hostname: 'sem-ponto' }, H)).status, 400);
  assert.equal((await sa.call('POST', P, { role: 'outro', hostname: 'a.b.test' }, H)).status, 400);

  // ainda não verificado: não entra na lista do edge nem ganha certificado
  assert.deepEqual(await hosts(), []); assert.equal((await tls('delivery.serafim.test')).status, 404);
  const no = await sa.call('POST', `${P}/${r.body.id}/verify`, {}, H);
  assert.equal(no.status, 422); assert.match(no.body.error.message, /203\.0\.113\.10/);                            // diz para onde apontar
  dnsA['delivery.serafim.test'] = ['198.51.100.7'];                                                                // aponta para outro servidor
  const wrong = await sa.call('POST', `${P}/${r.body.id}/verify`, {}, H);
  assert.equal(wrong.status, 422); assert.match(wrong.body.error.message, /198\.51\.100\.7/);
  dnsA['delivery.serafim.test'] = ['203.0.113.10'];
  assert.deepEqual((await sa.call('POST', `${P}/${r.body.id}/verify`, {}, H)).body, { verified: true });
  assert.deepEqual(await hosts(), [{ hostname: 'delivery.serafim.test', role: 'admin' }]);
  assert.equal((await tls('delivery.serafim.test')).status, 200);
  assert.equal((await resolve('delivery.serafim.test')).status, 404);                                               // não é loja

  // DNS falha depois de verificado: o endereço continua no ar, só fica o aviso
  delete dnsA['delivery.serafim.test'];
  assert.equal((await sa.call('POST', `${P}/${r.body.id}/verify`, {}, H)).status, 422);
  const row = (await sa.call('GET', P, undefined, H)).body.domains.find((d: any) => d.hostname === 'delivery.serafim.test');
  assert.equal(row.verified, true); assert.ok(row.verifyError);
  assert.equal((await hosts()).length, 1);
  assert.equal((await client(env).get('/v1/edge/platform-hosts')).status, 401);                                    // sem o segredo do edge
});

test('domínio das lojas: slug.dominio abre a loja depois de verificado o registro curinga', async () => {
  const r = await sa.call('POST', P, { role: 'stores', hostname: 'pediulanchou.test' }, H);
  assert.equal(r.status, 201); assert.equal(r.body.dns.name, '*.pediulanchou.test');
  assert.equal((await sa.call('POST', P, { role: 'stores', hostname: 'pediu.test' }, H)).status, 409);                      // já é o domínio do servidor
  assert.equal((await resolve('pizzaria-dom.pediulanchou.test')).status, 404);                                      // ainda não verificado
  assert.equal((await sa.call('POST', `${P}/${r.body.id}/verify`, {}, H)).status, 422);
  wildcard['pediulanchou.test'] = ['203.0.113.10'];
  assert.deepEqual((await sa.call('POST', `${P}/${r.body.id}/verify`, {}, H)).body, { verified: true });
  const ok = await resolve('pizzaria-dom.pediulanchou.test');
  assert.equal(ok.status, 200); assert.equal(ok.body.slug, 'pizzaria-dom'); assert.equal(ok.body.storeId, A.storeId);
  assert.equal((await tls('pizzaria-dom.pediulanchou.test')).status, 200);
  assert.equal((await resolve('nao-existe.pediulanchou.test')).status, 404); assert.equal((await tls('nao-existe.pediulanchou.test')).status, 404);
  assert.equal((await resolve('a.pizzaria-dom.pediulanchou.test')).status, 404);                                    // só um nível
  assert.deepEqual((await hosts()).map((h) => h.role), ['admin']);                                                  // domínio de lojas não vai para a lista de plataforma
  // subdomínio do domínio das lojas pode ser do super admin, desde que não seja o endereço de uma loja
  assert.equal((await sa.call('POST', P, { role: 'admin', hostname: 'pizzaria-dom.pediulanchou.test' }, H)).status, 409);
  assert.equal((await sa.call('POST', P, { role: 'admin', hostname: 'admin.pediulanchou.test' }, H)).status, 201);
});

test('remover: pede o autenticador, registra na auditoria e não deixa remover o endereço em uso', async () => {
  const list = (await sa.call('GET', P, undefined, H)).body;
  assert.deepEqual(list.server[0], { role: 'stores', hostname: 'pediu.test' }); assert.deepEqual(list.serverIps, ['203.0.113.10']); assert.equal(list.current, 'entrada.pediu.test');
  const d = list.domains.find((x: any) => x.hostname === 'delivery.serafim.test');
  const inUse = await sa.call('DELETE', `${P}/${d.id}`, undefined, { host: 'delivery.serafim.test' });
  assert.equal(inUse.status, 409); assert.equal(inUse.body.error.code, 'in_use');
  assert.equal((await sa.call('DELETE', `${P}/${d.id}`, undefined, H)).status, 200);
  assert.equal((await sa.call('DELETE', `${P}/${d.id}`, undefined, H)).status, 404);
  assert.deepEqual(await hosts(), []); assert.equal((await tls('delivery.serafim.test')).status, 404);
  const logs = await env.pools.platform.begin((q) => q`select action, meta->>'hostname' as h from audit_logs where action like 'platform_domain.%'`);
  assert.ok(logs.some((l) => l.action === 'platform_domain.removed' && l.h === 'delivery.serafim.test'));
  assert.ok(logs.some((l) => l.action === 'platform_domain.verified' && l.h === 'pediulanchou.test'));
});
