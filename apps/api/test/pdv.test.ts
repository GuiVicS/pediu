import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { client, seedStore, setup, staffLogin, type Client, type Env, type Seeded } from './helpers.js';

let env: Env; let A: Seeded; let B: Seeded; let credit: string; let debit: string; let boleto: string;
before(async () => {
  env = await setup(); A = await seedStore(env, 'loja-a'); B = await seedStore(env, 'loja-b');
  await env.pools.platform.begin(async (q) => {
    const pm = async (name: string, type: string) => (await q`insert into payment_methods (store_id, tenant_id, name, type) values (${A.storeId}, ${A.tenantId}, ${name}, ${type}) returning id`)[0]!.id as string;
    credit = await pm('Crédito (maquininha)', 'credit'); debit = await pm('Débito (maquininha)', 'debit');
    boleto = (await q`insert into payment_methods (store_id, tenant_id, name, type, active) values (${A.storeId}, ${A.tenantId}, 'Vale desligado', 'voucher', false) returning id`)[0]!.id as string;
    await q`insert into coupons (store_id, tenant_id, code, kind, percent, min_order_cents) values (${A.storeId}, ${A.tenantId}, 'PDV10', 'percent', 10, 0)`;
  });
});
after(() => env.close());

const op = async (role = 'balcao') => { const c = client(env); await staffLogin(env, c, A, role); return c; };
const sale = (c: Client, o: object = {}) => c.post('/v1/staff/orders', { type: 'retirada', lines: [{ productId: A.prod, qty: 1 }], ...o });   // Calabresa R$ 49,90
const orderOf = async (c: Client, id: string) => (await c.get('/v1/staff/orders?limit=50')).body.orders.find((x: { id: string }) => x.id === id);

test('turno de caixa: abrir com cédulas e moedas, um por operador, e só quem tem permissão de PDV', async () => {
  const c = await op();
  const none = await c.get('/v1/staff/cash/current');
  assert.deepEqual([none.status, none.body.session], [200, null]);
  // o detalhamento precisa bater com o valor de abertura
  assert.equal((await c.post('/v1/staff/cash/open', { openingCents: 30000, breakdown: { '100': 1, '50': 1 } })).status, 400);
  assert.equal((await c.post('/v1/staff/cash/open', { openingCents: -1 })).status, 400);
  const open = await c.post('/v1/staff/cash/open', { openingCents: 30000, breakdown: { '100': 1, '50': 2, '20': 5 } });
  assert.equal(open.status, 201); assert.equal(open.body.session.openingCents, 30000); assert.equal(open.body.session.openedBy, 'Pessoa balcao');
  assert.equal((await c.post('/v1/staff/cash/open', { openingCents: 100 })).status, 409);              // já tem um aberto
  const cur = await c.get('/v1/staff/cash/current');
  assert.deepEqual([cur.body.session.id, cur.body.summary.cash.expectedCents, cur.body.summary.totals.orders], [open.body.session.id, 30000, 0]);

  // outro operador abre o dele; garçom e entregador não mexem em caixa; outra loja não enxerga
  const g = await op('gerente'); assert.equal((await g.post('/v1/staff/cash/open', { openingCents: 5000 })).status, 201);
  assert.equal((await (await op('garcom')).get('/v1/staff/cash/current')).status, 403);
  assert.equal((await (await op('entregador')).post('/v1/staff/cash/open', { openingCents: 1 })).status, 403);
  assert.equal((await client(env).get('/v1/staff/cash/current')).status, 401);
  const b = client(env); await staffLogin(env, b, B, 'balcao');
  assert.equal((await b.get('/v1/staff/cash/current')).body.session, null);
});

