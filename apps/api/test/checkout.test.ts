import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { createMailRuntime } from '../src/mailConfig.js';
import { resendMailer, type Mail } from '../src/mailer.js';
import { client, createAdmin, fullLogin, seedStore, setup, stepUp, type Client, type Env, type Seeded } from './helpers.js';

let env: Env; let A: Seeded; let B: Seeded;
const sent: Mail[] = [];
before(async () => {
  env = await setup();
  env.ctx.mailer = { send: async (m) => { sent.push(m); } };
  A = await seedStore(env, 'checkout-a'); B = await seedStore(env, 'checkout-b');
});
after(() => env.close());

const C = (s: Seeded) => `/v1/store/${s.slug}/customer`;
const order = (c: Client, s: Seeded, extra: object = {}) => c.post(`/v1/store/${s.slug}/orders`, { type: 'retirada', customerName: 'Maria Silva', phone: '16999990000', paymentId: s.payCash, lines: [{ productId: s.prod, qty: 1 }], ...extra });
const lastCode = () => /\b(\d{6})\b/.exec(sent[sent.length - 1]!.text)![1]!;
const myOrders = async (c: Client, s: Seeded) => (await c.get(`${C(s)}/orders`)).body.orders as { number: number }[];

test('exists: diz se o e-mail tem conta e se ela tem senha, sem expor mais nada', async () => {
  assert.deepEqual((await client(env).post(`${C(A)}/exists`, { email: 'novo@x.com' })).body, { exists: false, hasPassword: false });
  await client(env).post(`${C(A)}/register`, { name: 'Ana', email: 'ana@x.com', password: 'senha-da-ana' });
  assert.deepEqual((await client(env).post(`${C(A)}/exists`, { email: 'ANA@x.com' })).body, { exists: true, hasPassword: true });
  assert.deepEqual((await client(env).post(`${C(B)}/exists`, { email: 'ana@x.com' })).body, { exists: false, hasPassword: false });   // contas são por loja
  assert.equal((await client(env).post(`${C(A)}/exists`, { email: 'nao-e-email' })).status, 400);
});

test('o pedido guarda o e-mail (minúsculo): o do cliente logado ou o informado no checkout', async () => {
  const guest = await order(client(env), A, { email: 'Visitante@X.com' });
  assert.equal(guest.status, 201);
  const [g] = await env.pools.platform.begin((q) => q`select customer_email from orders where tracking_token = ${guest.body.trackingToken}`);
  assert.equal(g!.customer_email, 'visitante@x.com');
  const logged = client(env);
  await logged.post(`${C(A)}/register`, { name: 'Bia', email: 'bia@x.com', password: 'senha-da-bia' });
  const mine = await order(logged, A, { email: 'outro@x.com' });
  const [m] = await env.pools.platform.begin((q) => q`select customer_email, customer_id from orders where tracking_token = ${mine.body.trackingToken}`);
  assert.equal(m!.customer_email, 'bia@x.com'); assert.ok(m!.customer_id);
});

test('criar conta depois do pedido: puxa os pedidos deste navegador (token), nunca por e-mail não provado', async () => {
  const o1 = await order(client(env), A, { email: 'carla@x.com' });   // feito sem conta, neste "navegador"
  const o2 = await order(client(env), A, { email: 'carla@x.com' });   // feito por outra pessoa/navegador, mesmo e-mail digitado
  const c = client(env);
  const r = await c.post(`${C(A)}/register`, { name: 'Carla', email: 'carla@x.com', password: 'senha-da-carla', orderTokens: [o1.body.trackingToken] });
  assert.equal(r.status, 201);
  const nums = (await myOrders(c, A)).map((x) => x.number);
  assert.deepEqual(nums, [o1.body.number]);                         // só o do token; o outro não é dela por saber o e-mail
  assert.ok(!nums.includes(o2.body.number));
});

test('token de outra loja ou de pedido que já tem dono não vincula', async () => {
  const dono = client(env);
  await dono.post(`${C(A)}/register`, { name: 'Dono', email: 'dono@x.com', password: 'senha-do-dono' });
  const oDono = await order(dono, A);
  const oB = await order(client(env), B);
  const intruso = client(env);
  await intruso.post(`${C(A)}/register`, { name: 'Intruso', email: 'intruso@x.com', password: 'senha-intruso', orderTokens: [oDono.body.trackingToken, oB.body.trackingToken] });
  assert.deepEqual(await myOrders(intruso, A), []);
  assert.equal((await myOrders(dono, A)).length, 1);
});

