import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant, type Q } from '@pediu/db';
import { AddonInput, BannerInput, CategoryInput, DeliveryZoneInput, FeaturedInput, PaymentMethodInput, PaymentMethodShape, PrintZoneInput, ProductInput, StoreInput, ThemeInput, type Perm } from '@pediu/shared';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { loadMenu } from './menu.js';
import { rawq } from './rawq.js';
import { bus } from './realtime.js';
import { staffGuard } from './staff.js';

type Kind = 'text' | 'int' | 'num' | 'bool' | 'uuid' | 'textarr';
interface Spec { table: string; perm: Perm; cols: Record<string, [col: string, kind: Kind]>; order: string; schema: z.ZodObject<z.ZodRawShape>; label: string; /** validação cruzada: vale inteira em criar e editar (sem edição parcial) */ full?: z.ZodTypeAny }

/** As coleções do painel (mesma interface da demo: lista, salvar, apagar). Campo da API (camelCase) → coluna. Só colunas deste mapa são tocadas. */
const COLLECTIONS: Record<string, Spec> = {
  categories: { table: 'categories', perm: 'admin.cardapio', order: 'sort', label: 'Categoria', schema: CategoryInput,
    cols: { name: ['name', 'text'], imageUrl: ['image_url', 'text'], imageFit: ['image_fit', 'text'], order: ['sort', 'int'], active: ['active', 'bool'], printZoneId: ['print_zone_id', 'uuid'] } },
  products: { table: 'products', perm: 'admin.cardapio', order: 'sort', label: 'Produto', schema: ProductInput,
    cols: { categoryId: ['category_id', 'uuid'], name: ['name', 'text'], description: ['description', 'text'], notes: ['notes', 'text'], price: ['price', 'num'], imageUrl: ['image_url', 'text'], imageFit: ['image_fit', 'text'],
      prepTime: ['prep_time', 'int'], active: ['active', 'bool'], available: ['available', 'bool'], order: ['sort', 'int'] } },
  groups: { table: 'addon_groups', perm: 'admin.cardapio', order: 'sort', label: 'Grupo de adicionais', schema: z.object({
      id: z.string().uuid().optional(), name: z.string().min(1).max(80), description: z.string().max(300).default(''), min: z.number().int().min(0).default(0), max: z.number().int().min(1).default(1),
      required: z.boolean().default(false), pricing: z.enum(['sum', 'highest', 'lowest', 'average']).default('sum'), order: z.number().int().default(0), active: z.boolean().default(true) }),
    cols: { name: ['name', 'text'], description: ['description', 'text'], min: ['min', 'int'], max: ['max', 'int'], required: ['required', 'bool'], pricing: ['pricing', 'text'], order: ['sort', 'int'], active: ['active', 'bool'] } },
  addons: { table: 'addons', perm: 'admin.cardapio', order: 'sort', label: 'Adicional', schema: AddonInput,
    cols: { groupId: ['group_id', 'uuid'], name: ['name', 'text'], price: ['price', 'num'], order: ['sort', 'int'], active: ['active', 'bool'] } },
  featured: { table: 'featured_products', perm: 'admin.cardapio', order: 'sort', label: 'Destaque', schema: FeaturedInput,
    cols: { productId: ['product_id', 'uuid'], order: ['sort', 'int'], active: ['active', 'bool'] } },
  banners: { table: 'banners', perm: 'admin.loja', order: 'sort', label: 'Banner', schema: BannerInput,
    cols: { title: ['title', 'text'], description: ['description', 'text'], imageUrl: ['image_url', 'text'], order: ['sort', 'int'], active: ['active', 'bool'] } },
  deliveryZones: { table: 'delivery_zones', perm: 'admin.loja', order: 'name', label: 'Zona de entrega', schema: DeliveryZoneInput,
    cols: { name: ['name', 'text'], fee: ['fee', 'num'], eta: ['eta', 'int'], active: ['active', 'bool'] } },
  payments: { table: 'payment_methods', perm: 'admin.loja', order: 'sort', label: 'Forma de pagamento', schema: PaymentMethodShape, full: PaymentMethodInput,
    cols: { name: ['name', 'text'], type: ['type', 'text'], note: ['note', 'text'], order: ['sort', 'int'], active: ['active', 'bool'], online: ['online', 'bool'], gateway: ['gateway', 'text'] } },
  printZones: { table: 'print_zones', perm: 'admin.loja', order: 'name', label: 'Zona de impressão', schema: PrintZoneInput,
    cols: { name: ['name', 'text'], description: ['description', 'text'], paper: ['paper', 'text'], copies: ['copies', 'int'], autoPrint: ['auto_print', 'bool'], showPrices: ['show_prices', 'bool'],
      active: ['active', 'bool'], isDefault: ['is_default', 'bool'], events: ['events', 'textarr'] } },
};
export const COLLECTION_NAMES = Object.keys(COLLECTIONS);

