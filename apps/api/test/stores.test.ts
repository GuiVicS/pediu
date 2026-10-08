import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { hashToken } from '@pediu/shared';
import { client, createAdmin, fullLogin, PASSWORD, setup, stepUp, type Client, type Env } from './helpers.js';

let env: Env; let c: Client;
const EMAIL = 'loja@teste.com';
before(async () => { env = await setup(); await createAdmin(env, EMAIL); c = client(env); await fullLogin(env, c, EMAIL); });
after(() => env.close());

const novaLoja = async (slug: string, extra: object = {}) => (await c.post('/v1/platform/stores', { slug, name: `Loja ${slug}`, tenantName: `Conta ${slug}`, adminEmail: `admin@${slug}.test`, adminPassword: PASSWORD, ...extra }));

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

test('checklist de funcionalidades: exige step-up, bloqueia indisponível e audita', async () => {
  const { body: s } = await novaLoja('checklist-ok');
  const id = s.id as string;
  const lista = await c.get(`/v1/platform/stores/${id}/features`);
  assert.equal(lista.status, 200);
  assert.ok(lista.body.features.every((f: any) => f.enabled === false));

  await stepUp(env, c, EMAIL);
  const indisponivel = await c.put(`/v1/platform/stores/${id}/features`, { changes: { ai_agent: true } });
  assert.equal(indisponivel.status, 422);
  assert.equal((await c.put(`/v1/platform/stores/${id}/features`, { changes: { inexistente: true } })).status, 422);

  const ok = await c.put(`/v1/platform/stores/${id}/features`, { changes: { whatsapp_support: true } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.features.find((f: any) => f.key === 'whatsapp_support').enabled, true);
  const audit = await env.pools.platform.begin((q) => q`select meta from audit_logs where store_id = ${id} and action = 'store.feature'`);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.meta.feature, 'whatsapp_support');
});

test('criar loja exige o administrador, que entra no painel ainda em desenvolvimento', async () => {
  const sem = await c.post('/v1/platform/stores', { slug: 'sem-admin', name: 'Sem admin', tenantName: 'Conta X' });
  assert.equal(sem.status, 400);
  assert.equal((await novaLoja('senha-curta', { adminPassword: 'curta' })).status, 400);
  const r = await novaLoja('com-admin', { adminEmail: 'Dono@Com-Admin.test', adminName: 'Dono' });
  assert.equal(r.status, 201); assert.equal(r.body.adminEmail, 'dono@com-admin.test');
  const staff = client(env);
  const login = await staff.post('/v1/staff/login', { store: 'com-admin', email: 'dono@com-admin.test', password: PASSWORD });
  assert.equal(login.status, 200); assert.equal(login.body.role, 'admin');
  const me = await staff.get('/v1/staff/me');
  assert.equal(me.status, 200); assert.equal(me.body.store.status, 'desenvolvimento');
  // tudo na mesma transação: e-mail repetido na mesma conta não deixa loja órfã
  const conta = r.body.tenantId as string;
  const dup = await novaLoja('outra-da-conta', { tenantId: conta, tenantName: undefined, adminEmail: 'dono@com-admin.test' });
  assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'admin_email_taken');
  const [n] = await env.pools.platform.begin((q) => q`select count(*)::int as n from stores where slug = 'outra-da-conta'`);
  assert.equal(n!.n, 0);
});

test('link de prévia: só quem tem o código vê a loja em desenvolvimento; pedidos continuam bloqueados', async () => {
  const { body: s } = await novaLoja('previa-loja');
  const publico = client(env);
  assert.equal((await publico.get('/v1/store/previa-loja')).status, 404);
  assert.equal((await c.get(`/v1/platform/stores/${s.id}/preview`)).body.link, null);

  const criado = await c.post(`/v1/platform/stores/${s.id}/preview`);
  assert.equal(criado.status, 200);
  const token = new URL(criado.body.link).searchParams.get('previa')!;
  assert.match(criado.body.link, /^https:\/\/previa-loja\.pediu\.test\/\?previa=/);
  assert.equal((await c.get(`/v1/platform/stores/${s.id}/preview`)).body.link, criado.body.link);

  const ver = (tk: string) => publico.call('GET', '/v1/store/previa-loja', undefined, { cookie: `pediu_previa=${tk}` });
  assert.equal((await ver(token)).status, 200);
  assert.equal((await ver('x'.repeat(32))).status, 404);
  // pedido continua bloqueado mesmo com a prévia
  const pedido = await publico.call('POST', '/v1/store/previa-loja/orders', { type: 'retirada', items: [] }, { cookie: `pediu_previa=${token}` });
  assert.notEqual(pedido.status, 201);

  // trocar o link invalida o anterior; apagar desliga
  const novo = await c.post(`/v1/platform/stores/${s.id}/preview`);
  assert.notEqual(novo.body.link, criado.body.link);
  assert.equal((await ver(token)).status, 404);
  assert.equal((await ver(new URL(novo.body.link).searchParams.get('previa')!)).status, 200);
  assert.equal((await c.del(`/v1/platform/stores/${s.id}/preview`)).status, 200);
  assert.equal((await ver(new URL(novo.body.link).searchParams.get('previa')!)).status, 404);

  // loja no ar não tem prévia (já é pública)
  await env.pools.platform.begin((q) => q`update stores set status = 'producao' where id = ${s.id}`);
  assert.equal((await c.post(`/v1/platform/stores/${s.id}/preview`)).status, 409);
  const audit = await env.pools.platform.begin((q) => q`select action from audit_logs where store_id = ${s.id} and action like 'store.preview%' order by id`);
  assert.deepEqual(audit.map((a) => a.action), ['store.preview_link_created', 'store.preview_link_created', 'store.preview_link_revoked']);
});

test('token do MCP: permissão de produção na criação e liga/desliga com step-up', async () => {
  await stepUp(env, c, EMAIL);
  const t1 = await c.post('/v1/platform/mcp-tokens', { name: 'Só dev' });
  const t2 = await c.post('/v1/platform/mcp-tokens', { name: 'Produção', allowProduction: true });
  assert.equal(t1.status, 201); assert.equal(t2.status, 201);
  const lista = (await c.get('/v1/platform/mcp-tokens')).body.tokens;
  assert.equal(lista.find((x: any) => x.id === t1.body.id).allow_production, false);
  assert.equal(lista.find((x: any) => x.id === t2.body.id).allow_production, true);
  const patch = (id: string, v: boolean) => env.app.inject({ method: 'PATCH', url: `/v1/platform/mcp-tokens/${id}`, payload: { allowProduction: v }, headers: { cookie: c.cookie } });
  const ligou = await patch(t1.body.id, true);
  assert.equal(ligou.statusCode, 200);
  const [row] = await env.pools.platform.begin((q) => q`select allow_production from mcp_tokens where id = ${t1.body.id}`);
  assert.equal(row!.allow_production, true);
  // a autenticação do MCP (função usada pelo servidor MCP) devolve a permissão de cada token
  const autentica = async (tk: string) => (await env.pools.mcp.begin((q) => q`select allow_production from app.mcp_authenticate(${hashToken(tk)}, '')`))[0]!.allow_production;
  assert.equal(await autentica(t1.body.token), true);
  assert.equal(await autentica(t2.body.token), true);
  assert.equal((await patch(t2.body.id, false)).statusCode, 200);
  assert.equal(await autentica(t2.body.token), false);
});
