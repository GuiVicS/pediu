import { useState } from 'react';
import { X } from 'lucide-react';
import type { Menu } from '@/store/StoreContext';
import { priceLine, toCents, type AddonGroupDef, type ProductDef } from '@pediu/shared/browser';
import { brl } from '@/lib/format';
import { cx } from '@/ui/kit';
import type { Line } from './OrderBuilder';

type Product = Menu['products'][number];
type Group = Menu['groups'][number];

/**
 * Adicionar produto ao pedido do operador. Produto sem adicionais entra direto (soma na linha igual); com adicionais abre a janela de opções
 * (o preço mostrado é o mesmo cálculo do servidor). Usado pelo PDV e pelo app do garçom.
 */
export function useProductPicker(menu: Menu, lines: Line[], setLines: (l: Line[]) => void) {
  const [pick, setPick] = useState<{ p: Product; sel: Record<string, string[]>; note: string } | null>(null);
  const groupsOf = (p: Product) => p.groupIds.map((id) => menu.groups.find((g) => g.id === id)).filter((g): g is Group => !!g && g.addons.length > 0);

  const addPlain = (p: Product) => {
    const i = lines.findIndex((l) => l.productId === p.id && !l.note && l.picks.length === 0);
    setLines(i >= 0 ? lines.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l)) : [...lines, { key: crypto.randomUUID(), productId: p.id, name: p.name, unitPrice: p.price, qty: 1, note: '', picks: [] }]);
  };
  const addProduct = (p: Product) => (groupsOf(p).length ? setPick({ p, note: '', sel: Object.fromEntries(groupsOf(p).map((g) => [g.id, g.required && g.max === 1 ? [g.addons[0]!.id] : []])) }) : addPlain(p));

  const priced = pick && (() => {
    const gs = groupsOf(pick.p);
    const defs: AddonGroupDef[] = gs.map((g) => ({ id: g.id, name: g.name, min: g.min, max: g.max, required: g.required, pricing: g.pricing, active: true, addons: g.addons.map((a) => ({ id: a.id, name: a.name, priceCents: toCents(a.price), active: true })) }));
    const def: ProductDef = { id: pick.p.id, name: pick.p.name, priceCents: toCents(pick.p.price), active: true, available: true, groupIds: gs.map((g) => g.id) };
    return { gs, r: priceLine(def, defs, Object.entries(pick.sel).map(([groupId, addonIds]) => ({ groupId, addonIds }))) };
  })();
  const toggle = (g: Group, aid: string) => setPick((cur) => {
    if (!cur) return cur; const list = cur.sel[g.id] ?? [];
    if (list.includes(aid)) return { ...cur, sel: { ...cur.sel, [g.id]: list.filter((x) => x !== aid) } };
    if (g.max === 1) return { ...cur, sel: { ...cur.sel, [g.id]: [aid] } };
    if (list.length >= g.max) return cur;
    return { ...cur, sel: { ...cur.sel, [g.id]: [...list, aid] } };
  });
  const confirmPick = () => {
    if (!pick || !priced?.r.ok) return;
    const picks = priced.gs.flatMap((g) => (pick.sel[g.id] ?? []).map((aid) => ({ groupId: g.id, addonId: aid, name: g.addons.find((a) => a.id === aid)!.name })));
    setLines([...lines, { key: crypto.randomUUID(), productId: pick.p.id, name: pick.p.name, unitPrice: priced.r.unitCents / 100, qty: 1, note: pick.note.trim(), picks }]);
    setPick(null);
  };

  const modal = pick && priced ? (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={() => setPick(null)}>
      <div className="flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl bg-card text-foreground sm:max-w-lg sm:rounded-ui" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3"><h3 className="font-semibold">{pick.p.name}</h3><button onClick={() => setPick(null)} aria-label="Fechar"><X size={18} /></button></div>
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {priced.gs.map((g) => (
            <section key={g.id}>
              <div className="mb-1 flex items-center justify-between text-sm"><b>{g.name}</b><span className="text-xs text-muted-foreground">{g.required ? 'Obrigatório' : 'Opcional'} · {(pick.sel[g.id] ?? []).length}/{g.max}</span></div>
              <div className="divide-y divide-border">{g.addons.map((a) => { const on = (pick.sel[g.id] ?? []).includes(a.id); return (
                <button key={a.id} onClick={() => toggle(g, a.id)} className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm"><span>{a.name}{a.price > 0 && <span className="ml-2 text-xs text-muted-foreground">+ {brl(a.price)}</span>}</span>
                  <span className={cx('flex h-5 w-5 items-center justify-center border-2', g.max === 1 ? 'rounded-full' : 'rounded', on ? 'border-primary bg-primary' : 'border-border')}>{on && <span className="h-2 w-2 rounded-full bg-primary-foreground" />}</span></button>); })}</div>
            </section>
          ))}
          <input className="w-full rounded-ui-xs border border-border bg-background px-2.5 py-2 text-sm" placeholder="Observação" value={pick.note} onChange={(e) => setPick({ ...pick, note: e.target.value })} />
        </div>
        <div className="border-t border-border p-3">
          {!priced.r.ok && <p className="mb-2 text-xs text-destructive">{priced.r.error}</p>}
          <button className="btn w-full !py-3" disabled={!priced.r.ok} onClick={confirmPick}>Adicionar{priced.r.ok ? ` · ${brl(priced.r.unitCents / 100)}` : ''}</button>
        </div>
      </div>
    </div>
  ) : null;

  return { addProduct, groupsOf, modal };
}
