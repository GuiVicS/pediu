import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CartLine } from './types';
import { useStore } from '@/store/StoreContext';

interface CartApi {
  lines: CartLine[]; count: number; subtotal: number;
  add: (l: Omit<CartLine, 'key'>) => void;
  setQty: (key: string, qty: number) => void;
  clear: () => void;
  open: boolean; setOpen: (v: boolean) => void;
}
const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { slug } = useStore();
  const storageKey = `pediu-cart-${slug}`;
  const [lines, setLines] = useState<CartLine[]>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]'); } catch { return []; }
  });
  const [open, setOpen] = useState(false);

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(lines)); }, [lines, storageKey]);

  const api = useMemo<CartApi>(() => ({
    lines, open, setOpen,
    count: lines.reduce((s, l) => s + l.qty, 0),
    subtotal: lines.reduce((s, l) => s + l.unitPrice * l.qty, 0),
    add: (l) => setLines((cur) => [...cur, { ...l, key: `${l.productId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }]),
    setQty: (key, qty) => setLines((cur) => (qty <= 0 ? cur.filter((l) => l.key !== key) : cur.map((l) => (l.key === key ? { ...l, qty } : l)))),
    clear: () => setLines([]),
  }), [lines, open]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error('CartProvider ausente');
  return c;
}
