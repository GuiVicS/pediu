import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { normPhone } from '../src/storeMcp.js';
import { client, seedStore, setup, staffLogin, type Client, type Env, type Seeded } from './helpers.js';

let env: Env; let A: Seeded; let B: Seeded; let admin: Client; let adminB: Client; let TOKEN = ''; let TOKEN_ID = '';
before(async () => {
  env = await setup(); A = await seedStore(env, 'mcp-a'); B = await seedStore(env, 'mcp-b');
  admin = client(env); await staffLogin(env, admin, A, 'admin'); adminB = client(env); await staffLogin(env, adminB, B, 'admin');
});
after(() => env.close());

const rpc = async (body: unknown, token = TOKEN) => {
  const r = await env.app.inject({ method: 'POST', url: '/v1/store-mcp', payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, headers: r.headers };
};
const call = async (name: string, args: object = {}, id = 1) => { const r = await rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }); return { ...r, text: r.body?.result?.content?.[0]?.text as string, isError: !!r.body?.result?.isError }; };
const data = (r: { text: string }) => JSON.parse(r.text);
/** Pedido criado pela API do painel (não pelo MCP): serve de alvo para mudar status/cancelar. */
const newOrder = async (c: Client, s: Seeded, type: 'retirada' | 'delivery' = 'retirada') => (await c.post('/v1/staff/orders', { type, customerName: 'Maria', phone: '16999990000', address: type === 'delivery' ? 'Rua A, 1' : '', zoneId: type === 'delivery' ? s.zone : undefined, lines: [{ productId: s.prod, qty: 2, addons: [] }] })).body as { id: string; number: number };
/** Lê um pedido pelo painel (o MCP não lê pedidos). */
const orderOf = async (c: Client, number: number) => (await c.get('/v1/staff/orders?limit=100')).body.orders.find((x: any) => x.number === number);
const cliente = { cliente: 'João da Silva', telefone: '(16) 99999-0000' };

test('painel: o lojista gera o token (aparece uma vez), lista sem segredos, só quem gerencia a loja, limite de 5, revogação', async () => {
  const balcao = client(env); await staffLogin(env, balcao, A, 'balcao');
  assert.equal((await balcao.post('/v1/staff/mcp/tokens', { name: 'x' })).status, 403);
  assert.equal((await client(env).get('/v1/staff/mcp')).status, 401);
  assert.equal((await admin.post('/v1/staff/mcp/tokens', { name: '' })).status, 400);
  const r = await admin.post('/v1/staff/mcp/tokens', { name: 'Claude da loja' });
  assert.equal(r.status, 201); assert.match(r.body.token, /^pomc_[A-Za-z0-9_-]{20,}$/); TOKEN = r.body.token; TOKEN_ID = r.body.id;
  const list = (await admin.get('/v1/staff/mcp')).body;
  assert.equal(list.tokens.length, 1); assert.equal(list.tokens[0].name, 'Claude da loja'); assert.deepEqual(list.tokens[0].scopes, ['orders']);
  assert.equal(JSON.stringify(list).includes(TOKEN), false); assert.equal('token_hash' in list.tokens[0], false);     // o segredo nunca volta
  assert.deepEqual(list.tools.map((t: any) => t.name), ['listar_colecoes', 'listar_produtos', 'consultar_cardapio', 'criar_pedido', 'mudar_status', 'cancelar_pedido']);
  assert.equal((await adminB.get('/v1/staff/mcp')).body.tokens.length, 0);                                              // outra loja não vê
  for (let i = 0; i < 4; i++) assert.equal((await admin.post('/v1/staff/mcp/tokens', { name: `t${i}` })).status, 201);
  assert.equal((await admin.post('/v1/staff/mcp/tokens', { name: 'sexto' })).status, 422);                              // limite
  const extra = (await admin.get('/v1/staff/mcp')).body.tokens.find((t: any) => t.name === 't0');
  assert.equal((await adminB.del(`/v1/staff/mcp/tokens/${extra.id}`)).status, 404);                                     // não revoga token de outra loja
  assert.equal((await admin.del(`/v1/staff/mcp/tokens/${extra.id}`)).status, 200);
  assert.equal((await admin.del(`/v1/staff/mcp/tokens/${extra.id}`)).status, 404);
});

