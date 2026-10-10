import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@pediu/db';
import { generateToken, getOpenStatus, hashToken } from '@pediu/shared';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { changeOrderStatus, createStaffOrder, staffOrderIn } from './orders.js';
import { staffGuard } from './staff.js';
import { loadMenu } from './menu.js';
import { GatewayError } from './gateways.js';
import { gatewayReady, startOnlinePayment } from './payments.js';

/**
 * MCP da loja: deixa um assistente de IA (Claude, ChatGPT etc.) GERENCIAR OS PEDIDOS da própria loja.
 * Escopo básico 'orders': leitura SÓ do cardápio; escrita de pedidos (criar, mudar status, cancelar); sem leitura de pedidos ou clientes.
 * Escopos opcionais, que o lojista marca ao gerar o token: 'customers' (listar, criar, editar e excluir contatos de clientes)
 * e 'payments' (gerar o Pix de um pedido e o link de pagamento). Não altera cardápio, equipe nem configurações; não estorna.
 * O token é gerado pelo lojista em Loja › Avançado e vale só para a loja dele. Protocolo MCP "Streamable HTTP" sem estado,
 * implementado aqui mesmo (JSON-RPC) para rodar dentro da API, com o mesmo isolamento por loja (RLS) do resto do sistema.
 */
const PREFIX = 'pomc';
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_ACTIVE_TOKENS = 5;

export const STORE_MCP_TOOLS = [
  // ---- LEITURA (só o cardápio) ----
  { name: 'listar_colecoes', description: 'Somente leitura. Lista TODAS as coleções (categorias) do cardápio da loja, com a quantidade de produtos de cada uma.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'listar_produtos', description: 'Somente leitura. Lista TODOS os produtos do cardápio: nome, descrição, preço, disponibilidade, coleção, tempo de preparo, foto e adicionais. Pode filtrar por coleção e/ou por parte do nome.',
    inputSchema: { type: 'object', properties: {
      colecao: { type: 'string', description: 'nome da coleção (categoria) para filtrar' }, busca: { type: 'string', description: 'parte do nome do produto' },
      somente_disponiveis: { type: 'boolean', description: 'true = esconde os produtos indisponíveis no momento (padrão: mostra todos)' } }, additionalProperties: false } },
  { name: 'consultar_cardapio', description: 'Somente leitura. O cardápio completo de uma vez: todas as coleções com seus produtos e adicionais, mais as regiões de entrega (com taxa) e as formas de pagamento da loja.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  // ---- ESCRITA (pedidos). Não existe leitura de pedidos: o assistente não lista nem consulta pedidos nem dados de clientes ----
  { name: 'criar_pedido', description: 'Lança um pedido novo na loja (retirada/balcão, entrega ou mesa). NOME e TELEFONE do cliente são OBRIGATÓRIOS em qualquer tipo de pedido. Os itens e adicionais vão pelo NOME, como em listar_produtos. O pedido nasce como "novo", entra no fluxo normal da loja e fica A RECEBER: o pagamento é registrado pelo lojista no PDV. Devolve o número do pedido. Confirme os dados com o lojista antes de criar.',
    inputSchema: { type: 'object', properties: {
      tipo: { type: 'string', enum: ['retirada', 'delivery', 'mesa'] },
      cliente: { type: 'string', minLength: 2, maxLength: 80, description: 'OBRIGATÓRIO. Nome do cliente' },
      telefone: { type: 'string', description: 'OBRIGATÓRIO. Celular/WhatsApp do cliente com DDD, ex.: (16) 99999-0000' },
      endereco: { type: 'string', description: 'rua, número, bairro (obrigatório na entrega)' }, regiao: { type: 'string', description: 'nome da região de entrega (obrigatório na entrega)' },
      mesa: { type: 'integer', description: 'número da mesa (obrigatório quando tipo = mesa)' }, pessoas: { type: 'integer' },
      forma_pagamento: { type: 'string', description: 'nome da forma de pagamento combinada (opcional; só formas presenciais)' }, observacao: { type: 'string', maxLength: 300 },
      itens: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', properties: { produto: { type: 'string' }, quantidade: { type: 'integer', minimum: 1, maximum: 50 }, observacao: { type: 'string', maxLength: 200 }, adicionais: { type: 'array', items: { type: 'string' }, description: 'nomes das opções de adicional' } }, required: ['produto'], additionalProperties: false } } },
      required: ['tipo', 'cliente', 'telefone', 'itens'], additionalProperties: false } },
  { name: 'mudar_status', description: 'Avança um pedido pelo fluxo da loja: preparo (aceitar), pronto, saiu (saiu para entrega) ou entregue. Informe o número do pedido (o criar_pedido devolve o número; o lojista também pode informar). Só vale para a etapa seguinte permitida; o sistema recusa saltos inválidos.',
    inputSchema: { type: 'object', properties: { numero: { type: 'integer' }, para: { type: 'string', enum: ['preparo', 'pronto', 'saiu', 'entregue'] } }, required: ['numero', 'para'], additionalProperties: false } },
  { name: 'cancelar_pedido', description: 'Cancela um pedido que ainda não foi entregue. O motivo é obrigatório e fica registrado. Atenção: não devolve dinheiro (estorno é feito pelo lojista no painel).',
    inputSchema: { type: 'object', properties: { numero: { type: 'integer' }, motivo: { type: 'string', maxLength: 200 } }, required: ['numero', 'motivo'], additionalProperties: false } },
  // ---- CLIENTES (escopo 'customers', opcional) ----
  { name: 'listar_clientes', description: 'Lista os contatos de clientes da loja (id, nome, telefone e e-mail), dos mais recentes para os mais antigos. Pode filtrar por parte do nome, do telefone ou do e-mail. Use o id devolvido aqui em editar_cliente e excluir_cliente.',
    inputSchema: { type: 'object', properties: { busca: { type: 'string', description: 'parte do nome, do telefone ou do e-mail' }, limite: { type: 'integer', minimum: 1, maximum: 100, description: 'quantos devolver (padrão 30)' } }, additionalProperties: false } },
  { name: 'criar_cliente', description: 'Cadastra um contato de cliente na loja. NOME e TELEFONE são obrigatórios; o e-mail é opcional. Recusa se já existir um cliente com o mesmo telefone ou e-mail (nesse caso use editar_cliente).',
    inputSchema: { type: 'object', properties: { nome: { type: 'string', minLength: 2, maxLength: 80 }, telefone: { type: 'string', description: 'celular/WhatsApp com DDD, ex.: (16) 99999-0000' }, email: { type: 'string', description: 'opcional' } }, required: ['nome', 'telefone'], additionalProperties: false } },
  { name: 'editar_cliente', description: 'Altera o nome, o telefone e/ou o e-mail de um contato (informe o id de listar_clientes e só os campos que mudam). O e-mail de quem já tem conta com senha ou e-mail confirmado não pode ser trocado por aqui. Confirme com o lojista antes de alterar.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'id do cliente (de listar_clientes)' }, nome: { type: 'string', minLength: 2, maxLength: 80 }, telefone: { type: 'string' }, email: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'excluir_cliente', description: 'Exclui DE VEZ um contato de cliente (informe o id de listar_clientes). Apaga também os endereços salvos e a conta dele na loja; os pedidos já feitos continuam no histórico, sem o vínculo. Não tem como desfazer: confirme com o lojista antes.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'id do cliente (de listar_clientes)' } }, required: ['id'], additionalProperties: false } },
  // ---- PAGAMENTOS (escopo 'payments', opcional). Só cobra: não estorna nem marca pedido como pago ----
  { name: 'gerar_pix', description: 'Gera a cobrança Pix de um pedido ainda não pago e devolve o código "copia e cola" para enviar ao cliente, com o valor e a validade (15 minutos). A loja precisa ter Mercado Pago ou Sicoob conectado. Quando o cliente paga, o pedido é marcado como pago sozinho. Se já houver um Pix válido para o pedido, devolve o mesmo. Se o pedido for cancelado, o Pix deixa de valer.',
    inputSchema: { type: 'object', properties: { numero: { type: 'integer', description: 'número do pedido' } }, required: ['numero'], additionalProperties: false } },
  { name: 'link_pagamento', description: 'Devolve um link para enviar ao cliente pagar o pedido com CARTÃO online: ele abre a página da loja, digita o cartão (Mercado Pago) e vê a confirmação na hora; o pedido é marcado como pago sozinho. Vale 60 minutos; depois gere outro. Se já houver um Pix válido do pedido (gerar_pix), a página mostra o Pix também. Se a loja não tiver cartão online conectado, o link abre só o Pix (15 minutos).',
    inputSchema: { type: 'object', properties: { numero: { type: 'integer', description: 'número do pedido' } }, required: ['numero'], additionalProperties: false } },
] as const;

