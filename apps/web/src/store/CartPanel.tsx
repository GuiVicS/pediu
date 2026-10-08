import { CreditCard, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { useCart } from '@/lib/cart';
import { brl } from '@/lib/format';
import { cx } from '@/ui/kit';
import { useStore } from './StoreContext';
import { Img } from './Img';

export function CartPanel({ flat, emptyText }: { flat?: boolean; emptyText?: string }) {
  const cart = useCart();
  const { theme, store, status, unpublished } = useStore();
  const below = cart.subtotal < store.minOrder;
  const wrap = cx('rounded-theme border border-t-border bg-t-card p-5', !flat && 'sticky top-24 shadow-sm');

  if (cart.lines.length === 0) {
    return (
      <div className={cx(wrap, 'flex flex-col items-center gap-3 py-8 text-center')}>
        <ShoppingBag size={56} className="text-t-primary" />
        <p className="text-sm text-t-muted-fg">{emptyText ?? theme.emptyCartMessage}</p>
      </div>
    );
  }

  return (
    <div className={wrap}>
      <h3 className="mb-3 flex items-center gap-2 font-bold"><ShoppingBag size={18} className="text-t-primary" /> Sua sacola</h3>
      <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
        {cart.lines.map((l) => (
          <div key={l.key} className="flex gap-3 rounded-theme bg-t-muted/50 p-2.5">
            <Img src={l.imageUrl} alt={l.name} fit={l.imageFit} className="h-14 w-14 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{l.name}</div>
              {l.addons.map((a, i) => <div key={i} className="truncate text-xs text-t-muted-fg">+ {a.name}</div>)}
              {l.note && <div className="text-xs italic text-t-muted-fg">Obs: {l.note}</div>}
              <div className="mt-1.5 flex items-center justify-between">
                <div className="flex items-center gap-2 rounded-full border border-t-border bg-t-card px-1">
                  <button aria-label="Diminuir" onClick={() => cart.setQty(l.key, l.qty - 1)} className="p-1">{l.qty === 1 ? <Trash2 size={13} className="text-t-danger" /> : <Minus size={13} />}</button>
                  <span className="min-w-4 text-center text-sm font-semibold">{l.qty}</span>
                  <button aria-label="Aumentar" onClick={() => cart.setQty(l.key, l.qty + 1)} className="p-1"><Plus size={13} /></button>
                </div>
                <span className="text-sm font-bold">{brl(l.unitPrice * l.qty)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-t-border pt-3">
        <span className="font-bold">Subtotal</span>
        <span className="text-xl font-bold text-t-primary">{brl(cart.subtotal)}</span>
      </div>
      {below && <p className="mt-2 text-xs text-t-danger">Pedido mínimo: {brl(store.minOrder)}</p>}
      {!status.open && <p className="mt-2 text-xs text-t-danger">Loja fechada — não é possível finalizar agora.</p>}
      {unpublished && <p className="mt-2 text-xs text-t-danger">Loja em desenvolvimento: os pedidos só são liberados depois da publicação.</p>}
      <button
        disabled={below || !status.open || unpublished}
        onClick={() => window.dispatchEvent(new Event('open-checkout'))}
        className="mt-3 w-full rounded-theme bg-t-primary py-3 font-semibold text-t-primary-fg transition hover:opacity-90 disabled:opacity-40"
      >
        <span className="flex items-center justify-center gap-2"><CreditCard size={18} /> Finalizar pedido</span>
      </button>
    </div>
  );
}
