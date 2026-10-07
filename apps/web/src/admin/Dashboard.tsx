import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, ChefHat, ClipboardList, MoreHorizontal, ReceiptText, ShoppingBag, Tag, Timer, Trophy, Wallet } from 'lucide-react';
import { get } from '@/lib/api';
import { brlc, STATUS_LABEL } from '@/lib/orders';
import { useStream } from '@/lib/realtime';
import type { OrderStatus } from '@/lib/types';
import { BannerSlider, useBanners } from '@/ui/BannerSlider';
import { cx } from '@/ui/kit';
import { Spinner } from '@/ui/misc';
import { PageHeader } from './AdminUI';

interface Stats { orders: number; cancelled: number; cancelRate: number; revenueCents: number; avgTicketCents: number; avgPrepMin: number | null; avgDeliveryMin: number | null }
interface Recent { id: string; number: number; customer_name: string; status: OrderStatus; type: string; total_cents: number; created_at: string; items: string }
interface Dash {
  today: Stats; yesterday: Stats; week: Stats; open: Record<string, number>; todayByStatus: Record<string, number>; recent: Recent[];
  byHour: { hour: number; orders: number }[]; topProducts: { name: string; qty: number; revenue_cents: number }[]; byChannel: { channel: string; orders: number; revenue_cents: number }[];
  toReceive: { orders: number; cents: number };
}
const CHANNEL: Record<string, string> = { loja: 'Loja online', pdv: 'Balcão', garcom: 'Garçom', ifood: 'iFood' };

/** Cores por status (rosca e etiquetas): mesma paleta nos dois lugares. */
const TONE: Record<string, { color: string; chip: string }> = {
  novo: { color: '#2F80FF', chip: 'bg-blue-50 text-blue-700' },
  preparo: { color: '#FF9F1C', chip: 'bg-orange-50 text-orange-600' },
  pronto: { color: '#5CC63E', chip: 'bg-lime-50 text-lime-700' },
  saiu: { color: '#8B5CF6', chip: 'bg-violet-50 text-violet-700' },
  entregue: { color: '#12B886', chip: 'bg-emerald-50 text-emerald-700' },
  cancelado: { color: '#F05252', chip: 'bg-red-50 text-red-600' },
};
const ORDER: OrderStatus[] = ['novo', 'preparo', 'pronto', 'saiu', 'entregue', 'cancelado'];
const labelOf = (s: string) => (s === 'entregue' ? 'Entregue' : STATUS_LABEL[s as OrderStatus] ?? s);