export const STORE_MCP_SCOPES = ['orders', 'customers', 'payments'] as const;
export type StoreMcpScope = (typeof STORE_MCP_SCOPES)[number];
/** Escopo de cada ferramenta opcional; o que não está aqui é do escopo básico 'orders', que todo token tem. */
const TOOL_SCOPE: Record<string, StoreMcpScope> = { listar_clientes: 'customers', criar_cliente: 'customers', editar_cliente: 'customers', excluir_cliente: 'customers', gerar_pix: 'payments', link_pagamento: 'payments' };
export const storeMcpScopeOf = (tool: string): StoreMcpScope => TOOL_SCOPE[tool] ?? 'orders';
const SCOPE_LABEL: Record<StoreMcpScope, string> = { orders: 'pedidos', customers: 'clientes', payments: 'pagamentos' };

interface Caller { tokenId: string; tokenName: string; storeId: string; tenantId: string; ip: string; scopes: string[] }
const money = (c: number) => `R$ ${(Number(c) / 100).toFixed(2).replace('.', ',')}`;

const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Acha um item pelo nome (sem ligar para acento/maiúscula): exato primeiro, depois "contém"; ambíguo ou inexistente vira erro com as opções. */
function byName<T extends { name: string }>(items: T[], wanted: string, what: string): { item: T } | { error: string } {
  const w = norm(wanted); if (!w) return { error: `Informe ${what}.` };
  const exact = items.filter((i) => norm(i.name) === w); const part = exact.length ? exact : items.filter((i) => norm(i.name).includes(w));
  if (part.length === 1) return { item: part[0]! };
  const list = (part.length ? part : items).slice(0, 12).map((i) => `"${i.name}"`).join(', ');
  return { error: part.length ? `"${wanted}" é ambíguo para ${what}. Qual destes? ${list}` : `Não encontrei ${what} "${wanted}". Opções: ${list || '(nenhuma cadastrada)'}` };
}

/** Telefone brasileiro só com dígitos (DDD + número): aceita "(16) 99999-0000", "+55 16 99999-0000", "16999990000"; fixo (10) ou celular (11). */
export function normPhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (Number(d.slice(0, 2)) < 11) return null;                 // DDD inválido
  if (d.length === 11 && d[2] !== '9') return null;            // celular começa com 9
  return d;
}

