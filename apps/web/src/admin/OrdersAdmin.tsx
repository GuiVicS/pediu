import { useMemo, useState } from 'react';
import { ArrowRight, Bike, Check, ChefHat, Clock, ConciergeBell, PackageCheck, Printer, Store as StoreIcon, Truck, X } from 'lucide-react';
import type { ApiOrder, OrderStatus } from '@/lib/types';
import { CHANNEL_LABEL, STATUS_LABEL, STATUS_STYLE, brlc, nextLabel, nextOf, timeAgo, useOrders } from '@/lib/orders';
import { Modal, cx } from '@/ui/kit';
import { ErrorBox, useAction, useTick } from '@/ui/misc';
import { useSession } from '@/lib/session';
import { PageHeader, useToast } from './AdminUI';

const COLS: { status: OrderStatus; title: string; Icon: typeof Clock }[] = [
  { status: 'novo', title: 'Novos', Icon: Clock }, { status: 'preparo', title: 'Em preparo', Icon: ChefHat },
  { status: 'pronto', title: 'Prontos', Icon: PackageCheck }, { status: 'saiu', title: 'Saiu p/ entrega', Icon: Bike },
];
export const typeIcon = (o: ApiOrder) => o.type === 'delivery' ? <Bike size={12} /> : o.type === 'mesa' ? <ConciergeBell size={12} /> : o.channel === 'ifood' ? <Truck size={12} /> : <StoreIcon size={12} />;
export const typeLabel = (o: ApiOrder) => o.type === 'mesa' ? `Mesa ${o.table_number}` : o.type === 'delivery' ? 'Entrega' : o.channel === 'pdv' ? 'Balcão' : 'Retirada';

