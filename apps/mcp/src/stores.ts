import type { Q } from '@pediu/db';
import { randomBytes } from 'node:crypto';
import { hashPassword, mcpCanWrite, previewLink, type StoreStatus } from '@pediu/shared';
import { McpError, notFound } from './errors.js';
import { actorOf, inStore, record, type Db, type StoreRef, type Token } from './core.js';

const j = (v: unknown) => JSON.stringify(v);

// ---------- leitura (qualquer status, exceto arquivada) ----------
export async function listStores(pools: Db, t: Token, filter?: { status?: StoreStatus }) {
  const rows = await pools.mcp.begin((q) => q`
    select s.id, s.slug, s.name, s.status, s.created_at, t.id as tenant_id, t.name as tenant_name,
      (select hostname from store_domains d where d.store_id = s.id order by d.created_at limit 1) as domain,
      (select status from subscriptions x where x.tenant_id = t.id order by x.created_at desc limit 1) as assinatura
    from stores s join tenants t on t.id = s.tenant_id
    where (${filter?.status ?? null}::text is null or s.status::text = ${filter?.status ?? null}) order by s.created_at desc limit 500`);
  return rows.filter((r) => !t.storeLimit || t.storeLimit.includes(r.id)).map((r) => ({ ...r, editavel: mcpCanWrite(r.status, t.allowProduction) }));
}

export async function listSubscriptions(pools: Db, t: Token, tenantId?: string) {
  const rows = await pools.mcp.begin((q) => q`
    select s.id, s.status, s.interval, s.amount_cents, s.current_period_end, s.trial_end, s.cancel_at_period_end, s.past_due_since,
           t.id as tenant_id, t.name as tenant_name, p.code as plano, p.name as plano_nome, p.modules as modulos
    from subscriptions s join tenants t on t.id = s.tenant_id left join plans p on p.id = s.plan_id
    where (${tenantId ?? null}::uuid is null or t.id = ${tenantId ?? null}::uuid) order by s.created_at desc limit 500`);
  if (!t.storeLimit) return rows;
  const allowed = await pools.mcp.begin((q) => q`select distinct tenant_id from stores where id in (select x::uuid from jsonb_array_elements_text(${j(t.storeLimit)}::jsonb) x)`);
  const ok = new Set(allowed.map((r) => r.tenant_id));
  return rows.filter((r) => ok.has(r.tenant_id));
}

export function viewStore(pools: Db, t: Token, storeId: string) {
  return inStore(pools, t, storeId, 'read', async (q, s) => {
    const [theme] = await q`select data from store_themes where store_id = ${s.id}`;
    const [settings] = await q`select data from store_settings where store_id = ${s.id}`;
    return {
      loja: { id: s.id, slug: s.slug, nome: s.name, status: s.status, editavel: mcpCanWrite(s.status, t.allowProduction) },
      tema: theme?.data ?? {}, configuracoes: settings?.data ?? {},
      categorias: await q`select id, name as nome, image_url, sort as ordem, active as ativa, print_zone_id from categories where store_id = ${s.id} order by sort`,
      produtos: await q`select id, category_id, name as nome, description as descricao, price as preco, image_url, active as ativo, available as disponivel, sort as ordem,
                        coalesce((select jsonb_agg(group_id) from product_addon_groups pg where pg.product_id = products.id), '[]') as grupos
                        from products where store_id = ${s.id} order by sort`,
      grupos_adicionais: await q`select g.id, g.name as nome, g.min, g.max, g.required as obrigatorio, g.pricing, g.active as ativo,
                        coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.name, 'preco', a.price, 'ativo', a.active) order by a.sort) from addons a where a.group_id = g.id), '[]') as adicionais
                        from addon_groups g where g.store_id = ${s.id} order by g.sort`,
      banners: await q`select id, title as titulo, image_url, active as ativo from banners where store_id = ${s.id} order by sort`,
      zonas_entrega: await q`select id, name as nome, fee as taxa, eta as minutos, active as ativa from delivery_zones where store_id = ${s.id}`,
      zonas_impressao: await q`select id, name as nome, paper as papel, copies as copias, auto_print, active as ativa from print_zones where store_id = ${s.id}`,
      formas_pagamento: await q`select id, name as nome, type as tipo, active as ativa from payment_methods where store_id = ${s.id} order by sort`,
    };
  });
}