const nomeCliente = z.string({ required_error: 'Informe o nome do cliente (obrigatório).' }).trim().min(2, 'Informe o nome do cliente (obrigatório).').max(80).refine((v) => /\p{L}{2}/u.test(v), 'O nome do cliente precisa ter letras.');
const emailCliente = z.string().trim().toLowerCase().min(5).max(160).email('E-mail inválido.');
/** Contato sem e-mail: a tabela exige um e-mail único por loja, então guardamos um endereço reservado (.invalid nunca recebe mensagem) e o escondemos na saída. */
const NO_EMAIL = '@sem-email.invalid';
const like = (v: string) => `%${v.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const shapeCustomer = (r: { id: string; name: string; phone: string; email: string; created_at: string | Date }) => ({ id: r.id, nome: r.name, telefone: r.phone || undefined, email: r.email.endsWith(NO_EMAIL) ? undefined : r.email, cadastrado_em: new Date(r.created_at).toISOString() });

const args = {
  produtos: z.object({ colecao: z.string().trim().max(80).optional(), busca: z.string().trim().max(60).optional(), somente_disponiveis: z.boolean().default(false) }),
  criar: z.object({
    tipo: z.enum(['retirada', 'delivery', 'mesa']),
    cliente: z.string({ required_error: 'Informe o nome do cliente (obrigatório).' }).trim().min(2, 'Informe o nome do cliente (obrigatório).').max(80).refine((v) => /\p{L}{2}/u.test(v), 'O nome do cliente precisa ter letras.'),
    telefone: z.string({ required_error: 'Informe o telefone do cliente (obrigatório).' }).trim().min(1, 'Informe o telefone do cliente (obrigatório).').max(25),
    endereco: z.string().trim().max(200).default(''),
    regiao: z.string().trim().max(80).optional(), mesa: z.number().int().min(1).max(500).optional(), pessoas: z.number().int().min(1).max(99).optional(), forma_pagamento: z.string().trim().max(60).optional(), observacao: z.string().trim().max(300).default(''),
    itens: z.array(z.object({ produto: z.string().trim().min(1).max(120), quantidade: z.number().int().min(1).max(50).default(1), observacao: z.string().trim().max(200).default(''), adicionais: z.array(z.string().trim().min(1).max(80)).max(30).default([]) })).min(1).max(30),
  }),
  numero: z.object({ numero: z.number().int().min(1).max(10_000_000) }),
  mudar: z.object({ numero: z.number().int().min(1).max(10_000_000), para: z.enum(['preparo', 'pronto', 'saiu', 'entregue']) }),
  cancelar: z.object({ numero: z.number().int().min(1).max(10_000_000), motivo: z.string().trim().min(3, 'Informe o motivo do cancelamento.').max(200) }),
  clientes: z.object({ busca: z.string().trim().max(80).optional(), limite: z.number().int().min(1).max(100).default(30) }),
  criarCliente: z.object({ nome: nomeCliente, telefone: z.string({ required_error: 'Informe o telefone do cliente (obrigatório).' }).trim().min(1, 'Informe o telefone do cliente (obrigatório).').max(25), email: emailCliente.optional() }),
  editarCliente: z.object({ id: z.string().uuid('Informe o id do cliente (de listar_clientes).'), nome: nomeCliente.optional(), telefone: z.string().trim().min(1).max(25).optional(), email: emailCliente.optional() }),
  idCliente: z.object({ id: z.string().uuid('Informe o id do cliente (de listar_clientes).') }),
};

/** Formato do cardápio que o MCP lê (loadMenu devolve linhas soltas do banco). */
interface MenuData {
  categories: { id: string; name: string }[];
  products: { id: string; category_id: string; name: string; description: string; price: number; available: boolean; group_ids: string[]; prep_time?: number; image_url?: string }[];
  groups: { id: string; name: string; min: number; max: number; required: boolean; addons: { id: string; name: string; price: number }[] }[];
  zones: { id: string; name: string; fee: number; eta: number }[];
}
type Out = { text: string; error?: boolean };
const ok = (data: unknown): Out => ({ text: JSON.stringify(data, null, 2) });
const bad = (msg: string): Out => ({ text: msg, error: true });

type MenuRead = MenuData & { pays: { id: string; name: string; type: string; online: boolean }[]; open: { open: boolean; label: string } };
/** Lê o cardápio da loja (somente leitura): coleções, produtos, adicionais, regiões, formas de pagamento e se está aberta. */
async function readMenu(ctx: Ctx, c: Caller): Promise<MenuRead> {
  return withTenant(ctx.pools, c.tenantId, async (q) => {
    const m = (await loadMenu(q, c.storeId)) as unknown as MenuData;
    const [pays, cfg] = await Promise.all([q`select id, name, type, online from payment_methods where store_id = ${c.storeId} and active order by sort`, q`select data from store_settings where store_id = ${c.storeId}`]);
    return { ...m, pays: pays as unknown as MenuRead['pays'], open: getOpenStatus(((cfg[0]?.data ?? {}) as Record<string, any>), ctx.clock.now()) };
  });
}
const shapeProduct = (p: MenuData['products'][number], m: MenuData, cat: { name: string }) => ({
  nome: p.name, colecao: cat.name, descricao: p.description || undefined, preco: money(Math.round(Number(p.price) * 100)), disponivel: !!p.available, tempo_preparo_min: p.prep_time || undefined, foto: p.image_url || undefined,
  adicionais: p.group_ids.map((id) => m.groups.find((g) => g.id === id)).filter((g) => !!g && g.addons.length > 0).map((g) => ({ grupo: g!.name, obrigatorio: !!g!.required, minimo: g!.min, maximo: g!.max, opcoes: g!.addons.map((x) => ({ nome: x.name, preco_extra: money(Math.round(x.price * 100)) })) })),
});

async function callTool(ctx: Ctx, c: Caller, name: string, raw: unknown): Promise<Out> {
  const find = (numero: number) => withTenant(ctx.pools, c.tenantId, async (q) => (await q`select id, number, status, type from orders where store_id = ${c.storeId} and number = ${numero}`)[0]);
  const actor = { tenantId: c.tenantId, storeId: c.storeId, staffId: null, actorId: `mcp:${c.tokenId}`, role: 'gerente' as const, ip: c.ip };

  const scope = storeMcpScopeOf(name);
  if (STORE_MCP_TOOLS.some((t) => t.name === name) && !c.scopes.includes(scope)) return bad(`Este token não tem acesso a ${SCOPE_LABEL[scope]}. O lojista libera gerando um token novo com essa permissão em Loja › Avançado › MCP da loja.`);
  const log = (action: string, meta: Record<string, unknown>) => (q: Parameters<typeof audit>[0]) => audit(q, { actorKind: 'staff', actorId: actor.actorId, tenantId: c.tenantId, storeId: c.storeId, action, ip: c.ip, meta: { ...meta, token: c.tokenName } });

  switch (name) {
    case 'listar_colecoes': {
      const m = await readMenu(ctx, c);
      return ok({ total: m.categories.length, colecoes: m.categories.map((cat) => { const ps = m.products.filter((p) => p.category_id === cat.id); return { nome: cat.name, produtos: ps.length, disponiveis: ps.filter((p) => p.available).length }; }) });
    }
    case 'listar_produtos': {
      const a = args.produtos.parse(raw ?? {});
      const m = await readMenu(ctx, c);
      let cats = m.categories;
      if (a.colecao) { const f = byName(m.categories, a.colecao, 'a coleção'); if ('error' in f) return bad(f.error); cats = [f.item]; }
      const w = a.busca ? norm(a.busca) : '';
      const rows = m.products.filter((p) => cats.some((cat) => cat.id === p.category_id) && (!a.somente_disponiveis || p.available) && (!w || norm(p.name).includes(w)));
      return ok({ total: rows.length, produtos: rows.map((p) => shapeProduct(p, m, cats.length === 1 ? cats[0]! : m.categories.find((cat) => cat.id === p.category_id)!)) });
    }
    case 'consultar_cardapio': {
      const m = await readMenu(ctx, c);
      return ok({
        loja: { aberta: m.open.open, situacao: m.open.label },
        colecoes: m.categories.map((cat) => ({ nome: cat.name, produtos: m.products.filter((p) => p.category_id === cat.id).map((p) => shapeProduct(p, m, cat)) })),
        regioes_de_entrega: m.zones.map((z) => ({ nome: z.name, taxa: money(Math.round(z.fee * 100)), tempo_min: z.eta })),
        formas_de_pagamento: m.pays.map((p) => ({ nome: p.name, tipo: p.type, online: !!p.online })),
      });
    }
    case 'criar_pedido': {
      const a = args.criar.parse(raw ?? {});
      const phone = normPhone(a.telefone);
      if (!phone) return bad('Telefone inválido: informe DDD + número do cliente, ex.: (16) 99999-0000.');
      const ref = await withTenant(ctx.pools, c.tenantId, async (q) => ({ m: (await loadMenu(q, c.storeId)) as unknown as MenuData, pays: await q`select id, name, online from payment_methods where store_id = ${c.storeId} and active` }));
      const groups = new Map(ref.m.groups.map((g) => [g.id, g]));
      const lines: { productId: string; qty: number; note: string; addons: { groupId: string; addonIds: string[] }[] }[] = [];
      for (const it of a.itens) {
        const pr = byName(ref.m.products.filter((p) => p.available), it.produto, 'o produto');
        if ('error' in pr) return bad(pr.error);
        const opts = pr.item.group_ids.flatMap((gid) => (groups.get(gid)?.addons ?? []).map((ad) => ({ name: ad.name, id: ad.id, groupId: gid, groupName: groups.get(gid)!.name })));
        const byGroup = new Map<string, string[]>();
        for (const nm of it.adicionais) {
          const ad = byName(opts, nm, `o adicional de "${pr.item.name}"`);
          if ('error' in ad) return bad(ad.error);
          byGroup.set(ad.item.groupId, [...(byGroup.get(ad.item.groupId) ?? []), ad.item.id]);
        }
        lines.push({ productId: pr.item.id, qty: it.quantidade, note: it.observacao, addons: [...byGroup.entries()].map(([groupId, addonIds]) => ({ groupId, addonIds })) });
      }
      let zoneId: string | undefined;
      if (a.tipo === 'delivery') {
        if (!a.regiao) return bad(`Informe a região de entrega. Opções: ${ref.m.zones.map((z) => `"${z.name}"`).join(', ') || '(nenhuma cadastrada)'}`);
        const z = byName(ref.m.zones, a.regiao, 'a região de entrega');
        if ('error' in z) return bad(z.error);
        zoneId = z.item.id;
      }
      let paymentId: string | undefined;
      if (a.forma_pagamento) {
        const pm = byName(ref.pays as { id: string; name: string; online: boolean }[], a.forma_pagamento, 'a forma de pagamento');
        if ('error' in pm) return bad(pm.error);
        if (pm.item.online) return bad(`"${pm.item.name}" é pagamento online (Pix/cartão pelo site) e não pode ser usado por aqui. Escolha uma forma presencial ou deixe sem forma de pagamento.`);
        paymentId = pm.item.id;
      }
      const input = staffOrderIn.parse({ type: a.tipo, customerName: a.cliente, phone, address: a.endereco, zoneId, table: a.mesa, guests: a.pessoas, note: a.observacao, paymentId, receiveNow: false, lines });
      const r = await createStaffOrder(ctx, { tenantId: c.tenantId, storeId: c.storeId, staffId: null, actorId: actor.actorId }, input);
      if (!r.ok) return bad(r.message);
      return ok({ ok: true, numero: r.number, total: money(r.totalCents), status: 'novo', mensagem: `Pedido #${r.number} criado (${money(r.totalCents)}). Já entrou no fluxo da loja. O pagamento fica A RECEBER: o lojista registra no PDV.` });
    }
    case 'mudar_status': {
      const a = args.mudar.parse(raw ?? {}); const o = await find(a.numero);
      if (!o) return bad(`Pedido #${a.numero} não encontrado nesta loja.`);
      const r = await changeOrderStatus(ctx, actor, o.id as string, a.para);
      return r.ok ? ok({ ok: true, mensagem: `Pedido #${a.numero} agora está "${r.status}".`, aviso: r.warning }) : bad(r.message);
    }
    case 'cancelar_pedido': {
      const a = args.cancelar.parse(raw ?? {}); const o = await find(a.numero);
      if (!o) return bad(`Pedido #${a.numero} não encontrado nesta loja.`);
      const r = await changeOrderStatus(ctx, actor, o.id as string, 'cancelado', `${a.motivo} (via MCP)`);
      return r.ok ? ok({ ok: true, mensagem: `Pedido #${a.numero} cancelado.`, aviso: r.warning ?? 'Se o cliente já pagou online, o estorno é feito pelo lojista no painel.' }) : bad(r.message);
    }
    case 'listar_clientes': {
      const a = args.clientes.parse(raw ?? {}); const pat = a.busca ? like(a.busca) : null; const digits = (a.busca ?? '').replace(/\D/g, ''); const dpat = digits.length >= 4 ? `%${digits}%` : null;
      return withTenant(ctx.pools, c.tenantId, async (q) => {
        const rows = await q`select id, name, phone, email, created_at from store_customers where store_id = ${c.storeId}
          and (${pat}::text is null or name ilike ${pat} or email ilike ${pat} or phone ilike ${pat} or (${dpat}::text is not null and regexp_replace(phone, '[^0-9]', '', 'g') like ${dpat}))
          order by created_at desc limit ${a.limite}`;
        return ok({ total: rows.length, clientes: (rows as unknown as Parameters<typeof shapeCustomer>[0][]).map(shapeCustomer) });
      });
    }
    case 'criar_cliente': {
      const a = args.criarCliente.parse(raw ?? {}); const phone = normPhone(a.telefone);
      if (!phone) return bad('Telefone inválido: informe DDD + número do cliente, ex.: (16) 99999-0000.');
      const email = a.email ?? `tel${phone}${NO_EMAIL}`;
      return withTenant(ctx.pools, c.tenantId, async (q) => {
        const [dup] = await q`select id, name from store_customers where store_id = ${c.storeId} and (email = ${email} or regexp_replace(phone, '[^0-9]', '', 'g') = ${phone}) limit 1`;
        if (dup) return bad(`Já existe um cliente com esse telefone ou e-mail: "${dup.name}" (id ${dup.id}). Use editar_cliente para alterar.`);
        const [r] = await q`insert into store_customers (store_id, tenant_id, email, name, phone) values (${c.storeId}, ${c.tenantId}, ${email}, ${a.nome}, ${phone}) returning id, name, phone, email, created_at`;
        await log('store_mcp.customer_created', { customerId: r!.id })(q);
        return ok({ ok: true, cliente: shapeCustomer(r as unknown as Parameters<typeof shapeCustomer>[0]), mensagem: `Cliente "${a.nome}" cadastrado.` });
      });
    }
    case 'editar_cliente': {
      const a = args.editarCliente.parse(raw ?? {});
      if (a.nome === undefined && a.telefone === undefined && a.email === undefined) return bad('Informe o que mudar: nome, telefone e/ou email.');
      const phone = a.telefone === undefined ? undefined : normPhone(a.telefone);
      if (phone === null) return bad('Telefone inválido: informe DDD + número do cliente, ex.: (16) 99999-0000.');
      return withTenant(ctx.pools, c.tenantId, async (q) => {
        const [cur] = await q`select id, email, password_hash is not null as has_password, email_verified_at from store_customers where id = ${a.id} and store_id = ${c.storeId} for update`;
        if (!cur) return bad('Cliente não encontrado nesta loja. Confira o id em listar_clientes.');
        if (a.email && a.email !== cur.email && (cur.has_password || cur.email_verified_at)) return bad('Este cliente já tem conta na loja (senha ou e-mail confirmado): o e-mail é o login dele e só ele pode trocar. Nome e telefone podem ser alterados.');
        const [dup] = await q`select id, name from store_customers where store_id = ${c.storeId} and id <> ${a.id}
          and ((${a.email ?? null}::text is not null and email = ${a.email ?? null}) or (${phone ?? null}::text is not null and regexp_replace(phone, '[^0-9]', '', 'g') = ${phone ?? null})) limit 1`;
        if (dup) return bad(`Outro cliente já usa esse telefone ou e-mail: "${dup.name}" (id ${dup.id}).`);
        const [r] = await q`update store_customers set name = coalesce(${a.nome ?? null}, name), phone = coalesce(${phone ?? null}, phone), email = coalesce(${a.email ?? null}, email)
          where id = ${a.id} and store_id = ${c.storeId} returning id, name, phone, email, created_at`;
        await log('store_mcp.customer_updated', { customerId: a.id, fields: (['nome', 'telefone', 'email'] as const).filter((k) => a[k] !== undefined) })(q);
        return ok({ ok: true, cliente: shapeCustomer(r as unknown as Parameters<typeof shapeCustomer>[0]), mensagem: 'Cliente atualizado.' });
      });
    }
    case 'excluir_cliente': {
      const a = args.idCliente.parse(raw ?? {});
      return withTenant(ctx.pools, c.tenantId, async (q) => {
        const [r] = await q`select name from app.store_mcp_delete_customer(${c.storeId}, ${a.id})`;      // app_api não tem delete na tabela: um cliente por vez, pela função
        if (!r) return bad('Cliente não encontrado nesta loja. Confira o id em listar_clientes.');
        await log('store_mcp.customer_deleted', { customerId: a.id, name: r.name })(q);
        return ok({ ok: true, mensagem: `Cliente "${r.name}" excluído. Os pedidos dele continuam no histórico da loja.` });
      });
    }
    case 'gerar_pix': {
      const a = args.numero.parse(raw ?? {});
      const r = await pixForOrder(ctx, c, a.numero);
      if ('error' in r) return bad(r.error);
      await withTenant(ctx.pools, c.tenantId, log(r.reused ? 'store_mcp.pix_reused' : 'store_mcp.pix_created', { number: a.numero, paymentId: r.paymentId, tool: name }));
      return ok({ ok: true, numero: a.numero, valor: money(r.amountCents), pix_copia_e_cola: r.qrCode, expira_em: r.expiresAt, mensagem: `Pix do pedido #${a.numero} gerado (${money(r.amountCents)}). Envie o código copia e cola ao cliente; quando ele pagar, o pedido é marcado como pago sozinho. Para pagar com cartão, use link_pagamento.` });
    }
    case 'link_pagamento': {
      const a = args.numero.parse(raw ?? {});
      const r = await payLinkForOrder(ctx, c, a.numero);
      if ('error' in r) return bad(r.error);
      await withTenant(ctx.pools, c.tenantId, log(r.reused ? 'store_mcp.pay_link_reused' : 'store_mcp.pay_link_created', { number: a.numero, paymentId: r.paymentId, methods: r.methods, tool: name }));
      return ok({ ok: true, numero: a.numero, valor: money(r.amountCents), link: r.link, formas_de_pagamento: r.methods, expira_em: r.expiresAt,
        mensagem: r.methods.includes('cartão') ? `Envie o link ao cliente: ele abre a página da loja e paga o pedido #${a.numero} com cartão${r.methods.includes('pix') ? ' ou Pix' : ''}. O pedido é marcado como pago sozinho.`
          : `Envie o link ao cliente: ele abre o Pix do pedido #${a.numero}. A loja não tem cartão online conectado (Painel › Integrações › Mercado Pago, com a chave pública), então o link só oferece Pix.` });
    }
    default: return bad(`Ferramenta desconhecida: ${name}`);
  }
}

