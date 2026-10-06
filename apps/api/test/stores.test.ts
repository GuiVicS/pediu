import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { client, createAdmin, fullLogin, setup, stepUp, type Client, type Env } from './helpers.js';

let env: Env; let c: Client;
const EMAIL = 'loja@teste.com';
before(async () => { env = await setup(); await createAdmin(env, EMAIL); c = client(env); await fullLogin(env, c, EMAIL); });
after(() => env.close());

const novaLoja = async (slug: string, extra: object = {}) => (await c.post('/v1/platform/stores', { slug, name: `Loja ${slug}`, tenantName: `Conta ${slug}`, ...extra }));

test('cria loja em desenvolvimento com subdomínio, tema e configurações vazios', async () => {
  const r = await novaLoja('forno-fogo');
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'desenvolvimento');
  assert.equal(r.body.domain, 'forno-fogo.pediu.test');
  const list = await c.get('/v1/platform/stores?status=desenvolvimento');
  assert.ok(list.body.stores.some((s: any) => s.slug === 'forno-fogo' && s.domain === 'forno-fogo.pediu.test'));
  assert.equal((await novaLoja('forno-fogo')).status, 409);
  assert.equal((await novaLoja('Forno_Fogo')).status, 400);
  assert.equal((await c.post('/v1/platform/stores', { slug: 'sem-conta', name: 'Sem conta' })).status, 400);
});

test('publicar: exige step-up e assinatura ou cortesia; voltar exige justificativa', async () => {
  const { body: s } = await novaLoja('pizza-boa');
  const id = s.id as string;
  const semStep = await c.post(`/v1/platform/stores/${id}/status`, { to: 'producao' });
  assert.equal(semStep.body.error.code, 'stepup_required');

  await stepUp(env, c, EMAIL);
  const semAssinatura = await c.post(`/v1/platform/stores/${id}/status`, { to: 'producao' });
  assert.equal(semAssinatura.status, 422);
  assert.match(semAssinatura.body.error.message, /assinatura|cortesia/i);

  const ok = await c.post(`/v1/platform/stores/${id}/status`, { to: 'producao', waiverReason: 'parceiro piloto' });
  assert.equal(ok.status, 200);
  const [row] = await env.pools.platform.begin((q) => q`select status, published_at, status_reason from stores where id = ${id}`);
  assert.equal(row!.status, 'producao'); assert.ok(row!.published_at); assert.equal(row!.status_reason, 'parceiro piloto');

  const semMotivo = await c.post(`/v1/platform/stores/${id}/status`, { to: 'desenvolvimento' });
  assert.equal(semMotivo.status, 422);
  const volta = await c.post(`/v1/platform/stores/${id}/status`, { to: 'desenvolvimento', reason: 'cliente pediu ajustes' });
  assert.equal(volta.status, 200);

  const audit = await env.pools.platform.begin((q) => q`select action, before, after from audit_logs where store_id = ${id} and action = 'store.status' order by id`);
  assert.equal(audit.length, 2);
  assert.deepEqual(audit[0]!.after, { status: 'producao' });
});

test('publicar com assinatura ativa não precisa de cortesia', async () => {
  const { body: s } = await novaLoja('com-plano');
  await env.pools.platform.begin((q) => q`insert into subscriptions (tenant_id, status) values (${s.tenantId}, 'trialing')`);
  await stepUp(env, c, EMAIL);
  assert.equal((await c.post(`/v1/platform/stores/${s.id}/status`, { to: 'producao' })).status, 200);
});

test('pedido de publicação do MCP: só o super admin aprova, com step-up', async () => {
  const { body: s } = await novaLoja('pedido-mcp');
  // o MCP (role mcp_agent) consegue abrir o pedido...
  await env.pools.mcp.begin((q) => q`insert into publication_requests (store_id, requested_by, note) values (${s.id}, 'mcp:teste', 'pronta')`);
  // ...mas não consegue mudar o status
  await assert.rejects(env.pools.mcp.begin((q) => q`update stores set status = 'producao' where id = ${s.id}`));
  const [row] = await env.pools.platform.begin((q) => q`select status from stores where id = ${s.id}`);
  assert.equal(row!.status, 'desenvolvimento');

  const list = await c.get('/v1/platform/publication-requests');
  const req = list.body.requests.find((r: any) => r.store_id === s.id);
  assert.equal(req.status, 'pendente');
  env.clock.advance(6 * 60_000); // a janela do step-up dos testes anteriores já expirou
  assert.equal((await c.post(`/v1/platform/publication-requests/${req.id}/decide`, { approve: true })).body.error.code, 'stepup_required');
  await stepUp(env, c, EMAIL);
  const negada = await c.post(`/v1/platform/publication-requests/${req.id}/decide`, { approve: true });
  assert.equal(negada.status, 422); // sem assinatura nem cortesia
  const ok = await c.post(`/v1/platform/publication-requests/${req.id}/decide`, { approve: true, waiverReason: 'cortesia' });
  assert.equal(ok.status, 200);
  assert.equal((await c.post(`/v1/platform/publication-requests/${req.id}/decide`, { approve: false })).status, 409);
});

test('tokens do MCP: o valor aparece uma vez, o banco guarda só o hash, revogação funciona', async () => {
  await stepUp(env, c, EMAIL);
  const r = await c.post('/v1/platform/mcp-tokens', { name: 'Claude Desktop', expiresInDays: 30 });
  assert.equal(r.status, 201);
  assert.match(r.body.token, /^pmcp_/);
  const list = await c.get('/v1/platform/mcp-tokens');
  const t = list.body.tokens.find((x: any) => x.id === r.body.id);
  assert.equal(t.hint, r.body.token.slice(-4));
  assert.equal(JSON.stringify(list.body).includes(r.body.token), false);
  const [db] = await env.pools.platform.begin((q) => q`select token_hash from mcp_tokens where id = ${r.body.id}`);
  assert.notEqual(db!.token_hash, r.body.token);
  assert.equal(db!.token_hash.length, 64);

  await stepUp(env, c, EMAIL);
  assert.equal((await c.del(`/v1/platform/mcp-tokens/${r.body.id}`)).status, 200);
  assert.equal((await c.del(`/v1/platform/mcp-tokens/${r.body.id}`)).status, 404);
});

test('token limitado a lojas guarda a lista', async () => {
  const { body: s } = await novaLoja('limitada');
  await stepUp(env, c, EMAIL);
  const r = await c.post('/v1/platform/mcp-tokens', { name: 'só uma loja', storeIds: [s.id] });
  const [db] = await env.pools.platform.begin((q) => q`select store_limit from mcp_tokens where id = ${r.body.id}`);
  assert.deepEqual(db!.store_limit, [s.id]);
});