// ---------- escrita (desenvolvimento; produção só com token liberado) ----------
export interface NewAdmin { name: string; email: string; password: string }
/** domain: domínio oficial (vira o subdomínio da loja); panelDomain: domínio pelo qual o painel abre hoje (PREVIEW_DOMAIN). */
export async function createStore(pools: Db, t: Token, input: { slug: string; name: string; tenantId?: string; tenantName?: string; domain: string; panelDomain?: string; admin: NewAdmin }) {
  if (t.storeLimit) throw new McpError('Este token é limitado a lojas específicas e não pode criar lojas novas.');
  if (!input.tenantId && !input.tenantName) throw new McpError('Informe tenantId (conta existente) ou tenantName (para criar a conta).');
  const adminHash = await hashPassword(input.admin.password);
  const adminEmail = input.admin.email.toLowerCase();
  try {
    return await pools.mcp.begin(async (q) => {
      let tenantId = input.tenantId;
      if (tenantId) {
        const [tn] = await q`select id from tenants where id = ${tenantId}`;
        if (!tn) throw notFound('Conta');
      } else tenantId = (await q`insert into tenants (name) values (${input.tenantName!}) returning id`)[0]!.id as string;
      const [s] = await q`insert into stores (tenant_id, slug, name, status, created_by) values (${tenantId}, ${input.slug}, ${input.name}, 'desenvolvimento', ${actorOf(t)}) returning id, tenant_id, slug, name, status`;
      const store = s as unknown as StoreRef;
      const host = `${input.slug}.${input.domain}`;
      await q`insert into store_domains (tenant_id, store_id, hostname, kind, verified_at) values (${tenantId}, ${store.id}, ${host}, 'subdomain', now())`;
      await q`insert into store_themes (store_id, tenant_id) values (${store.id}, ${tenantId})`;
      await q`insert into store_settings (store_id, tenant_id) values (${store.id}, ${tenantId})`;
      // administrador da loja: entra no painel (/entrar) já em desenvolvimento
      await q`insert into staff_users (tenant_id, store_id, email, name, role, password_hash, active) values (${tenantId}, ${store.id}, ${adminEmail}, ${input.admin.name}, 'admin', ${adminHash}, true)`;
      await record(q, t, store, 'loja', store.id, 'create', null, { slug: input.slug, name: input.name, admin: adminEmail });
      return { id: store.id, tenantId, slug: store.slug, status: store.status, dominio: host, editavel: true, administrador: { email: adminEmail, painel: `https://${input.slug}.${input.panelDomain ?? input.domain}/entrar` } };
    });
  } catch (e) {
    if ((e as { code?: string; constraint_name?: string }).code === '23505') {
      const x = e as { constraint_name?: string; constraint?: string; detail?: string; message?: string };
      if (/staff_users|\(tenant_id, email\)/.test(`${x.constraint_name ?? ''} ${x.constraint ?? ''} ${x.detail ?? ''} ${x.message ?? ''}`)) throw new McpError('Este e-mail de administrador já está em uso nesta conta.');
      throw new McpError('Já existe uma loja com este endereço (slug).');
    }
    throw e;
  }
}

export function updateStore(pools: Db, t: Token, storeId: string, input: { name?: string; settings: Record<string, unknown> }) {
  return inStore(pools, t, storeId, 'write', async (q, s) => {
    const [cur] = await q`select data from store_settings where store_id = ${s.id}`;
    if (input.name && input.name !== s.name) await q`update stores set name = ${input.name} where id = ${s.id}`;
    const patch = Object.keys(input.settings).length ? input.settings : null;
    if (patch) await q`insert into store_settings (store_id, tenant_id, data) values (${s.id}, ${s.tenant_id}, ${j(patch)}::jsonb)
                       on conflict (store_id) do update set data = store_settings.data || excluded.data, updated_at = now()`;
    const [after] = await q`select data from store_settings where store_id = ${s.id}`;
    await record(q, t, s, 'loja', s.id, 'update', { name: s.name, settings: cur?.data ?? {} }, { name: input.name ?? s.name, settings: after?.data ?? {} });
    return { nome: input.name ?? s.name, configuracoes: after?.data ?? {} };
  });
}

