import { useState } from 'react';
import { Banknote, Bike, CheckCircle2, MapPin, MessageCircle, Phone } from 'lucide-react';
import type { ApiOrder } from '@/lib/types';
import { brlc, timeAgo, useOrders } from '@/lib/orders';
import { useSession } from '@/lib/session';
import { cx } from '@/ui/kit';
import { ErrorBox, Spinner, useAction, useTick } from '@/ui/misc';
import { Empty } from '@/admin/AdminUI';
import { useToast } from '@/admin/AdminUI';
import AppShell from './AppShell';
import { ApiError } from '@/lib/api';

type Tab = 'livres' | 'minhas' | 'feitas';

/** App do entregador: entregas prontas, assumir, abrir rota, ligar e confirmar. O servidor garante que cada entrega tem um só dono. */
export default function CourierApp() { return <AppShell title="Entregador"><Courier /></AppShell>; }

function Courier() {
  const { me } = useSession();
  const o = useOrders({ open: false, limit: 200, sound: true });
  const toast = useToast();
  const act = useAction();
  const [tab, setTab] = useState<Tab>('livres');
  useTick();
  if (!o.ready) return <Spinner />;

  const mine = (x: ApiOrder) => x.type === 'delivery' && !!x.courier_id;          // o servidor já filtra: entregas prontas/sem dono ou do próprio entregador
  const lists: Record<Tab, ApiOrder[]> = {
    livres: o.orders.filter((x) => x.type === 'delivery' && x.status === 'pronto' && !x.courier_id),
    minhas: o.orders.filter((x) => mine(x) && x.status === 'saiu'),
    feitas: o.orders.filter((x) => mine(x) && x.status === 'entregue' && x.delivered_at && new Date(x.delivered_at).getTime() >= new Date().setHours(0, 0, 0, 0)),
  };
  const ganhos = lists.feitas.reduce((s, x) => s + x.fee_cents, 0);
  const digits = (s: string) => s.replace(/\D/g, '');
  const take = (x: ApiOrder) => act.run(async () => { try { await o.setStatus(x.id, 'saiu'); toast(`Entrega #${x.number} assumida`); setTab('minhas'); } catch (e) { if (e instanceof ApiError && e.code === 'taken') { toast('Outro entregador já assumiu esta entrega'); void o.reload(); } else throw e; } });
  const done = (x: ApiOrder) => act.run(async () => { await o.setStatus(x.id, 'entregue'); toast(`Entrega #${x.number} concluída`); });

  return (
    <>
      <ErrorBox>{act.error ?? o.error}</ErrorBox>
      <div className="mb-3 grid grid-cols-2 gap-2 text-center text-xs">
        <div className="card p-2"><div className="text-muted-foreground">Entregas hoje</div><b className="text-lg">{lists.feitas.length}</b></div>
        <div className="card p-2"><div className="text-muted-foreground">Taxas de hoje</div><b className="text-lg">{brlc(ganhos)}</b></div>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-1.5">{([['livres', 'Disponíveis'], ['minhas', 'Em rota'], ['feitas', 'Entregues']] as const).map(([t, label]) => (
        <button key={t} onClick={() => setTab(t)} className={cx('rounded-ui-sm py-2 text-sm font-medium', tab === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70')}>{label} <span className="opacity-70">({lists[t].length})</span></button>))}</div>
      <div className="space-y-3">
        {lists[tab].map((x) => { const cash = /dinheiro/i.test(x.payment_method) && !x.paid; return (
          <div key={x.id} className="card space-y-2 p-4">
            <div className="flex items-center justify-between"><b>Pedido #{x.number}</b><span className="text-xs text-muted-foreground">{timeAgo(x.created_at)}</span></div>
            <div className="text-sm"><b>{x.customer_name}</b> · {x.items.reduce((s, i) => s + i.qty, 0)} itens</div>
            <div className="flex items-start gap-1.5 text-sm text-muted-foreground"><MapPin size={14} className="mt-0.5 shrink-0" />{x.address}</div>
            <div className="flex flex-wrap items-center gap-2 text-xs"><span className="badge bg-muted text-foreground">Taxa {brlc(x.fee_cents)}</span>
              {cash ? <span className="badge bg-amber-100 text-amber-700"><Banknote size={11} className="mr-1" />Cobrar {brlc(x.total_cents)}{x.change_for_cents ? ` (troco p/ ${brlc(x.change_for_cents)})` : ''}</span> : <span className="badge bg-green-100 text-green-700">Pago{x.payment_method ? `: ${x.payment_method}` : ''}</span>}</div>
            {x.note && <div className="text-xs italic text-muted-foreground">Obs: {x.note}</div>}
            {tab === 'livres' && <button className="btn w-full !py-3" disabled={act.busy} onClick={() => take(x)}><Bike size={15} /> Assumir entrega</button>}
            {tab === 'minhas' && (
              <div className="grid grid-cols-3 gap-2">
                <a className="btn-ghost" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.address)}`}><MapPin size={14} /> Rota</a>
                <a className="btn-ghost" href={`tel:${digits(x.customer_phone)}`}><Phone size={14} /> Ligar</a>
                <a className="btn-ghost" target="_blank" rel="noreferrer" href={`https://wa.me/55${digits(x.customer_phone)}`}><MessageCircle size={14} /> Zap</a>
                <button className="btn col-span-3 !py-3" disabled={act.busy} onClick={() => done(x)}><CheckCircle2 size={15} /> Confirmar entrega{cash ? ' e recebimento' : ''}</button>
              </div>
            )}
          </div>); })}
        {lists[tab].length === 0 && <Empty>{tab === 'livres' ? 'Nenhuma entrega disponível agora' : tab === 'minhas' ? 'Você não tem entregas em rota' : 'Nenhuma entrega concluída hoje'}</Empty>}
      </div>
      <span className="hidden">{me?.name}</span>
    </>
  );
}
