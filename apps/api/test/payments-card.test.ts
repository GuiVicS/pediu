import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { MercadoPagoApi, MpPayment } from '../src/gateways.js';
import { client, seedStore, setup, staffLogin, type Client, type Env, type Seeded } from './helpers.js';

/** Mercado Pago falso: registra as cobranças e responde com o que o teste mandar. */
const calls: { amountCents: number; idempotencyKey: string; reference: string; token: string }[] = [];
let nextCard: Partial<MpPayment> = { status: 'approved' };
const payments = new Map<string, MpPayment>();
const fakeMp = (): MercadoPagoApi => ({
  async whoami() { return { id: '123', nickname: 'LOJA_TESTE' }; },
  async createPix() { throw new Error('não usado'); },
  async createCardPayment(p) {
    calls.push({ amountCents: p.amountCents, idempotencyKey: p.idempotencyKey, reference: p.reference, token: p.card.token });
    const r: MpPayment = { id: String(9000 + calls.length), status: 'approved', amountCents: p.amountCents, externalReference: p.reference, ...nextCard } as MpPayment;
    payments.set(r.id, r); return r;
  },
  async getPayment(id) { return payments.get(id)!; },
  async refund() { /* não usado */ },
});

let env: Env; let seed: Seeded; let adm: Client;
const TOKEN = 'TEST-1234567890123456-123456-abcdefabcdefabcdefabcdefabcdef-123456789';
const PUBLIC = 'TEST-abcdef12-3456-7890-abcd-ef1234567890';
before(async () => {
  env = await setup();
  env.ctx.gateways = { mercadoPago: fakeMp, sicoob: () => { throw new Error('não usado'); } };
  seed = await seedStore(env, 'cartao-loja');
  adm = client(env); await staffLogin(env, adm, seed, 'admin');
});
after(() => env.close());

const card = (over: object = {}) => ({ token: 'tok_cartao_teste', paymentMethodId: 'visa', issuerId: '25', installments: 1, payer: { email: 'cliente@exemplo.com', identification: { type: 'CPF', number: '12345678909' } }, ...over });
const order = (paymentId: string) => client(env).post(`/v1/store/${seed.slug}/orders`, {
  type: 'retirada', customerName: 'Cliente Teste', phone: '16999990000', paymentId, lines: [{ productId: seed.prod, qty: 2, addons: [] }],
});
const orderRow = (token: string) => env.pools.platform.begin(async (q) => (await q`select o.status, o.paid, p.status as pay_status, p.attempts, p.external_id from orders o join order_payments p on p.order_id = o.id where o.tracking_token = ${token}`)[0]!);

test('hub: Mercado Pago instala ao conectar; cartão exige a public key do mesmo ambiente', async () => {
  const misto = await adm.put('/v1/staff/gateways/mercadopago', { accessToken: TOKEN, publicKey: PUBLIC.replace('TEST-', 'APP_USR-') });
  assert.equal(misto.status, 400);
  assert.equal((await adm.put('/v1/staff/gateways/mercadopago', { accessToken: TOKEN })).status, 200);
  let mp = (await adm.get('/v1/staff/apps')).body.apps.find((a: any) => a.id === 'mercadopago');
  assert.equal(mp.installed, true); assert.equal(mp.cardReady, false);
  assert.equal((await adm.put('/v1/staff/apps/mercadopago/methods', { card: true })).status, 409);   // sem public key
  assert.equal((await adm.put('/v1/staff/gateways/mercadopago', { accessToken: TOKEN, publicKey: PUBLIC })).status, 200);
  mp = (await adm.get('/v1/staff/apps')).body.apps.find((a: any) => a.id === 'mercadopago');
  assert.equal(mp.cardReady, true); assert.equal(mp.account.publicKey, PUBLIC);
  assert.equal(JSON.stringify(mp).includes(TOKEN), false);   // o access token nunca volta
  assert.equal((await adm.put('/v1/staff/apps/mercadopago/methods', { card: true, pix: true })).status, 200);
  mp = (await adm.get('/v1/staff/apps')).body.apps.find((a: any) => a.id === 'mercadopago');
  assert.deepEqual(mp.methods, { pix: true, card: true });
  // ligar de novo não duplica a forma de pagamento
  await adm.put('/v1/staff/apps/mercadopago/methods', { card: true });
  const [n] = await env.pools.platform.begin((q) => q`select count(*)::int as n from payment_methods where store_id = ${seed.storeId} and online and type = 'credit'`);
  assert.equal(n!.n, 1);
});

