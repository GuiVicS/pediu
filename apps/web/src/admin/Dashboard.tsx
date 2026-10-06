import { useCallback, useEffect, useState } from 'react';
import { Banknote, BarChart3, Receipt, ShoppingBag, Timer, Trophy, XCircle } from 'lucide-react';
import { get } from '@/lib/api';
import { brlc } from '@/lib/orders';
import { useStream } from '@/lib/realtime';
import { cx } from '@/ui/kit';
import { Spinner } from '@/ui/misc';
import { PageHeader } from './AdminUI';

interface Stats { orders: number; cancelled: number; cancelRate: number; revenueCents: number; avgTicketCents: number; avgPrepMin: number | null; avgDeliveryMin: number | null }
interface Dash { today: Stats; week: Stats; open: Record<string, number>; byHour: { hour: number; orders: number }[]; topProducts: { name: string; qty: number; revenue_cents: number }[]; byChannel: { channel: string; orders: number; revenue_cents: number }[]; toReceive: { orders: number; cents: number } }
const CHANNEL = { loja: 'Loja online', pdv: 'Balcão', garcom: 'Garçom', ifood: 'iFood' } as Record<string, string>;

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { try { setD(await get<Dash>('/v1/staff/dashboard')); setErr(null); } catch (e) { setErr((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  useStream((e) => { if (e.type === 'order') void load(); }, load, 60_000);
  if (err) return <div className="rounded-ui-sm bg-destructive/10 p-4 text-sm text-destructive">{err}</div>;
  if (!d) return <Spinner />;

  const cards = [
    { label: 'Pedidos hoje', value: String(d.today.orders), Icon: ShoppingBag, color: 'bg-accent text-accent-foreground' },
    { label: 'Faturamento hoje', value: brlc(d.today.revenueCents), Icon: Banknote, color: 'bg-green-100 text-green-700' },
    { label: 'Ticket médio (7 dias)', value: brlc(d.week.avgTicketCents), Icon: Receipt, color: 'bg-amber-100 text-amber-700' },
    { label: 'Cancelamentos (7 dias)', value: `${Math.round(d.week.cancelRate * 100)}%`, Icon: XCircle, color: d.week.cancelRate > 0.2 ? 'bg-red-100 text-red-700' : 'bg-rose-100 text-rose-700' },
  ];
  const maxH = Math.max(1, ...d.byHour.map((h) => h.orders));
  const maxTop = Math.max(1, ...d.topProducts.map((p) => p.qty));
  const openTotal = Object.values(d.open).reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHeader title="Dashboard" subtitle="O dia e os últimos 7 dias da sua loja" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ label, value, Icon, color }) => (
          <div key={label} className="card flex items-center gap-3 p-4"><div className={cx('rounded-ui-sm p-2.5', color)}><Icon size={20} /></div><div><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-bold">{value}</div></div></div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="card p-4 text-sm"><div className="text-xs text-muted-foreground">Em andamento agora</div><b className="text-lg">{openTotal}</b><div className="mt-1 text-xs text-muted-foreground">{Object.entries(d.open).map(([s, n]) => `${n} ${s}`).join(' · ') || 'nenhum'}</div></div>
        <div className="card p-4 text-sm"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Timer size={13} /> Tempos médios (7 dias)</div><div className="mt-1">Preparo <b>{d.week.avgPrepMin ?? '—'} min</b> · Entrega <b>{d.week.avgDeliveryMin ?? '—'} min</b></div></div>
        <div className="card p-4 text-sm"><div className="text-xs text-muted-foreground">A receber</div><b className="text-lg">{brlc(d.toReceive.cents)}</b><div className="text-xs text-muted-foreground">{d.toReceive.orders} pedido(s) ainda não recebido(s)</div></div>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Trophy size={16} className="text-amber-500" /> Mais vendidos (7 dias)</h2>
          {d.topProducts.length === 0 && <p className="text-sm text-muted-foreground">Sem vendas ainda.</p>}
          <div className="space-y-2.5">{d.topProducts.map((p) => (
            <div key={p.name}><div className="flex justify-between text-sm"><span>{p.name}</span><span className="font-semibold">{p.qty}</span></div><div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(p.qty / maxTop) * 100}%` }} /></div></div>
          ))}</div>
        </section>
        <section className="card p-4">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><BarChart3 size={16} className="text-primary" /> Pedidos por hora (hoje)</h2>
          {d.byHour.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum pedido hoje.</p> : (
            <div className="flex h-32 items-end gap-1">{Array.from({ length: 24 }, (_, h) => d.byHour.find((x) => x.hour === h)?.orders ?? 0).map((n, h) => (
              <div key={h} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${h}h: ${n}`}><div className="w-full rounded-t bg-primary/80" style={{ height: `${(n / maxH) * 100}%`, minHeight: n ? 3 : 0 }} /><span className="text-[9px] text-muted-foreground">{h % 3 === 0 ? h : ''}</span></div>
            ))}</div>
          )}
          <div className="mt-4 space-y-1 text-sm">{d.byChannel.map((c) => <div key={c.channel} className="flex justify-between"><span>{CHANNEL[c.channel] ?? c.channel}</span><span><b>{c.orders}</b> · {brlc(c.revenue_cents)}</span></div>)}</div>
        </section>
      </div>
    </>
  );
}
