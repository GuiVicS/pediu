import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { client, seedStore, setup, staffLogin, type Client, type Env, type Seeded } from './helpers.js';
import type { Mail } from '../src/mailer.js';

let env: Env; let A: Seeded; let B: Seeded; let admin: Client; let adminB: Client;
const sent: Mail[] = [];
before(async () => {
  env = await setup();
  env.ctx.mailer = { send: async (m) => { sent.push(m); } };
  A = await seedStore(env, 'cup-a'); B = await seedStore(env, 'cup-b');
  admin = client(env); await staffLogin(env, admin, A, 'admin');
  adminB = client(env); await staffLogin(env, adminB, B, 'admin');
});
after(() => env.close());

const lines = (s: Seeded, qty = 1) => [{ productId: s.prod, qty }];   // Calabresa R$ 49,90
const mk = (c: Client, o: object = {}) => c.post('/v1/staff/coupons', { code: 'BEMVINDO10', kind: 'percent', percent: 10, ...o });
const validate = (c: Client, s: Seeded, code: string, extra: object = {}) => c.post(`/v1/store/${s.slug}/coupons/validate`, { code, lines: lines(s), ...extra });
const order = (c: Client, s: Seeded, code?: string, extra: object = {}) => c.post(`/v1/store/${s.slug}/orders`, { type: 'retirada', customerName: 'Maria Silva', phone: '16999990000', paymentId: s.payCash, lines: lines(s), couponCode: code, ...extra });
const lastCode = () => /\b(\d{6})\b/.exec(sent[sent.length - 1]!.text)![1]!;
const loginCustomer = async (s: Seeded, email: string) => {
  const c = client(env);
  await c.post(`/v1/store/${s.slug}/customer/code`, { email });
  const v = await c.post(`/v1/store/${s.slug}/customer/verify`, { email, code: lastCode() });
  return { c, id: v.body.customer.id as string };
};

test('lojista cria cupom com validações e código único por loja', async () => {
  assert.equal((await mk(admin)).status, 201);
  assert.equal((await mk(admin)).status, 409);                                   // mesmo código na mesma loja
  assert.equal((await mk(adminB)).status, 201);                                  // outra loja pode ter o mesmo código
  assert.equal((await mk(admin, { code: 'x' })).status, 400);                    // código curto
  assert.equal((await mk(admin, { code: 'SEM-VALOR', kind: 'fixed' })).status, 400);
  assert.equal((await mk(admin, { code: 'PORC-ZERO', percent: 0 })).status, 400);
  assert.equal((await mk(admin, { code: 'DATAS', startsAt: '2030-01-02T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' })).status, 400);
  const list = await admin.get('/v1/staff/coupons');
  assert.equal(list.body.coupons.length, 1); assert.equal(list.body.coupons[0].code, 'BEMVINDO10');
  // equipe sem permissão de loja não gerencia cupons
  const garcom = client(env); await staffLogin(env, garcom, A, 'garcom');
  assert.equal((await garcom.get('/v1/staff/coupons')).status, 403);
});

test('validação e pedido: desconto só sobre os itens, total recalculado no servidor, uso registrado', async () => {
  const v = await validate(client(env), A, 'bemvindo10');                        // minúsculas funcionam
  assert.equal(v.status, 200); assert.equal(v.body.discountCents, 499); assert.equal(v.body.subtotalCents, 4990);
  assert.equal((await validate(client(env), A, 'NAOEXISTE')).status, 422);
  assert.equal((await validate(client(env), B, 'BEMVINDO10')).body.discountCents, 499);   // o da loja B é outro cupom
  const o = await order(client(env), A, 'BEMVINDO10', { phone: '16911110001' });
  assert.equal(o.status, 201); assert.equal(o.body.totalCents, 4990 - 499);
  const [row] = await env.pools.platform.begin((q) => q`select discount_cents, subtotal_cents, total_cents, coupon_code from orders where number = ${o.body.number} and store_id = ${A.storeId}`);
  assert.deepEqual([row!.discount_cents, row!.subtotal_cents, row!.total_cents, row!.coupon_code], [499, 4990, 4491, 'BEMVINDO10']);
  const [c] = await env.pools.platform.begin((q) => q`select used_count from coupons where store_id = ${A.storeId} and code = 'BEMVINDO10'`);
  assert.equal(c!.used_count, 1);
  // cupom de uma loja não vale na outra, mesmo com o código certo da outra loja não existir lá
  await mk(admin, { code: 'SOA10', kind: 'fixed', amountCents: 1000 });
  assert.equal((await order(client(env), B, 'SOA10')).status, 422);
});

