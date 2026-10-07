import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { client, createAdmin, fullLogin, PASSWORD, seedStore, setup, staffLogin, stepUp, type Client, type Env, type Seeded } from './helpers.js';

let env: Env; let A: Seeded; let B: Seeded;
before(async () => { env = await setup(); A = await seedStore(env, 'loja-a'); B = await seedStore(env, 'loja-b'); });
after(() => env.close());

const as = async (seed: Seeded, role: string) => { const c = client(env); await staffLogin(env, c, seed, role); return c; };
const line = (s: Seeded, o: object = {}) => ({ productId: s.prod, qty: 1, ...o });
const checkout = (c: Client, s: Seeded, o: object = {}) => c.post(`/v1/store/${s.slug}/orders`, { type: 'retirada', customerName: 'Maria Silva', phone: '16999990000', paymentId: s.payPix, lines: [line(s)], ...o });

test('login da equipe: erros iguais, bloqueio por tentativas, cookie seguro e isolamento por loja', async () => {
  const c = client(env);
  const ok = await c.post('/v1/staff/login', { store: A.slug, email: A.users.balcao!.email, password: PASSWORD });
  assert.equal(ok.status, 200); assert.equal(ok.body.role, 'balcao');
  assert.match(String(ok.headers['set-cookie']), /HttpOnly/i); assert.match(String(ok.headers['set-cookie']), /SameSite=Strict/i);
  assert.equal((await c.get('/v1/staff/me')).body.name, 'Pessoa balcao');

  const wrong = await client(env).post('/v1/staff/login', { store: A.slug, email: A.users.garcom!.email, password: 'errada-errada' });
  const ghost = await client(env).post('/v1/staff/login', { store: A.slug, email: 'nao@existe.com', password: 'errada-errada' });
  const noStore = await client(env).post('/v1/staff/login', { store: 'loja-inexistente', email: A.users.garcom!.email, password: PASSWORD });
  assert.deepEqual([wrong.status, ghost.status, noStore.status], [401, 401, 401]);
  assert.deepEqual(wrong.body, ghost.body); assert.deepEqual(wrong.body, noStore.body);

  // credencial da loja A não entra na loja B
  assert.equal((await client(env).post('/v1/staff/login', { store: B.slug, email: A.users.garcom!.email, password: PASSWORD })).status, 401);

  // 5 erros bloqueiam, mesmo com a senha certa
  for (let i = 0; i < 5; i++) await client(env).post('/v1/staff/login', { store: A.slug, email: A.users.entregador!.email, password: 'x'.repeat(12) });
  assert.equal((await client(env).post('/v1/staff/login', { store: A.slug, email: A.users.entregador!.email, password: PASSWORD })).status, 423);
  env.clock.advance(16 * 60_000);
  assert.equal((await client(env).post('/v1/staff/login', { store: A.slug, email: A.users.entregador!.email, password: PASSWORD })).status, 200);
});

test('sessão: sem login 401, logout encerra, inatividade expira', async () => {
  assert.equal((await client(env).get('/v1/staff/orders')).status, 401);
  const c = await as(A, 'suporte');
  assert.equal((await c.get('/v1/staff/orders')).status, 200);
  await c.post('/v1/staff/logout');
  assert.equal((await c.get('/v1/staff/orders')).status, 401);
  const c2 = await as(A, 'suporte');
  env.clock.advance(2 * 3600_000 + 60_000);
  assert.equal((await c2.get('/v1/staff/orders')).status, 401);
});

