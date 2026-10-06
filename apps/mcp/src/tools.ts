import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { AddonGroupInput, BannerInput, CategoryInput, DeliveryZoneInput, PaymentMethodShape, PrintZoneInput, ProductInput, StoreInput, Slug, ThemeInput, STORE_STATUS } from '@pediu/shared';
import type { Token } from './core.js';
import { McpError } from './errors.js';
import { inStore, type Db } from './core.js';
import { removeAddonGroup, removeCategory, removeEntity, saveAddonGroup, saveEntity, saveProduct, type EntityKey } from './entities.js';
import { createStore, importMenu, listStores, listSubscriptions, requestPublication, updateStore, updateTheme, validateStore, viewStore } from './stores.js';

export const READ_TOOLS = ['listar_lojas', 'ver_loja', 'validar_loja', 'listar_assinaturas'] as const;
export const WRITE_TOOLS = [
  'criar_loja', 'atualizar_loja', 'atualizar_tema', 'salvar_categoria', 'remover_categoria', 'salvar_produto', 'remover_produto',
  'salvar_grupo_adicionais', 'remover_grupo_adicionais', 'salvar_banner', 'remover_banner', 'salvar_zona_entrega', 'remover_zona_entrega',
  'salvar_zona_impressao', 'remover_zona_impressao', 'salvar_forma_pagamento', 'remover_forma_pagamento', 'importar_cardapio', 'solicitar_publicacao',
] as const;

const json = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });
const falha = (msg: string) => ({ isError: true, content: [{ type: 'text' as const, text: msg }] });
const lojaId = z.string().uuid().describe('ID da loja (use listar_lojas)');
/** Na entrada da ferramenta tudo é opcional: ao ATUALIZAR só muda o que foi enviado (os padrões do schema não podem zerar campos). */
const loose = (shape: z.ZodRawShape): z.ZodRawShape => Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, v instanceof z.ZodDefault ? (v._def.innerType as z.ZodTypeAny).optional() : v.isOptional() ? v : v.optional()]));
/** Criar (sem id): valida com o schema completo e aplica os padrões. Atualizar (com id): usa só os campos enviados. */
function forSave(schema: z.ZodObject<z.ZodRawShape>, input: Record<string, any>): Record<string, any> {
  if (input.id) return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const r = schema.safeParse(input);
  if (!r.success) throw new McpError(`Para criar, faltam ou estão inválidos: ${r.error.issues.map((i) => `${i.path.join('.')} (${i.message})`).join('; ')}`);
  return r.data;
}
const id = (what: string) => z.string().uuid().describe(`ID ${what}`);

/** Erros de negócio viram mensagem clara; bloqueio do banco e erros inesperados viram texto genérico (o detalhe vai só para o log). */
const seguro = <A,>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
  try { return json(await fn(a)); } catch (e) {
    if (e instanceof McpError) return falha(e.message);
    const code = (e as { code?: string }).code;
    console.error('[mcp] erro', e);
    if (code === '42501') return falha('Operação bloqueada pelo banco de dados: a loja não está em desenvolvimento ou o recurso não é permitido ao MCP.');
    if (code === '23503') return falha('Referência inválida: um dos IDs informados não pertence a esta loja.');
    return falha('Erro inesperado ao executar a operação.');
  }
};

