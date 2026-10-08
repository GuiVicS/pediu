import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, CheckCircle2, ClipboardList, Loader2, Minus, Plus, Receipt, Send, ShoppingBag, Trash2, UtensilsCrossed, X } from 'lucide-react';
import { ApiError, get, post } from '@/lib/api';
import { brl } from '@/lib/format';
import { setThemeColor } from '@/lib/pwa';
import { cx, Modal } from '@/ui/kit';
import { normalizeMenu, type Menu } from '@/store/StoreContext';
import { sumLines, toOrderLines, type Line } from './OrderBuilder';
import { useProductPicker } from './ProductPicker';

/**
 * Totem de mesa: tablet em que o próprio cliente pede. Pareado a uma mesa pelo painel (Loja e entrega → Totens de mesa).
 * Não usa sessão de funcionário: o aparelho só vê o cardápio e a conta da mesa dele.
 */
interface Me { table: number; name: string; store: { name: string; slug: string; logoUrl: string; primary: string | null } }
interface Comanda { number: number; status: string; totalCents: number; billRequested: boolean; items: { name: string; qty: number; total_cents: number; note: string; addons: { name: string }[] }[] }
const IDLE_MS = 3 * 60_000;   // carrinho esquecido no tablet: limpa sozinho para o próximo cliente

export default function TotemApp() {
  const [me, setMe] = useState<Me | null | 'unpaired' | 'off'>(null);
  const load = useCallback(async () => {
    try { setMe(await get<Me>('/v1/totem/me')); }
    catch (e) { setMe(e instanceof ApiError && e.code === 'feature_off' ? 'off' : 'unpaired'); }
  }, []);
  useEffect(() => { void load(); document.title = 'Totem de mesa'; }, [load]);
  if (me === null) return <Center><Loader2 className="animate-spin" size={32} /></Center>;
  if (me === 'off') return <Center><UtensilsCrossed size={40} className="mb-3 text-muted-foreground" /><p className="text-lg font-semibold">Totem desativado</p><p className="text-sm text-muted-foreground">O totem de mesa não está liberado para esta loja. Chame um atendente.</p></Center>;
  if (me === 'unpaired') return <Pair onPaired={load} />;
  return <Kiosk me={me} />;
}

const Center = ({ children }: { children: React.ReactNode }) => <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center font-brand text-foreground">{children}</div>;

