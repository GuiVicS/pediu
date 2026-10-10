import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Banknote, Bike, CheckCircle2, Loader2, MapPin, MessageCircle, Navigation, Phone, Route as RouteIcon, X } from 'lucide-react';
import { mapsRouteUrl } from '@pediu/shared/browser';
import type { ApiOrder } from '@/lib/types';
import { brlc, timeAgo, useOrders } from '@/lib/orders';
import { useSession } from '@/lib/session';
import { cx } from '@/ui/kit';
import { ErrorBox, Spinner, useAction, useTick } from '@/ui/misc';
import { Empty } from '@/admin/AdminUI';
import { useToast } from '@/admin/AdminUI';
import AppShell from './AppShell';
import { ApiError, post, put } from '@/lib/api';

type Tab = 'livres' | 'minhas' | 'feitas';
interface PlanStop { id: string; number: number; address: string; group: string; customerName: string; feeCents: number; toCollectCents: number }

/** App do entregador: entregas prontas, assumir uma ou montar uma rota com várias paradas, abrir no mapa, ligar e confirmar. O servidor garante que cada entrega tem um só dono. */
export default function CourierApp() { return <AppShell title="Entregador"><Courier /></AppShell>; }

const digits = (s: string) => s.replace(/\D/g, '');
const move = <T,>(list: T[], i: number, d: -1 | 1): T[] => { const j = i + d; if (j < 0 || j >= list.length) return list; const c = [...list]; [c[i], c[j]] = [c[j]!, c[i]!]; return c; };

