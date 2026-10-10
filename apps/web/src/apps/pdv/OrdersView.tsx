import { useMemo, useState } from 'react';
import { TableHistory } from '../TableHistory';
import { Bike, CalendarDays, Check, ChefHat, ChevronRight, ConciergeBell, Filter, Globe, Loader2, MapPin, Phone, Printer, Search, ShoppingBag, Store as StoreIcon, Truck, User, X } from 'lucide-react';
import type { ApiOrder } from '@/lib/types';
import { STATUS_LABEL, brlc, nextLabel, nextOf, type useOrders } from '@/lib/orders';
import { useSession } from '@/lib/session';
import { Modal, cx } from '@/ui/kit';
import { ErrorBox, useAction } from '@/ui/misc';
import { useToast } from '@/admin/AdminUI';
import { PAY_LABEL } from './shared';

type Orders = ReturnType<typeof useOrders>;
type Origin = 'todos' | 'local' | 'delivery' | 'mesa' | 'online';
const ORIGINS: [Origin, string][] = [['todos', 'Todos'], ['local', 'Balcão e retirada'], ['delivery', 'Delivery'], ['mesa', 'Mesa'], ['online', 'Online']];
const originOf = (o: ApiOrder): Exclude<Origin, 'todos'> => (o.type === 'mesa' ? 'mesa' : o.type === 'delivery' ? 'delivery' : o.channel === 'pdv' ? 'local' : 'online');
const ORIGIN_VIEW = { local: { label: 'Balcão', Icon: StoreIcon }, delivery: { label: 'Delivery', Icon: Bike }, mesa: { label: 'Mesa', Icon: ConciergeBell }, online: { label: 'Online', Icon: Globe } } as const;
const STATUS_TONE: Record<string, string> = { aguardando: 'bg-slate-100 text-slate-700', novo: 'bg-blue-50 text-blue-700', preparo: 'bg-orange-50 text-orange-600', pronto: 'bg-lime-50 text-lime-700', saiu: 'bg-violet-50 text-violet-700', entregue: 'bg-slate-100 text-slate-600', cancelado: 'bg-red-50 text-red-600' };
const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function Chip({ status }: { status: string }) { return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', STATUS_TONE[status])}>{status === 'entregue' ? <Check size={12} /> : status === 'preparo' ? <ChefHat size={12} /> : status === 'saiu' ? <Truck size={12} /> : null}{status === 'entregue' ? 'Entregue' : STATUS_LABEL[status as ApiOrder['status']] ?? status}</span>; }
const PaidChip = ({ paid }: { paid: boolean }) => <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', paid ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>{paid ? <Check size={12} /> : <span className="font-black">!</span>}{paid ? 'Pago' : 'Pendente'}</span>;

/** Histórico do dia: busca, filtro por origem e status, lista e painel de detalhe com as ações do pedido. */
export default function OrdersView({ o, selectedId, onSelect, onReceive }: { o: Orders; selectedId: string | null; onSelect: (id: string | null) => void; onReceive: (order: ApiOrder) => void }) {
  const { can } = useSession();
  const toast = useToast(); const act = useAction();
  const [q, setQ] = useState(''); const [origin, setOrigin] = useState<Origin>('todos'); const [status, setStatus] = useState(''); const [period, setPeriod] = useState<'hoje' | 'abertos' | 'todos'>('hoje'); const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [cancel, setCancel] = useState<ApiOrder | null>(null); const [reason, setReason] = useState('');
  const today = new Date().setHours(0, 0, 0, 0);
  const list = useMemo(() => {
    const term = q.trim().toLowerCase().replace(/^#/, '');
    return [...o.orders].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)).filter((x) =>
      (period === 'todos' || (period === 'abertos' ? !['entregue', 'cancelado'].includes(x.status) : +new Date(x.created_at) >= today))
      && (!onlyUnpaid || (!x.paid && !['cancelado', 'aguardando'].includes(x.status))) && (origin === 'todos' || originOf(x) === origin) && (!status || x.status === status)
      && (!term || String(x.number).includes(term) || x.customer_name.toLowerCase().includes(term) || x.customer_phone.includes(term) || x.items.some((i) => i.name.toLowerCase().includes(term))));
  }, [o.orders, q, origin, status, period, today, onlyUnpaid]);
  const unpaid = o.orders.filter((x) => !x.paid && !['cancelado', 'aguardando'].includes(x.status)).length;
  const sel = o.orders.find((x) => x.id === selectedId) ?? null;
  const move = (x: ApiOrder, to: ApiOrder['status'], why?: string) => act.run(async () => { const r = await o.setStatus(x.id, to, why); toast(r.warning ?? `Pedido #${x.number}: ${STATUS_LABEL[to]}`); });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-3xl font-extrabold tracking-tight">Histórico de pedidos</h1><p className="text-muted-foreground">Acompanhe os pedidos do dia, receba e atualize o andamento.</p></div>
        <label className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5 text-sm font-semibold"><CalendarDays size={17} className="text-primary" />
          <select className="bg-transparent outline-none" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} aria-label="Período"><option value="hoje">Hoje — {new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</option><option value="abertos">Em andamento (qualquer dia)</option><option value="todos">Últimos 200 pedidos</option></select></label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-[16rem] flex-1 items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2.5 focus-within:border-ring"><Search size={18} className="text-muted-foreground" />
          <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Buscar por número, cliente ou item…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar pedidos" /></label>
        <div className="flex flex-wrap gap-1.5 rounded-full bg-muted/60 p-1" role="group" aria-label="Origem">{ORIGINS.map(([k, l]) => <button key={k} onClick={() => setOrigin(k)} aria-pressed={origin === k} className={cx('rounded-full px-4 py-2 text-sm font-semibold transition', origin === k ? 'bg-primary text-primary-foreground shadow-ui-sm' : 'text-foreground/70 hover:bg-card')}>{l}</button>)}</div>
        <button onClick={() => setOnlyUnpaid(!onlyUnpaid)} aria-pressed={onlyUnpaid} className={cx('flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-sm font-semibold transition', onlyUnpaid ? 'border-red-300 bg-red-50 text-red-700' : 'border-border bg-card hover:bg-accent')}>A receber{unpaid > 0 && <span className="rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">{unpaid}</span>}</button>
        <label className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3.5 py-2.5 text-sm font-medium"><Filter size={16} className="text-muted-foreground" />
          <select className="bg-transparent outline-none" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Todos os status</option>{(['novo', 'preparo', 'pronto', 'saiu', 'entregue', 'cancelado'] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
      </div>
      <ErrorBox>{act.error ?? o.error}</ErrorBox>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs font-semibold text-muted-foreground"><tr>{['#', 'Horário', 'Cliente', 'Total', 'Pagamento', 'Status', ''].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {list.map((x) => { const v = ORIGIN_VIEW[originOf(x)]; return (
                  <tr key={x.id} onClick={() => onSelect(x.id)} className={cx('cursor-pointer hover:bg-muted/40', sel?.id === x.id && 'bg-accent hover:bg-accent', x.status === 'cancelado' && 'opacity-60')} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(x.id); }} aria-selected={sel?.id === x.id}>
                    <td className="px-4 py-3 font-bold">{x.number}</td><td className="px-4 py-3">{time(x.created_at)}</td>
                    <td className="px-4 py-3"><div className="font-semibold">{x.customer_name || '—'}</div><div className="flex items-center gap-1 text-xs text-muted-foreground"><v.Icon size={12} />{x.type === 'mesa' ? `Mesa ${x.table_number}` : x.channel === 'ifood' ? 'iFood' : v.label}{x.bill_requested_at && <span className="ml-1 rounded-full bg-violet-600 px-1.5 py-px text-[10px] font-bold uppercase text-white">conta pedida</span>}</div></td>
                    <td className="px-4 py-3 font-bold">{brlc(x.total_cents)}</td><td className="px-4 py-3"><PaidChip paid={x.paid} /></td><td className="px-4 py-3"><Chip status={x.status} /></td>
                    <td className="px-2 py-3 text-muted-foreground"><ChevronRight size={18} /></td></tr>); })}
              </tbody>
            </table>
            {list.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">{o.ready ? 'Nenhum pedido encontrado.' : 'Carregando…'}</div>}
          </div>
        </section>

        <aside className="card h-fit p-5 xl:sticky xl:top-20">
          {!sel ? <div className="py-14 text-center text-sm text-muted-foreground"><ShoppingBag size={34} className="mx-auto mb-2 opacity-40" />Selecione um pedido para ver os detalhes.</div> : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2"><div><h2 className="text-2xl font-extrabold">Pedido #{sel.number}</h2><p className="text-sm text-muted-foreground">{new Date(sel.created_at).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })}</p></div><Chip status={sel.status} /></div>
              <div className="space-y-1.5 rounded-2xl border border-border p-3 text-sm">
                <div className="flex items-center gap-2 font-bold"><User size={16} className="text-primary" />{sel.customer_name || 'Cliente não informado'}<span className="ml-auto rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-primary">{sel.type === 'mesa' ? `Mesa ${sel.table_number}` : ORIGIN_VIEW[originOf(sel)].label}</span>{sel.bill_requested_at && <span className="rounded-full bg-violet-600 px-2.5 py-0.5 text-xs font-bold text-white">Conta pedida</span>}</div>
                {sel.customer_phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone size={14} />{sel.customer_phone}</div>}
                {sel.address && <div className="flex items-start gap-2 text-muted-foreground"><MapPin size={14} className="mt-0.5 shrink-0" />{sel.address}</div>}
              </div>
              <div><h3 className="mb-1 font-bold">Itens do pedido</h3>
                <ul className="divide-y divide-border text-sm">{sel.items.map((i, k) => <li key={k} className="flex justify-between gap-3 py-2"><div><b>{i.qty}×</b> {i.name}{i.addons?.length > 0 && <div className="text-xs text-muted-foreground">{i.addons.map((a) => a.name).join(' · ')}</div>}{i.note && <div className="text-xs text-muted-foreground">{i.note}</div>}</div><b className="shrink-0">{brlc(i.total_cents)}</b></li>)}</ul></div>
              <div className="space-y-1 rounded-2xl bg-muted/60 p-3 text-sm">
                <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{brlc(sel.subtotal_cents)}</span></div>
                {sel.fee_cents > 0 && <div className="flex justify-between text-muted-foreground"><span>Taxa de entrega</span><span>{brlc(sel.fee_cents)}</span></div>}
                {sel.discount_cents > 0 && <div className="flex justify-between text-emerald-700"><span>Desconto</span><span>− {brlc(sel.discount_cents)}</span></div>}
                <div className="flex justify-between pt-1 text-lg font-extrabold"><span>Total</span><span className="text-primary">{brlc(sel.total_cents)}</span></div>
              </div>
              <TableHistory orderId={sel.id} title={sel.type === 'mesa' ? 'Histórico da mesa' : 'Histórico do pedido'} version={`${sel.items.length}|${sel.status}|${sel.paid}|${sel.bill_requested_at ?? ''}|${sel.table_number ?? ''}`} />
              <div className="flex flex-wrap items-center gap-2 text-sm"><PaidChip paid={sel.paid} />
                <span className="text-muted-foreground">{sel.paid ? `${sel.paid_type ? PAY_LABEL[sel.paid_type] : sel.payment_method}${sel.payment_mode ? ` · ${sel.payment_mode === 'tela' ? 'na tela' : 'externo'}` : ''}${sel.payment_ref ? ` · aut. ${sel.payment_ref}` : ''}${sel.change_cents ? ` · troco ${brlc(sel.change_cents)}` : ''}` : sel.payment_method ? `Forma prevista: ${sel.payment_method}` : 'Ainda não recebido'}</span></div>
              {sel.status === 'cancelado' && sel.cancel_reason && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Cancelado: {sel.cancel_reason}</p>}
              {sel.status !== 'cancelado' && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {!sel.paid && <button className="btn !rounded-2xl !py-3 sm:col-span-2" onClick={() => onReceive(sel)}><ShoppingBag size={16} /> Receber {brlc(sel.total_cents)}</button>}
                  <button className="btn-ghost !rounded-2xl !py-3" disabled={act.busy} onClick={() => act.run(async () => { const r = await o.reprint(sel.id); toast(`${r.jobs} cupom(ns) enviado(s)`); })}><Printer size={16} /> Imprimir</button>
                  {nextOf(sel) && sel.type !== 'mesa' ? <button className="btn !rounded-2xl !py-3" disabled={act.busy} onClick={() => move(sel, nextOf(sel)!)}>{act.busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={16} />} {nextLabel(sel)}</button> : <span />}
                  {sel.status !== 'entregue' && can('orders.cancel') && <button className="btn-danger !rounded-2xl !py-3 sm:col-span-2" onClick={() => { setCancel(sel); setReason(''); }}><X size={15} /> Cancelar pedido</button>}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      <Modal open={!!cancel} onClose={() => setCancel(null)} title={`Cancelar pedido #${cancel?.number ?? ''}`}
        footer={<><button className="btn-ghost" onClick={() => setCancel(null)}>Voltar</button><button className="btn-danger" disabled={!reason.trim() || act.busy} onClick={async () => { if (cancel) { await move(cancel, 'cancelado', reason.trim()); setCancel(null); } }}>Cancelar pedido</button></>}>
        <input autoFocus className="input" placeholder="Motivo (obrigatório)" value={reason} onChange={(e) => setReason(e.target.value)} />
        {cancel?.paid && <p className="mt-2 text-xs text-amber-700">Este pedido já foi pago. O cancelamento aparece no fechamento do caixa como cancelamento/estorno; devolver o valor ao cliente é feito por fora.</p>}
      </Modal>
    </div>
  );
}
