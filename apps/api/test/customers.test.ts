import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { client, createAdmin, fullLogin, seedStore, setup, staffLogin, stepUp, type Client, type Env, type Seeded } from './helpers.js';
import type { Mail } from '../src/mailer.js';

let env: Env; let A: Seeded; let B: Seeded;
const sent: Mail[] = [];
before(async () => {
  env = await setup();
  env.ctx.mailer = { send: async (m) => { sent.push(m); } };
  A = await seedStore(env, 'loja-a'); B = await seedStore(env, 'loja-b');
  await env.pools.platform.begin(async (q) => {
    await q`insert into store_themes (store_id, tenant_id, data) values (${A.storeId}, ${A.tenantId}, ${JSON.stringify({ primary: '#112233', primaryFg: '#FFFFFF', logoUrl: 'https://cdn.test/logo.png' })}::jsonb)`;
    await q`update platform_public_settings set value = 'https://lp.pediu.test' where key = 'landing_url'`;
  });
});
after(() => env.close());

const lastCode = () => /\b(\d{6})\b/.exec(sent[sent.length - 1]!.text)![1]!;
const login = async (c: Client, s: Seeded, mail: string, extra: object = {}) => {
  assert.equal((await c.post(`/v1/store/${s.slug}/customer/code`, { email: mail, ...extra })).status, 200);
  return c.post(`/v1/store/${s.slug}/customer/verify`, { email: mail, code: lastCode() });
};
const order = (c: Client, s: Seeded) => c.post(`/v1/store/${s.slug}/orders`, { type: 'retirada', customerName: 'Maria Silva', phone: '16999990000', paymentId: s.payPix, lines: [{ productId: s.prod, qty: 1 }] });

test('login por código de e-mail: e-mail com a marca da loja, cookie, sessão e logout', async () => {
  const c = client(env);
  assert.equal((await c.get(`/v1/store/${A.slug}/customer/me`)).body.customer, null);   // sem login: 200 e null, nunca 401

  const v = await login(c, A, 'Maria@Teste.com', { name: 'Maria Silva', phone: '16999990000' });
  assert.equal(v.status, 200); assert.equal(v.body.customer.email, 'maria@teste.com'); assert.equal(v.body.customer.name, 'Maria Silva');

  const mail = sent[sent.length - 1]!;
  assert.equal(mail.to, 'maria@teste.com');
  assert.match(mail.html, /#112233/); assert.match(mail.html, /Loja loja-a/); assert.match(mail.html, /https:\/\/cdn\.test\/logo\.png/);
  assert.match(mail.html, /Desenvolvido com muita fome/); assert.match(mail.html, /href="https:\/\/lp\.pediu\.test"/); assert.match(mail.html, /logo-allblack\.png/);

  const set = String(v.headers['set-cookie']);
  assert.match(set, /HttpOnly/i);
  assert.equal((await c.get(`/v1/store/${A.slug}/customer/me`)).body.customer.email, 'maria@teste.com');
  assert.equal((await c.put(`/v1/store/${A.slug}/customer/me`, { name: 'Maria S.', phone: '16988887777' })).body.customer.phone, '16988887777');

  // o cookie da loja A não vale na loja B
  const other = await c.get(`/v1/store/${B.slug}/customer/me`);
  assert.equal(other.body.customer, null);

  await c.post(`/v1/store/${A.slug}/customer/logout`);
  assert.equal((await c.get(`/v1/store/${A.slug}/customer/me`)).body.customer, null);
});

test('código: uso único, erro não abre sessão e 5 erros inutilizam o código', async () => {
  const c = client(env);
  await c.post(`/v1/store/${A.slug}/customer/code`, { email: 'joao@teste.com' });
  const real = lastCode(); const wrong = real === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await c.post(`/v1/store/${A.slug}/customer/verify`, { email: 'joao@teste.com', code: wrong })).status, 401);
  // depois de 5 erros nem o código certo funciona
  assert.equal((await c.post(`/v1/store/${A.slug}/customer/verify`, { email: 'joao@teste.com', code: real })).status, 401);
  assert.equal((await c.get(`/v1/store/${A.slug}/customer/me`)).body.customer, null);

  // código usado não vale de novo
  const d = client(env);
  assert.equal((await login(d, A, 'ana@teste.com')).status, 200);
  assert.equal((await client(env).post(`/v1/store/${A.slug}/customer/verify`, { email: 'ana@teste.com', code: lastCode() })).status, 401);
  // e-mail inválido
  assert.equal((await client(env).post(`/v1/store/${A.slug}/customer/code`, { email: 'nao-e-email' })).status, 400);
});

