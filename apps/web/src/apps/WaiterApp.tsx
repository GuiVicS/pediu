import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRightLeft, BellRing, ChefHat, Clock, Loader2, Minus, Plus, Receipt, Search, Send, Trash2, Users, X } from 'lucide-react';
import type { ApiOrder, ApiOrderItem } from '@/lib/types';
import { brl } from '@/lib/format';
import { brlc, useOrders } from '@/lib/orders';
import { useSession } from '@/lib/session';
import { cx, Modal } from '@/ui/kit';
import { ErrorBox, Spinner, useAction, useTick } from '@/ui/misc';
import { useToast } from '@/admin/AdminUI';
import type { Menu } from '@/store/StoreContext';
import AppShell from './AppShell';
import { sumLines, toOrderLines, type Line } from './OrderBuilder';
import { useProductPicker } from './ProductPicker';
import { useStream } from '@/lib/realtime';
import { useStaffMenu } from './menuHook';
import { TableHistory } from './TableHistory';
import { namesLabel } from './tableHistory';

/** Mesa sem pedido novo há este tempo (e sem conta pedida): "parada", vale passar para ver se querem algo. */
const IDLE_MIN = 40;
/** Altura do cabeçalho do AppShell: as barras fixas (busca e filtros) grudam logo abaixo dele. */
const STICKY = 'top-[53px]';