export default function OrdersAdmin() {
  const o = useOrders({ open: true, limit: 200, sound: true });
  const toast = useToast();
  const { can } = useSession();
  const [sel, setSel] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<ApiOrder | null>(null);
  const [reason, setReason] = useState('');
  const act = useAction();
  useTick();
  const current = o.orders.find((x) => x.id === sel) ?? null;
  const byStatus = useMemo(() => Object.fromEntries(COLS.map((c) => [c.status, o.orders.filter((x) => x.status === c.status).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())])), [o.orders]);

  const move = (x: ApiOrder, to: OrderStatus, why?: string) => act.run(async () => {
    const r = await o.setStatus(x.id, to, why);
    toast(r.warning ?? `Pedido #${x.number}: ${STATUS_LABEL[to]}`);
  });

  return (
    <>
      <PageHeader title="Pedidos" subtitle="Pedidos da loja, do balcão, das mesas e do iFood chegam aqui em tempo real" />
      <ErrorBox>{o.error ?? act.error}</ErrorBox>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLS.map(({ status, title, Icon }) => {
          const list = byStatus[status] ?? [];
          return (
            <section key={status} className="rounded-ui bg-muted/60 p-2.5">
              <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold"><Icon size={15} /> {title} <span className="ml-auto rounded-full bg-card px-2 text-xs">{list.length}</span></h2>
              <div className="space-y-2">
                {list.map((x) => (
                  <div key={x.id} onClick={() => setSel(x.id)} className={cx('card cursor-pointer p-3 transition hover:shadow-ui', status === 'novo' && Date.now() - new Date(x.created_at).getTime() > 10 * 60_000 && 'border-destructive')}>
                    <div className="flex items-center justify-between"><b>#{x.number}</b><span className="text-xs text-muted-foreground">{timeAgo(x.created_at)}</span></div>
                    <div className="truncate text-sm">{x.customer_name || '—'}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">{typeIcon(x)}{typeLabel(x)} · {CHANNEL_LABEL[x.channel]} · {x.items.reduce((s, i) => s + i.qty, 0)} itens</div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-bold">{brlc(x.total_cents)}{!x.paid && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-700">a receber</span>}</span>
                      {nextOf(x) && can('admin.pedidos') && <button disabled={act.busy} className="btn !px-2.5 !py-1 text-xs" onClick={(e) => { e.stopPropagation(); void move(x, nextOf(x)!); }}>{nextLabel(x)} <ArrowRight size={12} /></button>}
                    </div>
                  </div>
                ))}
                {list.length === 0 && <div className="py-6 text-center text-xs text-muted-foreground">Nenhum pedido</div>}
              </div>
            </section>
          );
        })}
      </div>

      <Modal open={!!current} onClose={() => setSel(null)} wide title={current ? `Pedido #${current.number}` : ''}
        footer={current && !['entregue', 'cancelado'].includes(current.status) && (
          <>
            {can('orders.cancel') && <button className="btn-danger" onClick={() => { setCancelFor(current); setReason(''); }}><X size={14} /> Cancelar pedido</button>}
            {can('pdv') && <button className="btn-ghost" onClick={() => act.run(async () => { const r = await o.reprint(current.id); toast(`${r.jobs} cupom(ns) enviado(s) para impressão`); })}><Printer size={14} /> Reimprimir</button>}
            {nextOf(current) && <button className="btn" disabled={act.busy} onClick={() => move(current, nextOf(current)!)}><Check size={14} /> {nextLabel(current)}</button>}
          </>
        )}>
        {current && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cx('badge', STATUS_STYLE[current.status])}>{STATUS_LABEL[current.status]}</span>
              <span className="badge bg-muted text-foreground">{CHANNEL_LABEL[current.channel]}</span>
              <span className="text-muted-foreground">{new Date(current.created_at).toLocaleString('pt-BR')}</span>
              <span className={cx('badge', current.paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>{current.paid ? 'Recebido' : 'A receber'}</span>
            </div>
            <div className="grid gap-1 rounded-ui-sm bg-muted/50 p-3">
              <div><b>{current.customer_name || typeLabel(current)}</b> {current.customer_phone && `· ${current.customer_phone}`}</div>
              {current.address && <div>{current.address}</div>}
              <div>Pagamento: {current.payment_method || '—'}{current.change_for_cents ? ` · troco para ${brlc(current.change_for_cents)}` : ''}</div>
              {current.note && <div className="italic">Obs: {current.note}</div>}
              {current.cancel_reason && <div className="text-destructive">Motivo do cancelamento: {current.cancel_reason}</div>}
            </div>
            <div>
              {current.items.map((it, i) => (
                <div key={i} className="flex justify-between border-b border-border py-1.5">
                  <div><b>{it.qty}×</b> {it.name}{it.addons.map((a, k) => <div key={k} className="text-xs text-muted-foreground">+ {a.name}</div>)}{it.note && <div className="text-xs italic text-muted-foreground">obs: {it.note}</div>}</div>
                  <span>{brlc(it.total_cents)}</span>
                </div>
              ))}
              <div className="mt-2 space-y-0.5 text-right"><div>Subtotal {brlc(current.subtotal_cents)}</div>{current.fee_cents > 0 && <div>Entrega {brlc(current.fee_cents)}</div>}{current.discount_cents > 0 && <div>Desconto -{brlc(current.discount_cents)}</div>}<div className="text-base font-bold">Total {brlc(current.total_cents)}</div></div>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!cancelFor} onClose={() => setCancelFor(null)} title={`Cancelar pedido #${cancelFor?.number ?? ''}`}
        footer={<><button className="btn-ghost" onClick={() => setCancelFor(null)}>Voltar</button><button className="btn-danger" disabled={!reason.trim() || act.busy} onClick={async () => { if (cancelFor) { await move(cancelFor, 'cancelado', reason.trim()); setCancelFor(null); setSel(null); } }}><X size={14} /> Confirmar cancelamento</button></>}>
        <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Motivo (obrigatório)</span>
          <input autoFocus className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: cliente desistiu, item em falta…" /></label>
        {cancelFor?.channel === 'ifood' && <p className="mt-2 text-xs text-muted-foreground">O pedido é do iFood: o cancelamento também será pedido ao iFood.</p>}
      </Modal>
    </>
  );
}
