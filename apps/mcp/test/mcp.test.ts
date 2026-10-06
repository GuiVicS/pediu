import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, rateLimiter } from '../src/auth.js';
import { READ_TOOLS, WRITE_TOOLS } from '../src/tools.js';
import { hashToken } from '@pediu/shared';
import { setup, type Env } from './helpers.js';

let env: Env; let mcp: Awaited<ReturnType<Env['connect']>>;
before(async () => { env = await setup(); mcp = await env.connect(env.anyToken); });
after(async () => { await mcp.close(); await env.close(); });

const uuid = '00000000-0000-4000-8000-000000000000';
/** Cria uma loja de teste e garante que deu certo (nomes inválidos fariam testes passarem pelo motivo errado). */
const mk = async (slug: string, c: { call: Awaited<ReturnType<Env['connect']>>['call'] } = mcp) => {
  const r = await c.call('criar_loja', { slug, nome: `Loja ${slug}`, tenantName: `Conta ${slug}` });
  assert.equal(r.isError, false, `criar_loja ${slug}: ${r.text}`);
  return r.data.id as string;
};

test('expõe exatamente as ferramentas planejadas (leitura + escrita)', async () => {
  const { tools } = await mcp.client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [...READ_TOOLS, ...WRITE_TOOLS].sort());
  // nenhuma ferramenta toca em credenciais, usuários da plataforma, tokens, Stripe ou exclusão de loja
  assert.equal(names.some((n) => /credencial|token|stripe|segredo|usuario|excluir_loja|status/.test(n)), false);
});

test('fluxo de criação: loja → tema → cardápio → banner → zonas → pagamento, tudo gravado e auditado', async () => {
  const c = await mcp.call('criar_loja', { slug: 'pizzaria-mcp', nome: 'Pizzaria MCP', tenantName: 'Cliente MCP' });
  assert.equal(c.isError, false); assert.equal(c.data.status, 'desenvolvimento'); assert.equal(c.data.dominio, 'pizzaria-mcp.pediu.test');
  const lojaId = c.data.id as string;

  const tema = await mcp.call('atualizar_tema', { lojaId, primary: '#E53935', fontFamily: 'Poppins', logoUrl: 'https://cdn.exemplo.com/logo.png', productGridColumns: 3, customCss: '.x{}' });
  assert.equal(tema.data.tema.primary, '#E53935');
  const tema2 = await mcp.call('atualizar_tema', { lojaId, accent: '#FFC107' });
  assert.deepEqual([tema2.data.tema.primary, tema2.data.tema.accent], ['#E53935', '#FFC107']); // mescla, não substitui

  assert.equal((await mcp.call('atualizar_tema', { lojaId, primary: 'vermelho' })).isError, true); // validação do schema

  const set = await mcp.call('atualizar_loja', { lojaId, nome: 'Pizzaria MCP Premium', phone: '(16) 99999-0000', minOrder: 25, hours: [{ day: 1, closed: false, open: '18:00', close: '23:30' }] });
  assert.equal(set.data.nome, 'Pizzaria MCP Premium'); assert.equal(set.data.configuracoes.minOrder, 25);

  const cat = await mcp.call('salvar_categoria', { lojaId, name: 'Pizzas', order: 1 });
  const catId = cat.data.id as string;
  const grupo = await mcp.call('salvar_grupo_adicionais', { lojaId, name: 'Borda', min: 0, max: 1, addons: [{ name: 'Catupiry', price: 8 }, { name: 'Cheddar', price: 7 }] });
  assert.equal(grupo.isError, false);
  const prod = await mcp.call('salvar_produto', { lojaId, categoryId: catId, name: 'Calabresa', price: 49.9, groupIds: [grupo.data.id], imageUrl: 'https://cdn.exemplo.com/calabresa.jpg' });
  assert.equal(prod.isError, false);
  // atualização parcial: só nome e preço — foto, grupos e demais campos NÃO podem ser zerados
  const upd = await mcp.call('salvar_produto', { lojaId, id: prod.data.id, name: 'Calabresa Especial', price: 54.9 });
  assert.equal(upd.data.name, 'Calabresa Especial');
  assert.equal(upd.data.imageUrl, 'https://cdn.exemplo.com/calabresa.jpg');
  const rename = await mcp.call('salvar_grupo_adicionais', { lojaId, id: grupo.data.id, name: 'Borda recheada' }); // sem addons: mantém os 2
  assert.equal(rename.isError, false);
  const incompleto = await mcp.call('salvar_produto', { lojaId, name: 'Sem categoria' });
  assert.equal(incompleto.isError, true); assert.match(incompleto.text, /categoryId|price/);

  assert.equal((await mcp.call('salvar_banner', { lojaId, title: 'Promo', imageUrl: 'https://cdn.exemplo.com/b.jpg' })).isError, false);
  assert.equal((await mcp.call('salvar_zona_entrega', { lojaId, name: 'Centro', fee: 6, eta: 35 })).isError, false);
  const zi = await mcp.call('salvar_zona_impressao', { lojaId, name: 'Cozinha' });
  assert.equal((await mcp.call('salvar_categoria', { lojaId, id: catId, name: 'Pizzas', printZoneId: zi.data.id })).isError, false);
  assert.equal((await mcp.call('salvar_forma_pagamento', { lojaId, name: 'Pix', type: 'pix' })).isError, false);

  const v = await mcp.call('ver_loja', { lojaId });
  assert.equal(v.data.loja.editavel, true);
  assert.equal(v.data.produtos.length, 1); assert.equal(v.data.produtos[0].grupos.length, 1);
  assert.equal(v.data.grupos_adicionais[0].adicionais.length, 2);
  assert.equal(v.data.grupos_adicionais[0].nome, 'Borda recheada');
  assert.equal(v.data.produtos[0].preco, '54.90');
  assert.equal(v.data.categorias[0].print_zone_id, zi.data.id);
  assert.equal(v.data.tema.fontFamily, 'Poppins');

  // toda alteração gerou revisão e auditoria
  const revs = await env.plat((q) => q`select entity, op from store_config_revisions where store_id = ${lojaId}`);
  assert.ok(revs.length >= 12);
  assert.ok(revs.some((r) => r.entity === 'produto' && r.op === 'update'));
  const aud = await env.plat((q) => q`select action from audit_logs where store_id = ${lojaId} and actor_kind = 'mcp'`);
  assert.ok(aud.some((a) => a.action === 'mcp.produto.create'));
});