const NO_LINK = 'A loja ainda não tem um endereço verificado para montar o link. Use gerar_pix e envie o código copia e cola.';
type Charge = { o: Record<string, any>; pend: Record<string, any>[]; pixGateway: 'mercadopago' | 'sicoob' | null; cardReady: boolean; link?: string };
/** Pedido que ainda pode ser cobrado, com as cobranças abertas, os gateways prontos e o endereço da página de pagamento. */
async function chargeable(ctx: Ctx, c: Caller, numero: number): Promise<Charge | { error: string }> {
  const ref = await withTenant(ctx.pools, c.tenantId, async (q) => {
    const [o] = await q`select o.id, o.number, o.status, o.paid, o.total_cents, o.customer_name, o.tracking_token, s.slug from orders o join stores s on s.id = o.store_id where o.store_id = ${c.storeId} and o.number = ${numero}`;
    if (!o) return null;
    const pend = await q`select id, method, qr_code, expires_at, amount_cents from order_payments where order_id = ${o.id} and store_id = ${c.storeId} and status = 'pendente' order by created_at desc limit 10`;
    const pixGateway = (await gatewayReady(q, c.storeId, 'mercadopago')) ? 'mercadopago' as const : (await gatewayReady(q, c.storeId, 'sicoob')) ? 'sicoob' as const : null;
    const cardReady = await gatewayReady(q, c.storeId, 'mercadopago', 'card');
    const doms = await q`select hostname, kind from store_domains where store_id = ${c.storeId} and verified_at is not null order by created_at`;
    // endereço que o cliente consegue abrir: domínio próprio da loja; senão o domínio pelo qual as lojas abrem hoje (PREVIEW_DOMAIN); senão o subdomínio oficial
    const custom = doms.find((x) => x.kind === 'custom')?.hostname as string | undefined; const preview = process.env.PREVIEW_DOMAIN;
    const host = custom ?? (preview ? `${o.slug}.${preview}` : (doms[0]?.hostname as string | undefined));
    return { o, pend: [...pend], pixGateway, cardReady, link: host ? `https://${host}/pagar/${o.tracking_token}` : undefined };
  });
  if (!ref) return { error: `Pedido #${numero} não encontrado nesta loja.` };
  if (ref.o.paid) return { error: `O pedido #${numero} já está pago.` };
  if (ref.o.status === 'cancelado') return { error: `O pedido #${numero} está cancelado.` };
  if (!(Number(ref.o.total_cents) > 0)) return { error: `O pedido #${numero} não tem valor a cobrar.` };
  return ref;
}
/** Cobrança aberta que ainda vale por pelo menos `marginMs` e bate com o total atual do pedido. */
const livePayment = (ctx: Ctx, r: Charge, method: 'pix' | 'card', marginMs: number) =>
  r.pend.find((p) => p.method === method && (method === 'card' || p.qr_code) && Number(p.amount_cents) === Number(r.o.total_cents) && new Date(p.expires_at).getTime() > ctx.clock.now().getTime() + marginMs);