export function updateTheme(pools: Db, t: Token, storeId: string, patch: Record<string, unknown>) {
  return inStore(pools, t, storeId, 'write', async (q, s) => {
    if (!Object.keys(patch).length) throw new McpError('Informe ao menos um campo do tema.');
    const [cur] = await q`select data from store_themes where store_id = ${s.id}`;
    await q`insert into store_themes (store_id, tenant_id, data) values (${s.id}, ${s.tenant_id}, ${j(patch)}::jsonb)
            on conflict (store_id) do update set data = store_themes.data || excluded.data, updated_at = now()`;
    const [after] = await q`select data from store_themes where store_id = ${s.id}`;
    await record(q, t, s, 'tema', s.id, 'update', cur?.data ?? {}, after?.data ?? {});
    return { tema: after?.data };
  });
}

// ---------- link secreto de prévia (só em desenvolvimento) ----------
/** Devolve o link atual (cria se não houver); novo=true troca o código e o link anterior para de funcionar. */
export function previewLinkFor(pools: Db, t: Token, storeId: string, o: { novo?: boolean; domain: string }) {
  return inStore(pools, t, storeId, 'write', async (q, s) => {
    if (s.status !== 'desenvolvimento') throw new McpError(`A loja "${s.name}" já está ${s.status === 'producao' ? 'no ar' : s.status}: prévia só existe para lojas em desenvolvimento.`);
    const [cur] = await q`select preview_token from stores where id = ${s.id}`;
    let token = cur?.preview_token as string | null;
    if (!token || o.novo) {
      token = randomBytes(24).toString('base64url');
      await q`update stores set preview_token = ${token} where id = ${s.id}`;
      await q`insert into audit_logs (actor_kind, actor_id, tenant_id, store_id, action) values ('mcp', ${t.id}, ${s.tenant_id}, ${s.id}, 'store.preview_link_created')`;
    }
    return { link: previewLink(s.slug, o.domain, token), observacao: 'Quem abrir este link vê a vitrine da loja. Pedidos continuam bloqueados até publicar. Use novo=true para trocar o link.' };
  });
}

// ---------- checklist e publicação ----------
export interface Issue { nivel: 'erro' | 'aviso'; mensagem: string }

async function checklist(q: Q, s: StoreRef) {
  const n = async (sql: Promise<Record<string, any>[]>) => Number((await sql)[0]!.n);
  const issues: Issue[] = [];
  const products = await n(q`select count(*)::int as n from products where store_id = ${s.id} and active`);
  if (!products) issues.push({ nivel: 'erro', mensagem: 'A loja não tem nenhum produto ativo.' });
  const semFoto = await n(q`select count(*)::int as n from products where store_id = ${s.id} and active and image_url = ''`);
  if (semFoto) issues.push({ nivel: 'aviso', mensagem: `${semFoto} produto(s) ativo(s) sem foto.` });
  const vazias = await n(q`select count(*)::int as n from categories c where c.store_id = ${s.id} and c.active and not exists (select 1 from products p where p.category_id = c.id and p.active)`);
  if (vazias) issues.push({ nivel: 'aviso', mensagem: `${vazias} categoria(s) ativa(s) sem produtos.` });
  if (!(await n(q`select count(*)::int as n from payment_methods where store_id = ${s.id} and active`))) issues.push({ nivel: 'erro', mensagem: 'Nenhuma forma de pagamento ativa.' });
  if (!(await n(q`select count(*)::int as n from delivery_zones where store_id = ${s.id} and active`))) issues.push({ nivel: 'aviso', mensagem: 'Nenhuma zona de entrega ativa (a loja só aceitaria retirada).' });
  const [theme] = await q`select data from store_themes where store_id = ${s.id}`;
  if (!theme?.data?.logoUrl) issues.push({ nivel: 'aviso', mensagem: 'O tema não tem logo.' });
  const [set] = await q`select data from store_settings where store_id = ${s.id}`;
  if (!set?.data?.hours?.length) issues.push({ nivel: 'erro', mensagem: 'Os horários de funcionamento não foram definidos.' });
  if (!set?.data?.phone) issues.push({ nivel: 'aviso', mensagem: 'A loja não tem telefone/WhatsApp.' });
  const semZona = await n(q`select count(*)::int as n from categories where store_id = ${s.id} and active and print_zone_id is null`);
  if (semZona && (await n(q`select count(*)::int as n from print_zones where store_id = ${s.id}`))) issues.push({ nivel: 'aviso', mensagem: `${semZona} categoria(s) sem zona de impressão (sairão na zona padrão).` });
  return { ok: !issues.some((i) => i.nivel === 'erro'), issues, contagens: { produtos: products } };
}

