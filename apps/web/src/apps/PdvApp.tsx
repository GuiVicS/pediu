import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Bell, ChevronDown, ClipboardList, LogOut, Lock, LockOpen, ShoppingCart, Store as StoreIcon, Calculator, Bike, ConciergeBell, LayoutDashboard } from 'lucide-react';
import QRCode from 'qrcode';
import type { ApiOrder } from '@/lib/types';
import { post } from '@/lib/api';
import { useOrders } from '@/lib/orders';
import { ROLE_LABEL } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { cx } from '@/ui/kit';
import { ErrorBox, Spinner } from '@/ui/misc';
import { InstallButton } from '@/ui/InstallButton';
import { ThemeToggle, useApplyPlatformTheme } from '@/ui/platformTheme';
import { setThemeColor } from '@/lib/pwa';
import { ToastProvider, useToast } from '@/admin/AdminUI';
import { toOrderLines } from './OrderBuilder';
import { useStaffMenu } from './menuHook';
import DoneView from './pdv/DoneView';
import OrdersView from './pdv/OrdersView';
import PaymentView, { type PayTarget } from './pdv/PaymentView';
import SaleView from './pdv/SaleView';
import ShiftView, { useCash } from './pdv/ShiftView';
import { MODE_LABEL, emptyDraft, summaryOf, totalsOf, type Draft, type PayType, type Receipt, type SummaryLine } from './pdv/shared';

type View = 'venda' | 'pagamento' | 'sucesso' | 'pedidos' | 'turno';

export default function PdvApp() { return <ToastProvider><PdvShell /></ToastProvider>; }

/**
 * PDV (frente de caixa): venda → pagamento (na tela ou externo) → pedido finalizado, mais histórico de pedidos e turno de caixa.
 * O estado da venda em andamento fica aqui para o operador poder ir ao pagamento e voltar sem perder nada.
 */