const startFor = (ctx: Ctx, c: Caller, r: Charge, method: 'pix' | 'card', gateway: 'mercadopago' | 'sicoob') =>
  startOnlinePayment(ctx, { tenantId: c.tenantId, storeId: c.storeId, orderId: r.o.id as string, orderNumber: r.o.number as number, amountCents: Number(r.o.total_cents), slug: r.o.slug as string, method, gateway, customer: { name: (r.o.customer_name as string) || 'Cliente' } });

type PixOut = { paymentId: string; qrCode: string; expiresAt: string; amountCents: number; reused: boolean } | { error: string };
/** Pix de um pedido ainda não pago: reaproveita a cobrança pendente que ainda vale (não gera duas) ou cria outra no gateway conectado da loja. */
async function pixForOrder(ctx: Ctx, c: Caller, numero: number, known?: Charge): Promise<PixOut> {
  const r = known ?? await chargeable(ctx, c, numero);
  if ('error' in r) return r;
  const amountCents = Number(r.o.total_cents);
  const live = livePayment(ctx, r, 'pix', 120_000);
  if (live) return { paymentId: live.id as string, qrCode: live.qr_code as string, expiresAt: new Date(live.expires_at).toISOString(), amountCents, reused: true };
  if (!r.pixGateway) return { error: 'A loja não tem Pix online conectado. O lojista conecta o Mercado Pago ou o Sicoob em Painel › Integrações.' };
  try {
    const p = await startFor(ctx, c, r, 'pix', r.pixGateway);
    if (!p.qrCode) return { error: 'O gateway não devolveu o código Pix. Tente de novo em instantes.' };
    return { paymentId: p.id, qrCode: p.qrCode, expiresAt: p.expiresAt, amountCents, reused: false };
  } catch (e) { if (e instanceof GatewayError) return { error: `Não foi possível gerar o Pix agora: ${e.message}` }; throw e; }
}

