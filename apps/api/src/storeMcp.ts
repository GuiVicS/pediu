import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@pediu/db';
import { generateToken, getOpenStatus, hashToken } from '@pediu/shared';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { changeOrderStatus, createStaffOrder, staffOrderIn } from './orders.js';
import { enqueuePrint } from './printing.js';
import { staffGuard } from './staff.js';
import { loadMenu } from './menu.js';

/**
 * MCP da loja: deixa um assistente de IA (Claude, ChatGPT etc.) GERENCIAR OS PEDIDOS da própria loja.
 * Escopo único: pedidos (consultar o cardápio só para montar o pedido, criar, listar, ver, mudar status, cancelar, reimprimir).
 * Não altera cardápio, pagamentos, equipe nem configurações; não recebe pagamento (isso fica com o PDV).
 * O token é gerado pelo lojista em Loja › Avançado e vale só para a loja dele. Protocolo MCP "Streamable HTTP" sem estado,
 * implementado aqui mesmo (JSON-RPC) para rodar dentro da API, com o mesmo isolamento por loja (RLS) do resto do sistema.
 */
const PREFIX = 'pomc';
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_ACTIVE_TOKENS = 5;

const STATUS = ['novo', 'preparo', 'pronto', 'saiu', 'entregue', 'cancelado'] as const;
const TYPE_LABEL: Record<string, string> = { delivery: 'entrega', retirada: 'retirada', mesa: 'mesa' };