test('pagamento externo: dinheiro com troco calculado no servidor, maquininha com referência e forma inativa recusada', async () => {
  const c = await op();
  // dinheiro: recebido menor que o total é recusado; maior devolve o troco
  assert.equal((await sale(c, { receiveNow: true, paymentId: A.payCash, receivedCents: 1000 })).status, 422);
  const cash = await sale(c, { receiveNow: true, paymentId: A.payCash, receivedCents: 10000 });
  assert.equal(cash.status, 201); assert.equal(cash.body.totalCents, 4990); assert.equal(cash.body.changeCents, 5010);
  const o1 = await orderOf(c, cash.body.id);
  assert.deepEqual([o1.paid, o1.paid_type, o1.payment_mode, o1.cash_received_cents, o1.change_cents, o1.payment_ref], [true, 'cash', 'externo', 10000, 5010, null]);
  // sem valor informado = recebeu o valor exato
  const exact = await sale(c, { receiveNow: true, paymentId: A.payCash });
  assert.deepEqual([exact.body.changeCents, (await orderOf(c, exact.body.id)).cash_received_cents], [0, 4990]);

  // maquininha (cartão externo, ainda sem integração): crédito e débito com NSU opcional, sem troco
  const cc = await sale(c, { receiveNow: true, paymentId: credit, reference: 'NSU 123456', receivedCents: 99999 });
  const o2 = await orderOf(c, cc.body.id);
  assert.deepEqual([o2.paid_type, o2.payment_mode, o2.payment_ref, o2.cash_received_cents, o2.change_cents], ['credit', 'externo', 'NSU 123456', null, null]);
  const dd = await sale(c, { receiveNow: true, paymentId: debit });
  assert.deepEqual([(await orderOf(c, dd.body.id)).paid_type, (await orderOf(c, dd.body.id)).payment_ref], ['debit', null]);
  assert.equal((await sale(c, { receiveNow: true, paymentId: boleto })).status, 422);            // forma desligada
  assert.equal((await sale(c, { receiveNow: true })).status, 422);                                  // receber agora exige a forma
  assert.equal((await sale(c, { receiveNow: true, paymentId: B.payCash })).status, 422);          // forma de outra loja

  // pagar depois: lança como "a receber" e recebe pelo caixa, com troco e referência
  const later = await sale(c, { paymentId: A.payCash });
  assert.equal((await orderOf(c, later.body.id)).paid, false);
  assert.equal((await c.post(`/v1/staff/orders/${later.body.id}/pay`, { paymentId: A.payCash, receivedCents: 100 })).status, 422);
  const paid = await c.post(`/v1/staff/orders/${later.body.id}/pay`, { paymentId: A.payCash, receivedCents: 5000 });
  assert.deepEqual([paid.status, paid.body.changeCents], [200, 10]);
  assert.equal((await c.post(`/v1/staff/orders/${later.body.id}/pay`, { paymentId: A.payCash })).status, 409);
  const l2 = await sale(c); await c.post(`/v1/staff/orders/${l2.body.id}/pay`, { paymentId: credit, reference: 'AUT 9' });
  assert.deepEqual([(await orderOf(c, l2.body.id)).paid_type, (await orderOf(c, l2.body.id)).payment_ref], ['credit', 'AUT 9']);
});

test('cupom e cliente no PDV: prévia do desconto, valor com desconto cobrado e vínculo com a conta', async () => {
  const c = await op();
  const chk = await c.post('/v1/staff/coupons/check', { code: 'pdv10', subtotalCents: 4990 });
  assert.deepEqual([chk.status, chk.body.discountCents, chk.body.code], [200, 499, 'PDV10']);
  assert.equal((await c.post('/v1/staff/coupons/check', { code: 'NAOEXISTE', subtotalCents: 4990 })).status, 422);

  await env.pools.platform.begin((q) => q`insert into store_customers (id, store_id, tenant_id, email, name) values ('50000000-0000-0000-0000-0000000000a9', ${A.storeId}, ${A.tenantId}, 'cli@a.test', 'Cliente A'), ('50000000-0000-0000-0000-0000000000b9', ${B.storeId}, ${B.tenantId}, 'cli@b.test', 'Cliente B')`);
  const withDisc = await sale(c, { receiveNow: true, paymentId: A.payCash, receivedCents: 5000, couponCode: 'PDV10', customerId: '50000000-0000-0000-0000-0000000000a9' });
  assert.equal(withDisc.status, 201); assert.equal(withDisc.body.totalCents, 4491); assert.equal(withDisc.body.changeCents, 509);   // troco sobre o valor COM desconto
  const o = await orderOf(c, withDisc.body.id);
  assert.deepEqual([o.discount_cents, o.total_cents], [499, 4491]);
  const [row] = await env.pools.platform.begin((q) => q`select customer_id, coupon_code from orders where id = ${withDisc.body.id}`);
  assert.deepEqual([row!.customer_id, row!.coupon_code], ['50000000-0000-0000-0000-0000000000a9', 'PDV10']);
  assert.equal((await sale(c, { couponCode: 'NAOEXISTE' })).status, 422);
  assert.equal((await sale(c, { customerId: '50000000-0000-0000-0000-0000000000b9' })).status, 422);   // cliente de outra loja
});

