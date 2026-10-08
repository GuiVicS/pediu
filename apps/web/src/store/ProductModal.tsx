import { useMemo, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import type { Addon } from '@/lib/types';
import { groupPrice } from '@/lib/pricing';
import { useCart } from '@/lib/cart';
import { brl } from '@/lib/format';
import { cx } from '@/ui/kit';
import { Img } from './Img';
import { useStore } from './StoreContext';
import type { ProductView } from './useCatalog';

export function ProductModal({ product, onClose }: { product: ProductView; onClose: () => void }) {
  const cart = useCart();
  const { theme } = useStore();
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  // seleção inicial: grupos obrigatórios de escolha única já vêm com a 1ª opção marcada
  const [sel, setSel] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(product.groups.map((g) => [g.id, g.required && g.max === 1 ? [g.addons[0].id] : []])));

  const toggle = (gid: string, aid: string, max: number) => setSel((cur) => {
    const list = cur[gid] ?? [];
    if (list.includes(aid)) return { ...cur, [gid]: list.filter((x) => x !== aid) };
    if (max === 1) return { ...cur, [gid]: [aid] };
    if (list.length >= max) return cur;
    return { ...cur, [gid]: [...list, aid] };
  });

  const picked = useMemo(() => product.groups.map((g) => ({ g, items: g.addons.filter((a) => (sel[g.id] ?? []).includes(a.id)) })), [product.groups, sel]);
  const extras = picked.reduce((s, { g, items }) => s + groupPrice(g, items), 0);
  const unit = product.price + extras;
  const missing = picked.filter(({ g, items }) => items.length < (g.required ? Math.max(1, g.min) : g.min));

  function add() {
    cart.add({
      productId: product.id, name: product.name, categoryId: product.categoryId, imageUrl: product.imageUrl, imageFit: product.imageFit,
      qty, unitPrice: unit, note: note.trim(),
      addons: picked.flatMap(({ g, items }) => items.map((a: Addon) => ({ groupId: g.id, addonId: a.id, group: g.name, name: a.name, price: a.price }))),
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div className="flex max-h-[94vh] w-full flex-col overflow-hidden rounded-t-3xl bg-t-card text-t-fg sm:max-w-xl sm:rounded-theme" onMouseDown={(e) => e.stopPropagation()}>
        <div className="relative shrink-0">
          <Img src={product.imageUrl} alt={product.name} fit={product.imageFit} className="h-48 w-full sm:h-56" />
          <button onClick={onClose} aria-label="Fechar" className="absolute right-3 top-3 rounded-full bg-black/50 p-1.5 text-white"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <h2 className="text-xl font-bold">{product.name}</h2>
          <p className="mt-1 text-sm text-t-muted-fg">{product.description}</p>
          <div className="mt-1 text-sm font-semibold text-t-primary">{brl(product.price)}</div>

          {product.groups.map((g) => {
            const count = (sel[g.id] ?? []).length;
            return (
              <section key={g.id} className="mt-5">
                <div className="flex items-center justify-between rounded-lg bg-t-muted px-3 py-2">
                  <div>
                    <div className="text-sm font-bold">{g.name}</div>
                    <div className="text-xs text-t-muted-fg">{g.description || (g.max === 1 ? 'Escolha 1' : `Escolha até ${g.max}`)}</div>
                  </div>
                  <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', g.required ? 'bg-t-primary text-t-primary-fg' : 'bg-t-border text-t-muted-fg')}>
                    {g.required ? 'Obrigatório' : 'Opcional'} · {count}/{g.max}
                  </span>
                </div>
                <div className="mt-1 divide-y divide-t-border">
                  {g.addons.map((a) => {
                    const on = (sel[g.id] ?? []).includes(a.id);
                    const full = !on && g.max > 1 && count >= g.max;
                    return (
                      <button key={a.id} disabled={full} onClick={() => toggle(g.id, a.id, g.max)} className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left disabled:opacity-40">
                        <span className="text-sm">{a.name}{a.price > 0 && <span className="ml-2 text-xs text-t-muted-fg">+ {brl(a.price)}</span>}</span>
                        <span className={cx('flex h-5 w-5 items-center justify-center border-2', g.max === 1 ? 'rounded-full' : 'rounded', on ? 'border-t-primary bg-t-primary' : 'border-t-border')}>
                          {on && <span className="h-2 w-2 rounded-full bg-t-primary-fg" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <label className="mt-5 block text-sm font-semibold">Alguma observação?
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ex.: sem cebola"
              className="mt-1 w-full rounded-lg border border-t-border bg-t-bg p-2 text-sm font-normal outline-none" />
          </label>
        </div>
        <div className="flex shrink-0 items-center gap-3 border-t border-t-border p-4">
          <div className="flex items-center gap-3 rounded-full border border-t-border px-2 py-1">
            <button aria-label="Diminuir" onClick={() => setQty((q) => Math.max(1, q - 1))} className="p-1"><Minus size={16} /></button>
            <span className="min-w-5 text-center font-semibold">{qty}</span>
            <button aria-label="Aumentar" onClick={() => setQty((q) => q + 1)} className="p-1"><Plus size={16} /></button>
          </div>
          <button disabled={missing.length > 0} onClick={add}
            className="flex-1 rounded-theme bg-t-primary py-3 text-sm font-semibold text-t-primary-fg transition hover:opacity-90 disabled:opacity-40">
            {missing.length ? `Escolha: ${missing[0].g.name}` : `Adicionar · ${brl(unit * qty)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
