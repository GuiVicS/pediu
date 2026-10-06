import { useMemo, useState } from 'react';
import { Minus, Plus, Search, Trash2, X } from 'lucide-react';
import type { Menu } from '@/store/StoreContext';
import { priceLine, toCents, type AddonGroupDef, type ProductDef } from '@pediu/shared/browser';
import { brl } from '@/lib/format';
import type { OrderLine } from '@/lib/orders';
import { cx } from '@/ui/kit';

/** Linha do carrinho do operador, com o que o servidor precisa (ids) e o que a tela mostra (nomes). */
export interface Line { key: string; productId: string; name: string; unitPrice: number; qty: number; note: string; picks: { groupId: string; addonId: string; name: string }[] }
export const toOrderLines = (lines: Line[]): OrderLine[] => lines.map((l) => ({
  productId: l.productId, qty: l.qty, note: l.note || undefined,
  addons: Object.values(l.picks.reduce<Record<string, { groupId: string; addonIds: string[] }>>((a, p) => { (a[p.groupId] ??= { groupId: p.groupId, addonIds: [] }).addonIds.push(p.addonId); return a; }, {})),
}));
export const sumLines = (lines: Line[]) => lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);

/** Cardápio por categoria + carrinho. Produtos com adicionais abrem uma janela de opções (o preço mostrado é o mesmo cálculo do servidor). */
export default function OrderBuilder({ menu, lines, setLines, footer }: { menu: Menu; lines: Line[]; setLines: (l: Line[]) => void; footer: (total: number, count: number) => React.ReactNode }) {
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<{ p: Menu['products'][number]; sel: Record<string, string[]>; note: string } | null>(null);
  const cats = menu.categories;
  const active = cat ?? cats[0]?.id;
  const products = useMemo(() => menu.products.filter((p) => (q.trim() ? p.name.toLowerCase().includes(q.trim().toLowerCase()) : p.categoryId === active)), [menu.products, q, active]);
  const groupsOf = (p: Menu['products'][number]) => p.groupIds.map((id) => menu.groups.find((g) => g.id === id)).filter((g): g is Menu['groups'][number] => !!g && g.addons.length > 0);

  const addPlain = (p: Menu['products'][number]) => {
    const i = lines.findIndex((l) => l.productId === p.id && !l.note && l.picks.length === 0);
    setLines(i >= 0 ? lines.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l)) : [...lines, { key: crypto.randomUUID(), productId: p.id, name: p.name, unitPrice: p.price, qty: 1, note: '', picks: [] }]);
  };
  const open = (p: Menu['products'][number]) => (groupsOf(p).length ? setPick({ p, note: '', sel: Object.fromEntries(groupsOf(p).map((g) => [g.id, g.required && g.max === 1 ? [g.addons[0]!.id] : []])) }) : addPlain(p));
  const setQty = (i: number, qty: number) => setLines(qty <= 0 ? lines.filter((_, k) => k !== i) : lines.map((l, k) => (k === i ? { ...l, qty } : l)));

  const priced = pick && (() => {
    const gs = groupsOf(pick.p);
    const defs: AddonGroupDef[] = gs.map((g) => ({ id: g.id, name: g.name, min: g.min, max: g.max, required: g.required, pricing: g.pricing, active: true, addons: g.addons.map((a) => ({ id: a.id, name: a.name, priceCents: toCents(a.price), active: true })) }));
    const def: ProductDef = { id: pick.p.id, name: pick.p.name, priceCents: toCents(pick.p.price), active: true, available: true, groupIds: gs.map((g) => g.id) };
    return { gs, r: priceLine(def, defs, Object.entries(pick.sel).map(([groupId, addonIds]) => ({ groupId, addonIds }))) };
  })();
  const toggle = (g: Menu['groups'][number], aid: string) => setPick((cur) => {
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

  const total = sumLines(lines), count = lines.reduce((s, l) => s + l.qty, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <section>
        <div className="relative mb-3"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="w-full rounded-ui-sm border border-border bg-card py-2 pl-9 pr-3 text-sm" placeholder="Buscar produto…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {!q && <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">{cats.map((c) => <button key={c.id} onClick={() => setCat(c.id)} className={cx('shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium', active === c.id ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70')}>{c.name}</button>)}</div>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {products.map((p) => {
            const n = lines.filter((l) => l.productId === p.id).reduce((s, l) => s + l.qty, 0);
            return (
              <button key={p.id} disabled={!p.available} onClick={() => open(p)} className="card relative flex flex-col items-start gap-1 p-3 text-left transition hover:shadow-ui active:scale-[.98] disabled:opacity-50">
                {n > 0 && <span className="absolute right-2 top-2 rounded-full bg-primary px-2 text-xs font-bold text-primary-foreground">{n}</span>}
                <span className="pr-6 text-sm font-semibold leading-tight">{p.name}</span>
                <span className="text-sm font-bold text-primary">{groupsOf(p).length ? 'a partir de ' : ''}{brl(p.price)}</span>
                {!p.available && <span className="text-[10px] font-semibold text-destructive">Indisponível</span>}
              </button>
            );
          })}
          {products.length === 0 && <div className="col-span-full rounded-ui border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nenhum produto</div>}
        </div>
      </section>
      <aside className="card h-fit p-3 lg:sticky lg:top-20">
        <h2 className="mb-2 text-sm font-semibold">Itens ({count})</h2>
        {lines.length === 0 ? <div className="py-6 text-center text-xs text-muted-foreground">Toque nos produtos para adicionar</div> : (
          <div className="divide-y divide-border">{lines.map((l, i) => (
            <div key={l.key} className="py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 text-sm"><div className="truncate font-medium">{l.name}</div>{l.picks.map((p, k) => <div key={k} className="truncate text-xs text-muted-foreground">+ {p.name}</div>)}<div className="text-xs text-muted-foreground">{brl(l.unitPrice * l.qty)}</div></div>
                <button className="btn-ghost !p-1.5" onClick={() => setQty(i, l.qty - 1)} aria-label="Diminuir">{l.qty === 1 ? <Trash2 size={13} /> : <Minus size={13} />}</button>
                <b className="w-5 text-center text-sm">{l.qty}</b>
                <button className="btn-ghost !p-1.5" onClick={() => setQty(i, l.qty + 1)} aria-label="Aumentar"><Plus size={13} /></button>
              </div>
              <input className="mt-1.5 w-full rounded-ui-xs border border-border bg-background px-2 py-1 text-xs" placeholder="Observação (ex.: sem cebola)" value={l.note} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)))} />
            </div>
          ))}</div>
        )}
        <div className="mt-3 space-y-2 border-t border-border pt-3">{footer(total, count)}</div>
      </aside>

      {pick && priced && (
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
      )}
    </div>
  );
}
