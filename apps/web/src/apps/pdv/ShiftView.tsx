import { useCallback, useEffect, useState } from 'react';
import { Banknote, BarChart3, Calculator, Check, CreditCard, Landmark, Loader2, Lock, LockOpen, Minus, Plus, Printer, QrCode, ReceiptText, Scale, TrendingUp, Users, Wallet } from 'lucide-react';
import { ApiError, get, post } from '@/lib/api';
import { brlc } from '@/lib/orders';
import { useSession } from '@/lib/session';
import { Modal, cx } from '@/ui/kit';
import { ErrorBox, Spinner } from '@/ui/misc';
import { useToast } from '@/admin/AdminUI';
import { Keypad, PAY_LABEL, ChipStatus } from './shared';

export interface CashSession { id: string; openedBy: string; openedAt: string; openingCents: number; openingBreakdown: Record<string, number>; closedAt: string | null; countedCents: number | null; expectedCents: number | null; differenceCents: number | null; note: string }
export interface CashSummary {
  byMethod: { type: string; method: string; orders: number; cents: number }[];
  totals: { orders: number; revenueCents: number; avgTicketCents: number; itemsSold: number; customers: number };
  cancelled: { orders: number; cents: number }; cash: { openingCents: number; salesCents: number; expectedCents: number };
}
interface Current { session: CashSession | null; summary: CashSummary | null }

/** Turno de caixa do operador (aberto/fechado) e o resumo ao vivo. */
export function useCash() {
  const [data, setData] = useState<Current | null>(null);
  const reload = useCallback(async () => { try { setData(await get<Current>('/v1/staff/cash/current')); } catch { setData((d) => d ?? { session: null, summary: null }); } }, []);
  useEffect(() => { void reload(); const t = setInterval(reload, 30_000); return () => clearInterval(t); }, [reload]);
  return { ...(data ?? { session: null, summary: null }), ready: data !== null, reload };
}

const DENOMS: { key: string; cents: number; label: string; tone: string }[] = [
  { key: '100', cents: 10000, label: 'R$ 100,00', tone: 'bg-teal-100 text-teal-800' }, { key: '50', cents: 5000, label: 'R$ 50,00', tone: 'bg-orange-100 text-orange-800' },
  { key: '20', cents: 2000, label: 'R$ 20,00', tone: 'bg-yellow-100 text-yellow-800' }, { key: '10', cents: 1000, label: 'R$ 10,00', tone: 'bg-rose-100 text-rose-800' },
  { key: '5', cents: 500, label: 'R$ 5,00', tone: 'bg-purple-100 text-purple-800' }, { key: '2', cents: 200, label: 'R$ 2,00', tone: 'bg-slate-200 text-slate-700' },
  { key: '1', cents: 100, label: 'R$ 1,00', tone: 'bg-amber-200 text-amber-900' }, { key: '0.5', cents: 50, label: 'R$ 0,50', tone: 'bg-zinc-200 text-zinc-700' },
  { key: '0.25', cents: 25, label: 'R$ 0,25', tone: 'bg-amber-100 text-amber-800' }, { key: '0.1', cents: 10, label: 'R$ 0,10', tone: 'bg-amber-100 text-amber-800' }, { key: '0.05', cents: 5, label: 'R$ 0,05', tone: 'bg-orange-100 text-orange-800' },
];
const dayTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const METHOD_ICON: Record<string, typeof Banknote> = { cash: Banknote, pix: QrCode, credit: CreditCard, debit: CreditCard, voucher: ReceiptText };
const METHOD_TONE: Record<string, string> = { cash: 'bg-emerald-600', pix: 'bg-teal-500', credit: 'bg-blue-600', debit: 'bg-violet-600', voucher: 'bg-amber-500' };

export default function ShiftView({ cash }: { cash: ReturnType<typeof useCash> }) {
  const [closed, setClosed] = useState<{ session: CashSession; summary: CashSummary } | null>(null);
  if (!cash.ready) return <Spinner />;
  if (closed) return <ClosedReport r={closed} onNew={() => { setClosed(null); void cash.reload(); }} />;
  return cash.session && cash.summary ? <CloseShift session={cash.session} summary={cash.summary} onClosed={(r) => { setClosed(r); void cash.reload(); }} /> : <OpenShift onOpened={() => void cash.reload()} />;
}