/** Servidor MCP autenticado como `token`. Lojas em desenvolvimento aceitam toda a personalização; em produção só leitura. */
export function createMcpServer(pools: Db, token: Token, opts: { baseDomain: string }) {
  const s = new McpServer({ name: 'pediu-lojas', version: '1.0.0' });
  const W = (name: string, description: string, inputSchema: z.ZodRawShape, handler: (a: any) => Promise<unknown>) =>
    s.registerTool(name, { description: `${description} [Só lojas em desenvolvimento]`, inputSchema }, seguro(handler));
  const R = (name: string, description: string, inputSchema: z.ZodRawShape, handler: (a: any) => Promise<unknown>) =>
    s.registerTool(name, { description, inputSchema }, seguro(handler));

  // ---- leitura: funciona em qualquer status ----
  R('listar_lojas', 'Lista as lojas com status, domínio e situação da assinatura. "editavel" indica se o MCP pode alterar a loja.',
    { status: z.enum(STORE_STATUS).optional() }, (a) => listStores(pools, token, a));
  R('ver_loja', 'Mostra a configuração completa de uma loja: tema, dados, cardápio, adicionais, banners, zonas e pagamentos.', { lojaId }, (a) => viewStore(pools, token, a.lojaId));
  R('validar_loja', 'Confere o que falta para publicar (produtos, fotos, pagamento, horários, entrega, logo).', { lojaId }, (a) => validateStore(pools, token, a.lojaId));
  R('listar_assinaturas', 'Lista as assinaturas (plano, valor, situação, próxima cobrança). Somente leitura.', { tenantId: z.string().uuid().optional() }, (a) => listSubscriptions(pools, token, a.tenantId));

  // ---- escrita: só em desenvolvimento ----
  s.registerTool('criar_loja', {
    description: 'Cria uma loja nova, sempre em desenvolvimento, com subdomínio, tema e configurações vazios. Informe tenantId (conta existente) ou tenantName (cria a conta).',
    inputSchema: { slug: Slug.describe('Endereço: letras minúsculas, números e hífen'), nome: z.string().min(2).max(80), tenantId: z.string().uuid().optional(), tenantName: z.string().min(2).max(120).optional() },
  }, seguro((a: any) => createStore(pools, token, { slug: a.slug, name: a.nome, tenantId: a.tenantId, tenantName: a.tenantName, domain: opts.baseDomain })));

  W('atualizar_loja', 'Atualiza o nome e os dados da loja (telefone, endereço, horários, pedido mínimo, tempo de preparo, mensagens).',
    { lojaId, nome: z.string().min(2).max(80).optional(), ...Object.fromEntries(Object.entries(StoreInput.shape).filter(([k]) => k !== 'name')) },
    ({ lojaId, nome, ...settings }) => updateStore(pools, token, lojaId, { name: nome, settings }));

  W('atualizar_tema', 'Altera qualquer campo da aparência: cores, fonte, raio, logo, favicon, imagens, textos, colunas, SEO, pixel e CSS. Só envie o que muda.',
    { lojaId, ...ThemeInput.shape }, ({ lojaId, ...patch }) => updateTheme(pools, token, lojaId, patch));

  W('salvar_categoria', 'Cria (sem id) ou atualiza (com id, só os campos enviados) uma categoria.', { lojaId, ...loose(CategoryInput.shape) },
    ({ lojaId, ...c }) => inStore(pools, token, lojaId, 'write', (q, st) => saveEntity(q, token, st, 'categoria', forSave(CategoryInput, c))));
  W('remover_categoria', 'Remove uma categoria (e seus produtos, se confirmar=true).', { lojaId, categoriaId: id('da categoria'), confirmar: z.boolean().default(false) },
    (a) => removeCategory(pools, token, a.lojaId, a.categoriaId, a.confirmar));

  W('salvar_produto', 'Cria (sem id) ou atualiza (com id, só os campos enviados) um produto, com preço, foto e grupos de adicionais (groupIds).', { lojaId, ...loose(ProductInput.shape) },
    ({ lojaId, ...p }) => saveProduct(pools, token, lojaId, forSave(ProductInput, p)));
  W('remover_produto', 'Remove um produto.', { lojaId, produtoId: id('do produto') },
    (a) => inStore(pools, token, a.lojaId, 'write', (q, st) => removeEntity(q, token, st, 'produto', a.produtoId)));

  W('salvar_grupo_adicionais', 'Cria ou atualiza um grupo de adicionais (tamanho, borda, molhos…). Se enviar "addons", a lista substitui a anterior; se omitir, os adicionais ficam como estão.', { lojaId, ...loose(AddonGroupInput.shape) },
    ({ lojaId, ...g }) => saveAddonGroup(pools, token, lojaId, forSave(AddonGroupInput, g)));
  W('remover_grupo_adicionais', 'Remove um grupo de adicionais.', { lojaId, grupoId: id('do grupo') }, (a) => removeAddonGroup(pools, token, a.lojaId, a.grupoId));

  const simple = (key: EntityKey, saveName: string, removeName: string, label: string, schema: z.ZodObject<z.ZodRawShape>, idName: string) => {
    W(saveName, `Cria (sem id) ou atualiza (com id, só os campos enviados): ${label}.`, { lojaId, ...loose(schema.shape) },
      ({ lojaId, ...x }) => inStore(pools, token, lojaId, 'write', (q, st) => saveEntity(q, token, st, key, forSave(schema, x))));
    W(removeName, `Remove: ${label}.`, { lojaId, [idName]: id(`de ${label}`) },
      (a) => inStore(pools, token, a.lojaId, 'write', (q, st) => removeEntity(q, token, st, key, a[idName])));
  };
  simple('banner', 'salvar_banner', 'remover_banner', 'banner do carrossel', BannerInput, 'bannerId');
  simple('zona_entrega', 'salvar_zona_entrega', 'remover_zona_entrega', 'zona de entrega (bairro/taxa/tempo)', DeliveryZoneInput, 'zonaId');
  simple('zona_impressao', 'salvar_zona_impressao', 'remover_zona_impressao', 'zona de impressão (cozinha, bar, expedição)', PrintZoneInput, 'zonaId');
  simple('forma_pagamento', 'salvar_forma_pagamento', 'remover_forma_pagamento', 'forma de pagamento oferecida (liga/desliga e textos; nunca credenciais nem cobrança online)', PaymentMethodShape.omit({ online: true, gateway: true }), 'formaId');

  W('importar_cardapio', 'Importa categorias e produtos de uma vez. Use dryRun=true para só conferir. substituir=true apaga o cardápio atual (exige confirmarSubstituicao=true).',
    {
      lojaId, dryRun: z.boolean().default(false), substituir: z.boolean().default(false), confirmarSubstituicao: z.boolean().default(false),
      categorias: z.array(z.object({ nome: z.string().min(1).max(80), imagem: z.string().max(2048).optional(), produtos: z.array(z.object({ nome: z.string().min(1).max(120), preco: z.number().min(0).max(100000), descricao: z.string().max(1000).optional(), imagem: z.string().max(2048).optional() })).max(200) })).min(1).max(50),
    }, ({ lojaId, ...m }) => importMenu(pools, token, lojaId, m));

  W('solicitar_publicacao', 'Pede a publicação da loja. Roda a validação e abre um pedido que SÓ um administrador aprova no super admin (com autenticador). O MCP nunca publica.',
    { lojaId, observacao: z.string().max(300).optional() }, (a) => requestPublication(pools, token, a.lojaId, a.observacao));

  return s;
}