test('produto não aceita categoria/grupo de OUTRA loja', async () => {
  const a = await mk('loja-a-iso');
  const b = await mk('loja-b-iso');
  const catB = (await mcp.call('salvar_categoria', { lojaId: b, name: 'Da B' })).data.id as string;
  const r = await mcp.call('salvar_produto', { lojaId: a, categoryId: catB, name: 'Intruso', price: 1 });
  assert.equal(r.isError, true);
  const n = await env.plat((q) => q`select count(*)::int as n from products where store_id = ${a}`);
  assert.equal(n[0]!.n, 0);
});

test('importar_cardapio: dryRun não grava; importação grava; substituir exige confirmação', async () => {
  const lojaId = await mk('import-teste');
  const cardapio = { lojaId, categorias: [{ nome: 'Lanches', produtos: [{ nome: 'X-Burger', preco: 22 }, { nome: 'X-Salada', preco: 24, descricao: 'com alface' }] }, { nome: 'Bebidas', produtos: [{ nome: 'Suco', preco: 9 }] }] };
  const dry = await mcp.call('importar_cardapio', { ...cardapio, dryRun: true });
  assert.deepEqual([dry.data.categorias, dry.data.produtos], [2, 3]);
  assert.equal((await env.plat((q) => q`select count(*)::int as n from products where store_id = ${lojaId}`))[0]!.n, 0);
  assert.equal((await mcp.call('importar_cardapio', cardapio)).data.produtos, 3);
  assert.equal((await env.plat((q) => q`select count(*)::int as n from products where store_id = ${lojaId}`))[0]!.n, 3);
  const sem = await mcp.call('importar_cardapio', { ...cardapio, substituir: true });
  assert.equal(sem.isError, true); assert.match(sem.text, /confirmarSubstituicao/);
  const com = await mcp.call('importar_cardapio', { ...cardapio, substituir: true, confirmarSubstituicao: true });
  assert.equal(com.isError, false);
  assert.equal((await env.plat((q) => q`select count(*)::int as n from products where store_id = ${lojaId}`))[0]!.n, 3); // 3 antigos removidos, 3 novos
});