test('fechamento: resumo por forma de pagamento, cancelamento fora das vendas, dinheiro esperado e diferença', async () => {
  const c = await op();
  const cur = await c.get('/v1/staff/cash/current');
  const s = cur.body.summary;
  const by = Object.fromEntries(s.byMethod.map((m: { type: string; orders: number; cents: number }) => [m.type, m]));
  // dinheiro: 4990 + 4990 + 4990 (pagar depois) + 4491 (com cupom) ; crédito: 4990 + 4990 (pagar depois) ; débito: 4990
  assert.deepEqual([by.cash.orders, by.cash.cents], [4, 4990 * 3 + 4491]);
  assert.deepEqual([by.credit.orders, by.credit.cents, by.debit.orders], [2, 9980, 1]);
  assert.equal(s.totals.orders, 7); assert.equal(s.totals.revenueCents, 4990 * 3 + 4491 + 9980 + 4990);
  assert.equal(s.totals.avgTicketCents, Math.round(s.totals.revenueCents / 7)); assert.equal(s.totals.customers >= 1, true);
  assert.deepEqual(s.cash, { openingCents: 30000, salesCents: 4990 * 3 + 4491, expectedCents: 30000 + 4990 * 3 + 4491 });

  // um pedido pago e cancelado sai das vendas e aparece como cancelamento
  const x = await sale(c, { receiveNow: true, paymentId: debit });
  const admin = await op('admin');
  assert.equal((await admin.post(`/v1/staff/orders/${x.body.id}/status`, { to: 'cancelado', reason: 'cliente desistiu' })).status, 200);
  const after = (await c.get('/v1/staff/cash/current')).body.summary;
  assert.deepEqual([after.totals.orders, after.cancelled.orders, after.cancelled.cents], [7, 1, 4990]);

  // fecha contando R$ 10 a menos: a diferença fica registrada e o caixa some do "atual"
  const expected = after.cash.expectedCents;
  assert.equal((await c.post('/v1/staff/cash/close', { note: 'sem valor' })).status, 400);        // contagem obrigatória
  const closed = await c.post('/v1/staff/cash/close', { countedCents: expected - 1000, note: 'faltou troco' });
  assert.equal(closed.status, 200);
  assert.deepEqual([closed.body.session.expectedCents, closed.body.session.countedCents, closed.body.session.differenceCents, closed.body.session.note], [expected, expected - 1000, -1000, 'faltou troco']);
  assert.equal(closed.body.summary.totals.orders, 7);
  assert.equal((await c.get('/v1/staff/cash/current')).body.session, null);
  assert.equal((await c.post('/v1/staff/cash/close', { countedCents: 1 })).status, 404);
  const [frozen] = await env.pools.platform.begin((q) => q`select summary->'cash'->>'expectedCents' as e from cash_sessions where id = ${closed.body.session.id}`);
  assert.equal(frozen!.e, String(expected));                                                       // o resumo fica congelado no turno
  // depois de fechar, dá para abrir outro turno
  assert.equal((await c.post('/v1/staff/cash/open', { openingCents: 0 })).status, 201);
});

test('impressões do pedido por setor (tela de pedido finalizado) e isolamento entre lojas', async () => {
  const c = await op();
  const r = await sale(c, { receiveNow: true, paymentId: A.payCash });
  const jobs = await c.get(`/v1/staff/print/orders/${r.body.id}/jobs`);
  assert.equal(jobs.status, 200); assert.ok(Array.isArray(jobs.body.jobs));
  for (const j of jobs.body.jobs) assert.deepEqual(Object.keys(j).sort(), ['created_at', 'id', 'kind', 'last_error', 'printed_at', 'status', 'zone']);
  assert.equal((await (await op('entregador')).get(`/v1/staff/print/orders/${r.body.id}/jobs`)).status, 403);
  const b = client(env); await staffLogin(env, b, B, 'balcao');
  assert.deepEqual((await b.get(`/v1/staff/print/orders/${r.body.id}/jobs`)).body.jobs, []);        // outra loja não vê
});