/** Variação em % contra ontem. Sem base de comparação (ontem zerado) não inventa porcentagem. */
const delta = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const banners = useBanners('dashboard');
  const load = useCallback(async () => { try { setD(await get<Dash>('/v1/staff/dashboard')); setErr(null); } catch (e) { setErr((e as Error).message); } }, []);
  useEffect(() => { void load(); }, [load]);
  useStream((e) => { if (e.type === 'order') void load(); }, load, 60_000);
  if (err) return <div className="rounded-ui-sm bg-destructive/10 p-4 text-sm text-destructive">{err}</div>;
  if (!d) return <Spinner />;

  const preparo = d.open.preparo ?? 0;
  const kpis: { label: string; value: string; Icon: typeof ShoppingBag; tile: string; d: number | null; foot?: string }[] = [
    { label: 'pedidos', value: String(d.today.orders), Icon: ClipboardList, tile: 'bg-blue-50 text-blue-600', d: delta(d.today.orders, d.yesterday.orders) },
    { label: 'faturamento', value: brlc(d.today.revenueCents), Icon: Wallet, tile: 'bg-emerald-50 text-emerald-600', d: delta(d.today.revenueCents, d.yesterday.revenueCents) },
    { label: 'ticket médio', value: brlc(d.today.avgTicketCents), Icon: Tag, tile: 'bg-violet-50 text-violet-600', d: delta(d.today.avgTicketCents, d.yesterday.avgTicketCents) },
    { label: 'em preparo', value: String(preparo), Icon: ChefHat, tile: 'bg-orange-50 text-orange-500', d: null, foot: `${d.open.novo ?? 0} novo(s) aguardando · ${d.open.pronto ?? 0} pronto(s)` },
  ];
  const maxTop = Math.max(1, ...d.topProducts.map((p) => p.qty));
  return (
    <div className="space-y-5">
      {banners && banners.length > 0 && <BannerSlider banners={banners} variant="strip" />}
      <PageHeader title="Visão geral" subtitle="Acompanhe o desempenho da sua loja em tempo real." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="card flex flex-col gap-3 p-5">
            <div className="flex items-center gap-4">
              <span className={cx('flex h-[3.75rem] w-[3.75rem] shrink-0 items-center justify-center rounded-2xl', k.tile)}><k.Icon size={30} strokeWidth={1.8} /></span>
              <div className="min-w-0"><div className="truncate text-[1.75rem] font-extrabold leading-none tracking-tight">{k.value}</div><div className="mt-1 text-base text-muted-foreground">{k.label}</div></div>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {k.foot ?? (k.d === null ? <span>sem dados de ontem para comparar</span> : (
                <><span className={cx('flex items-center gap-0.5 font-bold', k.d >= 0 ? 'text-emerald-600' : 'text-red-500')}>{k.d >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}{k.d >= 0 ? '+' : ''}{k.d}%</span> em relação a ontem</>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Section icon={<BarChart3 size={20} className="text-primary" />} title="Pedidos por hora" subtitle="Quantidade de pedidos recebidos hoje, por hora."><HourChart byHour={d.byHour} /></Section>
        <Section icon={<ShoppingBag size={20} className="text-primary" />} title="Pedidos por status" subtitle="Distribuição dos pedidos de hoje."><StatusDonut counts={d.todayByStatus} /></Section>
      </div>

      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3"><ClipboardList size={22} className="mt-0.5 text-primary" /><div><h2 className="text-xl font-bold">Últimos pedidos</h2><p className="text-sm text-muted-foreground">Acompanhe os pedidos mais recentes da sua loja.</p></div></div>
          <Link to="/painel/pedidos" className="inline-flex items-center gap-2 rounded-xl border border-primary/40 px-4 py-2 text-sm font-semibold text-primary hover:bg-accent">Ver todos os pedidos <ArrowRight size={16} /></Link>
        </div>
        {d.recent.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nenhum pedido ainda. Os pedidos novos aparecem aqui na hora.</p> : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="bg-muted/60 text-xs font-semibold text-foreground/80"><tr>{['#', 'Cliente', 'Itens', 'Horário', 'Valor', 'Status', 'Ações'].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {d.recent.map((o) => (
                  <tr key={o.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-bold">#{o.number}</td>
                    <td className="px-4 py-3">{o.customer_name || <span className="text-muted-foreground">Sem nome</span>}</td>
                    <td className="max-w-[16rem] truncate px-4 py-3 text-muted-foreground" title={o.items}>{o.items || '—'}</td>
                    <td className="px-4 py-3">{new Date(o.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-4 py-3">{brlc(o.total_cents)}</td>
                    <td className="px-4 py-3"><Chip status={o.status} /></td>
                    <td className="px-4 py-3"><Link to="/painel/pedidos" className="inline-flex rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Abrir pedido ${o.number}`}><MoreHorizontal size={18} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-5 text-sm">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Trophy size={16} className="text-amber-500" /> Mais vendidos (7 dias)</h2>
          {d.topProducts.length === 0 && <p className="text-muted-foreground">Sem vendas ainda.</p>}
          <div className="space-y-2.5">{d.topProducts.map((p) => (
            <div key={p.name}><div className="flex justify-between"><span className="truncate">{p.name}</span><span className="font-semibold">{p.qty}</span></div><div className="mt-1 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(p.qty / maxTop) * 100}%` }} /></div></div>
          ))}</div>
        </section>
        <section className="card p-5 text-sm">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Timer size={16} className="text-primary" /> Tempos e canais (7 dias)</h2>
          <div className="space-y-1">
            <div className="flex justify-between"><span>Preparo médio</span><b>{d.week.avgPrepMin ?? '—'} min</b></div>
            <div className="flex justify-between"><span>Entrega média</span><b>{d.week.avgDeliveryMin ?? '—'} min</b></div>
            <div className="flex justify-between"><span>Cancelamentos</span><b>{Math.round(d.week.cancelRate * 100)}%</b></div>
          </div>
          <div className="mt-3 space-y-1 border-t border-border pt-3">{d.byChannel.length === 0 ? <span className="text-muted-foreground">Sem pedidos ainda.</span> : d.byChannel.map((c) => <div key={c.channel} className="flex justify-between"><span>{CHANNEL[c.channel] ?? c.channel}</span><span><b>{c.orders}</b> · {brlc(c.revenue_cents)}</span></div>)}</div>
        </section>
        <section className="card p-5 text-sm">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><ReceiptText size={16} className="text-primary" /> A receber</h2>
          <div className="text-2xl font-extrabold">{brlc(d.toReceive.cents)}</div>
          <div className="text-muted-foreground">{d.toReceive.orders} pedido(s) ainda não pagos (dinheiro, maquininha ou conta aberta).</div>
        </section>
      </div>
    </div>
  );
}

function Section({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-start gap-3">{icon}<div><h2 className="text-xl font-bold leading-tight">{title}</h2><p className="text-sm text-muted-foreground">{subtitle}</p></div></div>
      {children}
    </section>
  );
}

function Chip({ status }: { status: string }) {
  const t = TONE[status] ?? { color: '#94A3B8', chip: 'bg-slate-100 text-slate-600' };
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', t.chip)}><span className="h-2 w-2 rounded-full" style={{ background: t.color }} />{labelOf(status)}</span>;
}

/** Curva suave (Catmull-Rom → Bézier) que passa por todos os pontos. */
function smooth(pts: [number, number][]): string {
  if (pts.length < 2) return '';
  let path = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[i + 2] ?? p2;
    path += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6}, ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6}, ${p2[0]} ${p2[1]}`;
  }
  return path;
}

function HourChart({ byHour }: { byHour: { hour: number; orders: number }[] }) {
  const data = useMemo(() => Array.from({ length: 24 }, (_, h) => byHour.find((x) => x.hour === h)?.orders ?? 0), [byHour]);
  const peak = data.reduce((best, v, h) => (v > data[best]! ? h : best), 0);
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? peak;
  const W = 640, H = 300, L = 34, R = 12, T = 18, B = 30;
  const max = Math.max(4, Math.ceil(Math.max(...data) / 4) * 4);   // múltiplo de 4: as 5 linhas da grade caem em números inteiros
  const x = (h: number) => L + (h / 23) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const pts = data.map((v, h): [number, number] => [x(h), y(v)]);
  const line = smooth(pts);
  const area = `${line} L ${x(23)} ${y(0)} L ${x(0)} ${y(0)} Z`;
  const grid = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  const empty = Math.max(...data) === 0;
  const tipX = Math.min(Math.max(x(shown), 56), W - 56);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Pedidos por hora, hoje" onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; setHover(Math.min(23, Math.max(0, Math.round(((px - L) / (W - L - R)) * 23)))); }}>
        <defs><linearGradient id="hourFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2F80FF" stopOpacity="0.28" /><stop offset="100%" stopColor="#2F80FF" stopOpacity="0.02" /></linearGradient></defs>
        {grid.map((g) => <g key={g}><line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="currentColor" className="text-border" strokeWidth="1" /><text x={L - 8} y={y(g) + 4} textAnchor="end" className="fill-muted-foreground" fontSize="11">{Math.round(g)}</text></g>)}
        {Array.from({ length: 12 }, (_, i) => i * 2).map((h) => <text key={h} x={x(h)} y={H - 8} textAnchor="middle" className="fill-muted-foreground" fontSize="11">{String(h).padStart(2, '0')}h</text>)}
        {!empty && <><path d={area} fill="url(#hourFill)" /><path d={line} fill="none" stroke="#2F80FF" strokeWidth="3" strokeLinecap="round" /></>}
        {empty && <text x={W / 2} y={H / 2} textAnchor="middle" className="fill-muted-foreground" fontSize="14">Nenhum pedido hoje ainda</text>}
        {!empty && pts.map(([px, py], h) => (h % 2 === 0 || h === shown) && <circle key={h} cx={px} cy={py} r={h === shown ? 6 : 4} fill={h === shown ? '#2F80FF' : '#fff'} stroke="#2F80FF" strokeWidth="2.5" />)}
        {!empty && <><line x1={x(shown)} x2={x(shown)} y1={y(data[shown]!)} y2={y(0)} stroke="#2F80FF" strokeDasharray="4 4" strokeWidth="1.2" opacity=".6" />
          <g transform={`translate(${tipX}, ${Math.max(6, y(data[shown]!) - 52)})`}><rect x="-50" width="100" height="40" rx="10" className="fill-card" stroke="currentColor" strokeWidth="1" style={{ color: 'var(--border)' }} /><text y="16" textAnchor="middle" className="fill-muted-foreground" fontSize="11">{String(shown).padStart(2, '0')}h</text><text y="32" textAnchor="middle" className="fill-foreground" fontSize="13" fontWeight="700">{data[shown]} pedido{data[shown] === 1 ? '' : 's'}</text></g></>}
      </svg>
    </div>
  );
}

function StatusDonut({ counts }: { counts: Record<string, number> }) {
  const rows = ORDER.map((s) => ({ s, n: counts[s] ?? 0 })).filter((r) => r.n > 0 || ['novo', 'preparo', 'pronto', 'entregue'].includes(r.s));
  const total = rows.reduce((a, r) => a + r.n, 0);
  const R = 70, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row xl:flex-col 2xl:flex-row">
      <svg viewBox="0 0 200 200" className="h-48 w-48 shrink-0 -rotate-90" role="img" aria-label="Pedidos de hoje por status">
        <circle cx="100" cy="100" r={R} fill="none" stroke="currentColor" className="text-muted" strokeWidth="26" />
        {total > 0 && rows.filter((r) => r.n > 0).map((r) => { const len = (r.n / total) * C; const el = <circle key={r.s} cx="100" cy="100" r={R} fill="none" stroke={TONE[r.s]!.color} strokeWidth="26" strokeDasharray={`${Math.max(0, len - 1.5)} ${C - len + 1.5}`} strokeDashoffset={-acc} />; acc += len; return el; })}
        <g className="rotate-90" style={{ transformOrigin: '100px 100px' }}><text x="100" y="104" textAnchor="middle" className="fill-foreground" fontSize="32" fontWeight="800">{total}</text><text x="100" y="126" textAnchor="middle" className="fill-muted-foreground" fontSize="14">pedidos</text></g>
      </svg>
      <ul className="w-full space-y-3 text-[15px]">
        {rows.map((r) => (
          <li key={r.s} className="flex items-center gap-3"><span className="h-3.5 w-3.5 rounded-full" style={{ background: TONE[r.s]!.color }} /><span className="flex-1">{labelOf(r.s)}</span><b>{r.n}</b><span className="w-16 text-right text-muted-foreground">({total ? ((r.n / total) * 100).toFixed(1).replace('.', ',') : '0,0'}%)</span></li>
        ))}
      </ul>
    </div>
  );
}