function PdvShell() {
  const { me, can, logout } = useSession();
  const toast = useToast();
  const { menu, error } = useStaffMenu();
  const o = useOrders({ open: false, limit: 200, sound: true });
  const cash = useCash();
  const [view, setView] = useState<View>('venda');
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [existing, setExisting] = useState<ApiOrder | null>(null);   // recebendo um pedido que já foi lançado
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useApplyPlatformTheme();
  useEffect(() => { setThemeColor('#0091FF'); document.title = `PDV${me?.store?.name ? ` — ${me.store.name}` : ''} — PediuLanchou`; }, [me?.store?.name]);
  const toReceive = o.orders.filter((x) => !x.paid && !['cancelado', 'aguardando'].includes(x.status)).length;

  // ---- o que a tela de pagamento precisa, para venda nova ou pedido já lançado ----
  const target = useMemo<PayTarget | null>(() => {
    if (!menu) return null;
    const payMeta = (id: string) => menu.payments.find((p) => p.id === id);
    const finish = (r: Omit<Receipt, 'at'>): Receipt => ({ ...r, at: new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) });

    if (existing) {
      const x = existing;
      const lines: SummaryLine[] = x.items.map((i, k) => ({ key: String(k), name: i.name, qty: i.qty, totalCents: i.total_cents, detail: [...(i.addons ?? []).map((a) => a.name), i.note].filter(Boolean).join(' · ') || undefined }));
      const base = { orderId: x.id, number: x.number, totalCents: x.total_cents, lines, subtotalCents: x.subtotal_cents, feeCents: x.fee_cents, discountCents: x.discount_cents, customer: x.customer_name, modeLabel: x.type === 'mesa' ? `Mesa ${x.table_number}` : x.type === 'delivery' ? 'Delivery' : 'Balcão / retirada', heading: `Pedido #${x.number}` };
      return {
        heading: `Pedido #${x.number}`, sub: x.type === 'mesa' ? `Mesa ${x.table_number}` : x.customer_name || 'Receber pedido', lines, subtotalCents: x.subtotal_cents, feeCents: x.fee_cents, discountCents: x.discount_cents, totalCents: x.total_cents,
        submit: async ({ paymentId, receivedCents, reference }) => {
          const r = await o.pay(x.id, paymentId, { receivedCents, reference }); const pm = payMeta(paymentId)!;
          return finish({ ...base, paid: true, changeCents: r.changeCents, receivedCents: pm.type === 'cash' ? receivedCents ?? x.total_cents : null, method: pm.name, type: pm.type as PayType, mode: 'externo', ref: reference ?? null });
        },
        startPix: async (gateway) => {
          const c = await post<{ qrCode: string; expiresAt: string }>(`/v1/staff/orders/${x.id}/charge`, { gateway });
          return { orderId: x.id, number: x.number, qrCode: c.qrCode, qrImage: await QRCode.toDataURL(c.qrCode, { margin: 1, width: 300 }), expiresAt: c.expiresAt, finish: () => finish({ ...base, paid: true, changeCents: 0, receivedCents: null, method: 'Pix online', type: 'pix', mode: 'tela', ref: null }) };
        },
      };
    }

    const t = totalsOf(draft, menu);
    const zone = menu.zones.find((z) => z.id === (draft.zoneId || menu.zones[0]?.id));
    const body = {
      type: draft.mode === 'delivery' ? ('delivery' as const) : ('retirada' as const), customerName: draft.name.trim() || draft.customer?.name || undefined, phone: draft.phone.trim() || undefined,
      address: draft.mode === 'delivery' ? draft.address.trim() : undefined, zoneId: draft.mode === 'delivery' ? zone?.id : undefined, lines: toOrderLines(draft.lines),
      couponCode: draft.coupon?.code, customerId: draft.customer?.id,
    };
    const base = (id: string, number: number, total: number) => ({ orderId: id, number, totalCents: total, lines: summaryOf(draft, menu), subtotalCents: t.subtotalCents, feeCents: t.feeCents, discountCents: t.discountCents, customer: draft.name.trim() || draft.customer?.name || '', modeLabel: MODE_LABEL[draft.mode], heading: `Pedido #${number}` });
    return {
      heading: 'Novo pedido', sub: `${MODE_LABEL[draft.mode]}${draft.name.trim() ? ` · ${draft.name.trim()}` : ''}`, lines: summaryOf(draft, menu), subtotalCents: t.subtotalCents, feeCents: t.feeCents, discountCents: t.discountCents, totalCents: t.totalCents,
      submit: async ({ paymentId, receivedCents, reference }) => {
        const r = await o.create({ ...body, paymentId, receiveNow: true, receivedCents, reference }); const pm = payMeta(paymentId)!;
        return finish({ ...base(r.id, r.number, r.totalCents), paid: true, changeCents: r.changeCents, receivedCents: pm.type === 'cash' ? receivedCents ?? r.totalCents : null, method: pm.name, type: pm.type as PayType, mode: 'externo', ref: reference ?? null });
      },
      later: async () => { const r = await o.create(body); return finish({ ...base(r.id, r.number, r.totalCents), paid: false, changeCents: 0, receivedCents: null, method: '', type: null, mode: null, ref: null }); },
      startPix: async (gateway) => {
        const r = await o.create(body);
        const c = await post<{ qrCode: string; expiresAt: string }>(`/v1/staff/orders/${r.id}/charge`, { gateway });
        return { orderId: r.id, number: r.number, qrCode: c.qrCode, qrImage: await QRCode.toDataURL(c.qrCode, { margin: 1, width: 300 }), expiresAt: c.expiresAt, finish: () => finish({ ...base(r.id, r.number, r.totalCents), paid: true, changeCents: 0, receivedCents: null, method: 'Pix online', type: 'pix', mode: 'tela', ref: null }) };
      },
    };
  }, [menu, draft, existing, o]);   // eslint-disable-line react-hooks/exhaustive-deps

  const done = (r: Receipt) => {
    setReceipt(r); setView('sucesso'); void cash.reload();
    if (!existing) setDraft(emptyDraft());
    setExisting(null);
    toast(r.paid ? `Pedido #${r.number} pago` : `Pedido #${r.number} lançado`);
  };
  const go = (v: View) => { setView(v); if (v !== 'pagamento') setExisting(null); };
  const active = view === 'pagamento' || view === 'sucesso' ? 'venda' : view;

  return (
    <div className="flex min-h-screen flex-col bg-background font-brand text-foreground">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-5 gap-y-2 bg-primary px-4 py-2.5 text-primary-foreground shadow-ui-sm lg:px-6">
        <img src="/brand/logo-white.png" alt="PediuLanchou" className="h-9 w-auto" />
        <nav className="flex gap-1.5" aria-label="PDV">
          {([['venda', 'Caixa', ShoppingCart], ['pedidos', 'Pedidos', ClipboardList], ['turno', 'Turno', Calculator]] as const).map(([v, label, Icon]) => (
            <button key={v} onClick={() => go(v)} aria-current={active === v ? 'page' : undefined} className={cx('relative flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition sm:px-4', active === v ? 'bg-white/20' : 'hover:bg-white/10')}>
              <Icon size={18} /><span className="hidden sm:inline">{label}</span>
              {v === 'pedidos' && toReceive > 0 && <span className="rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">{toReceive}</span>}
            </button>))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <button onClick={() => go('turno')} className={cx('flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold', cash.session ? 'bg-white/15 hover:bg-white/25' : 'bg-red-500/90 hover:bg-red-500')} title={cash.session ? 'Caixa aberto' : 'Caixa fechado: abra o turno para controlar o dinheiro'}>
            {cash.session ? <LockOpen size={16} /> : <Lock size={16} />}<span className="hidden md:inline">{cash.session ? 'Caixa aberto' : 'Caixa fechado'}</span></button>
          <span className="hidden items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-foreground lg:flex"><StoreIcon size={16} className="text-primary" />{me?.store?.name}</span>
          <button onClick={() => go('pedidos')} className="relative rounded-full p-2 hover:bg-white/10" aria-label={`${toReceive} pedido(s) a receber`}><Bell size={22} />{toReceive > 0 && <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{toReceive}</span>}</button>
          <UserMenu onLogout={logout} name={me?.name ?? ''} role={me ? ROLE_LABEL[me.role] : ''} can={can} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1700px] flex-1 p-3 sm:p-4 lg:px-6">
        {error ? <ErrorBox>{error}</ErrorBox> : !menu || !target ? <Spinner /> : (
          <>
            {!cash.session && cash.ready && view === 'venda' && <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"><Lock size={16} /> O caixa está fechado: as vendas funcionam, mas o dinheiro não entra no controle do turno.<button className="ml-auto font-bold underline" onClick={() => go('turno')}>Abrir caixa</button></div>}
            {view === 'venda' && <SaleView menu={menu} draft={draft} setDraft={setDraft} onCheckout={() => setView('pagamento')} />}
            {view === 'pagamento' && <PaymentView menu={menu} target={target} onBack={() => (existing ? go('pedidos') : setView('venda'))} onDone={done} />}
            {view === 'sucesso' && receipt && <DoneView r={receipt} onNew={() => { setReceipt(null); setView('venda'); }} onOpenOrder={() => { setSelected(receipt.orderId); setView('pedidos'); }} onReprint={async () => (await o.reprint(receipt.orderId)).jobs} />}
            {view === 'pedidos' && <OrdersView o={o} selectedId={selected} onSelect={setSelected} onReceive={(x) => { setExisting(x); setView('pagamento'); }} />}
            {view === 'turno' && <ShiftView cash={cash} />}
          </>
        )}
      </main>
    </div>
  );
}