/** Situação da mesa no mapa: cada uma com uma cor (mesmo padrão dos apps de garçom do mercado). */
type TState = 'livre' | 'ocupada' | 'pronto' | 'conta' | 'parada' | 'chamando';
const STATE: Record<TState, { label: string; card: string; dot: string }> = {
  livre: { label: 'Livre', card: 'border-2 border-dashed border-border bg-card text-muted-foreground', dot: 'bg-emerald-500' },
  ocupada: { label: 'Ocupada', card: 'border-2 border-sky-600 bg-sky-500 text-white', dot: 'bg-sky-500' },
  pronto: { label: 'Servir!', card: 'border-2 border-emerald-700 bg-emerald-500 text-white ring-4 ring-emerald-300/60 animate-pulse', dot: 'bg-emerald-500' },
  conta: { label: 'Conta', card: 'border-2 border-violet-700 bg-violet-600 text-white', dot: 'bg-violet-600' },
  parada: { label: 'Parada', card: 'border-2 border-amber-600 bg-amber-400 text-amber-950', dot: 'bg-amber-400' },
  chamando: { label: 'Chamando!', card: 'border-2 border-red-700 bg-red-500 text-white ring-4 ring-red-300/60 animate-pulse', dot: 'bg-red-500' },
};
const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
const lastItemAt = (o: ApiOrder) => o.items.reduce((m, i) => (i.created_at && i.created_at > m ? i.created_at : m), o.created_at);
function stateOf(o?: ApiOrder, calling = false): TState {
  if (calling) return 'chamando';   // o totem da mesa chamou o garçom: vence qualquer outra situação
  if (!o) return 'livre';
  if (o.status === 'pronto') return 'pronto';
  if (o.bill_requested_at) return 'conta';
  return minutesSince(lastItemAt(o)) >= IDLE_MIN ? 'parada' : 'ocupada';
}
const fmtMin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`);

/** App do garçom: mapa de mesas colorido, comanda por mesa em rodadas, envio para a cozinha. Quem recebe a conta é o caixa (PDV). */
export default function WaiterApp() { return <AppShell title="Garçom"><Waiter /></AppShell>; }

function Waiter() {
  const { menu, error } = useStaffMenu();
  const o = useOrders({ open: true, limit: 200, sound: true });
  const toast = useToast();
  const [table, setTable] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  // chamados do totem de mesa (garçom ou conta): ficam marcados até o garçom abrir a mesa
  const [calls, setCalls] = useState<Set<number>>(new Set());
  useStream((e) => {
    if (e.type !== 'call') return;
    setCalls((c) => new Set(c).add(e.table));
    toast(e.kind === 'conta' ? `Mesa ${e.table} pediu a conta` : `Mesa ${e.table} está chamando o garçom`);
    try { navigator.vibrate?.([400, 150, 400, 150, 400]); } catch { /* sem vibração */ }
  }, () => undefined, 60_000);
  const openTable = (n: number) => { setCalls((c) => { const x = new Set(c); x.delete(n); return x; }); setTable(n); };
  useTick();

  // prato pronto: vibra e avisa (o garçom costuma estar com o celular no bolso)
  const prev = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    for (const x of o.orders) {
      if (x.type !== 'mesa') continue;
      const before = prev.current.get(x.id);
      if (before && before !== 'pronto' && x.status === 'pronto') {
        toast(`Mesa ${x.table_number}: pedido pronto para servir`);
        try { navigator.vibrate?.([250, 120, 250]); } catch { /* sem vibração */ }
      }
    }
    prev.current = new Map(o.orders.map((x) => [x.id, x.status]));
  }, [o.orders, toast]);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!menu || !o.ready) return <Spinner />;
  const comanda = (n: number) => o.orders.find((x) => x.type === 'mesa' && x.table_number === n && !['entregue', 'cancelado'].includes(x.status));
  // a quantidade vem da configuração da loja; uma comanda aberta numa mesa "fora da conta" continua aparecendo
  const total = Math.max(menu.tables ?? 20, ...o.orders.filter((x) => x.type === 'mesa' && x.table_number).map((x) => x.table_number!));

  if (table === null) return <TableMap total={total} comanda={comanda} calls={calls} onOpen={openTable} />;
  if (adding) return <AddItems menu={menu} table={table} current={comanda(table)} orders={o} onDone={() => setAdding(false)} />;
  return <TableView table={table} current={comanda(table)} total={total} comanda={comanda} orders={o} onBack={() => setTable(null)} onAdd={() => setAdding(true)} onMoved={setTable} />;
}

type Orders = ReturnType<typeof useOrders>;

// ---------------- mapa de mesas ----------------
function TableMap({ total, comanda, calls, onOpen }: { total: number; comanda: (n: number) => ApiOrder | undefined; calls: Set<number>; onOpen: (n: number) => void }) {
  const [filter, setFilter] = useState<'todas' | TState>('todas');
  const [q, setQ] = useState('');
  const tables = Array.from({ length: total }, (_, i) => i + 1).map((n) => ({ n, c: comanda(n), s: stateOf(comanda(n), calls.has(n)) }));
  const count = (s: TState) => tables.filter((t) => t.s === s).length;
  const shown = tables.filter((t) => (filter === 'todas' || t.s === filter) && (!q || String(t.n).startsWith(q)));
  if (total === 0) return <p className="rounded-ui border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nenhuma mesa cadastrada. Defina a quantidade em Painel → Loja e entrega → Mesas no salão.</p>;
  const chips: ['todas' | TState, string, number][] = [['todas', 'Todas', total], ['chamando', 'Chamando', count('chamando')], ['pronto', 'Servir', count('pronto')], ['conta', 'Conta', count('conta')], ['ocupada', 'Ocupadas', count('ocupada')], ['parada', 'Paradas', count('parada')], ['livre', 'Livres', count('livre')]];
  return (
    <div className="pb-6">
      {count('chamando') > 0 && (
        <button onClick={() => setFilter('chamando')} className="mb-2 flex w-full items-center gap-2 rounded-ui bg-red-500 px-4 py-3 text-left font-semibold text-white shadow-ui active:scale-[.99]">
          <BellRing size={18} className="animate-bounce" /> {count('chamando') === 1 ? '1 mesa chamando o garçom' : `${count('chamando')} mesas chamando o garçom`}
        </button>)}
      {count('pronto') > 0 && (
        <button onClick={() => setFilter('pronto')} className="mb-3 flex w-full items-center gap-2 rounded-ui bg-emerald-500 px-4 py-3 text-left font-semibold text-white shadow-ui active:scale-[.99]">
          <BellRing size={18} className="animate-bounce" /> {count('pronto') === 1 ? '1 mesa com pedido pronto para servir' : `${count('pronto')} mesas com pedido pronto para servir`}
        </button>)}
      <div className={cx('sticky z-20 -mx-4 mb-3 space-y-2 bg-background/95 px-4 pb-2 pt-1 backdrop-blur', STICKY)}>
        <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="w-full rounded-full border border-border bg-card py-2.5 pl-9 pr-3 text-base" inputMode="numeric" placeholder="Número da mesa" value={q} onChange={(e) => setQ(e.target.value.replace(/\D/g, ''))} /></div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {chips.map(([k, label, n]) => (
            <button key={k} onClick={() => setFilter(k)} className={cx('flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition', filter === k ? 'bg-foreground text-background' : 'bg-muted text-foreground')}>
              {k !== 'todas' && <span className={cx('h-2.5 w-2.5 rounded-full', STATE[k].dot)} />}{label}<span className="opacity-60">{n}</span>
            </button>))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2.5 min-[420px]:grid-cols-4 sm:grid-cols-5">
        {shown.map(({ n, c, s }) => (
          <button key={n} onClick={() => onOpen(n)} aria-label={`Mesa ${n}: ${STATE[s].label}`}
            className={cx('relative flex aspect-square flex-col items-center justify-center rounded-ui p-1.5 text-center transition active:scale-95', STATE[s].card)}>
            {c?.guests ? <span className="absolute left-1.5 top-1 flex items-center gap-0.5 text-[10px] font-semibold opacity-90"><Users size={10} />{c.guests}</span> : null}
            {c && <span className="absolute right-1.5 top-1 text-[10px] font-semibold opacity-90">{fmtMin(minutesSince(c.created_at))}</span>}
            <b className="text-2xl leading-none">{n}</b>
            {c?.opened_by_name ? <span className="mt-0.5 max-w-full truncate text-[10px] font-medium opacity-80">{c.opened_by_name.split(' ')[0]}</span> : null}
            {c ? <span className="mt-1 text-xs font-bold">{brlc(c.total_cents)}</span> : <span className="mt-1 text-[11px] font-medium">Livre</span>}
            {s !== 'livre' && s !== 'ocupada' && <span className="mt-0.5 text-[10px] font-extrabold uppercase tracking-wide">{STATE[s].label}</span>}
          </button>))}
        {shown.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Nenhuma mesa neste filtro.</p>}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {(Object.keys(STATE) as TState[]).map((k) => <span key={k} className="flex items-center gap-1"><span className={cx('h-2.5 w-2.5 rounded-full', STATE[k].dot)} />{k === 'pronto' ? 'Pronto p/ servir' : k === 'parada' ? `Sem pedido há ${IDLE_MIN}+ min` : k === 'chamando' ? 'Chamou pelo totem' : STATE[k].label}</span>)}
      </div>
    </div>
  );
}

// ---------------- comanda da mesa ----------------
/** Agrupa os itens por envio à cozinha (rodada): itens lançados juntos têm praticamente o mesmo horário. */
function rounds(items: ApiOrderItem[]) {
  const out: { at: string | null; items: ApiOrderItem[] }[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    const close = last && (!it.created_at || !last.at || Math.abs(new Date(it.created_at).getTime() - new Date(last.at).getTime()) < 90_000);
    if (close) last.items.push(it); else out.push({ at: it.created_at ?? null, items: [it] });
  }
  return out;
}

function TableView({ table, current, total, comanda, orders, onBack, onAdd, onMoved }: {
  table: number; current?: ApiOrder; total: number; comanda: (n: number) => ApiOrder | undefined; orders: Orders; onBack: () => void; onAdd: () => void; onMoved: (n: number) => void;
}) {
  const { can } = useSession(); const toast = useToast(); const act = useAction();
  const [moving, setMoving] = useState(false);
  const s = stateOf(current);
  const guests = current?.guests ?? null;
  const setGuests = (g: number | null) => current && act.run(async () => { await orders.mesa(current.id, { guests: g }); });
  const bill = (v: boolean) => current && act.run(async () => { await orders.mesa(current.id, { bill: v }); toast(v ? `Mesa ${table}: conta pedida ao caixa` : 'Pedido de conta cancelado'); });
  const move = (to: number) => current && act.run(async () => { await orders.mesa(current.id, { table: to }); toast(`Comanda da mesa ${table} foi para a mesa ${to}`); setMoving(false); onMoved(to); });
  const free = Array.from({ length: total }, (_, i) => i + 1).filter((n) => n !== table && !comanda(n));

  return (
    <div className="pb-28">
      <button className="mb-3 flex items-center gap-1.5 text-sm font-medium text-muted-foreground" onClick={onBack}><ArrowLeft size={16} /> Mesas</button>
      <div className={cx('mb-3 flex items-center gap-3 rounded-ui p-4', STATE[s].card.replace('animate-pulse', ''))}>
        <div className="text-4xl font-black leading-none">{table}</div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-wide opacity-80">Mesa · {s === 'pronto' ? 'pedido pronto, servir' : STATE[s].label}</div>
          {current ? <><div className="flex items-center gap-1.5 text-sm"><Clock size={13} /> aberta há {fmtMin(minutesSince(current.created_at))} · #{current.number}</div>
            {(current.opened_by_name || current.staff_names?.length) ? <div className="mt-0.5 flex items-center gap-1.5 text-sm"><Users size={13} /> {current.opened_by_name ? `aberta por ${current.opened_by_name.split(' ')[0]}` : 'comanda'}{(current.staff_names ?? []).filter((n) => n !== current.opened_by_name).length > 0 ? ` · também: ${namesLabel((current.staff_names ?? []).filter((n) => n !== current.opened_by_name))}` : ''}</div> : null}</> : <div className="text-sm">Toque em "Abrir comanda" para lançar os primeiros itens.</div>}
        </div>
        {current && <div className="text-right"><div className="text-xs opacity-80">Total</div><div className="text-xl font-extrabold">{brlc(current.total_cents)}</div></div>}
      </div>
      <ErrorBox>{act.error}</ErrorBox>

      {current && (
        <>
          <div className="card mb-3 flex items-center gap-3 p-3">
            <Users size={18} className="text-muted-foreground" /><span className="flex-1 text-sm font-medium">Pessoas na mesa</span>
            <button className="btn-ghost !p-2" aria-label="Menos pessoas" disabled={act.busy || !guests} onClick={() => setGuests(guests && guests > 1 ? guests - 1 : null)}><Minus size={16} /></button>
            <b className="w-6 text-center text-lg">{guests ?? '–'}</b>
            <button className="btn-ghost !p-2" aria-label="Mais pessoas" disabled={act.busy} onClick={() => setGuests(Math.min(99, (guests ?? 0) + 1))}><Plus size={16} /></button>
            {guests && guests > 1 ? <span className="w-24 text-right text-xs text-muted-foreground">{brlc(Math.ceil(current.total_cents / guests))}/pessoa</span> : null}
          </div>
          <div className="card mb-3 divide-y divide-border">
            {rounds(current.items).map((r, k) => (
              <div key={k} className="p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><ChefHat size={13} /> Rodada {k + 1}{r.at ? ` · ${new Date(r.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</div>
                {r.items.map((it, i) => (
                  <div key={i} className="flex justify-between gap-2 py-1 text-sm">
                    <div className="min-w-0"><b>{it.qty}×</b> {it.name}{it.addons.map((a, j) => <div key={j} className="text-xs text-muted-foreground">+ {a.name}</div>)}{it.note && <div className="text-xs italic text-amber-700 dark:text-amber-400">obs: {it.note}</div>}</div>
                    <span className="shrink-0 tabular-nums">{brlc(it.total_cents)}</span>
                  </div>))}
              </div>))}
          </div>
          <TableHistory orderId={current.id} title={`Histórico da comanda #${current.number}`} version={`${current.items.length}|${current.status}|${current.bill_requested_at ?? ''}|${current.table_number ?? ''}|${current.paid}`} />
          <div className="grid grid-cols-2 gap-2">
            {current.bill_requested_at
              ? <button className="btn-ghost !py-3" disabled={act.busy} onClick={() => bill(false)}><X size={16} /> Cancelar conta</button>
              : <button className="flex items-center justify-center gap-2 rounded-ui-sm bg-violet-600 py-3 text-sm font-semibold text-white active:scale-[.98] disabled:opacity-50" disabled={act.busy} onClick={() => bill(true)}><Receipt size={16} /> Pedir conta</button>}
            <button className="btn-ghost !py-3" disabled={act.busy} onClick={() => setMoving(true)}><ArrowRightLeft size={16} /> Transferir</button>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">{can('pdv') ? 'Para receber, use o PDV (Pedidos e caixa).' : 'Quem recebe a conta é o caixa.'}{current.bill_requested_at ? ` Conta pedida há ${fmtMin(minutesSince(current.bill_requested_at))}.` : ''}</p>
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-3 backdrop-blur" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}>
        <button className="btn mx-auto w-full max-w-2xl !py-3.5 text-base" onClick={onAdd}><Plus size={18} /> {current ? 'Adicionar itens' : 'Abrir comanda'}</button>
      </div>

      <Modal open={moving} onClose={() => setMoving(false)} title={`Transferir a mesa ${table} para…`}>
        {free.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Não há mesa livre.</p> : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">{free.map((n) => <button key={n} disabled={act.busy} onClick={() => move(n)} className="aspect-square rounded-ui-sm border-2 border-dashed border-border text-lg font-bold hover:border-primary hover:bg-primary/5 active:scale-95">{n}</button>)}</div>)}
      </Modal>
    </div>
  );
}

