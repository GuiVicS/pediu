import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
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
const newOrder = async (c: Client, s: Seeded, type: 'retirada' | 'delivery' = 'retirada') => (await c.post('/v1/staff/orders', { type, customerName: 'Maria', phone: '16999990000', address: type === 'delivery' ? 'Rua A, 1' : '', zoneId: type === 'delivery' ? s.zone : undefined, lines: [{ productId: s.prod, qty: 2, addons: [] }] })).body as { id: string; number: number };

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
  assert.deepEqual(list.tools.map((t: any) => t.name), ['consultar_cardapio', 'criar_pedido', 'listar_pedidos', 'ver_pedido', 'mudar_status', 'cancelar_pedido', 'reimprimir_pedido']);
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
  assert.equal((await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).body.result.protocolVersion, '2025-03-26');   // versão desconhecida: cai na suportada
  assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);                        // notificação não tem resposta
  assert.deepEqual((await rpc({ jsonrpc: '2.0', id: 3, method: 'ping' })).body, { jsonrpc: '2.0', id: 3, result: {} });
  const tools = (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' })).body.result.tools;
  assert.equal(tools.length, 7); assert.ok(tools.every((t: any) => t.inputSchema.type === 'object' && t.description.length > 20));
  assert.equal((await rpc({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).body.error.code, -32601);
  const batch = await rpc([{ jsonrpc: '2.0', id: 6, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 7, method: 'ping' }]);
  assert.deepEqual(batch.body.map((x: any) => x.id), [6, 7]);
  assert.equal((await env.app.inject({ method: 'GET', url: '/v1/store-mcp' })).statusCode, 405);
});

test('gerenciar pedidos: listar, ver, avançar etapas, recusar saltos, cancelar com motivo — tudo com histórico em nome do token', async () => {
  const o = await newOrder(admin, A, 'delivery'); const other = await newOrder(adminB, B);
  const lista = data(await call('listar_pedidos'));
  assert.ok(lista.pedidos.some((p: any) => p.numero === o.number && p.status === 'novo' && p.tipo === 'entrega' && p.itens[0] === '2× Calabresa'));
  assert.equal(lista.pedidos.length, 1);                                                                                // o pedido da OUTRA loja não aparece
  assert.equal(data(await call('listar_pedidos', { tipo: 'mesa' })).total, 0);
  assert.equal((await call('listar_pedidos', { limite: 500 })).isError, true);                                          // parâmetro inválido vira erro legível

  assert.equal((await call('mudar_status', { numero: o.number, para: 'entregue' })).isError, true);                    // não pode pular etapas
  const m = await call('mudar_status', { numero: o.number, para: 'preparo' });
  assert.equal(m.isError, false); assert.match(data(m).mensagem, new RegExp(`#${o.number}.*preparo`));
  assert.equal((await call('mudar_status', { numero: 999999, para: 'preparo' })).isError, true);
  assert.equal((await call('mudar_status', { numero: o.number, para: 'novo' })).isError, true);                        // voltar não é permitido pelo MCP

  const v = data(await call('ver_pedido', { numero: o.number }));
  assert.equal(v.status, 'preparo'); assert.equal(v.cliente, 'Maria'); assert.equal(v.itens[0].qtd, 2); assert.match(v.total, /^R\$ \d+,\d{2}$/);
  assert.deepEqual(v.historico.map((h: any) => h.evento), ['created', 'status:preparo']); assert.equal(v.historico[1].quem, 'Claude da loja (MCP)');
  assert.equal((await call('ver_pedido', { numero: other.number + 50 })).isError, true);

  // o painel também mostra quem foi
  const ev = (await admin.get(`/v1/staff/orders/${o.id}/events`)).body.events;
  assert.equal(ev.at(-1).actor_name, 'Claude da loja (MCP)');

  assert.equal((await call('cancelar_pedido', { numero: o.number })).isError, true);                                   // motivo obrigatório
  assert.equal((await call('cancelar_pedido', { numero: o.number, motivo: 'x' })).isError, true);                       // curto demais
  const c = await call('cancelar_pedido', { numero: o.number, motivo: 'cliente pediu para cancelar' });
  assert.equal(c.isError, false); assert.match(data(c).aviso, /estorno/);
  const after = data(await call('ver_pedido', { numero: o.number }));
  assert.equal(after.status, 'cancelado'); assert.match(after.motivo_cancelamento, /cliente pediu para cancelar \(via MCP\)/);
  const [log] = await env.pools.platform.begin((q) => q`select actor_id, meta from audit_logs where action = 'order.cancelled' and store_id = ${A.storeId} order by at desc limit 1`);
  assert.equal(log!.actor_id, `mcp:${TOKEN_ID}`);                                                                       // auditoria registra o token
  assert.equal((await call('mudar_status', { numero: o.number, para: 'pronto' })).isError, true);                      // pedido cancelado não anda mais
  const outro = (await adminB.get('/v1/staff/orders?limit=50')).body.orders.find((x: any) => x.id === other.id);
  assert.equal(outro.status, 'novo');                                                                                   // e a outra loja não foi tocada
});

test('reimprimir: sem impressora configurada explica o que falta; com impressora, enfileira o cupom', async () => {
  const o = await newOrder(admin, A);
  const r = await call('reimprimir_pedido', { numero: o.number });
  assert.equal(r.isError, true); assert.match(r.text, /Nada para imprimir/);
  await env.pools.platform.begin(async (q) => {
    const [zone] = await q`select id from print_zones where store_id = ${A.storeId} limit 1`;
    const [pr] = await q`insert into printers (store_id, tenant_id, name, connection, address) values (${A.storeId}, ${A.tenantId}, 'Cozinha', 'rede', '192.168.0.50:9100') returning id`;
    await q`insert into zone_printers (store_id, tenant_id, zone_id, printer_id, priority, copies) values (${A.storeId}, ${A.tenantId}, ${zone!.id}, ${pr!.id}, 0, 1)`;
  });
  const ok = await call('reimprimir_pedido', { numero: o.number });
  assert.equal(ok.isError, false); assert.match(data(ok).mensagem, /enviado para impressão/);
});

test('criar pedido pelo MCP: consulta o cardápio, resolve nomes (sem ligar para acento), entrega, mesa, pagamento presencial', async () => {
  const card = data(await call('consultar_cardapio'));
  assert.equal(card.loja.aberta, true);
  const pizzas = card.categorias.find((c: any) => c.nome === 'Pizzas');
  const calabresa = pizzas.produtos.find((p: any) => p.nome === 'Calabresa');
  assert.equal(calabresa.preco, 'R$ 49,90'); assert.deepEqual(calabresa.adicionais[0].opcoes.map((o: any) => o.nome), ['Catupiry', 'Cheddar']);
  assert.deepEqual(card.regioes_de_entrega, [{ nome: 'Centro', taxa: 'R$ 6,00', tempo_min: 35 }]);
  assert.deepEqual(card.formas_de_pagamento.map((f: any) => f.nome).sort(), ['Dinheiro', 'Pix']);
  assert.deepEqual(data(await call('consultar_cardapio', { busca: 'MARG' })).categorias[0].produtos.map((p: any) => p.nome), ['Marguerita']);

  // retirada com adicional: total = (49,90 + 8,00) × 2
  const r = await call('criar_pedido', { tipo: 'retirada', cliente: 'João', itens: [{ produto: 'CALÁBRESA', quantidade: 2, adicionais: ['catupiry'], observacao: 'bem passada' }], observacao: 'sem pressa' });
  assert.equal(r.isError, false); const d = data(r); assert.equal(d.total, 'R$ 115,80'); assert.equal(d.status, 'novo'); assert.match(d.mensagem, /A RECEBER/);
  const v = data(await call('ver_pedido', { numero: d.numero }));
  assert.equal(v.cliente, 'João'); assert.equal(v.pago, false); assert.equal(v.itens[0].qtd, 2); assert.deepEqual(v.itens[0].adicionais, ['Catupiry']); assert.equal(v.itens[0].observacao, 'bem passada');
  assert.equal(v.historico[0].evento, 'created'); assert.equal(v.historico[0].quem, 'Claude da loja (MCP)');
  const ord = (await admin.get('/v1/staff/orders?limit=50')).body.orders.find((x: any) => x.number === d.numero);
  assert.equal(ord.status, 'novo'); assert.equal(ord.paid, false); assert.equal(ord.channel, 'pdv');                    // entra no fluxo normal da loja

  // entrega: região por nome, taxa somada, endereço obrigatório
  const e0 = await call('criar_pedido', { tipo: 'delivery', cliente: 'Ana', endereco: 'Rua A, 10', itens: [{ produto: 'marguerita' }] });
  assert.equal(e0.isError, true); assert.match(e0.text, /região de entrega.*"Centro"/);
  assert.equal((await call('criar_pedido', { tipo: 'delivery', cliente: 'Ana', regiao: 'centro', itens: [{ produto: 'marguerita' }] })).isError, true);   // sem endereço
  const e1 = await call('criar_pedido', { tipo: 'delivery', cliente: 'Ana', endereco: 'Rua A, 10', regiao: 'Centro', telefone: '16999990000', forma_pagamento: 'dinheiro', itens: [{ produto: 'Marguerita' }] });
  assert.equal(e1.isError, false); assert.equal(data(e1).total, 'R$ 51,00');                                              // 45 + 6 de taxa
  const ev1 = data(await call('ver_pedido', { numero: data(e1).numero }));
  assert.equal(ev1.tipo, 'entrega'); assert.match(ev1.endereco, /Rua A, 10 — Centro/); assert.equal(ev1.pagamento, 'Dinheiro'); assert.equal(ev1.pago, false);

  // mesa: precisa do número; mesa ocupada avisa
  assert.equal((await call('criar_pedido', { tipo: 'mesa', itens: [{ produto: 'Marguerita' }] })).isError, true);
  const m1 = await call('criar_pedido', { tipo: 'mesa', mesa: 7, pessoas: 3, itens: [{ produto: 'Marguerita' }] });
  assert.equal(m1.isError, false); assert.equal(data(await call('ver_pedido', { numero: data(m1).numero })).mesa, 7);
  const m2 = await call('criar_pedido', { tipo: 'mesa', mesa: 7, itens: [{ produto: 'Marguerita' }] });
  assert.equal(m2.isError, true); assert.match(m2.text, /mesa já tem uma comanda/);

  // erros claros: produto inexistente, nome ambíguo, adicional inexistente, parâmetros inválidos, pagamento online
  const x1 = await call('criar_pedido', { tipo: 'retirada', itens: [{ produto: 'sorvete' }] }); assert.equal(x1.isError, true); assert.match(x1.text, /Não encontrei o produto "sorvete".*"Calabresa".*"Marguerita"/);
  const x2 = await call('criar_pedido', { tipo: 'retirada', itens: [{ produto: 'a' }] }); assert.equal(x2.isError, true); assert.match(x2.text, /ambíguo/);
  const x3 = await call('criar_pedido', { tipo: 'retirada', itens: [{ produto: 'Calabresa', adicionais: ['bacon'] }] }); assert.equal(x3.isError, true); assert.match(x3.text, /Não encontrei o adicional de "Calabresa" "bacon".*Catupiry/);
  assert.equal((await call('criar_pedido', { tipo: 'retirada', itens: [] })).isError, true);
  assert.equal((await call('criar_pedido', { tipo: 'viagem', itens: [{ produto: 'Marguerita' }] })).isError, true);
  await env.pools.platform.begin((q) => q`insert into payment_methods (store_id, tenant_id, name, type, online, gateway) values (${A.storeId}, ${A.tenantId}, 'Pix online', 'pix', true, 'mercadopago')`);
  const x4 = await call('criar_pedido', { tipo: 'retirada', forma_pagamento: 'pix online', itens: [{ produto: 'Marguerita' }] }); assert.equal(x4.isError, true); assert.match(x4.text, /pagamento online/);

  // nada vaza para a outra loja
  assert.equal((await adminB.get('/v1/staff/orders?limit=50')).body.orders.some((o: any) => o.customer_name === 'João'), false);
});

test('token revogado ou vencido para de valer na hora', async () => {
  const novo = (await admin.post('/v1/staff/mcp/tokens', { name: 'temporário', expiresInDays: 1 })).body;
  // (já havia 4 ativos + este: o teste anterior de limite deixou espaço depois de revogar um)
  assert.equal(novo.token?.startsWith('pomc_'), true);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, novo.token)).status, 200);
  await env.pools.platform.begin((q) => q`update store_mcp_tokens set expires_at = now() - interval '1 minute' where id = ${novo.id}`);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, novo.token)).status, 401);                          // venceu
  assert.equal((await admin.del(`/v1/staff/mcp/tokens/${TOKEN_ID}`)).status, 200);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);                                      // revogado
  const [t] = await env.pools.platform.begin((q) => q`select last_used_at, last_ip from store_mcp_tokens where id = ${TOKEN_ID}`);
  assert.ok(t!.last_used_at);                                                                                            // o último uso foi registrado
});