// ---------------- abertura ----------------
function OpenShift({ onOpened }: { onOpened: () => void }) {
  const { me } = useSession(); const toast = useToast();
  const [value, setValue] = useState(0); const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const used = Object.values(counts).some((n) => n > 0);
  const setCount = (key: string, cents: number, delta: number) => {
    const next = { ...counts, [key]: Math.max(0, (counts[key] ?? 0) + delta) };
    setCounts(next); setValue(DENOMS.reduce((s, d) => s + d.cents * (next[d.key] ?? 0), 0));   // o valor passa a ser a soma das cédulas e moedas
  };
  const open = async () => {
    setBusy(true); setError(null);
    try { const breakdown = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)); await post('/v1/staff/cash/open', { openingCents: value, ...(used ? { breakdown } : {}) }); toast('Caixa aberto'); onOpened(); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível abrir o caixa.'); } finally { setBusy(false); }
  };
  const now = new Date();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4"><span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-primary"><Calculator size={34} /></span><div><h1 className="text-3xl font-extrabold tracking-tight">Abertura de caixa</h1><p className="text-muted-foreground">Informe o valor inicial em dinheiro para abrir o caixa.</p></div></div>
      <ErrorBox>{error}</ErrorBox>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_20rem]">
        <section className="card p-5"><h2 className="text-xl font-extrabold">Valor de abertura</h2><p className="mb-3 text-sm text-muted-foreground">Digite o valor inicial que há em dinheiro no caixa.</p>
          <div className="mb-4 rounded-2xl border-2 border-primary bg-accent/40 px-5 py-4 text-4xl font-extrabold" aria-live="polite">{brlc(value)}</div>
          <Keypad value={value} onChange={(v) => { setValue(v); setCounts({}); }} /></section>
        <section className="card p-5"><h2 className="text-xl font-extrabold">Detalhamento por cédulas e moedas</h2><p className="mb-3 text-sm text-muted-foreground">Opcional: informe quantas cédulas e moedas você tem. O valor de abertura passa a ser a soma.</p>
          <ul className="divide-y divide-border">{DENOMS.map((d) => (
            <li key={d.key} className="flex items-center gap-3 py-2"><span className={cx('flex h-10 w-16 items-center justify-center rounded-lg text-xs font-bold', d.tone)}>{d.cents >= 200 ? 'nota' : 'moeda'}</span><span className="flex-1 font-semibold">{d.label}</span>
              <button className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted hover:bg-muted/70" onClick={() => setCount(d.key, d.cents, -1)} aria-label={`Menos ${d.label}`}><Minus size={14} /></button>
              <b className="w-8 text-center">{counts[d.key] ?? 0}</b>
              <button className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted hover:bg-muted/70" onClick={() => setCount(d.key, d.cents, 1)} aria-label={`Mais ${d.label}`}><Plus size={14} /></button>
              <span className="w-24 text-right font-bold text-primary">{brlc(d.cents * (counts[d.key] ?? 0))}</span></li>))}</ul></section>
        <div className="space-y-4">
          <section className="card p-5"><h2 className="mb-3 text-xl font-extrabold">Status do caixa</h2><div className="flex items-center justify-center gap-2 rounded-2xl bg-red-50 py-3 text-lg font-bold text-red-600"><Lock size={20} /> Fechado</div><p className="mt-2 text-center text-sm text-muted-foreground">O caixa ainda não foi aberto neste turno.</p></section>
          <section className="card space-y-3 p-5 text-sm"><h2 className="text-xl font-extrabold">Informações do turno</h2>
            <div><div className="text-xs text-muted-foreground">Operador</div><b>{me?.name}</b></div><div><div className="text-xs text-muted-foreground">Data</div><b>{now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}</b></div><div><div className="text-xs text-muted-foreground">Ponto de venda</div><b>{me?.store?.name}</b></div></section>
          <button className="btn !w-full !rounded-2xl !py-4 text-lg font-bold" disabled={busy} onClick={() => void open()}>{busy ? <Loader2 size={18} className="animate-spin" /> : <LockOpen size={20} />} Abrir caixa</button>
          <p className="text-center text-xs text-muted-foreground">Pode abrir com R$ 0,00 se não houver troco inicial.</p>
        </div>
      </div>
    </div>
  );
}