export const validateStore = (pools: Db, t: Token, storeId: string) => inStore(pools, t, storeId, 'read', (q, s) => checklist(q, s));

export function requestPublication(pools: Db, t: Token, storeId: string, note?: string) {
  return inStore(pools, t, storeId, 'write', async (q, s) => {
    if (s.status !== 'desenvolvimento') throw new McpError(`A loja "${s.name}" já está no ar: não há o que publicar.`);
    const c = await checklist(q, s);
    if (!c.ok) throw new McpError(`A loja ainda tem pendências obrigatórias: ${c.issues.filter((i) => i.nivel === 'erro').map((i) => i.mensagem).join(' ')}`);
    const dup = await q`select id from publication_requests where store_id = ${s.id} and status = 'pendente'`;
    if (dup.length) throw new McpError('Já existe um pedido de publicação pendente para esta loja.');
    const [r] = await q`insert into publication_requests (store_id, requested_by, note, checklist) values (${s.id}, ${actorOf(t)}, ${note ?? null}, ${j(c)}::jsonb) returning id`;
    await q`insert into audit_logs (actor_kind, actor_id, tenant_id, store_id, action, meta) values ('mcp', ${t.id}, ${s.tenant_id}, ${s.id}, 'mcp.publication_requested', ${j({ requestId: r!.id, note })}::jsonb)`;
    return { pedido: r!.id, mensagem: 'Pedido enviado. Um administrador precisa aprovar no super admin (com o código do autenticador). O MCP não publica lojas.', avisos: c.issues };
  });
}

// ---------- importação em lote ----------
export interface MenuImport { categorias: { nome: string; imagem?: string; produtos: { nome: string; preco: number; descricao?: string; imagem?: string }[] }[]; substituir?: boolean; confirmarSubstituicao?: boolean; dryRun?: boolean }

export function importMenu(pools: Db, t: Token, storeId: string, input: MenuImport) {
  return inStore(pools, t, storeId, 'write', async (q, s) => {
    const cats = input.categorias.length, prods = input.categorias.reduce((n, c) => n + c.produtos.length, 0);
    if (prods > 500) throw new McpError('Máximo de 500 produtos por importação.');
    if (input.dryRun) return { dryRun: true, categorias: cats, produtos: prods, substituiria: !!input.substituir };
    if (input.substituir) {
      if (!input.confirmarSubstituicao) throw new McpError('substituir=true apaga todo o cardápio atual. Confirme com confirmarSubstituicao=true.');
      const before = await q`select count(*)::int as n from products where store_id = ${s.id}`;
      await q`delete from categories where store_id = ${s.id}`;
      await record(q, t, s, 'cardapio', null, 'delete', { produtosRemovidos: before[0]!.n }, null);
    }
    const [{ m }] = (await q`select coalesce(max(sort), 0) as m from categories where store_id = ${s.id}`) as [{ m: number }];
    let ci = Number(m);
    for (const c of input.categorias) {
      const [cat] = await q`insert into categories (store_id, tenant_id, name, image_url, sort) values (${s.id}, ${s.tenant_id}, ${c.nome}, ${c.imagem ?? ''}, ${++ci}) returning id`;
      let pi = 0;
      for (const p of c.produtos) await q`insert into products (store_id, tenant_id, category_id, name, description, price, image_url, sort) values (${s.id}, ${s.tenant_id}, ${cat!.id}, ${p.nome}, ${p.descricao ?? ''}, ${p.preco}, ${p.imagem ?? ''}, ${++pi})`;
    }
    await record(q, t, s, 'cardapio', null, 'create', null, { categorias: cats, produtos: prods });
    return { importado: true, categorias: cats, produtos: prods };
  });
}