test('código do e-mail prova o e-mail: vincula os pedidos feitos com ele, e o login por senha também depois de verificado', async () => {
  const o = await order(client(env), A, { email: 'duda@x.com' });
  const c = client(env);
  assert.equal((await c.post(`${C(A)}/code`, { email: 'duda@x.com', name: 'Duda' })).status, 200);
  assert.equal((await c.post(`${C(A)}/verify`, { email: 'duda@x.com', code: lastCode() })).status, 200);
  assert.deepEqual((await myOrders(c, A)).map((x) => x.number), [o.body.number]);
  // outro pedido sem conta com o mesmo e-mail; no próximo login por senha (e-mail já verificado) ele entra
  await c.put(`${C(A)}/password`, { password: 'senha-da-duda' });
  const o2 = await order(client(env), A, { email: 'duda@x.com' });
  const c2 = client(env);
  await c2.post(`${C(A)}/login`, { email: 'duda@x.com', password: 'senha-da-duda' });
  assert.deepEqual((await myOrders(c2, A)).map((x) => x.number).sort(), [o.body.number, o2.body.number].sort());
});

test('link-orders: logado traz pedidos do navegador; exige login', async () => {
  const o = await order(client(env), A);
  assert.equal((await client(env).post(`${C(A)}/link-orders`, { orderTokens: [o.body.trackingToken] })).status, 401);
  const c = client(env);
  await c.post(`${C(A)}/register`, { name: 'Edu', email: 'edu@x.com', password: 'senha-do-edu' });
  assert.equal((await c.post(`${C(A)}/link-orders`, { orderTokens: [o.body.trackingToken] })).body.linked, 1);
  assert.equal((await c.post(`${C(A)}/link-orders`, { orderTokens: [o.body.trackingToken] })).body.linked, 0);   // idempotente
});

const addr = (extra: object = {}) => ({ label: 'Casa', cep: '14402151', street: 'Rua Eurípedes Barcaroli', number: '125', district: 'Jardim Palma', city: 'Franca', uf: 'sp', ...extra });

test('endereços salvos: cria, lista, edita, troca o padrão e exclui; um cliente não mexe no do outro', async () => {
  const c = client(env);
  assert.equal((await c.get(`${C(A)}/addresses`)).status, 401);
  await c.post(`${C(A)}/register`, { name: 'Fabi', email: 'fabi@x.com', password: 'senha-da-fabi' });
  const a1 = (await c.post(`${C(A)}/addresses`, addr({ zoneId: A.zone }))).body.address;
  assert.equal(a1.isDefault, true); assert.equal(a1.uf, 'SP'); assert.equal(a1.zoneId, A.zone);   // o primeiro vira padrão
  const a2 = (await c.post(`${C(A)}/addresses`, addr({ label: 'Trabalho', street: 'Av. Brasil', isDefault: true }))).body.address;
  assert.equal(a2.isDefault, true);
  const list = (await c.get(`${C(A)}/addresses`)).body.addresses as { id: string; isDefault: boolean }[];
  assert.deepEqual(list.map((x) => [x.id, x.isDefault]), [[a2.id, true], [a1.id, false]]);
  assert.equal((await c.put(`${C(A)}/addresses/${a1.id}`, addr({ number: '999' }))).body.address.number, '999');
  assert.equal((await c.post(`${C(A)}/addresses`, addr({ street: 'x' }))).status, 400);
  assert.equal((await c.post(`${C(A)}/addresses`, addr({ cep: '1440-2151' }))).status, 400);

  const outro = client(env);
  await outro.post(`${C(A)}/register`, { name: 'Gabi', email: 'gabi@x.com', password: 'senha-da-gabi' });
  assert.deepEqual((await outro.get(`${C(A)}/addresses`)).body.addresses, []);
  assert.equal((await outro.put(`${C(A)}/addresses/${a1.id}`, addr())).status, 404);
  assert.equal((await outro.del(`${C(A)}/addresses/${a1.id}`)).status, 404);

  assert.equal((await c.del(`${C(A)}/addresses/${a2.id}`)).status, 200);          // apagou o padrão: o outro assume
  assert.equal(((await c.get(`${C(A)}/addresses`)).body.addresses as { isDefault: boolean }[])[0]!.isDefault, true);
});

test('endereços: no máximo 10 por cliente', async () => {
  const c = client(env);
  await c.post(`${C(A)}/register`, { name: 'Hugo', email: 'hugo@x.com', password: 'senha-do-hugo' });
  for (let i = 0; i < 10; i++) assert.equal((await c.post(`${C(A)}/addresses`, addr({ number: String(i) }))).status, 201);
  assert.equal((await c.post(`${C(A)}/addresses`, addr())).status, 422);
});