// ---------------- fechamento ----------------
function CloseShift({ session, summary, onClosed }: { session: CashSession; summary: CashSummary; onClosed: (r: { session: CashSession; summary: CashSummary }) => void }) {
  const toast = useToast();
  const [counted, setCounted] = useState<number | null>(null); const [note, setNote] = useState(''); const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const expected = summary.cash.expectedCents;
  const diff = counted === null ? null : counted - expected;
  const close = async () => {
    setBusy(true); setError(null);
    try { const r = await post<{ session: CashSession; summary: CashSummary }>('/v1/staff/cash/close', { countedCents: counted ?? 0, note }); toast('Caixa fechado'); setConfirm(false); onClosed(r); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível fechar o caixa.'); setConfirm(false); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-extrabold tracking-tight">Fechamento de caixa</h1><p className="text-muted-foreground">Turno aberto por {session.openedBy} em {dayTime(session.openedAt)}.</p></div><ChipStatus ok>Caixa aberto</ChipStatus></div>
      <Kpis s={summary} />
      <ErrorBox>{error}</ErrorBox>
      <div className="grid gap-4 xl:grid-cols-2">
        <MethodList s={summary} />
        <section className="card space-y-3 p-5">
          <h2 className="text-xl font-extrabold">Conferência de dinheiro em espécie</h2>
          <Row icon={<Landmark size={18} />} label="Valor inicial do caixa (troco)" value={brlc(summary.cash.openingCents)} />
          <Row icon={<Banknote size={18} />} label="Total de vendas em dinheiro" value={brlc(summary.cash.salesCents)} />
          <Row icon={<Scale size={18} />} label="Total esperado em dinheiro" value={brlc(expected)} strong />
          <div className="rounded-2xl bg-muted/60 p-3"><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Wallet size={16} className="text-primary" /> Valor contado no caixa</div>
            <div className="mb-3 rounded-xl border-2 border-primary bg-card px-4 py-3 text-3xl font-extrabold" aria-live="polite">{counted === null ? <span className="text-muted-foreground">R$ 0,00</span> : brlc(counted)}</div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><Keypad value={counted ?? 0} onChange={setCounted} /><div className="flex flex-col gap-2"><button className="rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-accent" onClick={() => setCounted(expected)}>Conferiu: igual ao esperado</button><button className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-accent" onClick={() => setCounted(null)}>Limpar</button></div></div></div>
          <div className={cx('flex items-center justify-between rounded-2xl p-4', diff === null ? 'bg-muted text-muted-foreground' : diff === 0 ? 'bg-emerald-50 text-emerald-800' : diff > 0 ? 'bg-sky-50 text-sky-800' : 'bg-red-50 text-red-700')}><span className="flex items-center gap-2 font-bold"><Scale size={18} /> Diferença{diff !== null && diff !== 0 ? (diff > 0 ? ' (sobra)' : ' (falta)') : ''}</span><span className="text-2xl font-extrabold">{diff === null ? '—' : brlc(diff)}</span></div>
          <input className="input" maxLength={300} placeholder="Observação do fechamento (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </section>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <button className="flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-4 text-lg font-bold text-primary hover:bg-accent/70" onClick={() => printReport(session, summary, counted, note)}><Printer size={20} /> Imprimir relatório de fechamento</button>
        <button className="btn !rounded-2xl !py-4 text-xl font-extrabold" disabled={counted === null || busy} onClick={() => setConfirm(true)}><Lock size={22} /> Fechar caixa</button>
      </div>
      {counted === null && <p className="text-center text-xs text-muted-foreground">Conte o dinheiro do caixa e informe o valor para poder fechar.</p>}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Fechar o caixa?" footer={<><button className="btn-ghost" onClick={() => setConfirm(false)}>Voltar</button><button className="btn" disabled={busy} onClick={() => void close()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Fechar caixa</button></>}>
        <div className="space-y-2 text-sm"><p>Esperado em dinheiro: <b>{brlc(expected)}</b> · Contado: <b>{brlc(counted ?? 0)}</b></p>
          <p className={cx('font-semibold', diff === 0 ? 'text-emerald-700' : 'text-red-600')}>{diff === 0 ? 'O caixa bate com as vendas.' : `Diferença de ${brlc(diff ?? 0)}.`}</p><p className="text-muted-foreground">Depois de fechado, o turno não pode ser alterado. Para vender com controle de caixa será preciso abrir um novo.</p></div>
      </Modal>
    </div>
  );
}

function Kpis({ s }: { s: CashSummary }) {
  const cards = [
    { icon: <ShoppingBagIcon />, tone: 'bg-blue-50', label: 'Total de vendas', value: brlc(s.totals.revenueCents), sub: `${s.totals.orders} pedido(s)`, color: 'text-blue-700' },
    { icon: <TrendingUp size={26} className="text-emerald-600" />, tone: 'bg-emerald-50', label: 'Ticket médio', value: brlc(s.totals.avgTicketCents), sub: '', color: 'text-emerald-700' },
    { icon: <BarChart3 size={26} className="text-amber-600" />, tone: 'bg-amber-50', label: 'Itens vendidos', value: String(s.totals.itemsSold), sub: 'produtos', color: 'text-amber-700' },
    { icon: <Users size={26} className="text-violet-600" />, tone: 'bg-violet-50', label: 'Clientes atendidos', value: String(s.totals.customers), sub: 'clientes únicos', color: 'text-violet-700' },
  ];
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map((c) => <div key={c.label} className={cx('flex items-center gap-4 rounded-3xl p-4 dark:bg-card', c.tone)}><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white shadow-ui-sm dark:bg-muted">{c.icon}</span><div className="min-w-0"><div className="text-sm text-foreground/70">{c.label}</div><div className={cx('truncate text-3xl font-extrabold', c.color)}>{c.value}</div>{c.sub && <div className="text-sm text-foreground/60">{c.sub}</div>}</div></div>)}</div>;
}
const ShoppingBagIcon = () => <ReceiptText size={26} className="text-blue-600" />;

function MethodList({ s }: { s: CashSummary }) {
  return (
    <section className="card p-5"><h2 className="mb-3 text-xl font-extrabold">Resumo de vendas por forma de pagamento</h2>
      {s.byMethod.length === 0 ? <p className="rounded-2xl bg-muted/60 p-5 text-center text-sm text-muted-foreground">Nenhuma venda recebida neste turno ainda.</p> : (
        <ul className="divide-y divide-border">{s.byMethod.map((m) => { const Icon = METHOD_ICON[m.type] ?? Banknote; return (
          <li key={`${m.type}-${m.method}`} className="flex items-center gap-3 py-3"><span className={cx('flex h-11 w-11 items-center justify-center rounded-xl text-white', METHOD_TONE[m.type] ?? 'bg-slate-500')}><Icon size={20} /></span>
            <div className="min-w-0 flex-1"><div className="font-bold">{PAY_LABEL[m.type] ?? m.method}</div>{m.method && m.method !== PAY_LABEL[m.type] && <div className="truncate text-xs text-muted-foreground">{m.method}</div>}</div><span className="text-sm text-muted-foreground">{m.orders} pedido(s)</span><b className="w-28 text-right text-lg">{brlc(m.cents)}</b></li>); })}</ul>)}
      {s.cancelled.orders > 0 && <div className="mt-2 flex items-center gap-3 border-t border-border pt-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-500 text-white"><Minus size={20} /></span><div className="flex-1 font-bold">Cancelamentos / estornos</div><span className="text-sm text-muted-foreground">{s.cancelled.orders} pedido(s)</span><b className="w-28 text-right text-lg text-red-600">− {brlc(s.cancelled.cents)}</b></div>}
    </section>
  );
}
const Row = ({ icon, label, value, strong }: { icon: React.ReactNode; label: string; value: string; strong?: boolean }) => <div className={cx('flex items-center gap-3 rounded-2xl px-4 py-3', strong ? 'bg-accent text-primary' : 'bg-muted/50')}><span className="text-primary">{icon}</span><span className="flex-1 text-sm font-medium">{label}</span><b className={strong ? 'text-xl' : ''}>{value}</b></div>;

// ---------------- turno fechado ----------------
function ClosedReport({ r, onNew }: { r: { session: CashSession; summary: CashSummary }; onNew: () => void }) {
  const d = r.session.differenceCents ?? 0;
  return (
    <div className="space-y-4">
      <div className={cx('flex items-center gap-5 rounded-3xl border p-5', d === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900')} role="status">
        <span className={cx('flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-white', d === 0 ? 'bg-emerald-600' : 'bg-amber-500')}><Check size={36} strokeWidth={3} /></span>
        <div><h1 className="text-3xl font-extrabold">Caixa fechado</h1><p className="text-lg">{d === 0 ? 'O dinheiro do caixa bate com as vendas.' : `Diferença de ${brlc(d)} (${d > 0 ? 'sobra' : 'falta'}) registrada no fechamento.`}</p></div></div>
      <Kpis s={r.summary} />
      <div className="grid gap-4 xl:grid-cols-2"><MethodList s={r.summary} />
        <section className="card space-y-2 p-5"><h2 className="text-xl font-extrabold">Conferência de dinheiro</h2>
          <Row icon={<Landmark size={18} />} label="Valor inicial" value={brlc(r.summary.cash.openingCents)} /><Row icon={<Banknote size={18} />} label="Vendas em dinheiro" value={brlc(r.summary.cash.salesCents)} />
          <Row icon={<Scale size={18} />} label="Esperado" value={brlc(r.session.expectedCents ?? 0)} strong /><Row icon={<Wallet size={18} />} label="Contado" value={brlc(r.session.countedCents ?? 0)} /><Row icon={<Scale size={18} />} label="Diferença" value={brlc(d)} />
          {r.session.note && <p className="rounded-xl bg-muted/60 p-3 text-sm">Obs.: {r.session.note}</p>}</section></div>
      <div className="grid gap-3 sm:grid-cols-2"><button className="flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-4 text-lg font-bold text-primary hover:bg-accent/70" onClick={() => printReport(r.session, r.summary, r.session.countedCents, r.session.note)}><Printer size={20} /> Imprimir relatório</button><button className="btn !rounded-2xl !py-4 text-lg font-bold" onClick={onNew}><LockOpen size={20} /> Abrir um novo caixa</button></div>
    </div>
  );
}

/** Relatório do turno numa janela de impressão do navegador (cupom/folha A4). */
function printReport(session: CashSession, s: CashSummary, counted: number | null, note: string) {
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const rows = s.byMethod.map((m) => `<tr><td>${esc(PAY_LABEL[m.type] ?? m.method)}${m.method && m.method !== PAY_LABEL[m.type] ? ` (${esc(m.method)})` : ''}</td><td>${m.orders}</td><td class="r">${brlc(m.cents)}</td></tr>`).join('');
  const diff = counted === null ? null : counted - s.cash.expectedCents;
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Fechamento de caixa</title><style>body{font:14px/1.4 Arial,sans-serif;max-width:420px;margin:16px auto;color:#111}h1{font-size:18px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:8px 0}td,th{padding:4px 0;border-bottom:1px dashed #bbb;text-align:left}.r{text-align:right}.b{font-weight:700}small{color:#555}</style>
<h1>Fechamento de caixa</h1><small>Operador: ${esc(session.openedBy)}<br>Aberto em ${dayTime(session.openedAt)} · Impresso em ${dayTime(new Date().toISOString())}</small>
<table><tr><td>Total de vendas</td><td class="r b">${brlc(s.totals.revenueCents)}</td></tr><tr><td>Pedidos</td><td class="r">${s.totals.orders}</td></tr><tr><td>Ticket médio</td><td class="r">${brlc(s.totals.avgTicketCents)}</td></tr><tr><td>Itens vendidos</td><td class="r">${s.totals.itemsSold}</td></tr><tr><td>Clientes atendidos</td><td class="r">${s.totals.customers}</td></tr></table>
<b>Vendas por forma de pagamento</b><table>${rows || '<tr><td>Nenhuma venda</td></tr>'}</table>${s.cancelled.orders ? `<table><tr><td>Cancelamentos/estornos (${s.cancelled.orders})</td><td class="r">- ${brlc(s.cancelled.cents)}</td></tr></table>` : ''}
<b>Dinheiro em espécie</b><table><tr><td>Valor inicial</td><td class="r">${brlc(s.cash.openingCents)}</td></tr><tr><td>Vendas em dinheiro</td><td class="r">${brlc(s.cash.salesCents)}</td></tr><tr><td class="b">Esperado</td><td class="r b">${brlc(s.cash.expectedCents)}</td></tr>${counted !== null ? `<tr><td>Contado</td><td class="r">${brlc(counted)}</td></tr><tr><td class="b">Diferença</td><td class="r b">${brlc(diff ?? 0)}</td></tr>` : ''}</table>${note ? `<p>Obs.: ${esc(note)}</p>` : ''}<script>window.onload=()=>window.print()</script></html>`;
  const w = window.open('', '_blank', 'width=480,height=700');
  if (w) { w.document.open(); w.document.write(html); w.document.close(); }
}
