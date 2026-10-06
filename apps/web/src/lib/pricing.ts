import type { Addon, AddonGroup, CartLine } from './types';

/** Preço de um grupo conforme o modo de cobrança configurado. */
export function groupPrice(group: AddonGroup, selected: Addon[]): number {
  if (selected.length === 0) return 0;
  const prices = selected.map((a) => a.price);
  switch (group.pricing) {
    case 'highest': return Math.max(...prices);
    case 'lowest': return Math.min(...prices);
    case 'average': return prices.reduce((s, p) => s + p, 0) / prices.length;
    default: return prices.reduce((s, p) => s + p, 0);
  }
}

/** Menor valor possível do grupo (usado no "A partir de"). */
export function minGroupPrice(group: AddonGroup, addons: Addon[]): number {
  const need = group.required ? Math.max(1, group.min) : group.min;
  if (need <= 0) return 0;
  const cheapest = [...addons].sort((a, b) => a.price - b.price).slice(0, need);
  return groupPrice(group, cheapest);
}

export const cartTotal = (lines: CartLine[]) => lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