const toApi = (spec: Spec, row: Record<string, any>) => Object.fromEntries([['id', row.id], ...Object.entries(spec.cols).map(([api, [col, kind]]) => [api, kind === 'num' ? Number(row[col]) : row[col]])]);
const toDb = (kind: Kind, v: unknown) => (kind === 'textarr' ? JSON.stringify(v) : v);
const place = (kind: Kind) => (kind === 'textarr' ? '(select coalesce(array_agg(x), \'{}\') from jsonb_array_elements_text(?::jsonb) x)' : kind === 'uuid' ? '?::uuid' : kind === 'num' ? '?::numeric' : '?');

async function list(q: Q, name: string, storeId: string) {
  const spec = COLLECTIONS[name]!;
  const rows = await rawq(q, `select * from ${spec.table} where store_id = ? order by ${spec.order}, id`, [storeId]);
  const items = rows.map((r) => toApi(spec, r));
  if (name === 'products') {
    const links = await q`select product_id, group_id from product_addon_groups where store_id = ${storeId}`;
    for (const p of items) (p as any).groupIds = links.filter((l) => l.product_id === p.id).map((l) => l.group_id);
  }
  return items;
}

export function collectionRoutes(app: FastifyInstance, ctx: Ctx) {
  const S = '/v1/staff';

  // menu da equipe (qualquer status da loja): é o que PDV, garçom e painel usam
  app.get(`${S}/menu`, { preHandler: staffGuard(ctx) }, async (req) => {
    const s = req.staff!;
    return withTenant(ctx.pools, s.tenantId, async (q) => {
      const [cfg] = await q`select data->'tables' as tables from store_settings where store_id = ${s.storeId}`;
      const gws = await q`select provider from store_gateways where store_id = ${s.storeId} and status = 'ativo' order by provider`;
      // gateways: o PDV cobra Pix na tela por qualquer gateway conectado, sem exigir uma forma de pagamento "online" cadastrada
      return { ...(await loadMenu(q, s.storeId)), tables: Number(cfg?.tables ?? 20), gateways: gws.map((g) => g.provider as string) };
    });
  });

  const nameOf = (req: { params: unknown }) => (req.params as { name: string }).name;
  const guardFor = (req: { params: unknown }, perm?: Perm) => perm;
  void guardFor;

  app.get(`${S}/c/:name`, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const name = nameOf(req), spec = COLLECTIONS[name];
    if (!spec) return fail(reply, 404, 'not_found', 'Coleção inexistente.');
    const s = req.staff!;
    // leitura: quem edita a coleção, e a equipe de operação para o que o PDV/garçom precisam ver
    const opsRead = ['categories', 'products', 'groups', 'addons', 'payments', 'deliveryZones', 'featured', 'printZones'].includes(name);
    if (!(s.role === 'admin' || s.role === 'gerente' || (opsRead && s.role !== 'entregador')) && !hasPerm(s.role, spec.perm)) return fail(reply, 403, 'forbidden', 'Seu perfil não acessa esta área.');
    return { items: await withTenant(ctx.pools, s.tenantId, (q) => list(q, name, s.storeId)) };
  });

  app.put(`${S}/c/:name`, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const name = nameOf(req), spec = COLLECTIONS[name];
    if (!spec) return fail(reply, 404, 'not_found', 'Coleção inexistente.');
    const s = req.staff!;
    if (!hasPerm(s.role, spec.perm)) return fail(reply, 403, 'forbidden', 'Seu perfil não pode alterar esta área.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updating = typeof body.id === 'string';
    const extra = name === 'products' ? z.object({ groupIds: z.array(z.string().uuid()).max(50).optional() }) : null;
    const schema = spec.full ?? (updating ? spec.schema.partial().extend({ id: z.string().uuid() }).merge(extra ?? z.object({})) : spec.schema.merge(extra ?? z.object({})));
    const b = parse(schema, body, reply) as Record<string, any> | null;
    if (!b) return;
    const fields = Object.entries(spec.cols).filter(([api]) => b[api] !== undefined);
    try {
      const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
        let row: Record<string, any>;
        if (updating) {
          const [before] = await rawq(q, `select * from ${spec.table} where id = ?::uuid and store_id = ?::uuid`, [b.id, s.storeId]);
          if (!before) return null;
          if (!fields.length) row = before;
          else [row] = await rawq(q, `update ${spec.table} set ${fields.map(([, [col, kind]]) => `${col} = ${place(kind)}`).join(', ')} where id = ?::uuid and store_id = ?::uuid returning *`,
            [...fields.map(([api, [, kind]]) => toDb(kind, b[api])), b.id, s.storeId]) as [Record<string, any>];
        } else {
          [row] = await rawq(q, `insert into ${spec.table} (store_id, tenant_id, ${fields.map(([, [col]]) => col).join(', ')}) values (?::uuid, ?::uuid, ${fields.map(([, [, kind]]) => place(kind)).join(', ')}) returning *`,
            [s.storeId, s.tenantId, ...fields.map(([api, [, kind]]) => toDb(kind, b[api]))]) as [Record<string, any>];
        }
        // zona padrão: só uma por loja
        if (name === 'printZones' && b.isDefault === true) await q`update print_zones set is_default = false where store_id = ${s.storeId} and id <> ${row!.id}`;
        if (name === 'products' && b.groupIds) {
          await q`delete from product_addon_groups where product_id = ${row!.id} and store_id = ${s.storeId}`;
          for (const g of b.groupIds) await q`insert into product_addon_groups (store_id, tenant_id, product_id, group_id) values (${s.storeId}, ${s.tenantId}, ${row!.id}, ${g})`;
        }
        await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: `catalog.${name}.${updating ? 'update' : 'create'}`, ip: req.ip, meta: { id: row!.id } });
        const item = toApi(spec, row!);
        if (name === 'products') (item as any).groupIds = b.groupIds ?? (await q`select group_id from product_addon_groups where product_id = ${row!.id}`).map((l) => l.group_id);
        return item;
      });
      if (!out) return fail(reply, 404, 'not_found', `${spec.label} não encontrado(a).`);
      bus.emit(s.storeId, { type: 'menu', collection: name });
      return { item: out };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === '23503') return fail(reply, 422, 'invalid_reference', 'Referência inválida: um dos itens informados não pertence a esta loja.');
      if (code === '23505') return fail(reply, 409, 'duplicate', 'Já existe um registro igual.');
      throw e;
    }
  });

  app.delete(`${S}/c/:name/:id`, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const name = nameOf(req), spec = COLLECTIONS[name];
    if (!spec) return fail(reply, 404, 'not_found', 'Coleção inexistente.');
    const s = req.staff!;
    if (!hasPerm(s.role, spec.perm)) return fail(reply, 403, 'forbidden', 'Seu perfil não pode alterar esta área.');
    const id = parse(z.string().uuid(), (req.params as { id: string }).id, reply); if (!id) return;
    const n = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const r = await rawq(q, `delete from ${spec.table} where id = ?::uuid and store_id = ?::uuid returning id`, [id, s.storeId]);
      if (r.length) await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: `catalog.${name}.delete`, ip: req.ip, meta: { id } });
      return r.length;
    });
    if (!n) return fail(reply, 404, 'not_found', `${spec.label} não encontrado(a).`);
    bus.emit(s.storeId, { type: 'menu', collection: name });
    return { ok: true };
  });

  // ---- registros únicos: tema e dados da loja ----
  app.get(`${S}/kv/:key`, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const key = (req.params as { key: string }).key; const s = req.staff!;
    if (key !== 'theme' && key !== 'store') return fail(reply, 404, 'not_found', 'Registro inexistente.');
    return withTenant(ctx.pools, s.tenantId, async (q) => {
      if (key === 'theme') return { value: (await q`select data from store_themes where store_id = ${s.storeId}`)[0]?.data ?? {} };
      const [st] = await q`select name from stores where id = ${s.storeId}`;
      const [cfg] = await q`select data from store_settings where store_id = ${s.storeId}`;
      return { value: { ...(cfg?.data ?? {}), name: st!.name } };
    });
  });

  app.put(`${S}/kv/:key`, { preHandler: staffGuard(ctx, 'admin.loja') }, async (req, reply) => {
    const key = (req.params as { key: string }).key; const s = req.staff!;
    if (key !== 'theme' && key !== 'store') return fail(reply, 404, 'not_found', 'Registro inexistente.');
    const b = parse(key === 'theme' ? ThemeInput.strict() : StoreInput.strict(), req.body, reply) as Record<string, unknown> | null; if (!b) return;
    await withTenant(ctx.pools, s.tenantId, async (q) => {
      if (key === 'theme') {
        await q`insert into store_themes (store_id, tenant_id, data) values (${s.storeId}, ${s.tenantId}, ${JSON.stringify(b)}::jsonb)
                on conflict (store_id) do update set data = store_themes.data || excluded.data, updated_at = now()`;
      } else {
        const { name, ...rest } = b as { name?: string };
        if (name) await q`update stores set name = ${name} where id = ${s.storeId}`;
        await q`insert into store_settings (store_id, tenant_id, data) values (${s.storeId}, ${s.tenantId}, ${JSON.stringify(rest)}::jsonb)
                on conflict (store_id) do update set data = store_settings.data || excluded.data, updated_at = now()`;
      }
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: `catalog.${key}.update`, ip: req.ip });
    });
    bus.emit(s.storeId, { type: 'menu', collection: key });
    return { ok: true };
  });
}

import { can } from '@pediu/shared';
const hasPerm = (role: Parameters<typeof can>[0], perm: Perm) => can(role, perm);