export const STORE_MCP_TOOLS = [
  { name: 'consultar_cardapio', description: 'Somente leitura. Mostra o cardápio da loja (categorias, produtos com preço e disponibilidade, adicionais), as regiões de entrega com taxa e as formas de pagamento. Use antes de criar_pedido para usar os nomes exatos.',
    inputSchema: { type: 'object', properties: { busca: { type: 'string', description: 'opcional: filtra produtos pelo nome' } }, additionalProperties: false } },
  { name: 'criar_pedido', description: 'Lança um pedido novo na loja (retirada/balcão, entrega ou mesa). Os itens e adicionais vão pelo NOME, como em consultar_cardapio. O pedido nasce como "novo", vai para a cozinha/impressoras e fica A RECEBER: o pagamento é registrado pelo lojista no PDV. Confirme os dados com o lojista antes de criar.',
    inputSchema: { type: 'object', properties: {
      tipo: { type: 'string', enum: ['retirada', 'delivery', 'mesa'] },
      cliente: { type: 'string', description: 'nome do cliente (obrigatório na entrega)' }, telefone: { type: 'string' },
      endereco: { type: 'string', description: 'rua, número, bairro (obrigatório na entrega)' }, regiao: { type: 'string', description: 'nome da região de entrega (obrigatório na entrega)' },
      mesa: { type: 'integer', description: 'número da mesa (obrigatório quando tipo = mesa)' }, pessoas: { type: 'integer' },
      forma_pagamento: { type: 'string', description: 'nome da forma de pagamento combinada (opcional; só formas presenciais)' }, observacao: { type: 'string', maxLength: 300 },
      itens: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', properties: { produto: { type: 'string' }, quantidade: { type: 'integer', minimum: 1, maximum: 50 }, observacao: { type: 'string', maxLength: 200 }, adicionais: { type: 'array', items: { type: 'string' }, description: 'nomes das opções de adicional' } }, required: ['produto'], additionalProperties: false } } },
      required: ['tipo', 'itens'], additionalProperties: false } },
  { name: 'listar_pedidos', description: 'Lista os pedidos da loja, do mais novo para o mais antigo. Por padrão traz só os que estão em aberto (novo, em preparo, pronto, saiu para entrega).',
    inputSchema: { type: 'object', properties: {
      status: { type: 'string', enum: ['abertos', ...STATUS], description: '"abertos" (padrão) ou um status específico' },
      tipo: { type: 'string', enum: ['delivery', 'retirada', 'mesa'], description: 'filtra pelo tipo do pedido' },
      limite: { type: 'integer', minimum: 1, maximum: 50, description: 'quantos pedidos trazer (padrão 20)' } }, additionalProperties: false } },
  { name: 'ver_pedido', description: 'Mostra um pedido completo (itens, adicionais, observações, cliente, endereço, pagamento) e o histórico do que já aconteceu com ele.',
    inputSchema: { type: 'object', properties: { numero: { type: 'integer', description: 'número do pedido, como #1005' } }, required: ['numero'], additionalProperties: false } },
  { name: 'mudar_status', description: 'Avança o pedido pelo fluxo da loja: preparo (aceitar), pronto, saiu (saiu para entrega) ou entregue. Só vale para a etapa seguinte permitida; o sistema recusa saltos inválidos.',
    inputSchema: { type: 'object', properties: { numero: { type: 'integer' }, para: { type: 'string', enum: ['preparo', 'pronto', 'saiu', 'entregue'] } }, required: ['numero', 'para'], additionalProperties: false } },
  { name: 'cancelar_pedido', description: 'Cancela um pedido que ainda não foi entregue. O motivo é obrigatório e fica registrado. Atenção: não devolve dinheiro (estorno é feito pelo lojista no painel).',
    inputSchema: { type: 'object', properties: { numero: { type: 'integer' }, motivo: { type: 'string', maxLength: 200 } }, required: ['numero', 'motivo'], additionalProperties: false } },
  { name: 'reimprimir_pedido', description: 'Manda imprimir de novo o cupom do pedido nas impressoras das zonas (cozinha, bar, caixa).',
    inputSchema: { type: 'object', properties: { numero: { type: 'integer' } }, required: ['numero'], additionalProperties: false } },
] as const;

interface Caller { tokenId: string; tokenName: string; storeId: string; tenantId: string; ip: string }
const money = (c: number) => `R$ ${(Number(c) / 100).toFixed(2).replace('.', ',')}`;
const minutesAgo = (d: unknown) => Math.max(0, Math.round((Date.now() - new Date(String(d)).getTime()) / 60_000));

const norm = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** Acha um item pelo nome (sem ligar para acento/maiúscula): exato primeiro, depois "contém"; ambíguo ou inexistente vira erro com as opções. */
function byName<T extends { name: string }>(items: T[], wanted: string, what: string): { item: T } | { error: string } {
  const w = norm(wanted); if (!w) return { error: `Informe ${what}.` };
  const exact = items.filter((i) => norm(i.name) === w); const part = exact.length ? exact : items.filter((i) => norm(i.name).includes(w));
  if (part.length === 1) return { item: part[0]! };
  const list = (part.length ? part : items).slice(0, 12).map((i) => `"${i.name}"`).join(', ');
  return { error: part.length ? `"${wanted}" é ambíguo para ${what}. Qual destes? ${list}` : `Não encontrei ${what} "${wanted}". Opções: ${list || '(nenhuma cadastrada)'}` };
}

const args = {
  cardapio: z.object({ busca: z.string().trim().max(60).optional() }),
  criar: z.object({
    tipo: z.enum(['retirada', 'delivery', 'mesa']), cliente: z.string().trim().max(80).default(''), telefone: z.string().trim().max(20).default(''), endereco: z.string().trim().max(200).default(''),
    regiao: z.string().trim().max(80).optional(), mesa: z.number().int().min(1).max(500).optional(), pessoas: z.number().int().min(1).max(99).optional(), forma_pagamento: z.string().trim().max(60).optional(), observacao: z.string().trim().max(300).default(''),
    itens: z.array(z.object({ produto: z.string().trim().min(1).max(120), quantidade: z.number().int().min(1).max(50).default(1), observacao: z.string().trim().max(200).default(''), adicionais: z.array(z.string().trim().min(1).max(80)).max(30).default([]) })).min(1).max(30),
  }),
  listar: z.object({ status: z.enum(['abertos', ...STATUS]).default('abertos'), tipo: z.enum(['delivery', 'retirada', 'mesa']).optional(), limite: z.number().int().min(1).max(50).default(20) }),
  numero: z.object({ numero: z.number().int().min(1).max(10_000_000) }),
  mudar: z.object({ numero: z.number().int().min(1).max(10_000_000), para: z.enum(['preparo', 'pronto', 'saiu', 'entregue']) }),
  cancelar: z.object({ numero: z.number().int().min(1).max(10_000_000), motivo: z.string().trim().min(3, 'Informe o motivo do cancelamento.').max(200) }),
};

/** Formato do cardápio que o MCP lê (loadMenu devolve linhas soltas do banco). */
interface MenuData {
  categories: { id: string; name: string }[];
  products: { id: string; category_id: string; name: string; description: string; price: number; available: boolean; group_ids: string[] }[];
  groups: { id: string; name: string; min: number; max: number; required: boolean; addons: { id: string; name: string; price: number }[] }[];
  zones: { id: string; name: string; fee: number; eta: number }[];
}
type Out = { text: string; error?: boolean };
const ok = (data: unknown): Out => ({ text: JSON.stringify(data, null, 2) });
const bad = (msg: string): Out => ({ text: msg, error: true });

async function callTool(ctx: Ctx, c: Caller, name: string, raw: unknown): Promise<Out> {
  const find = (numero: number) => withTenant(ctx.pools, c.tenantId, async (q) => (await q`select id, number, status, type from orders where store_id = ${c.storeId} and number = ${numero}`)[0]);
  const actor = { tenantId: c.tenantId, storeId: c.storeId, staffId: null, actorId: `mcp:${c.tokenId}`, role: 'gerente' as const, ip: c.ip };

  switch (name) {
    case 'consultar_cardapio': {
      const a = args.cardapio.parse(raw ?? {});
      const out = await withTenant(ctx.pools, c.tenantId, async (q) => {
        const m = (await loadMenu(q, c.storeId)) as unknown as MenuData;
        const [pays, cfg] = await Promise.all([q`select name, type, online from payment_methods where store_id = ${c.storeId} and active order by sort`, q`select data from store_settings where store_id = ${c.storeId}`]);
        return { m, pays, open: getOpenStatus(((cfg[0]?.data ?? {}) as Record<string, any>), ctx.clock.now()) };
      });
      const w = a.busca ? norm(a.busca) : '';
      const groups = new Map(out.m.groups.map((g) => [g.id, g]));
      return ok({
        loja: { aberta: out.open.open, situacao: out.open.label },
        categorias: out.m.categories.map((cat) => ({ nome: cat.name, produtos: out.m.products.filter((p) => p.category_id === cat.id && (!w || norm(p.name).includes(w))).map((p) => ({
          nome: p.name, preco: money(Math.round(Number(p.price) * 100)), disponivel: !!p.available, descricao: p.description || undefined,
          adicionais: p.group_ids.map((id) => groups.get(id)).filter((g) => !!g && g.addons.length > 0).map((g) => ({ grupo: g!.name, obrigatorio: !!g!.required, minimo: g!.min, maximo: g!.max, opcoes: g!.addons.map((x) => ({ nome: x.name, preco_extra: money(Math.round(x.price * 100)) })) })) })) })).filter((cat) => cat.produtos.length > 0),
        regioes_de_entrega: out.m.zones.map((z) => ({ nome: z.name, taxa: money(Math.round(z.fee * 100)), tempo_min: z.eta })),
        formas_de_pagamento: out.pays.map((p) => ({ nome: p.name, tipo: p.type, online: !!p.online })),
      });
    }
    case 'criar_pedido': {
      const a = args.criar.parse(raw ?? {});
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
      const input = staffOrderIn.parse({ type: a.tipo, customerName: a.cliente, phone: a.telefone, address: a.endereco, zoneId, table: a.mesa, guests: a.pessoas, note: a.observacao, paymentId, receiveNow: false, lines });
      const r = await createStaffOrder(ctx, { tenantId: c.tenantId, storeId: c.storeId, staffId: null, actorId: actor.actorId }, input);
      if (!r.ok) return bad(r.message);
      return ok({ ok: true, numero: r.number, total: money(r.totalCents), status: 'novo', mensagem: `Pedido #${r.number} criado (${money(r.totalCents)}). Já foi para a cozinha/impressoras. O pagamento fica A RECEBER: o lojista registra no PDV.` });
    }
    case 'listar_pedidos': {
      const a = args.listar.parse(raw ?? {});
      const rows = await withTenant(ctx.pools, c.tenantId, (q) => q`
        select o.id, o.number, o.type, o.channel, o.status, o.customer_name, o.total_cents, o.paid, o.table_number, o.created_at, o.note,
          coalesce((select jsonb_agg(i.qty || '× ' || i.name order by i.created_at) from order_items i where i.order_id = o.id), '[]'::jsonb) as itens
        from orders o where o.store_id = ${c.storeId}
          and (${a.status}::text = 'abertos' and o.status in ('novo', 'preparo', 'pronto', 'saiu') or o.status = ${a.status}::text)
          and (${a.tipo ?? null}::text is null or o.type = ${a.tipo ?? null})
        order by o.created_at desc limit ${a.limite}`);
      return ok({ total: rows.length, pedidos: rows.map((r) => ({ numero: r.number, tipo: TYPE_LABEL[r.type as string] ?? r.type, canal: r.channel, status: r.status, cliente: r.customer_name, mesa: r.table_number ?? undefined, total: money(r.total_cents), pago: !!r.paid, ha_minutos: minutesAgo(r.created_at), itens: r.itens, observacao: r.note || undefined })) });
    }
    case 'ver_pedido': {
      const { numero } = args.numero.parse(raw ?? {});
      const out = await withTenant(ctx.pools, c.tenantId, async (q) => {
        const [o] = await q`select id, number, type, channel, status, customer_name, customer_phone, address, table_number, note, subtotal_cents, fee_cents, discount_cents, total_cents, payment_method, paid, created_at, cancel_reason from orders where store_id = ${c.storeId} and number = ${numero}`;
        if (!o) return null;
        const items = await q`select qty, name, total_cents, note, addons from order_items where order_id = ${o.id} order by created_at`;
        const ev = await q`select e.at, e.event, e.data, coalesce(u.name, t.name || ' (MCP)', case e.actor_kind when 'customer' then 'Cliente' when 'system' then 'Sistema' else null end) as quem
                           from order_events e left join staff_users u on e.actor_kind = 'staff' and u.id::text = e.actor_id and u.store_id = e.store_id
                           left join store_mcp_tokens t on e.actor_id = 'mcp:' || t.id::text where e.order_id = ${o.id} order by e.id`;
        return { o, items, ev };
      });
      if (!out) return bad(`Pedido #${numero} não encontrado nesta loja.`);
      const { o } = out;
      return ok({ numero: o.number, tipo: TYPE_LABEL[o.type as string] ?? o.type, canal: o.channel, status: o.status, mesa: o.table_number ?? undefined, cliente: o.customer_name, telefone: o.customer_phone || undefined, endereco: o.address || undefined, observacao: o.note || undefined,
        itens: out.items.map((i) => ({ qtd: i.qty, nome: i.name, total: money(i.total_cents), observacao: i.note || undefined, adicionais: Array.isArray(i.addons) ? i.addons.map((a: { name?: string }) => a.name) : undefined })),
        subtotal: money(o.subtotal_cents), taxa_entrega: money(o.fee_cents), desconto: money(o.discount_cents), total: money(o.total_cents), pagamento: o.payment_method, pago: !!o.paid, motivo_cancelamento: o.cancel_reason || undefined, ha_minutos: minutesAgo(o.created_at),
        historico: out.ev.map((e) => ({ quando: e.at, quem: e.quem ?? 'equipe', evento: e.event, detalhes: e.data ?? undefined })) });
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
    case 'reimprimir_pedido': {
      const a = args.numero.parse(raw ?? {}); const o = await find(a.numero);
      if (!o) return bad(`Pedido #${a.numero} não encontrado nesta loja.`);
      const n = await enqueuePrint(ctx, { tenantId: c.tenantId, storeId: c.storeId, orderId: o.id as string, kind: 'reimpressao', manual: true });
      await withTenant(ctx.pools, c.tenantId, (q) => audit(q, { actorKind: 'staff', actorId: actor.actorId, tenantId: c.tenantId, storeId: c.storeId, action: 'print.reprint', ip: c.ip, meta: { orderId: o.id, via: 'mcp' } }));
      return n ? ok({ ok: true, mensagem: `Pedido #${a.numero} enviado para impressão (${n} cupom/cupons).` }) : bad('Nada para imprimir: confira se as zonas têm impressora e itens.');
    }
    default: return bad(`Ferramenta desconhecida: ${name}`);
  }
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
        instructions: 'Você gerencia os pedidos de UMA loja de delivery. Use listar_pedidos para ver o que está em aberto, ver_pedido para detalhes e mudar_status para avançar cada pedido. Para lançar um pedido, consulte o cardápio primeiro (consultar_cardapio) e confirme os dados com o lojista antes de criar_pedido. Cancelar exige motivo; confirme com o lojista antes de cancelar.' } };
    }
    case 'ping': return { jsonrpc: '2.0', id: m.id, result: {} };
    case 'tools/list': return { jsonrpc: '2.0', id: m.id, result: { tools: STORE_MCP_TOOLS } };
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
    return { tokens, tools: STORE_MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })), maxActive: MAX_ACTIVE_TOKENS };
  });

  app.post(`${M}/tokens`, { preHandler: adm, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const s = req.staff!;
    const b = parse(z.object({ name: z.string().trim().min(1, 'Dê um nome ao token (ex.: Claude da loja).').max(60), expiresInDays: z.number().int().min(1).max(730).nullable().default(null) }), req.body, reply); if (!b) return;
    const t = generateToken(PREFIX);
    const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [n] = await q`select count(*)::int as n from store_mcp_tokens where store_id = ${s.storeId} and revoked_at is null and (expires_at is null or expires_at > now())`;
      if ((n?.n ?? 0) >= MAX_ACTIVE_TOKENS) return 'limit' as const;
      const exp = b.expiresInDays ? new Date(ctx.clock.now().getTime() + b.expiresInDays * 86_400_000).toISOString() : null;
      const [r] = await q`insert into store_mcp_tokens (store_id, tenant_id, name, token_hash, created_by, expires_at) values (${s.storeId}, ${s.tenantId}, ${b.name}, ${t.hash}, ${s.staffId}::uuid, ${exp}) returning id, name, scopes, created_at, expires_at`;
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'store_mcp.token_created', ip: req.ip, meta: { tokenId: r!.id, name: b.name, expiresAt: exp } });
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

    const caller: Caller = { tokenId: r.id as string, tokenName: r.name as string, storeId: r.store_id as string, tenantId: r.tenant_id as string, ip: req.ip ?? '' };
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