test('remover categoria com produtos exige confirmação', async () => {
  const lojaId = await mk('rm-cat');
  const cat = (await mcp.call('salvar_categoria', { lojaId, name: 'C' })).data.id as string;
  await mcp.call('salvar_produto', { lojaId, categoryId: cat, name: 'P', price: 5 });
  const no = await mcp.call('remover_categoria', { lojaId, categoriaId: cat });
  assert.equal(no.isError, true); assert.match(no.text, /confirmar=true/);
  assert.equal((await mcp.call('remover_categoria', { lojaId, categoriaId: cat, confirmar: true })).isError, false);
});

test('publicação: checklist bloqueia loja incompleta; completa gera pedido; o MCP não publica', async () => {
  const lojaId = await mk('publica-me');
  const vazio = await mcp.call('validar_loja', { lojaId });
  assert.equal(vazio.data.ok, false);
  assert.equal((await mcp.call('solicitar_publicacao', { lojaId })).isError, true);

  const cat = (await mcp.call('salvar_categoria', { lojaId, name: 'Lanches' })).data.id as string;
  await mcp.call('salvar_produto', { lojaId, categoryId: cat, name: 'Burger', price: 20 });
  await mcp.call('salvar_forma_pagamento', { lojaId, name: 'Pix', type: 'pix' });
  await mcp.call('atualizar_loja', { lojaId, hours: [{ day: 1, closed: false, open: '10:00', close: '22:00' }] });
  const ok = await mcp.call('validar_loja', { lojaId });
  assert.equal(ok.data.ok, true); assert.ok(ok.data.issues.length > 0); // avisos (sem foto, sem logo…) não bloqueiam

  const pedido = await mcp.call('solicitar_publicacao', { lojaId, observacao: 'cliente aprovou o layout' });
  assert.equal(pedido.isError, false); assert.match(pedido.data.mensagem, /administrador/);
  assert.equal((await mcp.call('solicitar_publicacao', { lojaId })).isError, true); // já há um pendente
  const [st] = await env.plat((q) => q`select status from stores where id = ${lojaId}`);
  assert.equal(st!.status, 'desenvolvimento');
});