test('protocolo MCP: initialize, notificações, ping, lista de ferramentas e erros', async () => {
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, '')).status, 401);                                // sem token
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'pomc_naoexiste_naoexiste_naoexiste')).status, 401);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'pmcp_' + 'a'.repeat(30))).status, 401);           // token do MCP da plataforma não vale aqui
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } } });
  assert.equal(init.body.result.protocolVersion, '2025-06-18'); assert.deepEqual(init.body.result.capabilities, { tools: {} }); assert.equal(init.body.result.serverInfo.name, 'pediu-pedidos');
  assert.match(init.body.result.instructions, /NÃO consegue ler nem listar pedidos/); assert.match(init.body.result.instructions, /nome e o telefone/);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).body.result.protocolVersion, '2025-03-26');   // versão desconhecida: cai na suportada
  assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);                        // notificação não tem resposta
  assert.deepEqual((await rpc({ jsonrpc: '2.0', id: 3, method: 'ping' })).body, { jsonrpc: '2.0', id: 3, result: {} });
  const tools = (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' })).body.result.tools;
  assert.equal(tools.length, 6); assert.ok(tools.every((t: any) => t.inputSchema.type === 'object' && t.description.length > 20));
  assert.equal((await rpc({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).body.error.code, -32601);
  const batch = await rpc([{ jsonrpc: '2.0', id: 6, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 7, method: 'ping' }]);
  assert.deepEqual(batch.body.map((x: any) => x.id), [6, 7]);
  assert.equal((await env.app.inject({ method: 'GET', url: '/v1/store-mcp' })).statusCode, 405);
});

test('contrato: leitura SÓ do cardápio, escrita de pedidos; não há leitura de pedidos, de clientes nem impressão', async () => {
  const names = (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).body.result.tools.map((t: any) => t.name) as string[];
  assert.deepEqual(names.filter((n) => /pedidos?$|status|cancelar/.test(n)).sort(), ['cancelar_pedido', 'criar_pedido', 'mudar_status']);   // escrita
  for (const gone of ['listar_pedidos', 'ver_pedido', 'reimprimir_pedido']) {
    const o = await newOrder(admin, A);
    const r = await call(gone, { numero: o.number });
    assert.equal(r.isError, true); assert.match(r.text, /Ferramenta desconhecida/);                                    // chamar mesmo assim é recusado
  }
  assert.equal(names.some((n) => /imprim|print|cliente/i.test(n)), false);
  const o = await newOrder(admin, A);
  const m = await call('mudar_status', { numero: o.number, para: 'preparo' });
  assert.equal(m.isError, false); assert.deepEqual(Object.keys(data(m)).sort(), ['aviso', 'mensagem', 'ok'].filter((k) => k in data(m)).sort());
  assert.equal(/Maria|16999990000|Rua A/.test(m.text), false);                                                         // a resposta não devolve dados do cliente
});

test('leitura do cardápio: todas as coleções e todos os produtos (inclusive indisponíveis), com filtros, só leitura', async () => {
  await env.pools.platform.begin((q) => q`update products set available = false where store_id = ${A.storeId} and name = 'Marguerita'`);
  const cols = data(await call('listar_colecoes'));
  assert.deepEqual(cols.colecoes, [{ nome: 'Pizzas', produtos: 2, disponiveis: 1 }]);

  const todos = data(await call('listar_produtos'));
  assert.equal(todos.total, 2);
  const calabresa = todos.produtos.find((p: any) => p.nome === 'Calabresa');
  assert.equal(calabresa.preco, 'R$ 49,90'); assert.equal(calabresa.colecao, 'Pizzas'); assert.equal(calabresa.disponivel, true);
  assert.deepEqual(calabresa.adicionais[0].opcoes.map((o: any) => [o.nome, o.preco_extra]), [['Catupiry', 'R$ 8,00'], ['Cheddar', 'R$ 7,00']]);
  assert.equal(todos.produtos.find((p: any) => p.nome === 'Marguerita').disponivel, false);                           // indisponível aparece, marcado
  assert.deepEqual(data(await call('listar_produtos', { somente_disponiveis: true })).produtos.map((p: any) => p.nome), ['Calabresa']);
  assert.deepEqual(data(await call('listar_produtos', { busca: 'MARG' })).produtos.map((p: any) => p.nome), ['Marguerita']);
  assert.deepEqual(data(await call('listar_produtos', { colecao: 'pizza' })).produtos.length, 2);                      // coleção sem acento/maiúscula
  const semColecao = await call('listar_produtos', { colecao: 'sobremesas' }); assert.equal(semColecao.isError, true); assert.match(semColecao.text, /Não encontrei a coleção "sobremesas".*"Pizzas"/);

  const card = data(await call('consultar_cardapio'));
  assert.equal(card.loja.aberta, true); assert.equal(card.colecoes[0].nome, 'Pizzas'); assert.equal(card.colecoes[0].produtos.length, 2);
  assert.deepEqual(card.regioes_de_entrega, [{ nome: 'Centro', taxa: 'R$ 6,00', tempo_min: 35 }]);
  assert.deepEqual(card.formas_de_pagamento.map((f: any) => f.nome).sort(), ['Dinheiro', 'Pix']);

  // leitura não altera nada
  const antes = await env.pools.platform.begin((q) => q`select count(*)::int as n from orders where store_id = ${A.storeId}`);
  await call('consultar_cardapio'); await call('listar_produtos');
  assert.equal((await env.pools.platform.begin((q) => q`select count(*)::int as n from orders where store_id = ${A.storeId}`))[0]!.n, antes[0]!.n);
  await env.pools.platform.begin((q) => q`update products set available = true where store_id = ${A.storeId}`);          // volta ao normal para os próximos testes
});

test('telefone: aceita formatos brasileiros e normaliza para só dígitos; recusa o inválido', () => {
  assert.equal(normPhone('(16) 99999-0000'), '16999990000'); assert.equal(normPhone('+55 16 99999-0000'), '16999990000'); assert.equal(normPhone('16999990000'), '16999990000');
  assert.equal(normPhone('(16) 3222-1111'), '1632221111');                                       // fixo
  assert.equal(normPhone('5516999990000'), '16999990000');
  for (const bad of ['', '123', '99999-0000', '(16) 89999-0000', '(05) 99999-0000', '16 9999 000', '+1 415 555 0100', 'abc']) assert.equal(normPhone(bad), null, bad);
});

test('criar pedido exige NOME e TELEFONE do cliente em qualquer tipo (retirada, entrega e mesa)', async () => {
  const item = [{ produto: 'Marguerita' }];
  const base = { tipo: 'retirada', itens: item };
  const semNome = await call('criar_pedido', { ...base, telefone: '16999990000' });
  assert.equal(semNome.isError, true); assert.match(semNome.text, /cliente.*nome do cliente/i);
  const semFone = await call('criar_pedido', { ...base, cliente: 'João da Silva' });
  assert.equal(semFone.isError, true); assert.match(semFone.text, /telefone.*telefone do cliente/i);
  assert.equal((await call('criar_pedido', { ...base, cliente: '', telefone: '16999990000' })).isError, true);
  assert.equal((await call('criar_pedido', { ...base, cliente: 'J', telefone: '16999990000' })).isError, true);        // nome curto demais
  assert.equal((await call('criar_pedido', { ...base, cliente: '1234', telefone: '16999990000' })).isError, true);     // sem letras
  const fone = await call('criar_pedido', { ...base, cliente: 'João', telefone: '123' });
  assert.equal(fone.isError, true); assert.match(fone.text, /Telefone inválido.*DDD/);
  // vale para os três tipos
  for (const extra of [{ tipo: 'delivery', endereco: 'Rua A, 10', regiao: 'Centro' }, { tipo: 'mesa', mesa: 3 }]) {
    assert.equal((await call('criar_pedido', { ...base, ...extra, cliente: 'Ana' })).isError, true);                   // sem telefone
    assert.equal((await call('criar_pedido', { ...base, ...extra, telefone: '16999990000' })).isError, true);           // sem nome
  }
  // o esquema anunciado ao assistente também marca os dois como obrigatórios
  const sch = (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).body.result.tools.find((t: any) => t.name === 'criar_pedido').inputSchema;
  assert.deepEqual(sch.required, ['tipo', 'cliente', 'telefone', 'itens']);
  // nada foi criado por essas tentativas
  assert.equal((await env.pools.platform.begin((q) => q`select count(*)::int as n from orders where store_id = ${A.storeId} and customer_name in ('Ana', 'João', 'J', '1234')`))[0]!.n, 0);
});

test('criar pedido pelo MCP: nomes sem acento, adicionais, entrega com taxa, mesa, pagamento presencial; guarda nome e telefone normalizado', async () => {
  const r = await call('criar_pedido', { tipo: 'retirada', ...cliente, itens: [{ produto: 'CALÁBRESA', quantidade: 2, adicionais: ['catupiry'], observacao: 'bem passada' }], observacao: 'sem pressa' });
  assert.equal(r.isError, false); const d = data(r); assert.equal(d.total, 'R$ 115,80'); assert.equal(d.status, 'novo'); assert.match(d.mensagem, /A RECEBER/);   // (49,90 + 8,00) × 2
  const ord = await orderOf(admin, d.numero);
  assert.equal(ord.customer_name, 'João da Silva'); assert.equal(ord.customer_phone, '16999990000'); assert.equal(ord.status, 'novo'); assert.equal(ord.paid, false); assert.equal(ord.channel, 'pdv');
  assert.equal(ord.items[0].qty, 2); assert.equal(ord.items[0].note, 'bem passada'); assert.equal(ord.items[0].addons[0].name, 'Catupiry');
  const ev = (await admin.get(`/v1/staff/orders/${ord.id}/events`)).body.events;
  assert.equal(ev[0].event, 'created'); assert.equal(ev[0].actor_name, 'Claude da loja (MCP)');                       // autoria registrada

  // entrega: região por nome, taxa somada, endereço obrigatório
  const e0 = await call('criar_pedido', { tipo: 'delivery', ...cliente, endereco: 'Rua A, 10', itens: [{ produto: 'marguerita' }] });
  assert.equal(e0.isError, true); assert.match(e0.text, /região de entrega.*"Centro"/);
  assert.equal((await call('criar_pedido', { tipo: 'delivery', ...cliente, regiao: 'centro', itens: [{ produto: 'marguerita' }] })).isError, true);   // sem endereço
  const e1 = await call('criar_pedido', { tipo: 'delivery', ...cliente, telefone: '+55 (16) 3222-1111', endereco: 'Rua A, 10', regiao: 'Centro', forma_pagamento: 'dinheiro', itens: [{ produto: 'Marguerita' }] });
  assert.equal(e1.isError, false); assert.equal(data(e1).total, 'R$ 51,00');                                              // 45 + 6 de taxa
  const o1 = await orderOf(admin, data(e1).numero); assert.equal(o1.customer_phone, '1632221111'); assert.match(o1.address, /Rua A, 10 — Centro/); assert.equal(o1.payment_method, 'Dinheiro'); assert.equal(o1.paid, false);

  // mesa: precisa do número; mesa ocupada avisa
  assert.equal((await call('criar_pedido', { tipo: 'mesa', ...cliente, itens: [{ produto: 'Marguerita' }] })).isError, true);
  const m1 = await call('criar_pedido', { tipo: 'mesa', mesa: 7, pessoas: 3, ...cliente, itens: [{ produto: 'Marguerita' }] });
  assert.equal(m1.isError, false); assert.equal((await orderOf(admin, data(m1).numero)).table_number, 7);
  const m2 = await call('criar_pedido', { tipo: 'mesa', mesa: 7, ...cliente, itens: [{ produto: 'Marguerita' }] });
  assert.equal(m2.isError, true); assert.match(m2.text, /mesa já tem uma comanda/);

  // erros claros: produto inexistente, nome ambíguo, adicional inexistente, itens vazios, tipo inválido, pagamento online
  const x1 = await call('criar_pedido', { tipo: 'retirada', ...cliente, itens: [{ produto: 'sorvete' }] }); assert.equal(x1.isError, true); assert.match(x1.text, /Não encontrei o produto "sorvete".*"Calabresa".*"Marguerita"/);
  const x2 = await call('criar_pedido', { tipo: 'retirada', ...cliente, itens: [{ produto: 'a' }] }); assert.equal(x2.isError, true); assert.match(x2.text, /ambíguo/);
  const x3 = await call('criar_pedido', { tipo: 'retirada', ...cliente, itens: [{ produto: 'Calabresa', adicionais: ['bacon'] }] }); assert.equal(x3.isError, true); assert.match(x3.text, /Não encontrei o adicional de "Calabresa" "bacon".*Catupiry/);
  assert.equal((await call('criar_pedido', { tipo: 'retirada', ...cliente, itens: [] })).isError, true);
  assert.equal((await call('criar_pedido', { tipo: 'viagem', ...cliente, itens: [{ produto: 'Marguerita' }] })).isError, true);
  await env.pools.platform.begin((q) => q`insert into payment_methods (store_id, tenant_id, name, type, online, gateway) values (${A.storeId}, ${A.tenantId}, 'Pix online', 'pix', true, 'mercadopago')`);
  const x4 = await call('criar_pedido', { tipo: 'retirada', ...cliente, forma_pagamento: 'pix online', itens: [{ produto: 'Marguerita' }] }); assert.equal(x4.isError, true); assert.match(x4.text, /pagamento online/);

  // nada vaza para a outra loja
  assert.equal((await adminB.get('/v1/staff/orders?limit=50')).body.orders.some((o: any) => o.customer_name === 'João da Silva'), false);
});

test('escrita em pedidos existentes: avançar etapas, recusar saltos, cancelar com motivo — com histórico e auditoria em nome do token', async () => {
  const o = await newOrder(admin, A, 'delivery'); const other = await newOrder(adminB, B);
  assert.equal((await call('mudar_status', { numero: o.number, para: 'entregue' })).isError, true);                    // não pode pular etapas
  const m = await call('mudar_status', { numero: o.number, para: 'preparo' });
  assert.equal(m.isError, false); assert.match(data(m).mensagem, new RegExp(`#${o.number}.*preparo`));
  assert.equal((await orderOf(admin, o.number)).status, 'preparo');
  assert.equal((await call('mudar_status', { numero: 999999, para: 'preparo' })).isError, true);
  assert.equal((await call('mudar_status', { numero: o.number, para: 'novo' })).isError, true);                        // voltar não é permitido pelo MCP

  const ev = (await admin.get(`/v1/staff/orders/${(await orderOf(admin, o.number)).id}/events`)).body.events;           // o painel mostra quem foi
  assert.deepEqual(ev.map((e: any) => e.event), ['created', 'status:preparo']); assert.equal(ev.at(-1).actor_name, 'Claude da loja (MCP)');

  assert.equal((await call('cancelar_pedido', { numero: o.number })).isError, true);                                   // motivo obrigatório
  assert.equal((await call('cancelar_pedido', { numero: o.number, motivo: 'x' })).isError, true);                       // curto demais
  const c = await call('cancelar_pedido', { numero: o.number, motivo: 'cliente pediu para cancelar' });
  assert.equal(c.isError, false); assert.match(data(c).aviso, /estorno/);
  const after = await orderOf(admin, o.number); assert.equal(after.status, 'cancelado'); assert.match(after.cancel_reason, /cliente pediu para cancelar \(via MCP\)/);
  const [log] = await env.pools.platform.begin((q) => q`select actor_id from audit_logs where action = 'order.cancelled' and store_id = ${A.storeId} order by at desc limit 1`);
  assert.equal(log!.actor_id, `mcp:${TOKEN_ID}`);                                                                       // auditoria registra o token
  assert.equal((await call('mudar_status', { numero: o.number, para: 'pronto' })).isError, true);                      // pedido cancelado não anda mais
  assert.equal((await adminB.get('/v1/staff/orders?limit=50')).body.orders.find((x: any) => x.id === other.id).status, 'novo');   // a outra loja não foi tocada
});

test('token revogado ou vencido para de valer na hora', async () => {
  const novo = (await admin.post('/v1/staff/mcp/tokens', { name: 'temporário', expiresInDays: 1 })).body;
  assert.equal(novo.token?.startsWith('pomc_'), true);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, novo.token)).status, 200);
  await env.pools.platform.begin((q) => q`update store_mcp_tokens set expires_at = now() - interval '1 minute' where id = ${novo.id}`);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, novo.token)).status, 401);                          // venceu
  assert.equal((await admin.del(`/v1/staff/mcp/tokens/${TOKEN_ID}`)).status, 200);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);                                      // revogado
  const [t] = await env.pools.platform.begin((q) => q`select last_used_at from store_mcp_tokens where id = ${TOKEN_ID}`);
  assert.ok(t!.last_used_at);                                                                                            // o último uso foi registrado
});