test('gestão da equipe: só admin; PIN e senha nunca voltam; último admin protegido; desativar derruba a sessão', async () => {
  const admin = await as(A, 'admin');
  assert.equal((await (await as(A, 'gerente')).get('/v1/staff/users')).status, 403);
  const list = await admin.get('/v1/staff/users');
  assert.equal(list.status, 200); assert.ok(list.body.users.length >= 6);
  assert.equal(JSON.stringify(list.body).includes('hash'), false);
  assert.equal(JSON.stringify(list.body).includes(PASSWORD), false);

  const novo = await admin.post('/v1/staff/users', { name: 'Novo Caixa', email: 'Caixa2@Loja-A.test', role: 'balcao', password: 'outra-senha-bem-longa', pin: '1234' });
  assert.equal(novo.status, 201);
  assert.equal((await admin.post('/v1/staff/users', { name: 'Dup', email: 'caixa2@loja-a.test', role: 'balcao' })).status, 409);
  const [row] = await env.pools.platform.begin((q) => q`select email, pin_hash, password_hash from staff_users where id = ${novo.body.id}`);
  assert.equal(row!.email, 'caixa2@loja-a.test'); assert.match(row!.pin_hash, /^scrypt\$/); assert.notEqual(row!.password_hash, 'outra-senha-bem-longa');

  // gerente não cria admin; admin não remove o último admin
  assert.equal((await admin.put(`/v1/staff/users/${A.users.admin!.id}`, { role: 'gerente' })).body.error.code, 'last_admin');
  assert.equal((await admin.put(`/v1/staff/users/${A.users.admin!.id}`, { active: false })).body.error.code, 'last_admin');

  // desativar derruba a sessão aberta da pessoa
  const victim = await as(A, 'garcom');
  assert.equal((await victim.get('/v1/staff/me')).status, 200);
  assert.equal((await admin.put(`/v1/staff/users/${A.users.garcom!.id}`, { active: false })).status, 200);
  assert.equal((await victim.get('/v1/staff/me')).status, 401);
  await admin.put(`/v1/staff/users/${A.users.garcom!.id}`, { active: true });
});

test('admin da loja A não enxerga nem edita usuários da loja B', async () => {
  const admin = await as(A, 'admin');
  assert.equal((await admin.put(`/v1/staff/users/${B.users.garcom!.id}`, { name: 'Invasor' })).status, 404);
  const [r] = await env.pools.platform.begin((q) => q`select name from staff_users where id = ${B.users.garcom!.id}`);
  assert.equal(r!.name, 'Pessoa garcom');
});

test('cardápio público e loja: só em produção; rascunho não vaza', async () => {
  const dev = await seedStore(env, 'loja-rascunho', { status: 'desenvolvimento' });
  for (const status of ['desenvolvimento', 'suspensa', 'arquivada']) {
    const x = await seedStore(env, `loja-${status}`, { status });
    assert.equal((await client(env).get(`/v1/store/${x.slug}`)).status, 404, `${status}: dados da loja`);
    assert.equal((await client(env).get(`/v1/store/${x.slug}/menu`)).status, 404, `${status}: cardápio`);
    assert.equal((await client(env).get(`/v1/store/${x.slug}?preview=1`)).status, 404, `${status}: preview não abre rascunho`);
    assert.equal((await checkout(client(env), x)).status, 404, `${status}: pedido`);
  }
  assert.equal((await client(env).get(`/v1/store/${dev.slug}`)).status, 404);
  const pub = await client(env).get(`/v1/store/${A.slug}`);
  assert.equal(pub.status, 200); assert.equal(pub.body.open.open, true);
  const menu = await client(env).get(`/v1/store/${A.slug}/menu`);
  assert.equal(menu.body.products.length, 2); assert.equal(menu.body.zones[0].name, 'Centro'); assert.equal(menu.body.groups[0].addons.length, 2);
  assert.equal((await checkout(client(env), dev)).status, 404); // não pede em loja fora do ar
});