test('Resend: mailer chama a API com a chave e devolve o erro do provedor', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const ok = resendMailer({ apiKey: 're_chave_teste', from: 'PediuLanchou <nao-responda@pediulanchou.com.br>' }, (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{"id":"1"}', { status: 200 }); }) as never);
  await ok.send({ to: 'a@x.com', subject: 'Oi', html: '<b>oi</b>', text: 'oi' });
  assert.equal(calls[0]!.url, 'https://api.resend.com/emails');
  assert.equal((calls[0]!.init.headers as Record<string, string>).authorization, 'Bearer re_chave_teste');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { from: 'PediuLanchou <nao-responda@pediulanchou.com.br>', to: ['a@x.com'], subject: 'Oi', html: '<b>oi</b>', text: 'oi' });
  const bad = resendMailer({ apiKey: 'x', from: 'a@b.com' }, (async () => new Response('{"message":"domínio não verificado"}', { status: 403 })) as never);
  await assert.rejects(() => bad.send({ to: 'a@x.com', subject: 's', html: 'h', text: 't' }), /Resend 403: domínio não verificado/);
});

test('super admin configura o Resend (cifrado, step-up) e o código de acesso passa a sair por ele', async () => {
  const calls: { body: any }[] = [];
  const fake = (async (_u: string, init: RequestInit) => { calls.push({ body: JSON.parse(String(init.body)) }); return new Response('{"id":"1"}', { status: 200 }); }) as never;
  const mail = createMailRuntime(env.ctx, undefined, fake);
  const app2 = buildApp({ ...env.ctx, mail, mailer: mail }); await app2.ready();
  const env2 = { ...env, app: app2 } as Env;
  try {
    assert.equal(await mail.ready!(), false);                                       // sem Resend e sem SMTP
    await createAdmin(env2, 'sa-mail@pediu.test');
    const sa = client(env2); await fullLogin(env2, sa, 'sa-mail@pediu.test');
    assert.deepEqual((await sa.get('/v1/platform/mail-settings')).body, { active: null, saved: null });
    const body = { apiKey: 're_chave_secreta_123', from: 'PediuLanchou <nao-responda@pediulanchou.com.br>' };
    assert.equal((await sa.put('/v1/platform/mail-settings', body)).status, 403);   // exige step-up
    await stepUp(env2, sa, 'sa-mail@pediu.test');
    assert.equal((await sa.put('/v1/platform/mail-settings', { ...body, from: 'sem-arroba' })).status, 400);
    assert.equal((await sa.put('/v1/platform/mail-settings', body)).status, 200);
    const d = (await sa.get('/v1/platform/mail-settings')).body;
    assert.deepEqual(d, { active: 'resend', saved: { from: body.from, hasKey: true } });
    assert.equal(JSON.stringify(d).includes('re_chave_secreta'), false);            // a chave nunca volta
    const [row] = await env.pools.platform.begin((q) => q`select value_enc from platform_settings where key = 'mail.resend'`);
    assert.equal(String(row!.value_enc).includes('re_chave_secreta'), false);       // e fica cifrada no banco

    // o login por código do cliente sai pelo Resend, com remetente da PediuLanchou e a marca da loja dentro
    await env.pools.platform.begin((q) => q`insert into store_themes (store_id, tenant_id, data) values (${A.storeId}, ${A.tenantId}, ${JSON.stringify({ primary: '#112233' })}::jsonb) on conflict (store_id) do update set data = excluded.data`);
    assert.equal((await client(env2).post(`${C(A)}/code`, { email: 'resend@x.com' })).status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.body.from, body.from); assert.deepEqual(calls[0]!.body.to, ['resend@x.com']);
    assert.ok(calls[0]!.body.html.includes('#112233') && calls[0]!.body.html.includes('Loja checkout-a'));

    // trocar só o remetente mantém a chave
    assert.equal((await sa.put('/v1/platform/mail-settings', { from: 'Outra <outra@pediulanchou.com.br>' })).status, 200);
    assert.equal((await sa.get('/v1/platform/mail-settings')).body.saved.from, 'Outra <outra@pediulanchou.com.br>');
    assert.equal((await sa.post('/v1/platform/mail-settings/test', { to: 'eu@x.com' })).body.ok, true);

    assert.equal((await sa.del('/v1/platform/mail-settings')).status, 200);
    assert.equal((await sa.get('/v1/platform/mail-settings')).body.active, null);
    assert.equal((await client(env2).post(`${C(A)}/code`, { email: 'resend@x.com' })).status, 503);   // sem provedor, como antes
  } finally { await app2.close(); }
});
