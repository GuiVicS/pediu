import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { Featured, Product } from '@/lib/types';
import { byOrder, moveItem, useCollection } from '@/lib/data';
import { brl } from '@/lib/format';
import { Toggle } from '@/ui/kit';
import { Empty, PageHeader } from './AdminUI';

export default function FeaturedAdmin() {
  const feat = useCollection<Featured>('featured');
  const prods = useCollection<Product>('products');
  const sorted = [...feat.items].sort(byOrder);
  const free = prods.items.filter((p) => !feat.items.some((f) => f.productId === p.id));

  return (
    <>
      <PageHeader title="Destaques" subtitle="Produtos exibidos no carrossel “Destaques” da página inicial" actions={
        <select className="input !w-auto" value="" onChange={(e) => e.target.value && feat.save({ productId: e.target.value, order: sorted.length + 1, active: true })}>
          <option value="">+ Adicionar produto…</option>{free.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      } />
      {sorted.length === 0 ? <Empty>Nenhum destaque. Adicione produtos pelo seletor acima.</Empty> : (
        <div className="space-y-2">
          {sorted.map((f, i) => {
            const p = prods.items.find((x) => x.id === f.productId);
            return (
              <div key={f.id} className="card flex items-center gap-3 p-3">
                <div className="flex flex-col"><button className="p-0.5 text-muted-foreground disabled:opacity-30" disabled={i === 0} onClick={() => moveItem(sorted, f.id, -1, feat.save)}><ArrowUp size={14} /></button><button className="p-0.5 text-muted-foreground disabled:opacity-30" disabled={i === sorted.length - 1} onClick={() => moveItem(sorted, f.id, 1, feat.save)}><ArrowDown size={14} /></button></div>
                {p?.imageUrl ? <img src={p.imageUrl} alt="" className="h-12 w-12 rounded-ui-sm object-cover" /> : <div className="h-12 w-12 rounded-ui-sm bg-muted" />}
                <div className="flex-1"><div className="font-medium">{p?.name ?? 'Produto removido'}</div>{p && <div className="text-xs text-muted-foreground">{brl(p.price)}</div>}</div>
                <Toggle checked={f.active} onChange={(v) => feat.save({ ...f, active: v })} />
                <button className="btn-danger !px-2" onClick={() => feat.remove(f.id)}><Trash2 size={14} /></button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