test('desconto nunca passa dos itens e não alcança a taxa de entrega; teto e mínimo', async () => {
  await mk(admin, { code: 'GRANDE', kind: 'fixed', amountCents: 10000 });
  const o = await client(env).post(`/v1/store/${A.slug}/orders`, { type: 'delivery', zoneId: A.zone, address: 'Rua 1, 10', customerName: 'Maria Silva', phone: '16922220001', paymentId: A.payPix, lines: lines(A), couponCode: 'GRANDE' });
  assert.equal(o.status, 201); assert.equal(o.body.totalCents, 600);              // itens grátis, taxa de R$ 6 paga
  await mk(admin, { code: 'TETO', percent: 50, maxDiscountCents: 300 });
  assert.equal((await validate(client(env), A, 'TETO')).body.discountCents, 300);
  await mk(admin, { code: 'MIN100', kind: 'fixed', amountCents: 500, minOrderCents: 10000 });
  const low = await validate(client(env), A, 'MIN100');
  assert.equal(low.status, 422); assert.match(low.body.error.message, /R\$ 100,00/);
  assert.equal((await client(env).post(`/v1/store/${A.slug}/coupons/validate`, { code: 'MIN100', lines: lines(A, 3) })).status, 200);   // 3 × 49,90 passa do mínimo
});

test('validade, início, desativação', async () => {
  await mk(admin, { code: 'PASSADO', endsAt: '2020-01-01T00:00:00Z' });
  await mk(admin, { code: 'FUTURO', startsAt: '2090-01-01T00:00:00Z' });
  const off = await mk(admin, { code: 'DESLIGADO', active: false });
  assert.match((await validate(client(env), A, 'PASSADO')).body.error.message, /expirou/);
  assert.match((await validate(client(env), A, 'FUTURO')).body.error.message, /ainda não começou/);
  assert.equal((await validate(client(env), A, 'DESLIGADO')).status, 422);
  assert.equal((await admin.put(`/v1/staff/coupons/${off.body.id}`, { code: 'DESLIGADO', kind: 'percent', percent: 10, active: true })).status, 200);
  assert.equal((await validate(client(env), A, 'DESLIGADO')).status, 200);
});