type LinkOut = { paymentId: string; link: string; methods: string[]; expiresAt: string; amountCents: number; reused: boolean } | { error: string };
/** Link de pagamento: abre o cartão online (Mercado Pago) na página da loja; se a loja não tiver cartão online, cai no Pix. Um Pix já gerado para o pedido aparece junto. */
async function payLinkForOrder(ctx: Ctx, c: Caller, numero: number): Promise<LinkOut> {
  const r = await chargeable(ctx, c, numero);
  if ('error' in r) return r;
  if (!r.link) return { error: NO_LINK };                                                              // sem endereço não há link: não cria cobrança à toa
  const amountCents = Number(r.o.total_cents);
  if (!r.cardReady) {
    const pix = await pixForOrder(ctx, c, numero, r);
    return 'error' in pix ? pix : { paymentId: pix.paymentId, link: r.link, methods: ['pix'], expiresAt: pix.expiresAt, amountCents, reused: pix.reused };
  }
  const methods = ['cartão', ...(livePayment(ctx, r, 'pix', 120_000) ? ['pix'] : [])];
  const live = livePayment(ctx, r, 'card', 5 * 60_000);
  if (live) return { paymentId: live.id as string, link: r.link, methods, expiresAt: new Date(live.expires_at).toISOString(), amountCents, reused: true };
  try {
    const p = await startFor(ctx, c, r, 'card', 'mercadopago');
    return { paymentId: p.id, link: r.link, methods, expiresAt: p.expiresAt, amountCents, reused: false };
  } catch (e) { if (e instanceof GatewayError) return { error: `Não foi possível abrir o pagamento por cartão agora: ${e.message}` }; throw e; }
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const rpcError = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handleRpc(ctx: Ctx, c: Caller, m: Rpc): Promise<unknown | null> {
  const isNotification = m.id === undefined;
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return isNotification ? null : rpcError(m.id, -32600, 'Requisição JSON-RPC inválida.');
  if (isNotification) return null;                                                              // ex.: notifications/initialized
  switch (m.method) {
    case 'initialize': {
      const asked = String((m.params as { protocolVersion?: unknown } | undefined)?.protocolVersion ?? '');
      return { jsonrpc: '2.0', id: m.id, result: { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1], capabilities: { tools: {} }, serverInfo: { name: 'pediu-pedidos', version: '1.0.0' },
        instructions: 'Você trabalha para UMA loja de delivery. LEITURA: somente o cardápio (listar_colecoes, listar_produtos, consultar_cardapio). ESCRITA: pedidos (criar_pedido, mudar_status, cancelar_pedido). '
          + (c.scopes.includes('customers') ? 'Você NÃO consegue ler nem listar pedidos existentes. CLIENTES: você pode listar, criar, editar e excluir contatos de clientes (listar_clientes, criar_cliente, editar_cliente, excluir_cliente); são dados pessoais: use só para o que o lojista pedir e confirme com ele antes de editar ou excluir. ' : 'Você NÃO consegue ler nem listar pedidos existentes nem dados de clientes. ')
          + (c.scopes.includes('payments') ? 'PAGAMENTOS: você pode gerar o Pix de um pedido (gerar_pix, devolve o copia e cola) e o link para o cliente pagar com cartão online (link_pagamento); você não estorna nem marca pedido como pago. ' : '')
          + 'Para criar um pedido é OBRIGATÓRIO informar o nome e o telefone do cliente. Use os nomes exatos do cardápio. Confirme todos os dados com o lojista antes de criar ou cancelar um pedido.' } };
    }
    case 'ping': return { jsonrpc: '2.0', id: m.id, result: {} };
    case 'tools/list': return { jsonrpc: '2.0', id: m.id, result: { tools: STORE_MCP_TOOLS.filter((t) => c.scopes.includes(storeMcpScopeOf(t.name))) } };
    case 'tools/call': {
      const p = m.params as { name?: unknown; arguments?: unknown } | undefined;
      if (typeof p?.name !== 'string') return rpcError(m.id, -32602, 'Informe o nome da ferramenta.');
      try {
        const r = await callTool(ctx, c, p.name, p.arguments);
        return { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: r.text }], ...(r.error ? { isError: true } : {}) } };
      } catch (e) {
        if (e instanceof z.ZodError) return { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `Parâmetros inválidos: ${e.issues.map((i) => `${i.path.join('.') || 'valor'}: ${i.message}`).join('; ')}` }], isError: true } };
        ctx.telemetry?.log({ level: 'error', service: 'api', event: 'store_mcp.tool_failed', message: String((e as Error).message).slice(0, 300), storeId: c.storeId, tenantId: c.tenantId });
        return { jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'Não foi possível concluir agora. Tente de novo em instantes.' }], isError: true } };
      }
    }
    default: return rpcError(m.id, -32601, `Método não suportado: ${m.method}`);
  }
}