test('pedido de cliente logado entra no histórico; pedido anônimo não; acompanhamento do pedido', async () => {
  const c = client(env);
  await login(c, A, 'pedro@teste.com', { name: 'Pedro Alves' });
  const mine = await order(c, A);
  assert.equal(mine.status, 201);
  await order(client(env), A);   // anônimo, mesma loja

  const list = await c.get(`/v1/store/${A.slug}/customer/orders`);
  assert.equal(list.status, 200); assert.equal(list.body.orders.length, 1);
  assert.equal(list.body.orders[0].number, mine.body.number);
  assert.equal(list.body.orders[0].token, mine.body.trackingToken);
  assert.equal(list.body.orders[0].items[0].qty, 1);
  assert.equal((await client(env).get(`/v1/store/${A.slug}/customer/orders`)).status, 401);

  // o status andando na cozinha aparece para o cliente
  const kitchen = client(env); await staffLogin(env, kitchen, A, 'gerente');
  const orders = await kitchen.get('/v1/staff/orders?open=1');
  const id = orders.body.orders.find((o: { number: number }) => o.number === mine.body.number).id;
  assert.equal((await kitchen.post(`/v1/staff/orders/${id}/status`, { to: 'preparo' })).status, 200);
  assert.equal((await c.get(`/v1/store/${A.slug}/customer/orders`)).body.orders[0].status, 'preparo');
});

test('lista de clientes do lojista: só da própria loja, com busca e totais; só quem tem permissão', async () => {
  const bc = client(env); await login(bc, B, 'bruno@loja-b.com', { name: 'Bruno B' });
  const admin = client(env); await staffLogin(env, admin, A, 'admin');
  const r = await admin.get('/v1/staff/customers');
  assert.equal(r.status, 200);
  const emails = r.body.customers.map((x: { email: string }) => x.email);
  assert.ok(emails.includes('pedro@teste.com')); assert.ok(!emails.includes('bruno@loja-b.com'));
  const pedro = r.body.customers.find((x: { email: string }) => x.email === 'pedro@teste.com');
  assert.equal(pedro.orders_count, 1); assert.ok(pedro.spent_cents > 0);

  assert.deepEqual((await admin.get('/v1/staff/customers?q=pedro')).body.customers.map((x: { email: string }) => x.email), ['pedro@teste.com']);
  assert.equal((await admin.get('/v1/staff/customers?q=%25')).body.customers.length, 0);   // % não vira curinga
  const detail = await admin.get(`/v1/staff/customers/${pedro.id}/orders`);
  assert.equal(detail.body.orders.length, 1);

  const balcao = client(env); await staffLogin(env, balcao, A, 'balcao');
  assert.equal((await balcao.get('/v1/staff/customers')).status, 403);
  assert.equal((await client(env).get('/v1/staff/customers')).status, 401);
  // a loja B não enxerga clientes da A
  const adminB = client(env); await staffLogin(env, adminB, B, 'admin');
  assert.deepEqual((await adminB.get('/v1/staff/customers')).body.customers.map((x: { email: string }) => x.email), ['bruno@loja-b.com']);
});

test('limite de códigos por e-mail e por hora', async () => {
  const c = client(env); const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await c.post(`/v1/store/${B.slug}/customer/code`, { email: 'spam@teste.com' })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
});

test('a vitrine informa o link da landing page (rodapé das lojas)', async () => {
  const info = await client(env).get(`/v1/store/${A.slug}`);
  assert.equal(info.body.platform.landingUrl, 'https://lp.pediu.test');
});

test('super admin muda o link da landing page: step-up obrigatório, só http(s) e a vitrine reflete', async () => {
  await createAdmin(env, 'sa@pediu.test');
  const sa = client(env); await fullLogin(env, sa, 'sa@pediu.test');
  assert.equal((await sa.get('/v1/platform/public-settings')).body.settings.landing_url, 'https://lp.pediu.test');
  assert.equal((await sa.put('/v1/platform/public-settings', { landingUrl: 'https://novo.test' })).status, 403);   // sem step-up
  await stepUp(env, sa, 'sa@pediu.test');
  assert.equal((await sa.put('/v1/platform/public-settings', { landingUrl: 'javascript:alert(1)' })).status, 400);
  assert.equal((await sa.put('/v1/platform/public-settings', { landingUrl: 'https://novo.test/lp' })).status, 200);
  assert.equal((await client(env).get(`/v1/store/${A.slug}`)).body.platform.landingUrl, 'https://novo.test/lp');
  assert.equal((await client(env).put('/v1/platform/public-settings', { landingUrl: 'https://x.test' })).status, 401);
});