function Courier() {
  const { me } = useSession();
  const o = useOrders({ open: false, limit: 200, sound: true });
  const toast = useToast();
  const act = useAction();
  const [tab, setTab] = useState<Tab>('livres');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlanStop[] | null>(null);
  useTick();

  const mine = (x: ApiOrder) => x.type === 'delivery' && !!x.courier_id;          // o servidor já filtra: entregas prontas/sem dono ou do próprio entregador
  const lists = useMemo(() => ({
    livres: o.orders.filter((x) => x.type === 'delivery' && x.status === 'pronto' && !x.courier_id),
    minhas: o.orders.filter((x) => mine(x) && x.status === 'saiu').sort((a, b) => (a.route_id ?? '').localeCompare(b.route_id ?? '') || (a.route_stop ?? 999) - (b.route_stop ?? 999)),
    feitas: o.orders.filter((x) => mine(x) && x.status === 'entregue' && x.delivered_at && new Date(x.delivered_at).getTime() >= new Date().setHours(0, 0, 0, 0)),
  }), [o.orders]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!o.ready) return <Spinner />;

  const ganhos = lists.feitas.reduce((s, x) => s + x.fee_cents, 0);
  const take = (x: ApiOrder) => act.run(async () => { try { await o.setStatus(x.id, 'saiu'); toast(`Entrega #${x.number} assumida`); setTab('minhas'); } catch (e) { if (e instanceof ApiError && e.code === 'taken') { toast('Outro entregador já assumiu esta entrega'); void o.reload(); } else throw e; } });
  const done = (x: ApiOrder) => act.run(async () => { await o.setStatus(x.id, 'entregue'); toast(`Entrega #${x.number} concluída`); });

  // ---- montar rota: escolher entregas → sugestão de ordem → ajustar → iniciar ----
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 12 ? p : [...p, id]));
  const leaveSelect = () => { setSelecting(false); setPicked([]); setPlan(null); };
  const suggest = () => act.run(async () => {
    const r = await post<{ stops: PlanStop[]; unavailable: string[] }>('/v1/staff/routes/suggest', { orderIds: picked });
    if (r.unavailable.length) { toast(`${r.unavailable.length} entrega(s) não estão mais disponíveis e saíram da rota`); void o.reload(); }
    if (r.stops.length === 0) { leaveSelect(); return; }
    setPlan(r.stops);
  });
  const start = () => plan && act.run(async () => {
    try {
      const r = await post<{ stops: { id: string }[]; unavailable: { id: string; number: number | null }[] }>('/v1/staff/routes', { orderIds: plan.map((s) => s.id) });
      toast(r.unavailable.length ? `Rota iniciada com ${r.stops.length} entrega(s). ${r.unavailable.length} já foram assumidas por outro entregador.` : `Rota iniciada: ${r.stops.length} paradas`);
      leaveSelect(); setTab('minhas'); void o.reload();
    } catch (e) { if (e instanceof ApiError && e.code === 'taken') { toast('Essas entregas já foram assumidas por outro entregador'); leaveSelect(); void o.reload(); } else throw e; }
  });
  const reorderRoute = (routeId: string, orderIds: string[]) => act.run(async () => { await put(`/v1/staff/routes/${routeId}/order`, { orderIds }); await o.reload(); });

  // paradas de cada rota em andamento (uma rota = mesmo route_id), na ordem
  const routes = new Map<string, ApiOrder[]>();
  for (const x of lists.minhas) if (x.route_id) routes.set(x.route_id, [...(routes.get(x.route_id) ?? []), x]);
  const loose = lists.minhas.filter((x) => !x.route_id);

  const Info = ({ x, cash }: { x: ApiOrder; cash: boolean }) => (<>
    <div className="text-sm"><b>{x.customer_name}</b> · {x.items.reduce((s, i) => s + i.qty, 0)} itens</div>
    <div className="flex items-start gap-1.5 text-sm text-muted-foreground"><MapPin size={14} className="mt-0.5 shrink-0" />{x.address}</div>
    <div className="flex flex-wrap items-center gap-2 text-xs"><span className="badge bg-muted text-foreground">Taxa {brlc(x.fee_cents)}</span>
      {cash ? <span className="badge bg-amber-100 text-amber-700"><Banknote size={11} className="mr-1" />Cobrar {brlc(x.total_cents)}{x.change_for_cents ? ` (troco p/ ${brlc(x.change_for_cents)})` : ''}</span> : <span className="badge bg-green-100 text-green-700">Pago{x.payment_method ? `: ${x.payment_method}` : ''}</span>}</div>
    {x.note && <div className="text-xs italic text-muted-foreground">Obs: {x.note}</div>}
  </>);
  const Actions = ({ x, cash }: { x: ApiOrder; cash: boolean }) => (
    <div className="grid grid-cols-3 gap-2">
      <a className="btn-ghost" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(x.address.split(' — ')[0]!)}`}><MapPin size={14} /> Rota</a>
      <a className="btn-ghost" href={`tel:${digits(x.customer_phone)}`}><Phone size={14} /> Ligar</a>
      <a className="btn-ghost" target="_blank" rel="noreferrer" href={`https://wa.me/55${digits(x.customer_phone)}`}><MessageCircle size={14} /> Zap</a>
      <button className="btn col-span-3 !py-3" disabled={act.busy} onClick={() => done(x)}><CheckCircle2 size={15} /> Confirmar entrega{cash ? ' e recebimento' : ''}</button>
    </div>
  );

  // ---------- tela de montagem da rota ----------
  if (plan) {
    const fees = plan.reduce((s, p) => s + p.feeCents, 0), collect = plan.reduce((s, p) => s + p.toCollectCents, 0);
    return (
      <>
        <ErrorBox>{act.error ?? o.error}</ErrorBox>
        <div className="mb-3 flex items-center gap-2"><RouteIcon size={20} className="text-primary" /><h1 className="flex-1 text-lg font-bold">Sua rota · {plan.length} paradas</h1><button className="btn-ghost !p-2" aria-label="Cancelar rota" onClick={leaveSelect}><X size={16} /></button></div>
        <p className="mb-3 text-sm text-muted-foreground">Sugerimos esta ordem agrupando por região e CEP, para evitar idas e vindas. Mude com as setas se conhecer um caminho melhor.</p>
        <ol className="space-y-2">
          {plan.map((p, i) => (
            <li key={p.id} className="card flex items-center gap-3 p-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground" aria-label={`Parada ${i + 1}`}>{i + 1}</span>
              <div className="min-w-0 flex-1 text-sm"><div className="flex items-center gap-2"><b>#{p.number}</b><span className="truncate">{p.customerName}</span>{p.toCollectCents > 0 && <span className="badge bg-amber-100 text-amber-700">cobrar {brlc(p.toCollectCents)}</span>}</div>
                <div className="truncate text-muted-foreground">{p.address.split(' — ')[0]}</div><div className="text-xs text-muted-foreground">{p.group}</div></div>
              <div className="flex shrink-0 flex-col gap-1">
                <button className="btn-ghost !p-1.5" aria-label={`Subir parada ${i + 1}`} disabled={i === 0} onClick={() => setPlan(move(plan, i, -1))}><ArrowUp size={14} /></button>
                <button className="btn-ghost !p-1.5" aria-label={`Descer parada ${i + 1}`} disabled={i === plan.length - 1} onClick={() => setPlan(move(plan, i, 1))}><ArrowDown size={14} /></button>
              </div>
            </li>))}
        </ol>
        <div className="my-3 grid grid-cols-2 gap-2 text-center text-xs"><div className="card p-2"><div className="text-muted-foreground">Taxas da rota</div><b className="text-lg">{brlc(fees)}</b></div><div className="card p-2"><div className="text-muted-foreground">A cobrar na porta</div><b className="text-lg">{brlc(collect)}</b></div></div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost !py-3" onClick={() => setPlan([...plan].reverse())}>Inverter ordem</button>
          <button className="btn !py-3" disabled={act.busy} onClick={start}>{act.busy ? <Loader2 size={15} className="animate-spin" /> : <Bike size={15} />} Iniciar rota</button>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">Ao iniciar, as {plan.length} entregas ficam com você.</p>
      </>
    );
  }

  return (
    <>
      <ErrorBox>{act.error ?? o.error}</ErrorBox>
      <div className="mb-3 grid grid-cols-2 gap-2 text-center text-xs">
        <div className="card p-2"><div className="text-muted-foreground">Entregas hoje</div><b className="text-lg">{lists.feitas.length}</b></div>
        <div className="card p-2"><div className="text-muted-foreground">Taxas de hoje</div><b className="text-lg">{brlc(ganhos)}</b></div>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-1.5">{([['livres', 'Disponíveis'], ['minhas', 'Em rota'], ['feitas', 'Entregues']] as const).map(([t, label]) => (
        <button key={t} onClick={() => { setTab(t); if (t !== 'livres') leaveSelect(); }} className={cx('rounded-ui-sm py-2 text-sm font-medium', tab === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70')}>{label} <span className="opacity-70">({lists[t].length})</span></button>))}</div>

      {tab === 'livres' && lists.livres.length >= 2 && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-ui-sm bg-primary/5 p-2.5 text-sm">
          <span className="flex items-center gap-2"><RouteIcon size={16} className="text-primary" aria-hidden /> {selecting ? `${picked.length} selecionada(s)` : 'Várias entregas? Monte uma rota.'}</span>
          <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => (selecting ? leaveSelect() : setSelecting(true))}>{selecting ? 'Cancelar' : 'Montar rota'}</button>
        </div>
      )}

      <div className="space-y-3 pb-20">
        {tab === 'livres' && lists.livres.map((x) => { const cash = /dinheiro/i.test(x.payment_method) && !x.paid; const on = picked.includes(x.id); return (
          <div key={x.id} className={cx('card space-y-2 p-4', selecting && on && 'ring-2 ring-primary')}>
            <div className="flex items-center justify-between"><b className="flex items-center gap-2">{selecting && <input type="checkbox" className="h-5 w-5" checked={on} onChange={() => toggle(x.id)} aria-label={`Selecionar pedido ${x.number}`} />}Pedido #{x.number}</b><span className="text-xs text-muted-foreground">{timeAgo(x.created_at)}</span></div>
            <Info x={x} cash={cash} />
            {!selecting && <button className="btn w-full !py-3" disabled={act.busy} onClick={() => take(x)}><Bike size={15} /> Assumir entrega</button>}
          </div>); })}

        {tab === 'minhas' && [...routes.entries()].map(([rid, stops]) => {
          const url = mapsRouteUrl(stops.map((s) => s.address));
          return (
            <section key={rid} className="space-y-3" aria-label="Rota em andamento">
              <div className="flex flex-wrap items-center gap-2 rounded-ui-sm bg-primary/5 p-2.5 text-sm">
                <RouteIcon size={16} className="text-primary" aria-hidden /><b className="flex-1">Rota · {stops.length} {stops.length === 1 ? 'parada restante' : 'paradas restantes'}</b>
                {url && <a className="btn !px-3 !py-1.5 text-xs" href={url} target="_blank" rel="noreferrer"><Navigation size={13} /> Abrir rota no Google Maps</a>}
              </div>
              {stops.map((x, i) => { const cash = /dinheiro/i.test(x.payment_method) && !x.paid; return (
                <div key={x.id} className={cx('card space-y-2 p-4', i === 0 && 'ring-2 ring-primary')}>
                  <div className="flex items-center gap-2">
                    <span className={cx('flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold', i === 0 ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{i + 1}</span>
                    <b className="flex-1">Pedido #{x.number}{i === 0 && <span className="ml-2 badge bg-primary/10 text-primary">próxima parada</span>}</b>
                    <button className="btn-ghost !p-1.5" aria-label={`Subir pedido ${x.number}`} disabled={act.busy || i === 0} onClick={() => reorderRoute(rid, move(stops, i, -1).map((s) => s.id))}><ArrowUp size={14} /></button>
                    <button className="btn-ghost !p-1.5" aria-label={`Descer pedido ${x.number}`} disabled={act.busy || i === stops.length - 1} onClick={() => reorderRoute(rid, move(stops, i, 1).map((s) => s.id))}><ArrowDown size={14} /></button>
                  </div>
                  <Info x={x} cash={cash} /><Actions x={x} cash={cash} />
                </div>); })}
            </section>);
        })}
        {tab === 'minhas' && loose.map((x) => { const cash = /dinheiro/i.test(x.payment_method) && !x.paid; return (
          <div key={x.id} className="card space-y-2 p-4"><div className="flex items-center justify-between"><b>Pedido #{x.number}</b><span className="text-xs text-muted-foreground">{timeAgo(x.created_at)}</span></div><Info x={x} cash={cash} /><Actions x={x} cash={cash} /></div>); })}
        {tab === 'feitas' && lists.feitas.map((x) => { const cash = /dinheiro/i.test(x.payment_method) && !x.paid; return (
          <div key={x.id} className="card space-y-2 p-4"><div className="flex items-center justify-between"><b>Pedido #{x.number}</b><span className="text-xs text-muted-foreground">{timeAgo(x.created_at)}</span></div><Info x={x} cash={cash} /></div>); })}
        {lists[tab].length === 0 && <Empty>{tab === 'livres' ? 'Nenhuma entrega disponível agora' : tab === 'minhas' ? 'Você não tem entregas em rota' : 'Nenhuma entrega concluída hoje'}</Empty>}
      </div>

      {tab === 'livres' && selecting && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-3 backdrop-blur" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}>
          <button className="btn mx-auto w-full max-w-2xl !py-3.5 text-base" disabled={picked.length < 2 || act.busy} onClick={suggest}>{act.busy ? <Loader2 size={16} className="animate-spin" /> : <RouteIcon size={16} />} {picked.length < 2 ? 'Escolha pelo menos 2 entregas' : `Sugerir ordem das ${picked.length} paradas`}</button>
        </div>
      )}
      <span className="hidden">{me?.name}</span>
    </>
  );
}
