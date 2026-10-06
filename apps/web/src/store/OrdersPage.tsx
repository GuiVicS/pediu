import { useCallback, useEffect, useState } from 'react';
import { Bike, CheckCircle2, ChefHat, ClipboardCheck, ClipboardList, Clock, PackageCheck, QrCode, XCircle, type LucideIcon } from 'lucide-react';
import { get } from '@/lib/api';
import { brl } from '@/lib/format';
import { cx } from '@/ui/kit';
import { loadMyOrders } from './CheckoutModal';
import { useStore } from './StoreContext';

interface Tracked { number: number; status: string; type: string; total_cents: number; created_at: string; store_name: string; items: { name: string; qty: number }[] }
const STEPS_DELIVERY = ['novo', 'preparo', 'pronto', 'saiu', 'entregue'];
const STEPS_LOCAL = ['novo', 'preparo', 'pronto', 'entregue'];
const LABEL: Record<string, string> = { aguardando: 'Aguardando pagamento', novo: 'Recebido', preparo: 'Em preparo', pronto: 'Pronto', saiu: 'Saiu para entrega', entregue: 'Entregue', cancelado: 'Cancelado' };
const ICON: Record<string, LucideIcon> = { novo: ClipboardCheck, preparo: ChefHat, pronto: PackageCheck, saiu: Bike, entregue: CheckCircle2 };
const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? 'agora' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`; };

/** Acompanhamento: o cliente guarda só o token de cada pedido; o status vem do servidor (atualiza a cada 8 s enquanto houver pedido em andamento). */
export default function OrdersPage() {
  const { slug } = useStore();
  const [orders, setOrders] = useState<(Tracked & { token: string })[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const mine = loadMyOrders(slug);
    const res = await Promise.all(mine.map(async (m) => { try { return { ...(await get<Tracked>(`/v1/track/${m.token}`)), token: m.token }; } catch { return null; } }));
    setOrders(res.filter((x): x is Tracked & { token: string } => !!x)); setLoaded(true);
  }, [slug]);
  useEffect(() => { void load(); }, [load]);
  const active = orders.some((o) => !['entregue', 'cancelado'].includes(o.status));
  useEffect(() => { if (!active) return; const t = setInterval(load, 8000); return () => clearInterval(t); }, [active, load]);

  return (
    <div className="mx-auto max-w-2xl px-3 pt-4 md:pt-8">
      <h1 className="mb-4 flex items-center gap-2 text-2xl font-bold"><ClipboardList size={24} /> Meus pedidos</h1>
      {loaded && orders.length === 0 && <p className="rounded-t border border-t-border bg-t-card p-6 text-center text-sm text-t-muted-fg">Você ainda não fez pedidos neste aparelho. Faça um pedido e acompanhe o status aqui.</p>}
      <div className="space-y-3">
        {orders.map((o) => {
          const steps = o.type === 'delivery' ? STEPS_DELIVERY : STEPS_LOCAL;
          const step = steps.indexOf(o.status);
          return (
            <div key={o.token} className="rounded-t border border-t-border bg-t-card p-4">
              <div className="flex items-center justify-between"><div className="font-bold">Pedido #{o.number}</div><span className="flex items-center gap-1 text-xs text-t-muted-fg"><Clock size={12} />{ago(o.created_at)}</span></div>
              {o.status === 'cancelado' ? <div className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-t-danger"><XCircle size={16} /> Pedido cancelado</div>
                : o.status === 'aguardando' ? <div className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-t-primary"><QrCode size={16} /> Aguardando o pagamento</div>
                : (
                  <div className="mt-3 flex items-center gap-1">
                    {steps.map((s, i) => { const Icon = ICON[s]!; return (
                      <div key={s} className="flex flex-1 flex-col items-center gap-1">
                        <Icon size={16} className={i <= step ? 'text-t-primary' : 'text-t-muted-fg'} />
                        <div className={cx('h-1.5 w-full rounded-full', i <= step ? 'bg-t-primary' : 'bg-t-border')} />
                        <span className={cx('text-center text-[10px]', i === step ? 'font-bold' : 'text-t-muted-fg')}>{LABEL[s]}</span>
                      </div>); })}
                  </div>
                )}
              <ul className="mt-3 space-y-0.5 text-sm text-t-muted-fg">{o.items.map((it, i) => <li key={i}>{it.qty}× {it.name}</li>)}</ul>
              <div className="mt-2 flex justify-between border-t border-t-border pt-2 text-sm font-bold"><span>Total</span><span>{brl(o.total_cents / 100)}</span></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