// ================= a trava: loja em produção é somente leitura =================
test('LOJA EM PRODUÇÃO: nenhuma ferramenta de escrita funciona e nada muda no banco', async () => {
  const lojaId = await mk('ja-no-ar');
  const cat = (await mcp.call('salvar_categoria', { lojaId, name: 'Original' })).data.id as string;
  const prod = (await mcp.call('salvar_produto', { lojaId, categoryId: cat, name: 'Original', price: 10 })).data.id as string;
  const grupo = (await mcp.call('salvar_grupo_adicionais', { lojaId, name: 'G' })).data.id as string;
  const banner = (await mcp.call('salvar_banner', { lojaId, imageUrl: 'https://x.com/a.jpg' })).data.id as string;
  const zona = (await mcp.call('salvar_zona_entrega', { lojaId, name: 'Z', fee: 1, eta: 10 })).data.id as string;
  const zi = (await mcp.call('salvar_zona_impressao', { lojaId, name: 'Coz' })).data.id as string;
  const forma = (await mcp.call('salvar_forma_pagamento', { lojaId, name: 'Pix', type: 'pix' })).data.id as string;

  const snap = async () => JSON.stringify(await env.plat(async (q) => ({
    s: await q`select name, slug, status from stores where id = ${lojaId}`, th: await q`select data from store_themes where store_id = ${lojaId}`,
    st: await q`select data from store_settings where store_id = ${lojaId}`, c: await q`select * from categories where store_id = ${lojaId} order by id`,
    p: await q`select * from products where store_id = ${lojaId} order by id`, g: await q`select * from addon_groups where store_id = ${lojaId}`,
    b: await q`select * from banners where store_id = ${lojaId}`, z: await q`select * from delivery_zones where store_id = ${lojaId}`,
    zi: await q`select * from print_zones where store_id = ${lojaId}`, f: await q`select * from payment_methods where store_id = ${lojaId}`,
    r: await q`select count(*)::int as n from store_config_revisions where store_id = ${lojaId}`, pr: await q`select count(*)::int as n from publication_requests where store_id = ${lojaId}`,
  })));

  await env.plat((q) => q`update stores set status = 'producao' where id = ${lojaId}`); // um humano publicou
  const antes = await snap();

  const cardapio = { lojaId, categorias: [{ nome: 'Novo', produtos: [{ nome: 'X', preco: 1 }] }] };
  const tentativas: [string, Record<string, unknown>][] = [
    ['atualizar_loja', { lojaId, nome: 'Hackeada', phone: '1' }], ['atualizar_tema', { lojaId, primary: '#000000' }],
    ['salvar_categoria', { lojaId, name: 'Nova' }], ['salvar_categoria', { lojaId, id: cat, name: 'Alterada' }], ['remover_categoria', { lojaId, categoriaId: cat, confirmar: true }],
    ['salvar_produto', { lojaId, categoryId: cat, name: 'Novo', price: 1 }], ['salvar_produto', { lojaId, id: prod, categoryId: cat, name: 'Alterado', price: 999 }], ['remover_produto', { lojaId, produtoId: prod }],
    ['salvar_grupo_adicionais', { lojaId, name: 'Novo' }], ['salvar_grupo_adicionais', { lojaId, id: grupo, name: 'Alterado' }], ['remover_grupo_adicionais', { lojaId, grupoId: grupo }],
    ['salvar_banner', { lojaId, imageUrl: 'https://x.com/b.jpg' }], ['remover_banner', { lojaId, bannerId: banner }],
    ['salvar_zona_entrega', { lojaId, name: 'Nova', fee: 0, eta: 1 }], ['remover_zona_entrega', { lojaId, zonaId: zona }],
    ['salvar_zona_impressao', { lojaId, name: 'Nova' }], ['remover_zona_impressao', { lojaId, zonaId: zi }],
    ['salvar_forma_pagamento', { lojaId, name: 'Nova', type: 'cash' }], ['remover_forma_pagamento', { lojaId, formaId: forma }],
    ['importar_cardapio', cardapio], ['importar_cardapio', { ...cardapio, substituir: true, confirmarSubstituicao: true }], ['solicitar_publicacao', { lojaId }],
  ];
  // cobre TODAS as ferramentas de escrita (exceto criar_loja, que não opera sobre loja existente)
  const cobertas = new Set(tentativas.map(([n]) => n));
  for (const w of WRITE_TOOLS.filter((x) => x !== 'criar_loja')) assert.ok(cobertas.has(w), `ferramenta sem teste de bloqueio: ${w}`);

  for (const [nome, args] of tentativas) {
    const r = await mcp.call(nome, args);
    assert.equal(r.isError, true, `${nome} deveria ser bloqueada em produção`);
    assert.match(r.text, /produção|desenvolvimento/i, `${nome}: mensagem inesperada: ${r.text}`);
  }
  assert.equal(await snap(), antes, 'o banco mudou mesmo com todas as escritas bloqueadas');

  // leitura continua funcionando
  const v = await mcp.call('ver_loja', { lojaId });
  assert.equal(v.isError, false); assert.equal(v.data.loja.editavel, false); assert.equal(v.data.produtos.length, 1);
  const l = await mcp.call('listar_lojas', {});
  assert.equal(l.data.find((x: any) => x.id === lojaId).editavel, false);
  assert.equal((await mcp.call('validar_loja', { lojaId })).isError, false);
  assert.equal((await mcp.call('listar_assinaturas', {})).isError, false);
});

test('mesmo burlando o código, o banco bloqueia: SQL direto como mcp_agent em loja de produção falha', async () => {
  const lojaId = await mk('sql-direto');
  const cat = (await mcp.call('salvar_categoria', { lojaId, name: 'C' })).data.id as string;
  await env.plat((q) => q`update stores set status = 'producao' where id = ${lojaId}`);
  await assert.rejects(env.pools.mcp.begin((q) => q`insert into categories (store_id, tenant_id, name) select id, tenant_id, 'invasão' from stores where id = ${lojaId}`));
  const upd = await env.pools.mcp.begin((q) => q`update categories set name = 'hack' where id = ${cat} returning id`);
  assert.equal(upd.length, 0);
  const del = await env.pools.mcp.begin((q) => q`delete from categories where id = ${cat} returning id`);
  assert.equal(del.length, 0);
  await assert.rejects(env.pools.mcp.begin((q) => q`update stores set status = 'desenvolvimento' where id = ${lojaId}`));
  await assert.rejects(env.pools.mcp.begin((q) => q`select * from mcp_tokens`));
  await assert.rejects(env.pools.mcp.begin((q) => q`select * from platform_admins`));
  await assert.rejects(env.pools.mcp.begin((q) => q`select * from platform_settings`));
});

