import { createContext, useContext } from 'react';
import type { Addon, AddonGroup, Banner, Category, DeliveryZone, PaymentMethod, Product, Store, Theme } from '@/lib/types';

export interface Menu {
  categories: (Category & { image_url?: string })[]; products: Product[]; groups: (AddonGroup & { addons: Addon[] })[];
  banners: Banner[]; featured: string[]; zones: DeliveryZone[]; payments: PaymentMethod[];
  /** só no cardápio da equipe: mesas do salão */
  tables?: number;
}
/** landingUrl: link da landing page da plataforma (rodapé de todas as lojas); vem da configuração do super admin. */
export interface StoreCtx { slug: string; theme: Theme; store: Store; status: { open: boolean; label: string }; /** loja ainda em desenvolvimento: só a equipe vê; pedidos desativados */ unpublished: boolean; menu: Menu; landingUrl: string; reload: () => Promise<void> }
export const StoreContext = createContext<StoreCtx | null>(null);
export const useStore = () => {
  const c = useContext(StoreContext);
  if (!c) throw new Error('StoreContext ausente');
  return c;
};

/** O servidor devolve nomes de coluna (snake_case) no cardápio público; aqui viram os tipos da interface. */
export function normalizeMenu(raw: any): Menu {
  const img = (x: any) => x.image_url ?? x.imageUrl ?? '';
  return {
    ...(typeof raw.tables === 'number' ? { tables: raw.tables } : {}),
    categories: raw.categories.map((c: any, i: number) => ({ id: c.id, name: c.name, imageUrl: img(c), imageFit: c.image_fit ?? 'cover', order: i, active: true, printZoneId: c.print_zone_id ?? null })),
    products: raw.products.map((p: any, i: number) => ({ id: p.id, categoryId: p.category_id, name: p.name, description: p.description ?? '', notes: p.notes ?? '', price: Number(p.price), imageUrl: img(p), imageFit: p.image_fit ?? 'cover',
      prepTime: p.prep_time ?? 0, active: true, available: p.available, order: i, groupIds: p.group_ids ?? [] })),
    groups: raw.groups.map((g: any, i: number) => ({ id: g.id, name: g.name, description: g.description ?? '', min: g.min, max: g.max, required: g.required, pricing: g.pricing, order: i, active: true,
      addons: g.addons.map((a: any, k: number) => ({ id: a.id, groupId: g.id, name: a.name, price: Number(a.price), order: k, active: true })) })),
    banners: raw.banners.map((b: any, i: number) => ({ id: b.id, title: b.title, description: b.description, imageUrl: img(b), order: i, active: true })),
    featured: raw.featured ?? [],
    zones: raw.zones.map((z: any) => ({ id: z.id, name: z.name, fee: Number(z.fee), eta: z.eta, active: true })),
    payments: raw.payments.map((p: any, i: number) => ({ id: p.id, name: p.name, type: p.type, note: p.note ?? '', order: i, active: true, online: !!p.online, gateway: p.gateway ?? null })),
  };
}
