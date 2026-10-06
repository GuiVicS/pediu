import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { BadgePercent, CreditCard, Image, Layers, LayoutDashboard, ListPlus, Package, Palette, Printer, ShoppingBag, Star, Store as StoreIcon, type LucideIcon } from 'lucide-react';
import { cx } from '@/ui/kit';

const TITLE_ICONS: [string, LucideIcon][] = [['dashboard', LayoutDashboard], ['pedidos', ShoppingBag], ['produtos', Package], ['categorias', Layers], ['adicionais', ListPlus], ['destaques', Star], ['banners', Image], ['aparência', Palette], ['pagamentos', CreditCard], ['impressão', Printer], ['loja', StoreIcon], ['cupons', BadgePercent]];

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">{(() => { const Icon = TITLE_ICONS.find(([k]) => title.toLowerCase().includes(k))?.[1]; return Icon && <Icon size={20} className="text-primary" />; })()}{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-ui border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export function StatusBadge({ on, onLabel = 'Ativo', offLabel = 'Inativo' }: { on: boolean; onLabel?: string; offLabel?: string }) {
  return <span className={cx('badge', on ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground')}>{on ? onLabel : offLabel}</span>;
}

// ---- toasts do painel ----
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<{ id: number; msg: string }[]>([]);
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, msg }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] space-y-2">
        {list.map((t) => <div key={t.id} className="pointer-events-auto rounded-ui-sm bg-foreground px-4 py-2.5 text-sm text-background shadow-ui-lg">{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