test('limite total: esgota, e cancelar o pedido devolve o uso; pedidos simultâneos não estouram', async () => {
  await mk(admin, { code: 'UNICO', maxUses: 1 });
  const first = await order(client(env), A, 'UNICO', { phone: '16933330001' });
  assert.equal(first.status, 201);
  const second = await order(client(env), A, 'UNICO', { phone: '16933330002' });
  assert.equal(second.status, 422); assert.match(second.body.error.message, /esgot/);
  // cancelar devolve o uso
  const [o] = await env.pools.platform.begin((q) => q`select id from orders where number = ${first.body.number} and store_id = ${A.storeId}`);
  await env.pools.platform.begin((q) => q`update orders set status = 'cancelado' where id = ${o!.id}`);
  const [c] = await env.pools.platform.begin((q) => q`select used_count from coupons where store_id = ${A.storeId} and code = 'UNICO'`);
  assert.equal(c!.used_count, 0);
  assert.equal((await order(client(env), A, 'UNICO', { phone: '16933330003' })).status, 201);
  // corrida: limite 1, dois pedidos ao mesmo tempo
  await mk(admin, { code: 'CORRIDA', maxUses: 1 });
  const rs = await Promise.all([order(client(env), A, 'CORRIDA', { phone: '16944440001' }), order(client(env), A, 'CORRIDA', { phone: '16944440002' })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [201, 422]);
});

test('limite por cliente vale por conta e por telefone (sem conta também)', async () => {
  await mk(admin, { code: 'UMAVEZ', maxUsesPerCustomer: 1 });
  assert.equal((await order(client(env), A, 'UMAVEZ', { phone: '(16) 95555-0001' })).status, 201);
  const again = await order(client(env), A, 'UMAVEZ', { phone: '16955550001' });  // mesmo telefone, formato diferente
  assert.equal(again.status, 422); assert.match(again.body.error.message, /máximo de vezes/);
  assert.equal((await order(client(env), A, 'UMAVEZ', { phone: '16955550002' })).status, 201);
  // com conta: trocar de telefone não burla
  const { c } = await loginCustomer(A, 'ana@teste.com');
  assert.equal((await order(c, A, 'UMAVEZ', { phone: '16955550003' })).status, 201);
  assert.equal((await order(c, A, 'UMAVEZ', { phone: '16955550004' })).status, 422);
});

test('cupom exclusivo: só clientes escolhidos, aparece na conta e respeita o isolamento entre lojas', async () => {
  const ana = await loginCustomer(A, 'ana.vip@teste.com'); const bia = await loginCustomer(A, 'bia@teste.com');
  const cup = await mk(admin, { code: 'VIP20', percent: 20, audience: 'selected', description: 'Só para você' });
  const other = await loginCustomer(B, 'zoe@teste.com');
  const set = await admin.put(`/v1/staff/coupons/${cup.body.id}/customers`, { customerIds: [ana.id, other.id] });   // cliente da loja B é ignorado
  assert.equal(set.status, 200); assert.equal(set.body.count, 1);
  assert.equal((await admin.get(`/v1/staff/coupons/${cup.body.id}/customers`)).body.customers.length, 1);

  const anon = await validate(client(env), A, 'VIP20');
  assert.equal(anon.status, 422); assert.match(anon.body.error.message, /entre na sua conta/);
  assert.equal((await validate(bia.c, A, 'VIP20')).status, 422);                    // logada, mas não escolhida
  assert.equal((await validate(ana.c, A, 'VIP20')).body.discountCents, 998);
  assert.equal((await order(ana.c, A, 'VIP20', { phone: '16966660001' })).status, 201);

  const mine = await ana.c.get(`/v1/store/${A.slug}/customer/coupons`);
  assert.ok(mine.body.coupons.some((x: any) => x.code === 'VIP20'));
  assert.equal((await bia.c.get(`/v1/store/${A.slug}/customer/coupons`)).body.coupons.length, 0);
  assert.equal((await client(env).get(`/v1/store/${A.slug}/customer/coupons`)).status, 401);

  // a loja B não vê nem altera cupons da A
  assert.equal((await adminB.put(`/v1/staff/coupons/${cup.body.id}`, { code: 'VIP20', kind: 'percent', percent: 99 })).status, 404);
  assert.equal((await adminB.put(`/v1/staff/coupons/${cup.body.id}/customers`, { customerIds: [] })).status, 404);
  assert.ok(!(await adminB.get('/v1/staff/coupons')).body.coupons.some((x: any) => x.code === 'VIP20'));
});

test('apagar: só cupom nunca usado; com uso, desative', async () => {
  const novo = await mk(admin, { code: 'APAGAVEL' });
  assert.equal((await admin.del(`/v1/staff/coupons/${novo.body.id}`)).status, 200);
  const list = (await admin.get('/v1/staff/coupons')).body.coupons;
  const used = list.find((x: any) => x.code === 'BEMVINDO10');
  assert.ok(used.used_count >= 1); assert.ok(used.discount_total_cents >= 499);
  const del = await admin.del(`/v1/staff/coupons/${used.id}`);
  assert.equal(del.status, 409); assert.equal(del.body.error.code, 'coupon_used');
  assert.equal((await adminB.del(`/v1/staff/coupons/${used.id}`)).status, 404);
});