function Pair({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const pair = async () => { setBusy(true); setError(null); try { await post('/v1/totem/pair', { code }); onPaired(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível parear.'); } finally { setBusy(false); } };
  return (
    <Center>
      <div className="w-full max-w-sm rounded-ui border border-border bg-card p-6 shadow-ui">
        <UtensilsCrossed size={36} className="mx-auto mb-2 text-primary" />
        <h1 className="text-xl font-bold">Parear totem de mesa</h1>
        <p className="mt-1 text-sm text-muted-foreground">No painel da loja: <b>Loja e entrega → Totens de mesa → Novo totem</b>. Digite aqui o código de 6 dígitos.</p>
        {error && <div className="mt-3 rounded-ui-sm bg-destructive/10 p-2.5 text-sm text-destructive">{error}</div>}
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); if (code.length === 6 && !busy) void pair(); }}>
          <input className="w-full rounded-ui-sm border border-border bg-background py-3 text-center text-3xl font-bold tracking-[0.4em]" inputMode="numeric" autoFocus maxLength={6} value={code} placeholder="••••••" onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          <button className="btn w-full !py-3" disabled={code.length !== 6 || busy}>{busy && <Loader2 size={16} className="animate-spin" />} Parear</button>
        </form>
      </div>
    </Center>
  );
}

function Kiosk({ me }: { me: Me }) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [cat, setCat] = useState<string | null>(null);
  const [view, setView] = useState<'menu' | 'cart' | 'bill'>('menu');
  const [comanda, setComanda] = useState<Comanda | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const primary = me.store.primary ?? '#0091FF';
  useEffect(() => { setThemeColor(primary); }, [primary]);
  useEffect(() => { get('/v1/totem/menu').then((r) => setMenu(normalizeMenu(r))).catch(() => setError('Não foi possível carregar o cardápio.')); }, []);
  const loadBill = useCallback(async () => setComanda((await get<{ comanda: Comanda | null }>('/v1/totem/comanda')).comanda), []);
  useEffect(() => { void loadBill(); const t = setInterval(() => void loadBill(), 30_000); return () => clearInterval(t); }, [loadBill]);
  // inatividade: limpa o carrinho e volta ao cardápio
  useEffect(() => {
    let t = setTimeout(() => undefined, 0);
    const reset = () => { clearTimeout(t); t = setTimeout(() => { setLines([]); setView('menu'); }, IDLE_MS); };
    reset(); window.addEventListener('pointerdown', reset);
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', reset); };
  }, []);
  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(null), 4000); };
  const picker = useProductPicker(menu ?? { categories: [], products: [], groups: [], banners: [], featured: [], zones: [], payments: [] }, lines, setLines);
  const active = cat ?? menu?.categories[0]?.id;
  const products = useMemo(() => (menu ? menu.products.filter((p) => p.categoryId === active) : []), [menu, active]);
  const count = lines.reduce((s, l) => s + l.qty, 0); const total = sumLines(lines);
  const setQty = (i: number, qty: number) => setLines(qty <= 0 ? lines.filter((_, k) => k !== i) : lines.map((l, k) => (k === i ? { ...l, qty } : l)));
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Algo deu errado. Tente de novo.'); } finally { setBusy(false); } };
  const send = () => run(async () => { await post('/v1/totem/orders', { lines: toOrderLines(lines) }); setLines([]); setView('menu'); await loadBill(); flash('Pedido enviado para a cozinha!'); });
  const call = (kind: 'garcom' | 'conta') => run(async () => { await post('/v1/totem/call', { kind }); if (kind === 'conta') await loadBill(); flash(kind === 'conta' ? 'Pronto! Já avisamos que você pediu a conta.' : 'Pronto! O garçom já foi chamado.'); });
  const btn = { background: primary, color: '#fff' };

  if (!menu) return <Center>{error ? <p>{error}</p> : <Loader2 className="animate-spin" size={32} />}</Center>;
  return (
    <div className="flex h-[100dvh] flex-col bg-background font-brand text-foreground">
      <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3">
        {me.store.logoUrl ? <img src={me.store.logoUrl} alt="" className="h-10 w-10 rounded-full object-cover" /> : <UtensilsCrossed size={28} style={{ color: primary }} />}
        <div className="min-w-0 flex-1 leading-tight"><div className="truncate font-bold">{me.store.name}</div><div className="text-sm text-muted-foreground">Mesa <b className="text-foreground">{me.table}</b></div></div>
        <button className="flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-sm font-semibold active:scale-95" disabled={busy} onClick={() => call('garcom')}><BellRing size={16} /> <span className="hidden sm:inline">Chamar garçom</span></button>
        <button className="flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-sm font-semibold active:scale-95" onClick={() => { void loadBill(); setView('bill'); }}><ClipboardList size={16} /> <span className="hidden sm:inline">Minha conta</span></button>
      </header>
      {error && <div className="bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}

      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-48 shrink-0 overflow-y-auto border-r border-border bg-card p-2 md:block">
          {menu.categories.map((c) => <button key={c.id} onClick={() => setCat(c.id)} className={cx('mb-1 w-full rounded-ui-sm px-3 py-3 text-left font-semibold', active === c.id ? 'text-white' : 'hover:bg-muted')} style={active === c.id ? btn : undefined}>{c.name}</button>)}
        </nav>
        <main className="min-w-0 flex-1 overflow-y-auto p-3 pb-28">
          <div className="-mx-3 mb-3 flex gap-2 overflow-x-auto px-3 md:hidden">{menu.categories.map((c) => <button key={c.id} onClick={() => setCat(c.id)} className={cx('shrink-0 rounded-full px-4 py-2 text-sm font-semibold', active !== c.id && 'bg-muted')} style={active === c.id ? btn : undefined}>{c.name}</button>)}</div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            {products.map((p) => { const n = lines.filter((l) => l.productId === p.id).reduce((s, l) => s + l.qty, 0); return (
              <button key={p.id} disabled={!p.available} onClick={() => picker.addProduct(p)} className="relative flex flex-col overflow-hidden rounded-ui border border-border bg-card text-left shadow-ui-sm transition active:scale-[.98] disabled:opacity-50">
                <div className="aspect-[4/3] w-full bg-muted">{p.imageUrl ? <img src={p.imageUrl} alt="" className={cx('h-full w-full', p.imageFit === 'contain' ? 'object-contain' : 'object-cover')} loading="lazy" /> : <div className="flex h-full items-center justify-center text-muted-foreground"><UtensilsCrossed size={28} /></div>}</div>
                {n > 0 && <span className="absolute right-2 top-2 rounded-full px-2.5 py-0.5 text-sm font-bold text-white" style={btn}>{n}</span>}
                <div className="flex flex-1 flex-col p-3"><div className="font-bold leading-tight">{p.name}</div>
                  {p.description && <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</div>}
                  <div className="mt-auto flex items-center justify-between pt-2"><b style={{ color: primary }}>{brl(p.price)}</b><span className="flex h-9 w-9 items-center justify-center rounded-full text-white" style={btn}><Plus size={18} /></span></div>
                  {!p.available && <span className="text-xs font-semibold text-destructive">Indisponível</span>}</div>
              </button>); })}
          </div>
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card/95 p-3 backdrop-blur" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}>
        <button className="mx-auto flex w-full max-w-3xl items-center gap-3 rounded-ui px-4 py-4 text-lg font-bold text-white shadow-ui disabled:opacity-50" style={btn} disabled={!count} onClick={() => setView('cart')}>
          <ShoppingBag size={22} /><span className="flex-1 text-left">{count ? `Ver pedido (${count})` : 'Escolha seus itens'}</span><span>{brl(total)}</span>
        </button>
      </div>

      <Modal open={view === 'cart'} onClose={() => setView('menu')} title="Seu pedido"
        footer={<button className="flex w-full items-center justify-center gap-2 rounded-ui py-4 text-lg font-bold text-white disabled:opacity-50" style={btn} disabled={!count || busy} onClick={send}>{busy ? <Loader2 className="animate-spin" /> : <Send size={20} />} Enviar para a cozinha · {brl(total)}</button>}>
        <div className="divide-y divide-border">{lines.map((l, i) => (
          <div key={l.key} className="py-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1"><div className="font-semibold">{l.name}</div>{l.picks.map((p, k) => <div key={k} className="text-xs text-muted-foreground">+ {p.name}</div>)}<div className="text-sm text-muted-foreground">{brl(l.unitPrice * l.qty)}</div></div>
              <button className="rounded-full border border-border p-2.5" onClick={() => setQty(i, l.qty - 1)} aria-label="Diminuir">{l.qty === 1 ? <Trash2 size={18} /> : <Minus size={18} />}</button>
              <b className="w-7 text-center text-lg">{l.qty}</b>
              <button className="rounded-full border border-border p-2.5" onClick={() => setQty(i, l.qty + 1)} aria-label="Aumentar"><Plus size={18} /></button>
            </div>
            <input className="mt-2 w-full rounded-ui-xs border border-border bg-background px-3 py-2.5 text-sm" placeholder="Alguma observação? (ex.: sem cebola)" value={l.note} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)))} />
          </div>))}</div>
      </Modal>

      <Modal open={view === 'bill'} onClose={() => setView('menu')} title={`Conta da mesa ${me.table}`}
        footer={comanda && !comanda.billRequested ? <button className="flex w-full items-center justify-center gap-2 rounded-ui py-4 text-lg font-bold text-white" style={btn} disabled={busy} onClick={() => call('conta')}><Receipt size={20} /> Pedir a conta</button> : undefined}>
        {!comanda ? <p className="py-6 text-center text-muted-foreground">Ainda não há pedidos nesta mesa.</p> : (
          <div>
            <div className="divide-y divide-border">{comanda.items.map((it, i) => (
              <div key={i} className="flex justify-between gap-2 py-2 text-sm"><div><b>{it.qty}×</b> {it.name}{it.addons?.map((a, k) => <div key={k} className="text-xs text-muted-foreground">+ {a.name}</div>)}</div><span>{brl(it.total_cents / 100)}</span></div>))}</div>
            <div className="mt-2 flex justify-between border-t border-border pt-2 text-xl font-extrabold"><span>Total</span><span>{brl(comanda.totalCents / 100)}</span></div>
            {comanda.billRequested && <p className="mt-3 rounded-ui-sm bg-violet-100 p-3 text-center text-sm font-semibold text-violet-800">Conta pedida. Um atendente já vem até a mesa.</p>}
          </div>)}
      </Modal>

      {notice && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-6" onClick={() => setNotice(null)}>
          <div className="max-w-sm rounded-ui bg-card p-8 text-center shadow-ui-lg"><CheckCircle2 size={56} className="mx-auto mb-3" style={{ color: primary }} /><p className="text-xl font-bold">{notice}</p>
            <button className="mt-5 inline-flex items-center gap-1 text-sm text-muted-foreground"><X size={14} /> Fechar</button></div>
        </div>)}
      {picker.modal}
    </div>
  );
}