export function storeMcpRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---------- painel do lojista: gerar e revogar tokens ----------
  const adm = staffGuard(ctx, 'admin.loja');
  const M = '/v1/staff/mcp';

  app.get(M, { preHandler: adm }, async (req) => {
    const s = req.staff!;
    const tokens = await withTenant(ctx.pools, s.tenantId, (q) => q`select id, name, scopes, created_at, last_used_at, revoked_at, expires_at from store_mcp_tokens where store_id = ${s.storeId} order by created_at desc limit 50`);
    return { tokens, tools: STORE_MCP_TOOLS.map((t) => ({ name: t.name, description: t.description, scope: storeMcpScopeOf(t.name) })), maxActive: MAX_ACTIVE_TOKENS };
  });

  app.post(`${M}/tokens`, { preHandler: adm, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const s = req.staff!;
    const b = parse(z.object({ name: z.string().trim().min(1, 'Dê um nome ao token (ex.: Claude da loja).').max(60), expiresInDays: z.number().int().min(1).max(730).nullable().default(null),
      scopes: z.array(z.enum(['customers', 'payments'])).max(2).default([]) }), req.body, reply); if (!b) return;
    const scopes = STORE_MCP_SCOPES.filter((x) => x === 'orders' || b.scopes.includes(x));          // 'orders' é o básico: todo token tem
    const t = generateToken(PREFIX);
    const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [n] = await q`select count(*)::int as n from store_mcp_tokens where store_id = ${s.storeId} and revoked_at is null and (expires_at is null or expires_at > now())`;
      if ((n?.n ?? 0) >= MAX_ACTIVE_TOKENS) return 'limit' as const;
      const exp = b.expiresInDays ? new Date(ctx.clock.now().getTime() + b.expiresInDays * 86_400_000).toISOString() : null;
      const [r] = await q`insert into store_mcp_tokens (store_id, tenant_id, name, token_hash, scopes, created_by, expires_at) values (${s.storeId}, ${s.tenantId}, ${b.name}, ${t.hash}, ${scopes as unknown as string[]}, ${s.staffId}::uuid, ${exp}) returning id, name, scopes, created_at, expires_at`;
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'store_mcp.token_created', ip: req.ip, meta: { tokenId: r!.id, name: b.name, expiresAt: exp, scopes } });
      return r!;
    });
    if (out === 'limit') return fail(reply, 422, 'limit', `Você já tem ${MAX_ACTIVE_TOKENS} tokens ativos. Revogue algum para criar outro.`);
    return reply.status(201).send({ ...out, token: t.token });          // o token aparece UMA vez; só o hash fica guardado
  });

  app.delete(`${M}/tokens/:id`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!; const id = parse(z.string().uuid(), (req.params as { id: string }).id, reply); if (!id) return;
    const n = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const r = await q`update store_mcp_tokens set revoked_at = now() where id = ${id} and store_id = ${s.storeId} and revoked_at is null returning name`;
      if (r.length) await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'store_mcp.token_revoked', ip: req.ip, meta: { tokenId: id, name: r[0]!.name } });
      return r.length;
    });
    return n ? { ok: true } : fail(reply, 404, 'not_found', 'Token não encontrado ou já revogado.');
  });

  // ---------- endpoint do protocolo MCP (quem chama é o assistente de IA) ----------
  const hits = new Map<string, { n: number; reset: number }>();
  const allow = (key: string) => { const t = Date.now(); const h = hits.get(key); if (!h || h.reset <= t) { hits.set(key, { n: 1, reset: t + 60_000 }); return true; } return ++h.n <= 60; };

  app.get('/v1/store-mcp', async (_req, reply) => reply.status(405).header('allow', 'POST').send({ error: { code: 'method_not_allowed', message: 'Use POST (MCP Streamable HTTP sem estado).' } }));
  app.post('/v1/store-mcp', { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = String(req.headers.authorization ?? '').match(new RegExp(`^Bearer (${PREFIX}_[A-Za-z0-9_-]{20,})$`))?.[1];
    const unauthorized = () => reply.status(401).header('www-authenticate', 'Bearer').send(rpcError(null, -32001, 'Token ausente, inválido, revogado ou vencido. Gere um novo em Loja › Avançado › MCP da loja.'));
    if (!token) return unauthorized();
    const [r] = await ctx.pools.app.begin((q) => q`select id, store_id, tenant_id, name, scopes from app.store_mcp_authenticate(${hashToken(token)}, ${req.ip ?? ''})`);
    if (!r || !(r.scopes as string[]).includes('orders')) return unauthorized();
    if (!allow(r.id as string)) return reply.status(429).header('retry-after', '60').send(rpcError(null, -32002, 'Muitas requisições. Aguarde um minuto.'));

    const caller: Caller = { tokenId: r.id as string, tokenName: r.name as string, storeId: r.store_id as string, tenantId: r.tenant_id as string, ip: req.ip ?? '', scopes: r.scopes as string[] };
    const body = req.body as Rpc | Rpc[] | null;
    if (Array.isArray(body)) {
      const outs = (await Promise.all(body.slice(0, 20).map((m) => handleRpc(ctx, caller, m)))).filter((x) => x !== null);
      return outs.length ? reply.send(outs) : reply.status(202).send();
    }
    if (!body || typeof body !== 'object') return reply.status(400).send(rpcError(null, -32700, 'JSON inválido.'));
    const out = await handleRpc(ctx, caller, body);
    return out === null ? reply.status(202).send() : reply.send(out);
  });
}
