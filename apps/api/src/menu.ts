import type { Q } from '@pediu/db';

/** Cardápio completo de uma loja (categorias, produtos, adicionais, banners, destaques, zonas, pagamentos). Usado pela loja pública e pela equipe. */
export async function loadMenu(q: Q, storeId: string) {
  const [categories, products, groups, banners, featured, zones, payments] = await Promise.all([
    q`select id, name, image_url, image_fit, print_zone_id from categories where store_id = ${storeId} and active order by sort`,
    q`select p.id, p.category_id, p.name, p.description, p.notes, p.price, p.image_url, p.image_fit, p.prep_time, p.available, p.sort,
        coalesce((select jsonb_agg(group_id) from product_addon_groups pg where pg.product_id = p.id), '[]') as group_ids
      from products p join categories c on c.id = p.category_id where p.store_id = ${storeId} and p.active and c.active order by c.sort, p.sort`,
    q`select g.id, g.name, g.description, g.min, g.max, g.required, g.pricing,
        coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price) order by a.sort) from addons a where a.group_id = g.id and a.active), '[]') as addons
      from addon_groups g where g.store_id = ${storeId} and g.active order by g.sort`,
    q`select id, title, description, image_url from banners where store_id = ${storeId} and active order by sort`,
    q`select product_id from featured_products where store_id = ${storeId} and active order by sort`,
    q`select id, name, fee, eta from delivery_zones where store_id = ${storeId} and active order by name`,
    q`select id, name, type, note from payment_methods where store_id = ${storeId} and active order by sort`,
  ]);
  const num = (v: unknown) => Number(v);
  return {
    categories,
    products: products.map((p) => ({ ...p, price: num(p.price) })),
    groups: groups.map((g) => ({ ...g, addons: (g.addons as { id: string; name: string; price: string | number }[]).map((a) => ({ ...a, price: num(a.price) })) })),
    banners, featured: featured.map((f) => f.product_id as string),
    zones: zones.map((z) => ({ ...z, fee: num(z.fee) })), payments,
  };
}
