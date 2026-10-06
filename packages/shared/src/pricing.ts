/** Preço sempre calculado no servidor, em centavos inteiros (nunca float). Mesmas regras da demo (pediu-mvp/src/lib/pricing.ts). */
export type PricingMode = 'sum' | 'highest' | 'lowest' | 'average';
export const toCents = (n: number) => Math.round(n * 100);
export const fromCents = (c: number) => c / 100;

export interface AddonDef { id: string; name: string; priceCents: number; active: boolean }
export interface AddonGroupDef { id: string; name: string; min: number; max: number; required: boolean; pricing: PricingMode; active: boolean; addons: AddonDef[] }
export interface ProductDef { id: string; name: string; priceCents: number; active: boolean; available: boolean; groupIds: string[] }
export interface Selection { groupId: string; addonIds: string[] }
export interface PricedAddon { group: string; name: string; priceCents: number }

export function groupPriceCents(mode: PricingMode, prices: number[]): number {
  if (!prices.length) return 0;
  switch (mode) {
    case 'highest': return Math.max(...prices);
    case 'lowest': return Math.min(...prices);
    case 'average': return Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
    default: return prices.reduce((s, p) => s + p, 0);
  }
}

export type PriceResult = { ok: true; unitCents: number; addons: PricedAddon[] } | { ok: false; error: string };

/** Valida a escolha do cliente (grupos do produto, mínimo/máximo, itens ativos) e devolve o preço unitário. Nada vem do navegador além dos ids. */
export function priceLine(product: ProductDef, groups: AddonGroupDef[], selection: Selection[] = []): PriceResult {
  if (!product.active || !product.available) return { ok: false, error: `"${product.name}" está indisponível.` };
  const byId = new Map(groups.map((g) => [g.id, g]));
  const allowed = new Set(product.groupIds);
  for (const s of selection) if (!allowed.has(s.groupId) || !byId.get(s.groupId)?.active) return { ok: false, error: `Grupo de adicionais inválido para "${product.name}".` };

  let unit = product.priceCents;
  const addons: PricedAddon[] = [];
  for (const gid of product.groupIds) {
    const g = byId.get(gid);
    if (!g || !g.active) continue;
    const ids = [...new Set(selection.find((s) => s.groupId === gid)?.addonIds ?? [])];
    const chosen: AddonDef[] = [];
    for (const id of ids) {
      const a = g.addons.find((x) => x.id === id);
      if (!a || !a.active) return { ok: false, error: `Opção inválida ou indisponível em "${g.name}".` };
      chosen.push(a);
    }
    const need = g.required ? Math.max(1, g.min) : g.min;
    if (chosen.length < need) return { ok: false, error: `Escolha ao menos ${need} em "${g.name}".` };
    if (chosen.length > g.max) return { ok: false, error: `Escolha no máximo ${g.max} em "${g.name}".` };
    unit += groupPriceCents(g.pricing, chosen.map((a) => a.priceCents));
    for (const a of chosen) addons.push({ group: g.name, name: a.name, priceCents: a.priceCents });
  }
  return { ok: true, unitCents: unit, addons };
}