// ---------------- lançar itens (mobile-first) ----------------
function AddItems({ menu, table, current, orders, onDone }: { menu: Menu; table: number; current?: ApiOrder; orders: Orders; onDone: () => void }) {
  const toast = useToast(); const act = useAction();
  const [lines, setLines] = useState<Line[]>([]);
  const [cat, setCat] = useState<string | null>(null); const [q, setQ] = useState('');
  const [review, setReview] = useState(false);
  const [guests, setGuests] = useState(2);
  const picker = useProductPicker(menu, lines, setLines);
  const active = cat ?? menu.categories[0]?.id;
  const products = useMemo(() => menu.products.filter((p) => (q.trim() ? p.name.toLowerCase().includes(q.trim().toLowerCase()) : p.categoryId === active)), [menu.products, q, active]);
  const count = lines.reduce((s, l) => s + l.qty, 0); const total = sumLines(lines);
  const qtyOf = (id: string) => lines.filter((l) => l.productId === id).reduce((s, l) => s + l.qty, 0);
  const setQty = (i: number, qty: number) => setLines(qty <= 0 ? lines.filter((_, k) => k !== i) : lines.map((l, k) => (k === i ? { ...l, qty } : l)));
  const send = () => act.run(async () => {
    if (current) await orders.addItems(current.id, toOrderLines(lines));
    else await orders.create({ type: 'mesa', table, guests, lines: toOrderLines(lines) });
    toast(`Mesa ${table}: ${count} item(ns) enviados para a cozinha`); onDone();
  });
  const leave = () => { if (!lines.length || confirm('Descartar os itens que ainda não foram enviados?')) onDone(); };

  return (
    <div className="pb-28">
      <div className="mb-2 flex items-center gap-2">
        <button className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground" onClick={leave}><ArrowLeft size={16} /> Mesa {table}</button>
        <span className="ml-auto rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-700">{current ? 'Nova rodada' : 'Abrindo comanda'}</span>
      </div>
      <div className={cx('sticky z-20 -mx-4 space-y-2 bg-background/95 px-4 pb-2 pt-1 backdrop-blur', STICKY)}>
        <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className="w-full rounded-full border border-border bg-card py-2.5 pl-9 pr-3 text-base" placeholder="Buscar no cardápio" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {!q && <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">{menu.categories.map((c) => (
          <button key={c.id} onClick={() => setCat(c.id)} className={cx('shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold', active === c.id ? 'bg-primary text-primary-foreground' : 'bg-muted')}>{c.name}</button>))}</div>}
      </div>
      <div className="mt-1 divide-y divide-border overflow-hidden rounded-ui border border-border bg-card">
        {products.map((p) => { const n = qtyOf(p.id); const opts = picker.groupsOf(p).length > 0; return (
          <button key={p.id} disabled={!p.available} onClick={() => picker.addProduct(p)} className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-muted disabled:opacity-50">
            <div className="min-w-0 flex-1"><div className="font-semibold leading-tight">{p.name}</div>
              <div className="text-sm text-muted-foreground">{opts ? 'a partir de ' : ''}{brl(p.price)}{opts ? ' · com opções' : ''}{!p.available ? ' · indisponível' : ''}</div></div>
            {n > 0 && <span className="rounded-full bg-primary px-2.5 py-0.5 text-sm font-bold text-primary-foreground">{n}</span>}
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Plus size={20} /></span>
          </button>); })}
        {products.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Nenhum produto.</p>}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-3 backdrop-blur" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}>
        <button className="btn mx-auto flex w-full max-w-2xl items-center !py-3.5 text-base" disabled={!count} onClick={() => setReview(true)}>
          <span className="rounded-full bg-white/20 px-2 text-sm font-bold">{count}</span><span className="flex-1">{count ? 'Revisar e enviar' : 'Toque nos produtos para adicionar'}</span><b>{brl(total)}</b>
        </button>
      </div>

      <Modal open={review} onClose={() => setReview(false)} title={`Mesa ${table} · enviar para a cozinha`}
        footer={<button className="btn w-full !py-3.5 text-base" disabled={!count || act.busy} onClick={send}>{act.busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} Enviar {count} item(ns) · {brl(total)}</button>}>
        <div className="space-y-3">
          <ErrorBox>{act.error}</ErrorBox>
          {!current && (
            <div className="flex items-center gap-3 rounded-ui-sm bg-muted p-3"><Users size={18} /><span className="flex-1 text-sm font-medium">Pessoas na mesa</span>
              <button className="btn-ghost !p-2" aria-label="Menos pessoas" onClick={() => setGuests(Math.max(1, guests - 1))}><Minus size={16} /></button><b className="w-6 text-center">{guests}</b>
              <button className="btn-ghost !p-2" aria-label="Mais pessoas" onClick={() => setGuests(Math.min(99, guests + 1))}><Plus size={16} /></button></div>)}
          <div className="divide-y divide-border">{lines.map((l, i) => (
            <div key={l.key} className="py-2.5">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1"><div className="font-semibold">{l.name}</div>{l.picks.map((p, k) => <div key={k} className="text-xs text-muted-foreground">+ {p.name}</div>)}<div className="text-sm text-muted-foreground">{brl(l.unitPrice * l.qty)}</div></div>
                <button className="btn-ghost !p-2.5" onClick={() => setQty(i, l.qty - 1)} aria-label="Diminuir">{l.qty === 1 ? <Trash2 size={16} /> : <Minus size={16} />}</button>
                <b className="w-6 text-center text-lg">{l.qty}</b>
                <button className="btn-ghost !p-2.5" onClick={() => setQty(i, l.qty + 1)} aria-label="Aumentar"><Plus size={16} /></button>
              </div>
              <input className="mt-2 w-full rounded-ui-xs border border-border bg-background px-3 py-2 text-sm" placeholder="Observação (ex.: sem cebola, bem passado)" value={l.note} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)))} />
            </div>))}</div>
        </div>
      </Modal>
      {picker.modal}
    </div>
  );
}