test('loja suspensa também é somente leitura', async () => {
  const lojaId = await mk('suspensa-x');
  await env.plat((q) => q`update stores set status = 'suspensa' where id = ${lojaId}`);
  const r = await mcp.call('salvar_categoria', { lojaId, name: 'x' });
  assert.equal(r.isError, true); assert.match(r.text, /suspensa/);
  assert.equal((await mcp.call('ver_loja', { lojaId })).isError, false);
});

test('loja arquivada some para o MCP', async () => {
  const lojaId = await mk('arquivada-x');
  await env.plat((q) => q`update stores set status = 'arquivada' where id = ${lojaId}`);
  assert.equal((await mcp.call('ver_loja', { lojaId })).isError, true);
  assert.equal((await mcp.call('listar_lojas', {})).data.some((l: any) => l.id === lojaId), false);
});

test('token limitado: só enxerga e altera as lojas liberadas e não cria lojas', async () => {
  const livre = await mk('livre-lim');
  const outra = await mk('outra-lim');
  const lim = await env.connect({ id: '22222222-2222-2222-2222-222222222222', storeLimit: [livre] });
  try {
    assert.equal((await lim.call('salvar_categoria', { lojaId: livre, name: 'ok' })).isError, false);
    const bloq = await lim.call('salvar_categoria', { lojaId: outra, name: 'nope' });
    assert.equal(bloq.isError, true); assert.match(bloq.text, /não tem acesso/);
    assert.equal((await lim.call('ver_loja', { lojaId: outra })).isError, true);
    assert.deepEqual((await lim.call('listar_lojas', {})).data.map((l: any) => l.id), [livre]);
    const nova = await lim.call('criar_loja', { slug: 'nova-lim', nome: 'Nova Loja', tenantName: 'Conta Nova' });
    assert.equal(nova.isError, true); assert.match(nova.text, /limitado/);
  } finally { await lim.close(); }
});

test('slug repetido e loja inexistente dão mensagens claras', async () => {
  assert.match((await mcp.call('criar_loja', { slug: 'pizzaria-mcp', nome: 'Outra', tenantName: 'Outra Conta' })).text, /Já existe/);
  assert.match((await mcp.call('ver_loja', { lojaId: uuid })).text, /não encontrad/);
  const inv = await mcp.call('criar_loja', { slug: 'Slug Inválido', nome: 'Nome Ok', tenantName: 'Conta Ok' });
  assert.equal(inv.isError, true); assert.match(inv.text, /slug|minúsculas/i);
});

test('autenticação do token: válido, revogado, vencido e formato errado', async () => {
  const tk = (suffix: string) => `pmcp_${suffix.padEnd(32, 'x')}`;
  const insert = (token: string, expires: string, revoked: boolean) => env.plat((q) => q`
    insert into mcp_tokens (name, token_hash, hint, expires_at, revoked_at) values ('t', ${hashToken(token)}, 'xxxx', ${expires}::timestamptz, ${revoked ? new Date().toISOString() : null})`);
  const future = new Date(Date.now() + 86_400_000).toISOString(), past = new Date(Date.now() - 86_400_000).toISOString();
  await insert(tk('valido'), future, false); await insert(tk('revogado'), future, true); await insert(tk('vencido'), past, false);

  const ok = await authenticate(env.db, `Bearer ${tk('valido')}`, '203.0.113.9');
  assert.ok(ok?.id); assert.equal(ok!.storeLimit, null);
  const [used] = await env.plat((q) => q`select last_used_at, last_ip::text as ip from mcp_tokens where id = ${ok!.id}`);
  assert.ok(used!.last_used_at); assert.match(used!.ip, /203\.0\.113\.9/);
  assert.equal(await authenticate(env.db, `Bearer ${tk('revogado')}`, ''), null);
  assert.equal(await authenticate(env.db, `Bearer ${tk('vencido')}`, ''), null);
  assert.equal(await authenticate(env.db, `Bearer ${tk('inexistente')}`, ''), null);
  assert.equal(await authenticate(env.db, 'Bearer qualquer-coisa', ''), null);
  assert.equal(await authenticate(env.db, undefined, ''), null);
});

test('limite de requisições por token', () => {
  let t = 0; const allow = rateLimiter(3, 1000, () => t);
  assert.deepEqual([allow('a'), allow('a'), allow('a'), allow('a')], [true, true, true, false]);
  assert.equal(allow('b'), true);
  t = 1500; assert.equal(allow('a'), true);
});
