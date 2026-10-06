import { useState } from 'react';
import { ArrowLeft, Loader2, Plus, Receipt } from 'lucide-react';
import type { ApiOrder } from '@/lib/types';
import { STATUS_LABEL, STATUS_STYLE, brlc, timeAgo, useOrders } from '@/lib/orders';
import { useSession } from '@/lib/session';
import { cx } from '@/ui/kit';
import { ErrorBox, Spinner, useAction, useTick } from '@/ui/misc';
import { useToast } from '@/admin/AdminUI';
import AppShell from './AppShell';
import OrderBuilder, { sumLines, toOrderLines, type Line } from './OrderBuilder';
import { useStaffMenu } from './menuHook';

const TABLES = 20;

/** App do garçom: mapa de mesas, comanda por mesa, envio para a cozinha. Quem recebe a conta é o caixa (PDV). */
export default function WaiterApp() { return <AppShell title="Garçom — Mesas"><Waiter /></AppShell>; }

function Waiter() {
  const { menu, error } = useStaffMenu();
  const o = useOrders({ open: true, limit: 200, sound: true });
  const toast = useToast();
  const { can } = useSession();
  const act = useAction();
  const [table, setTable] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  useTick();
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!menu || !o.ready) return <Spinner />;

  const comanda = (n: number) => o.orders.find((x) => x.type === 'mesa' && x.table_number === n && !['entregue', 'cancelado'].includes(x.status));
  const send = (current?: ApiOrder) => act.run(async () => {
    if (current) await o.addItems(current.id, toOrderLines(lines)); else await o.create({ type: 'mesa', table: table!, lines: toOrderLines(lines) });
    toast(`Mesa ${table}: ${lines.reduce((s, l) => s + l.qty, 0)} item(ns) enviados para a cozinha`); setLines([]); setAdding(false);
  });

  if (table === null) {
    const occupied = Array.from({ length: TABLES }, (_, i) => comanda(i + 1)).filter(Boolean).length;
    return (
      <>
        <p className="mb-3 text-sm text-muted-foreground">{occupied} de {TABLES} mesas ocupadas. Toque numa mesa para abrir ou ver a comanda.</p>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
          {Array.from({ length: TABLES }, (_, i) => i + 1).map((n) => { const c = comanda(n); const pronto = c?.status === 'pronto'; return (
            <button key={n} onClick={() => setTable(n)} className={cx('card flex aspect-square flex-col items-center justify-center gap-0.5 p-1.5 transition active:scale-95', c ? (pronto ? 'border-green-500 bg-green-50 dark:bg-green-950' : 'border-amber-400 bg-amber-50 dark:bg-amber-950') : 'hover:bg-muted')}>
              <b className="text-xl">{n}</b>{c ? <><span className="text-xs font-semibold">{brlc(c.total_cents)}</span><span className="text-[10px]">{pronto ? 'Pronto' : STATUS_LABEL[c.status]}</span></> : <span className="text-[11px] text-green-700">Livre</span>}
            </button>); })}
        </div>
      </>
    );
  }

  const current = comanda(table);
  const back = <button className="btn-ghost mb-3" onClick={() => { if (adding) { setAdding(false); setLines([]); } else setTable(null); }}><ArrowLeft size={14} /> {adding ? 'Comanda' : 'Mesas'}</button>;
  if (adding) return (<>{back}<h2 className="mb-3 text-lg font-bold">Mesa {table} — adicionar itens</h2><ErrorBox>{act.error}</ErrorBox>
    <OrderBuilder menu={menu} lines={lines} setLines={setLines} footer={() => (<><div className="flex justify-between text-lg font-extrabold"><span>Subtotal</span><span>{brlc(Math.round(sumLines(lines) * 100))}</span></div><button className="btn w-full !py-3" disabled={lines.length === 0 || act.busy} onClick={() => send(current)}>{act.busy && <Loader2 className="animate-spin" size={16} />} Enviar para a cozinha</button></>)} /></>);

  return (
    <>
      {back}
      <div className="card space-y-3 p-4">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Mesa {table}</h2>{current ? <span className={cx('badge', STATUS_STYLE[current.status])}>{STATUS_LABEL[current.status]}</span> : <span className="badge bg-green-100 text-green-700">Livre</span>}</div>
        {!current ? <p className="py-4 text-center text-sm text-muted-foreground">Mesa livre. Abra a comanda adicionando os primeiros itens.</p> : (
          <>
            <div className="text-xs text-muted-foreground">Comanda #{current.number} · aberta há {timeAgo(current.created_at)}</div>
            <div className="divide-y divide-border">{current.items.map((it, i) => (
              <div key={i} className="flex justify-between py-2 text-sm"><div><b>{it.qty}×</b> {it.name}{it.addons.map((a, k) => <div key={k} className="text-xs text-muted-foreground">+ {a.name}</div>)}{it.note && <div className="text-xs italic text-muted-foreground">obs: {it.note}</div>}</div><span>{brlc(it.total_cents)}</span></div>))}</div>
            <div className="flex justify-between border-t border-border pt-2 text-lg font-extrabold"><span>Total</span><span>{brlc(current.total_cents)}</span></div>
          </>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <button className="btn !py-3" onClick={() => setAdding(true)}><Plus size={15} /> {current ? 'Adicionar itens' : 'Abrir comanda'}</button>
          {current && (can('pdv')
            ? <p className="self-center text-xs text-muted-foreground">Para receber, use o PDV (aba "Pedidos e caixa").</p>
            : <p className="flex items-center gap-1.5 self-center text-xs text-muted-foreground"><Receipt size={13} /> O caixa recebe a conta desta mesa.</p>)}
        </div>
      </div>
    </>
  );
}
