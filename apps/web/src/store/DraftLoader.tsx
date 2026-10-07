import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { groupPrice } from '@/lib/pricing';
import { useStore } from './StoreContext';

interface Draft { type: 'delivery' | 'retirada'; lines: { productId: string; qty: number; note?: string; addons?: { groupId: string; addonIds: string[] }[] }[] }

/** Abre o rascunho montado pelo atendimento (?rascunho=token): coloca os itens no carrinho. O preço final é sempre recalculado no checkout. */
export default function DraftLoader() {
  const [params, setParams] = useSearchParams();
  const { slug, menu } = useStore();
  const cart = useCart();
  const done = useRef(false);
  const token = params.get('rascunho');

  useEffect(() => {
    if (!token || done.current) return;
    done.current = true;
    (async () => {
      try {
        const d = await get<Draft>(`/v1/store/${slug}/drafts/${encodeURIComponent(token)}`);
        cart.clear();
        for (const l of d.lines) {
          const p = menu.products.find((x) => x.id === l.productId);
          if (!p || !p.available) continue;
          const groups = p.groupIds.map((id) => menu.groups.find((g) => g.id === id)).filter((g) => !!g);
          const picked = groups.map((g) => ({ g: g!, items: g!.addons.filter((a) => l.addons?.find((s) => s.groupId === g!.id)?.addonIds.includes(a.id)) }));
          cart.add({
            productId: p.id, name: p.name, categoryId: p.categoryId, imageUrl: p.imageUrl, imageFit: p.imageFit, qty: l.qty, note: l.note ?? '',
            unitPrice: p.price + picked.reduce((s, { g, items }) => s + groupPrice(g, items), 0),
            addons: picked.flatMap(({ g, items }) => items.map((a) => ({ groupId: g.id, addonId: a.id, group: g.name, name: a.name, price: a.price }))),
          });
        }
        cart.setOpen(true);
      } catch { /* link vencido ou inválido: a loja abre normalmente */ }
      finally { const p = new URLSearchParams(params); p.delete('rascunho'); setParams(p, { replace: true }); }
    })();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
