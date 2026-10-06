import { useMemo } from 'react';
import type { Addon, AddonGroup, Product } from '@/lib/types';
import { minGroupPrice } from '@/lib/pricing';
import { useStore } from './StoreContext';

export interface ProductView extends Product { groups: (AddonGroup & { addons: Addon[] })[]; fromPrice: number; hasOptions: boolean }

/** Catálogo da loja já ligado: produtos com seus grupos/adicionais ativos. */
export function useCatalog() {
  const { menu } = useStore();
  return useMemo(() => {
    const products: ProductView[] = menu.products.map((p) => {
      const gs = p.groupIds.map((id) => menu.groups.find((g) => g.id === id)).filter((g): g is AddonGroup & { addons: Addon[] } => !!g && g.addons.length > 0);
      const fromPrice = p.price + gs.reduce((s, g) => s + minGroupPrice(g, g.addons), 0);
      return { ...p, groups: gs, fromPrice, hasOptions: gs.length > 0 };
    });
    return { ready: true, categories: menu.categories, products };
  }, [menu]);
}
