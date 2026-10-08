import type { Q } from '@pediu/db';
import { McpError, notFound } from './errors.js';
import { inStore, raw, record, type Db, type StoreRef, type Token } from './core.js';

/** Entidades simples: campo da API (camelCase) → coluna do banco. */
export const ENTITIES = {
  categoria: { table: 'categories', label: 'Categoria', cols: { name: 'name', imageUrl: 'image_url', imageFit: 'image_fit', order: 'sort', active: 'active', printZoneId: 'print_zone_id' } },
  produto: { table: 'products', label: 'Produto', cols: { categoryId: 'category_id', name: 'name', description: 'description', notes: 'notes', price: 'price', imageUrl: 'image_url', imageFit: 'image_fit', prepTime: 'prep_time', order: 'sort', active: 'active', available: 'available' } },
  banner: { table: 'banners', label: 'Banner', cols: { title: 'title', description: 'description', imageUrl: 'image_url', order: 'sort', active: 'active' } },
  zona_entrega: { table: 'delivery_zones', label: 'Zona de entrega', cols: { name: 'name', fee: 'fee', eta: 'eta', active: 'active' } },
  zona_impressao: { table: 'print_zones', label: 'Zona de impressão', cols: { name: 'name', description: 'description', paper: 'paper', copies: 'copies', autoPrint: 'auto_print', showPrices: 'show_prices', active: 'active', isDefault: 'is_default', events: 'events' } },
  forma_pagamento: { table: 'payment_methods', label: 'Forma de pagamento', cols: { name: 'name', type: 'type', note: 'note', order: 'sort', active: 'active' } },
} as const;
export type EntityKey = keyof typeof ENTITIES;

/** Colunas text[] chegam como lista e vão como JSON, convertidas no próprio SQL. */
const ARRAY_COLS = new Set(['events']);
const slot = (col: string) => (ARRAY_COLS.has(col) ? "(select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(?::jsonb) x)" : '?');
const val = (col: string, v: unknown) => (ARRAY_COLS.has(col) ? JSON.stringify(v) : v);
const toApi = (cols: Record<string, string>, row: Record<string, any>) => ({ id: row.id, ...Object.fromEntries(Object.entries(cols).map(([api, col]) => [api, row[col]])) });

/** Cria (sem id) ou atualiza (com id) uma entidade da loja. Só colunas do mapa; tudo amarrado a store_id. */
export async function saveEntity(q: Q, t: Token, s: StoreRef, key: EntityKey, input: Record<string, any>) {
  const { table, label, cols } = ENTITIES[key];
  const fields = Object.entries(cols).filter(([api]) => input[api] !== undefined);
  const names = fields.map(([, col]) => col);
  const vals = fields.map(([api, col]) => val(col, input[api]));
  if (input.id) {
    const [before] = await raw(q, `select * from ${table} where id = ? and store_id = ?`, [input.id, s.id]);
    if (!before) throw notFound(label);
    // nada para alterar na própria entidade (ex.: produto só com groupIds): sem isso o SQL sai "set  where" e quebra
    if (!names.length) return toApi(cols, before);
    const [row] = await raw(q, `update ${table} set ${names.map((n) => `${n} = ${slot(n)}`).join(', ')} where id = ? and store_id = ? returning *`, [...vals, input.id, s.id]);
    await record(q, t, s, key, input.id, 'update', toApi(cols, before), toApi(cols, row!));
    return toApi(cols, row!);
  }
  const [row] = await raw(q, `insert into ${table} (store_id, tenant_id, ${names.join(', ')}) values (?, ?, ${names.map((n) => slot(n)).join(', ')}) returning *`, [s.id, s.tenant_id, ...vals]);
  await record(q, t, s, key, row!.id, 'create', null, toApi(cols, row!));
  return toApi(cols, row!);
}

export async function removeEntity(q: Q, t: Token, s: StoreRef, key: EntityKey, id: string) {
  const { table, label, cols } = ENTITIES[key];
  const [row] = await raw(q, `delete from ${table} where id = ? and store_id = ? returning *`, [id, s.id]);
  if (!row) throw notFound(label);
  await record(q, t, s, key, id, 'delete', toApi(cols, row), null);
  return { removido: id };
}