function UserMenu({ name, role, can, onLogout }: { name: string; role: string; can: (p: 'garcom' | 'motoboy' | 'admin.dashboard') => boolean; onLogout: () => void }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off); }, []);
  const first = name.split(' ')[0] || 'você';
  const item = 'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-accent';
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 hover:bg-white/10" aria-expanded={open} aria-haspopup="menu">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-base font-bold text-primary">{first.charAt(0).toUpperCase()}</span>
        <span className="hidden text-left leading-tight md:block"><span className="block font-bold">Olá, {first}</span><span className="block text-xs text-primary-foreground/80">{role}</span></span><ChevronDown size={16} className="hidden md:block" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-border bg-card p-2 text-foreground shadow-ui-md" role="menu">
          {can('garcom') && <NavLink to="/garcom" className={item}><ConciergeBell size={15} /> App do garçom</NavLink>}
          {can('motoboy') && <NavLink to="/entregador" className={item}><Bike size={15} /> App do entregador</NavLink>}
          {can('admin.dashboard') && <a href="/painel" className={item}><LayoutDashboard size={15} /> Painel do lojista</a>}
          <InstallButton label="Instalar PDV como app" className={item} />
          <div className="flex items-center justify-between px-3 py-2 text-sm text-muted-foreground">Aparência <ThemeToggle /></div>
          <button onClick={onLogout} className={item} role="menuitem"><LogOut size={15} /> Sair</button>
        </div>
      )}
    </div>
  );
}