test('checkout: o servidor calcula o preço (adicionais, taxa) e ignora qualquer valor do cliente', async () => {
  const c = client(env);
  const r = await c.post(`/v1/store/${A.slug}/orders`, { type: 'delivery', customerName: 'João Souza', phone: '16988887777', address: 'Rua das Flores, 10', zoneId: A.zone, paymentId: A.payCash, changeFor: 150,
    lines: [{ productId: A.prod, qty: 2, note: 'sem cebola', addons: [{ groupId: A.group, addonIds: [A.addonA] }], unitPrice: 0.01, total: 0.01 }], totalCents: 1, total: 1 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.totalCents, (4990 + 800) * 2 + 600);
  assert.equal(r.body.number, 1001);
  const [o] = await env.pools.platform.begin((q) => q`select subtotal_cents, fee_cents, total_cents, address, change_for_cents, status, channel, paid from orders where number = ${r.body.number} and store_id = ${A.storeId}`);
  assert.deepEqual({ ...o }, { subtotal_cents: 11580, fee_cents: 600, total_cents: 12180, address: 'Rua das Flores, 10 — Centro', change_for_cents: 15000, status: 'novo', channel: 'loja', paid: false });
  const items = await env.pools.platform.begin((q) => q`select name, qty, unit_cents, total_cents, addons, print_zone_id from order_items where store_id = ${A.storeId} and note = 'sem cebola'`);
  assert.equal(items[0]!.unit_cents, 5790); assert.equal(items[0]!.addons[0].name, 'Catupiry'); assert.ok(items[0]!.print_zone_id); // zona de impressão gravada para a Fase de impressão
  assert.equal((await client(env).post(`/v1/store/${A.slug}/orders`, { type: 'retirada', customerName: 'Ana Paula', phone: '16977776666', paymentId: A.payPix, lines: [line(A)] })).body.number, 1002);
});

test('checkout: validações (item de outra loja, adicional inválido, zona, troco, mínimo, fechada)', async () => {
  const c = client(env);
  assert.equal((await checkout(c, A, { lines: [{ productId: B.prod, qty: 1 }] })).body.error.code, 'invalid_items');           // produto de OUTRA loja
  assert.equal((await checkout(c, A, { lines: [line(A, { addons: [{ groupId: A.group, addonIds: [A.addonA, A.addonB] }] })] })).body.error.code, 'invalid_items'); // máximo 1
  assert.equal((await checkout(c, A, { lines: [{ productId: A.prodB, qty: 1, addons: [{ groupId: A.group, addonIds: [A.addonA] }] }] })).body.error.code, 'invalid_items'); // grupo não é do produto
  assert.equal((await checkout(c, A, { paymentId: B.payPix })).body.error.code, 'invalid_payment');                              // pagamento de outra loja
  assert.equal((await checkout(c, A, { type: 'delivery', address: 'Rua X', zoneId: B.zone })).body.error.code, 'invalid_zone');    // zona de outra loja
  assert.equal((await checkout(c, A, { type: 'delivery', zoneId: A.zone })).body.error.code, 'address_required');
  assert.equal((await checkout(c, A, { paymentId: A.payCash, changeFor: 10 })).body.error.code, 'invalid_change');
  assert.equal((await checkout(c, A, { qty: 0, lines: [{ productId: A.prod, qty: 0 }] })).status, 400);
  assert.equal((await checkout(c, A, { phone: '1' })).status, 400);

  const M = await seedStore(env, 'loja-minimo', { minOrder: 100 });
  assert.equal((await checkout(c, M)).body.error.code, 'below_minimum');
  assert.equal((await checkout(c, M, { lines: [line(M, { qty: 3 })] })).status, 201);

  const F = await seedStore(env, 'loja-fechada');
  await env.pools.platform.begin((q) => q`update store_settings set data = data || '{"mode":"closed"}'::jsonb where store_id = ${F.storeId}`);
  assert.equal((await checkout(c, F)).body.error.code, 'closed');
  await env.pools.platform.begin((q) => q`update products set available = false where id = ${A.prodB}`);
  assert.equal((await checkout(c, A, { lines: [{ productId: A.prodB, qty: 1 }] })).body.error.code, 'invalid_items');
  await env.pools.platform.begin((q) => q`update products set available = true where id = ${A.prodB}`);
});

test('acompanhamento por token: mostra o andamento, nunca telefone ou endereço', async () => {
  const r = await checkout(client(env), A);
  const t = await client(env).get(`/v1/track/${r.body.trackingToken}`);
  assert.equal(t.status, 200); assert.equal(t.body.status, 'novo'); assert.equal(t.body.items[0].name, 'Calabresa');
  const txt = JSON.stringify(t.body);
  assert.equal(txt.includes('16999990000'), false); assert.equal(txt.includes('phone'), false); assert.equal(txt.includes('address'), false);
  assert.equal((await client(env).get(`/v1/track/${'0'.repeat(64)}`)).status, 404);
  assert.equal((await client(env).get('/v1/track/curto')).status, 400);
});

test('fluxo de entrega ponta a ponta com cada perfil: aceitar, preparar, entregador assume e conclui', async () => {
  const pedido = (await client(env).post(`/v1/store/${A.slug}/orders`, { type: 'delivery', customerName: 'Cliente Fluxo', phone: '16955554444', address: 'Av. Brasil, 1', zoneId: A.zone, paymentId: A.payPix, lines: [line(A)] })).body;
  const [{ id }] = await env.pools.platform.begin((q) => q`select id from orders where store_id = ${A.storeId} and number = ${pedido.number}`) as [{ id: string }];
  const balcao = await as(A, 'balcao'), ent = await as(A, 'entregador'), garcom = await as(A, 'garcom'), sup = await as(A, 'suporte');

  assert.equal((await ent.post(`/v1/staff/orders/${id}/status`, { to: 'preparo' })).status, 403);   // entregador não aceita
  assert.equal((await garcom.post(`/v1/staff/orders/${id}/status`, { to: 'preparo' })).status, 403); // garçom não mexe em entrega
  assert.equal((await balcao.post(`/v1/staff/orders/${id}/status`, { to: 'saiu' })).body.error.code, 'invalid_transition'); // não pula etapas
  assert.equal((await balcao.post(`/v1/staff/orders/${id}/status`, { to: 'preparo' })).status, 200);
  assert.equal((await balcao.post(`/v1/staff/orders/${id}/status`, { to: 'pronto' })).status, 200);

  // entregador só enxerga a entrega quando está pronta
  const lista = await ent.get('/v1/staff/orders?open=1');
  assert.ok(lista.body.orders.some((o: any) => o.id === id)); assert.ok(lista.body.orders.every((o: any) => o.type === 'delivery' && ['pronto', 'saiu'].includes(o.status)));
  assert.equal((await ent.post(`/v1/staff/orders/${id}/status`, { to: 'saiu' })).status, 200);
  const [o] = await env.pools.platform.begin((q) => q`select courier_id, dispatched_at from orders where id = ${id}`);
  assert.equal(o!.courier_id, A.users.entregador!.id); assert.ok(o!.dispatched_at);
  assert.equal((await ent.post(`/v1/staff/orders/${id}/status`, { to: 'cancelado', reason: 'x' })).status, 403); // entregador não cancela
  assert.equal((await ent.post(`/v1/staff/orders/${id}/status`, { to: 'entregue' })).status, 200);

  // cancelamento: balcão não pode, suporte exige motivo
  const p2 = (await checkout(client(env), A)).body;
  const [{ id: id2 }] = await env.pools.platform.begin((q) => q`select id from orders where store_id = ${A.storeId} and number = ${p2.number}`) as [{ id: string }];
  assert.equal((await balcao.post(`/v1/staff/orders/${id2}/status`, { to: 'cancelado', reason: 'cliente desistiu' })).status, 403);
  assert.equal((await sup.post(`/v1/staff/orders/${id2}/status`, { to: 'cancelado' })).body.error.code, 'reason_required');
  assert.equal((await sup.post(`/v1/staff/orders/${id2}/status`, { to: 'cancelado', reason: 'cliente desistiu' })).status, 200);
  assert.equal((await sup.post(`/v1/staff/orders/${id2}/status`, { to: 'preparo' })).status, 422); // terminal

  const ev = await sup.get(`/v1/staff/orders/${id}/events`);
  assert.deepEqual(ev.body.events.map((e: any) => e.event), ['created', 'status:preparo', 'status:pronto', 'status:saiu', 'status:entregue']);
  const au = await env.pools.platform.begin((q) => q`select action, meta from audit_logs where store_id = ${A.storeId} and action = 'order.cancelled'`);
  assert.equal(au.length, 1); assert.equal(au[0]!.meta.reason, 'cliente desistiu');
});

test('dois entregadores: a entrega é de quem assumiu primeiro', async () => {
  const p = (await checkout(client(env), A, { type: 'delivery', address: 'R. Dois, 2', zoneId: A.zone })).body;
  const [{ id }] = await env.pools.platform.begin((q) => q`select id from orders where store_id = ${A.storeId} and number = ${p.number}`) as [{ id: string }];
  const bal = await as(A, 'balcao'); await bal.post(`/v1/staff/orders/${id}/status`, { to: 'preparo' }); await bal.post(`/v1/staff/orders/${id}/status`, { to: 'pronto' });
  const [{ id: e2 }] = await env.pools.platform.begin((q) => q`insert into staff_users (tenant_id, store_id, email, name, role) values (${A.tenantId}, ${A.storeId}, 'ent2@loja-a.test', 'Entregador 2', 'entregador') returning id`) as [{ id: string }];
  await env.pools.platform.begin((q) => q`update orders set courier_id = ${e2} , status = 'saiu' where id = ${id}`);
  const ent = await as(A, 'entregador');
  assert.equal((await ent.post(`/v1/staff/orders/${id}/status`, { to: 'entregue' })).body.error.code, 'taken'); // não conclui entrega de outro entregador
  const [still] = await env.pools.platform.begin((q) => q`select status from orders where id = ${id}`);
  assert.equal(still!.status, 'saiu');
  // nem assume uma já assumida
  const p3 = (await checkout(client(env), A, { type: 'delivery', address: 'R. Três, 3', zoneId: A.zone })).body;
  const [{ id: id3 }] = await env.pools.platform.begin((q) => q`select id from orders where store_id = ${A.storeId} and number = ${p3.number}`) as [{ id: string }];
  await bal.post(`/v1/staff/orders/${id3}/status`, { to: 'preparo' }); await bal.post(`/v1/staff/orders/${id3}/status`, { to: 'pronto' });
  await env.pools.platform.begin((q) => q`update orders set courier_id = ${e2} where id = ${id3}`);
  assert.equal((await ent.post(`/v1/staff/orders/${id3}/status`, { to: 'saiu' })).body.error.code, 'taken');
});

test('mesa e PDV: comanda única por mesa, itens adicionais voltam à cozinha, receber encerra a conta', async () => {
  const garcom = await as(A, 'garcom'), balcao = await as(A, 'balcao');
  assert.equal((await garcom.post('/v1/staff/orders', { type: 'retirada', lines: [line(A)] })).status, 403); // garçom só mesa
  const abre = await garcom.post('/v1/staff/orders', { type: 'mesa', table: 7, lines: [line(A)] });
  assert.equal(abre.status, 201, JSON.stringify(abre.body)); assert.equal(abre.body.totalCents, 4990);
  assert.equal((await garcom.post('/v1/staff/orders', { type: 'mesa', table: 7, lines: [line(A)] })).body.error.code, 'table_busy');

  const id = abre.body.id as string;
  await balcao.post(`/v1/staff/orders/${id}/status`, { to: 'preparo' }); await balcao.post(`/v1/staff/orders/${id}/status`, { to: 'pronto' });
  const add = await garcom.post(`/v1/staff/orders/${id}/items`, { lines: [{ productId: A.prodB, qty: 2 }] });
  assert.equal(add.status, 200); assert.equal(add.body.totalCents, 4990 + 9000);
  const [o] = await env.pools.platform.begin((q) => q`select status, ready_at, subtotal_cents from orders where id = ${id}`);
  assert.equal(o!.status, 'preparo'); assert.equal(o!.ready_at, null); // voltou para a cozinha

  assert.equal((await garcom.post(`/v1/staff/orders/${id}/pay`, { paymentId: A.payPix })).status, 403);   // garçom não recebe
  const pay = await balcao.post(`/v1/staff/orders/${id}/pay`, { paymentId: A.payPix });
  assert.equal(pay.status, 200); assert.equal(pay.body.totalCents, 13990);
  assert.equal((await balcao.post(`/v1/staff/orders/${id}/pay`, { paymentId: A.payPix })).body.error.code, 'already_paid');
  const [c] = await env.pools.platform.begin((q) => q`select status, paid, paid_method from orders where id = ${id}`);
  assert.deepEqual({ ...c }, { status: 'entregue', paid: true, paid_method: 'Pix' });
  assert.equal((await garcom.post(`/v1/staff/orders/${id}/items`, { lines: [line(A)] })).body.error.code, 'closed');
  assert.equal((await garcom.post('/v1/staff/orders', { type: 'mesa', table: 7, lines: [line(A)] })).status, 201); // mesa liberada

  // PDV: balcão recebendo na hora entra direto em preparo, já pago
  const venda = await balcao.post('/v1/staff/orders', { type: 'retirada', paymentId: A.payCash, receiveNow: true, lines: [line(A, { qty: 2 })] });
  assert.equal(venda.status, 201);
  const [v] = await env.pools.platform.begin((q) => q`select status, paid, channel, customer_name from orders where id = ${venda.body.id}`);
  assert.deepEqual({ ...v }, { status: 'preparo', paid: true, channel: 'pdv', customer_name: 'Balcão' });
  assert.equal((await balcao.post('/v1/staff/orders', { type: 'retirada', receiveNow: true, lines: [line(A)] })).body.error.code, 'invalid_payment');
});

test('isolamento: a equipe da loja A não vê, altera nem recebe pedidos da loja B', async () => {
  const pb = (await checkout(client(env), B)).body;
  const [{ id: idB }] = await env.pools.platform.begin((q) => q`select id from orders where store_id = ${B.storeId} and number = ${pb.number}`) as [{ id: string }];
  const adminA = await as(A, 'admin');
  assert.equal((await adminA.get('/v1/staff/orders?limit=200')).body.orders.some((o: any) => o.id === idB), false);
  assert.equal((await adminA.post(`/v1/staff/orders/${idB}/status`, { to: 'preparo' })).status, 404);
  assert.equal((await adminA.post(`/v1/staff/orders/${idB}/pay`, { paymentId: A.payPix })).status, 404);
  assert.equal((await adminA.post(`/v1/staff/orders/${idB}/items`, { lines: [line(A)] })).status, 404);
  assert.equal((await adminA.get(`/v1/staff/orders/${idB}/events`)).body.events.length, 0);
  const [r] = await env.pools.platform.begin((q) => q`select status, paid from orders where id = ${idB}`);
  assert.deepEqual({ ...r }, { status: 'novo', paid: false });
});

test('banco: o role da API não vê pedidos de outra conta nem sem tenant definido', async () => {
  const none = await env.pools.app.begin((q) => q`select count(*)::int as n from orders`);
  assert.equal(none[0]!.n, 0);
  const seen = await env.pools.app.begin(async (q) => { await q`select set_config('app.tenant_id', ${A.tenantId}, true)`; return q`select distinct tenant_id from orders`; });
  assert.deepEqual(seen.map((r) => r.tenant_id), [A.tenantId]);
  await assert.rejects(env.pools.app.begin(async (q) => { await q`select set_config('app.tenant_id', ${A.tenantId}, true)`; return q`update order_items set qty = 99`; })); // itens são imutáveis para a API
  await assert.rejects(env.pools.mcp.begin((q) => q`select * from orders`));       // MCP não lê pedidos (dados de clientes)
  await assert.rejects(env.pools.mcp.begin((q) => q`select * from staff_users`));
});

test('super admin cria o 1º administrador da loja (com autenticador reconfirmado) e redefine a senha do dono', async () => {
  const E = 'padmin@teste.com';
  await createAdmin(env, E);
  const sa = client(env); await fullLogin(env, sa, E);
  const [t] = await env.pools.platform.begin((q) => q`insert into tenants (name) values ('Conta Nova') returning id`);
  const [st] = await env.pools.platform.begin((q) => q`insert into stores (tenant_id, slug, name, status) values (${t!.id}, 'loja-nova', 'Loja Nova', 'producao') returning id`);
  const body = { name: 'Dona da Loja', email: 'Dona@Loja-Nova.test', password: 'senha-inicial-segura' };
  assert.equal((await sa.post(`/v1/platform/stores/${st!.id}/admin-user`, body)).body.error.code, 'stepup_required');
  await stepUp(env, sa, E);
  assert.equal((await sa.post(`/v1/platform/stores/${st!.id}/admin-user`, { ...body, password: 'curta' })).status, 400);
  const novo = await sa.post(`/v1/platform/stores/${st!.id}/admin-user`, body);
  assert.equal(novo.status, 201);

  const dona = client(env);
  const l = await dona.post('/v1/staff/login', { store: 'loja-nova', email: 'dona@loja-nova.test', password: 'senha-inicial-segura' });
  assert.equal(l.status, 200); assert.equal(l.body.role, 'admin');
  assert.equal((await dona.get('/v1/staff/users')).status, 200);       // já consegue montar a própria equipe

  // redefinir a senha: devolve 200, derruba a sessão aberta e a senha antiga deixa de valer
  env.clock.advance(6 * 60_000); await stepUp(env, sa, E);
  const reset = await sa.post(`/v1/platform/stores/${st!.id}/admin-user`, { ...body, password: 'senha-nova-bem-segura' });
  assert.equal(reset.status, 200); assert.equal(reset.body.id, novo.body.id);
  assert.equal((await dona.get('/v1/staff/me')).status, 401);
  assert.equal((await client(env).post('/v1/staff/login', { store: 'loja-nova', email: 'dona@loja-nova.test', password: 'senha-inicial-segura' })).status, 401);
  assert.equal((await client(env).post('/v1/staff/login', { store: 'loja-nova', email: 'dona@loja-nova.test', password: 'senha-nova-bem-segura' })).status, 200);
  const acts = (await env.pools.platform.begin((q) => q`select action from audit_logs where store_id = ${st!.id} order by id`)).map((a) => a.action);
  assert.deepEqual(acts.filter((a) => a.startsWith('staff.admin')), ['staff.admin_created', 'staff.admin_reset']);
  await env.pools.platform.begin((q) => q`update stores set status = 'arquivada' where id = ${st!.id}`);
  env.clock.advance(6 * 60_000); await stepUp(env, sa, E);
  assert.equal((await sa.post(`/v1/platform/stores/${st!.id}/admin-user`, body)).status, 404);          // arquivada
});

test('pré-visualização: loja em desenvolvimento só abre para a equipe da própria loja e não aceita pedido', async () => {
  const D = await seedStore(env, 'loja-previa', { status: 'desenvolvimento' });
  const anon = client(env);
  assert.equal((await anon.get(`/v1/store/${D.slug}`)).status, 404);
  assert.equal((await anon.get(`/v1/store/${D.slug}/menu`)).status, 404);

  const dono = await as(D, 'admin');
  const info = await dono.get(`/v1/store/${D.slug}`);
  assert.equal(info.status, 200); assert.equal(info.body.status, 'desenvolvimento');
  assert.ok((await dono.get(`/v1/store/${D.slug}/menu`)).body.products.length > 0);
  const me = await dono.get('/v1/staff/me');
  assert.deepEqual(me.body.store, { slug: D.slug, name: `Loja ${D.slug}`, status: 'desenvolvimento' });

  // pedido real continua bloqueado fora de produção, mesmo para a equipe
  assert.equal((await checkout(dono, D)).status, 404);
  // equipe de OUTRA loja não enxerga o rascunho
  const outra = await as(A, 'admin');
  assert.equal((await outra.get(`/v1/store/${D.slug}`)).status, 404);
  // suspensa/arquivada seguem invisíveis
  await env.pools.platform.begin((q) => q`update stores set status = 'suspensa' where id = ${D.storeId}`);
  assert.equal((await dono.get(`/v1/store/${D.slug}`)).status, 404);
});