// ---- produto: grupos de adicionais ligados ----
export async function setProductGroups(q: Q, s: StoreRef, productId: string, groupIds: string[]) {
  await q`delete from product_addon_groups where product_id = ${productId} and store_id = ${s.id}`;
  for (const g of groupIds) await q`insert into product_addon_groups (store_id, tenant_id, product_id, group_id) values (${s.id}, ${s.tenant_id}, ${productId}, ${g})`;
}

export function saveProduct(pools: Db, t: Token, storeId: string, input: Record<string, any>) {
  return inStore(pools, t, storeId, 'write', async (q, s) => {
    const { groupIds, ...rest } = input;
    const p = await saveEntity(q, t, s, 'produto', rest);
    if (groupIds) await setProductGroups(q, s, p.id, groupIds);
    return { ...p, groupIds: groupIds ?? undefined };
  });
}

// ---- grupos de adicionais (com a lista de adicionais substituída por inteiro) ----
export function saveAddonGroup(pools: Db, t: Token, storeId: string, input: Record<string, any>) {
  return inStore(pools, t, storeId, 'write', async (q, s) => {
    const f = { name: input.name, description: input.description, min: input.min, max: input.max, required: input.required, pricing: input.pricing, sort: input.order, active: input.active };
    let id = input.id as string | undefined;
    let before: unknown = null;
    if (id) {
      before = (await q`select g.*, coalesce((select jsonb_agg(a order by a.sort) from addons a where a.group_id = g.id), '[]') as addons from addon_groups g where g.id = ${id} and g.store_id = ${s.id}`)[0];
      if (!before) throw notFound('Grupo de adicionais');
      // atualização parcial: o que não veio fica como está
      await q`update addon_groups set name = coalesce(${f.name ?? null}, name), description = coalesce(${f.description ?? null}, description),
              min = coalesce(${f.min ?? null}::int, min), max = coalesce(${f.max ?? null}::int, max), required = coalesce(${f.required ?? null}::boolean, required),
              pricing = coalesce(${f.pricing ?? null}, pricing), sort = coalesce(${f.sort ?? null}::int, sort), active = coalesce(${f.active ?? null}::boolean, active)
              where id = ${id} and store_id = ${s.id}`;
    } else {
      id = (await q`insert into addon_groups (store_id, tenant_id, name, description, min, max, required, pricing, sort, active)
                    values (${s.id}, ${s.tenant_id}, ${f.name}, ${f.description}, ${f.min}, ${f.max}, ${f.required}, ${f.pricing}, ${f.sort}, ${f.active}) returning id`)[0]!.id as string;
    }
    if (input.addons) {
      await q`delete from addons where group_id = ${id} and store_id = ${s.id}`;
      for (const a of input.addons) await q`insert into addons (store_id, tenant_id, group_id, name, price, sort, active) values (${s.id}, ${s.tenant_id}, ${id}, ${a.name}, ${a.price}, ${a.order}, ${a.active})`;
    }
    await record(q, t, s, 'grupo_adicionais', id!, before ? 'update' : 'create', before, { ...f, addons: input.addons });
    return { id, ...f, addons: input.addons };
  });
}

export function removeAddonGroup(pools: Db, t: Token, storeId: string, id: string) {
  return inStore(pools, t, storeId, 'write', async (q, s) => {
    const [row] = await q`delete from addon_groups where id = ${id} and store_id = ${s.id} returning *`;
    if (!row) throw notFound('Grupo de adicionais');
    await record(q, t, s, 'grupo_adicionais', id, 'delete', row, null);
    return { removido: id };
  });
}

export function removeCategory(pools: Db, t: Token, storeId: string, id: string, confirmar: boolean) {
  return inStore(pools, t, storeId, 'write', async (q, s) => {
    const [n] = await q`select count(*)::int as n from products where category_id = ${id} and store_id = ${s.id}`;
    if (n!.n > 0 && !confirmar) throw new McpError(`A categoria tem ${n!.n} produto(s); remover apaga todos. Chame de novo com confirmar=true.`);
    return removeEntity(q, t, s, 'categoria', id);
  });
}