test('checkout transparente: recusa permite tentar de novo; aprovação libera o pedido; valor sempre do servidor', async () => {
  const [m] = await env.pools.platform.begin((q) => q`select id from payment_methods where store_id = ${seed.storeId} and online and type = 'credit'`);
  const r = await order(m!.id);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.payment.method, 'card'); assert.equal(r.body.payment.publicKey, PUBLIC); assert.equal(r.body.payment.amountCents, r.body.totalCents);
  assert.equal(r.body.payment.checkoutUrl, undefined);   // nada de redirecionar para fora da loja
  const tk = r.body.trackingToken as string;
  assert.equal((await orderRow(tk)).status, 'aguardando');
  calls.length = 0;

  nextCard = { status: 'rejected', statusDetail: 'cc_rejected_insufficient_amount' };
  const recusa = await client(env).post(`/v1/track/${tk}/card`, card());
  assert.equal(recusa.status, 200); assert.equal(recusa.body.status, 'recusado'); assert.match(recusa.body.message, /limite/);
  let row = await orderRow(tk);
  assert.equal(row.status, 'aguardando'); assert.equal(row.pay_status, 'pendente'); assert.equal(row.external_id, null);

  // webhook da tentativa recusada não cancela o pedido (o cliente está tentando outro cartão)
  const wh = await env.app.inject({ method: 'POST', url: `/v1/webhooks/mercadopago?store=${seed.storeId}`, payload: { type: 'payment', data: { id: '9001' } } });
  assert.equal(wh.statusCode, 200);
  assert.equal((await orderRow(tk)).status, 'aguardando');

  nextCard = { status: 'approved' };
  const ok = await client(env).post(`/v1/track/${tk}/card`, card({ token: 'tok_outro_cartao', amountCents: 1 }));
  assert.equal(ok.body.status, 'aprovado');
  row = await orderRow(tk);
  assert.equal(row.status, 'novo'); assert.equal(row.paid, true); assert.equal(row.pay_status, 'aprovado'); assert.equal(row.attempts, 2);
  assert.deepEqual(calls.map((c) => c.amountCents), [r.body.totalCents, r.body.totalCents]);   // o navegador não escolhe o valor
  assert.notEqual(calls[0]!.idempotencyKey, calls[1]!.idempotencyKey);                       // cada tentativa tem sua chave

  // pagamento encerrado: não cobra de novo
  assert.equal((await client(env).post(`/v1/track/${tk}/card`, card())).status, 409);
  assert.equal(calls.length, 2);
  assert.equal((await client(env).post(`/v1/track/${'0'.repeat(64)}/card`, card())).status, 404);
});

test('cartão em análise fica aguardando e o webhook confirma depois', async () => {
  const [m] = await env.pools.platform.begin((q) => q`select id from payment_methods where store_id = ${seed.storeId} and online and type = 'credit'`);
  const r = await order(m!.id); const tk = r.body.trackingToken as string;
  nextCard = { status: 'in_process', statusDetail: 'pending_review_manual' };
  const a = await client(env).post(`/v1/track/${tk}/card`, card());
  assert.equal(a.body.status, 'em_analise');
  const row = await orderRow(tk); assert.equal(row.status, 'aguardando'); assert.ok(row.external_id);
  payments.set(row.external_id, { ...payments.get(row.external_id)!, status: 'approved' });
  await env.app.inject({ method: 'POST', url: `/v1/webhooks/mercadopago?store=${seed.storeId}`, payload: { type: 'payment', data: { id: row.external_id } } });
  assert.equal((await orderRow(tk)).status, 'novo');
  nextCard = { status: 'approved' };
});

test('hub: iFood e WhatsApp instalam e desinstalam; desinstalar o Mercado Pago apaga as credenciais e desliga o online', async () => {
  assert.equal((await adm.post('/v1/staff/apps/mercadopago/install')).status, 422);   // pagamento instala conectando a conta
  assert.equal((await adm.post('/v1/staff/apps/ifood/install')).status, 200);
  const garcom = client(env); await staffLogin(env, garcom, seed, 'garcom');
  assert.equal((await garcom.get('/v1/staff/apps')).body.apps.find((a: any) => a.id === 'ifood').installed, true);   // a equipe vê o que está instalado
  assert.equal((await garcom.post('/v1/staff/apps/whatsapp/install')).status, 403);                                     // mas só o admin instala
  assert.equal((await adm.del('/v1/staff/apps/ifood')).status, 200);
  assert.equal((await adm.get('/v1/staff/apps')).body.apps.find((a: any) => a.id === 'ifood').installed, false);

  assert.equal((await adm.del('/v1/staff/apps/mercadopago')).status, 200);
  const [g] = await env.pools.platform.begin((q) => q`select count(*)::int as n from store_gateways where store_id = ${seed.storeId}`);
  assert.equal(g!.n, 0);
  const [on] = await env.pools.platform.begin((q) => q`select count(*)::int as n from payment_methods where store_id = ${seed.storeId} and (online or (gateway is not null))`);
  assert.equal(on!.n, 0);
  assert.equal((await adm.get('/v1/staff/apps')).body.apps.find((a: any) => a.id === 'mercadopago').installed, false);
});
