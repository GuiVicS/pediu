import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, Bike, Blocks, Calendar, ChevronDown, ClipboardList, ConciergeBell, ExternalLink, Globe, Home, LogOut, Menu, MessageCircle, Monitor, Palette, Printer,
  Search, Store as StoreIcon, Tag, Truck, UserCog, Users, UtensilsCrossed, X, type LucideIcon,
} from 'lucide-react';
import type { Perm } from '@pediu/shared/browser';
import { get } from '@/lib/api';
import { brlc, useOrders } from '@/lib/orders';
import { ROLE_LABEL } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { cx } from '@/ui/kit';
import { InstallButton } from '@/ui/InstallButton';
import { ThemeToggle, useApplyPlatformTheme } from '@/ui/platformTheme';
import { ToastProvider, TopbarSlot } from './AdminUI';

interface Item { to: string; label: string; Icon: LucideIcon; perm: Perm; end?: boolean; children?: [to: string, label: string][]; app?: string }

/** Itens principais (o que o lojista usa todo dia). Itens com `children` abrem os atalhos da área quando ela está ativa. */
const MAIN: Item[] = [
  { to: '/painel', label: 'Visão geral', Icon: Home, perm: 'admin.dashboard', end: true },
  { to: '/painel/pedidos', label: 'Pedidos', Icon: ClipboardList, perm: 'admin.pedidos' },
  { to: '/painel/produtos', label: 'Cardápio', Icon: UtensilsCrossed, perm: 'admin.cardapio', children: [['/painel/produtos', 'Produtos'], ['/painel/categorias', 'Categorias'], ['/painel/adicionais', 'Adicionais'], ['/painel/destaques', 'Destaques']] },
  { to: '/painel/clientes', label: 'Clientes', Icon: Users, perm: 'admin.pedidos' },
  { to: '/painel/cupons', label: 'Cupons', Icon: Tag, perm: 'admin.loja' },
  { to: '/painel/aparencia', label: 'Aparência', Icon: Palette, perm: 'admin.loja', children: [['/painel/aparencia', 'Tema e logo'], ['/painel/banners', 'Banners']] },
  { to: '/painel/integracoes', label: 'Integrações', Icon: Blocks, perm: 'admin.loja' },
  { to: '/painel/loja', label: 'Loja e entrega', Icon: Bike, perm: 'admin.loja' },
  { to: '/painel/impressao', label: 'Impressão', Icon: Printer, perm: 'admin.loja' },
  { to: '/painel/dominios', label: 'Domínios', Icon: Globe, perm: 'admin.loja' },
  { to: '/painel/usuarios', label: 'Equipe', Icon: UserCog, perm: 'admin.usuarios' },
];
const MORE: Item[] = [
  // apps do hub: só aparecem quando instalados em Integrações
  { to: '/painel/whatsapp', label: 'WhatsApp e IA', Icon: MessageCircle, perm: 'admin.pedidos', app: 'whatsapp' },
  { to: '/painel/ifood', label: 'iFood', Icon: Truck, perm: 'admin.loja', app: 'ifood' },
  { to: '/pdv', label: 'PDV (caixa)', Icon: Monitor, perm: 'pdv' },
  { to: '/garcom', label: 'Garçom (mesas)', Icon: ConciergeBell, perm: 'garcom' },
  { to: '/entregador', label: 'Entregador', Icon: Bike, perm: 'motoboy' },
];

export default function AdminLayout() { return <ToastProvider><Shell /></ToastProvider>; }

function Shell() {
  const { me, can } = useSession();
  const [open, setOpen] = useState(false);
  // apps instalados no hub (Integrações): o menu esconde iFood e WhatsApp quando não estão instalados
  const [installed, setInstalled] = useState<Set<string> | null>(null);
  useEffect(() => {
    const load = () => get<{ apps: { id: string; installed: boolean }[] }>('/v1/staff/apps').then((r) => setInstalled(new Set(r.apps.filter((a) => a.installed).map((a) => a.id)))).catch(() => setInstalled(null));
    load(); window.addEventListener('pediu:apps-changed', load); return () => window.removeEventListener('pediu:apps-changed', load);
  }, []);
  const visible = (i: Item) => can(i.perm) && (!i.app || !installed || installed.has(i.app));
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const loc = useLocation();
  const { orders } = useOrders({ open: true, limit: 100, sound: true });
  const novos = orders.filter((o) => o.status === 'novo').length;
  useApplyPlatformTheme();
  useEffect(() => { document.title = `${me?.store?.name ? `${me.store.name} — ` : ''}Painel — PediuLanchou`; }, [me?.store?.name]);
  useEffect(() => setOpen(false), [loc.pathname]);
  // a campainha só toca depois de um toque na página (regra dos navegadores): avisamos o lojista uma vez
  const [armed, setArmed] = useState(() => sessionStorage.getItem('pediu-sound') === '1');
  useEffect(() => { if (armed) return; const on = () => { sessionStorage.setItem('pediu-sound', '1'); setArmed(true); }; window.addEventListener('pointerdown', on, { once: true }); return () => window.removeEventListener('pointerdown', on); }, [armed]);
  const today = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="flex min-h-screen bg-background font-brand text-foreground">
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-[17rem] flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform lg:sticky lg:top-0 lg:h-screen lg:max-h-screen lg:shrink-0 lg:self-start lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="relative rounded-b-[1.75rem] bg-primary px-7 pb-8 pt-7">
          <img src="/brand/logo-white.png" alt="PediuLanchou" className="h-10 w-auto" />
          <button className="absolute right-3 top-3 rounded-full p-1.5 text-white/80 hover:bg-white/15 lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu"><X size={18} /></button>
        </div>
        <StoreCard />
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3 pt-1" aria-label="Menu do painel">
          {MAIN.filter((i) => can(i.perm)).map((i) => <NavItem key={i.to} item={i} path={loc.pathname} badge={i.to === '/painel/pedidos' ? novos : 0} />)}
          {MORE.some(visible) && <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">Mais</div>}
          {MORE.filter(visible).map((i) => <NavItem key={i.to} item={i} path={loc.pathname} badge={0} />)}
        </nav>
        <div className="space-y-1 border-t border-sidebar-border p-3 text-sm">
          <InstallButton label="Instalar painel como app" className="flex w-full items-center gap-2 rounded-xl bg-sidebar-primary px-3 py-2 font-medium text-sidebar-primary-foreground hover:bg-sidebar-primary/90" />
          <a className="flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" href="/" target="_blank" rel="noreferrer"><ExternalLink size={15} /> Ver loja{me?.store?.status === 'desenvolvimento' && <span className="rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-600">dev</span>}</a>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile: barra compacta */}
        <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Menu"><Menu size={20} /></button>
          <img src="/brand/bubble.png" alt="PediuLanchou" className="h-7 w-7" />
          <span className="flex-1 truncate font-semibold">{me?.store?.name ?? 'Painel'}</span>
          <ThemeToggle />
          <Link to="/painel/pedidos" className="relative" aria-label="Pedidos novos"><Bell size={18} />{novos > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{novos}</span>}</Link>
        </header>
        {/* desktop: título da página (vem do PageHeader), busca, sino e usuário */}
        <div className="hidden items-start gap-4 px-7 pb-2 pt-6 lg:flex">
          <div ref={setSlot} className="min-w-0 flex-1" />
          <div className="flex shrink-0 flex-col items-end gap-3">
            <div className="flex items-center gap-4"><SearchBox /><Bell2 count={novos} /><UserMenu /></div>
            {loc.pathname === '/painel' && <span className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-sm font-medium"><Calendar size={15} className="text-muted-foreground" /> Hoje, {today}</span>}
          </div>
        </div>
        {!armed && <div className="bg-blue-500/10 px-4 py-1.5 text-center text-xs text-blue-700 dark:text-blue-300">Toque em qualquer lugar da página para ativar o som de pedido novo.</div>}
        <main className="min-w-0 flex-1 p-4 lg:px-7 lg:pb-7 lg:pt-3"><TopbarSlot.Provider value={slot}><Outlet /></TopbarSlot.Provider></main>
      </div>
    </div>
  );
}

/** Cartão da loja: foto/logo, nome e se está aberta (ou em desenvolvimento). */
function StoreCard() {
  const { me } = useSession();
  const st = me?.store;
  const dev = st?.status === 'desenvolvimento';
  const label = !st ? '' : dev ? 'Em desenvolvimento' : st.status !== 'producao' ? st.status : st.open ? 'Loja aberta' : 'Loja fechada';
  const dot = dev ? 'bg-amber-500' : st?.open && st.status === 'producao' ? 'bg-green-500' : 'bg-slate-400';
  return (
    <div className="bg-sidebar px-6 pb-3 pt-6">
      <div className="flex items-center gap-3.5">
        {st?.logoUrl ? <img src={st.logoUrl} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-border" />
          : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-primary ring-2 ring-border"><StoreIcon size={24} /></span>}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[15px] font-bold" title={st?.name}>{st?.name ?? 'Minha loja'}</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><span className={cx('h-2 w-2 rounded-full', dot)} />{label}</div>
        </div>
      </div>
    </div>
  );
}

function NavItem({ item, path, badge }: { item: Item; path: string; badge: number }) {
  const { to, label, Icon, end, children } = item;
  const inGroup = !!children && children.some(([c]) => path === c || path.startsWith(`${c}/`));
  const active = (end ? path === to : path === to || path.startsWith(`${to}/`)) || inGroup;
  return (
    <div>
      <NavLink to={to} end={end} className={cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition', active ? 'bg-accent font-semibold text-primary' : 'font-medium text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')}>
        <Icon size={19} className={active ? 'text-primary' : 'text-sidebar-foreground/70'} /> <span className="flex-1">{label}</span>
        {badge > 0 && <span className="rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">{badge}</span>}
      </NavLink>
      {children && inGroup && (
        <div className="ml-[2.1rem] mt-0.5 space-y-0.5 border-l border-border pl-3">
          {children.map(([c, l]) => <NavLink key={c} to={c} className={({ isActive }) => cx('block rounded-lg px-2 py-1.5 text-sm', isActive ? 'font-semibold text-primary' : 'text-muted-foreground hover:text-foreground')}>{l}</NavLink>)}
        </div>
      )}
    </div>
  );
}

function Bell2({ count }: { count: number }) {
  return (
    <Link to="/painel/pedidos" className="relative rounded-full p-2 text-primary transition hover:bg-accent" aria-label={count ? `${count} pedido(s) novo(s)` : 'Pedidos'}>
      <Bell size={24} />
      {count > 0 && <span className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-destructive-foreground">{count}</span>}
    </Link>
  );
}

interface Found { orders: { number: number; customer_name: string; status: string; total_cents: number }[]; customers: { id: string; name: string; email: string }[]; products: { id: string; name: string; price: number }[] }

/** Busca rápida: pedidos (número, nome ou telefone), clientes com conta e produtos. */
function SearchBox() {
  const nav = useNavigate();
  const [q, setQ] = useState(''); const [found, setFound] = useState<Found | null>(null); const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setFound(null); return; }
    let alive = true;
    const t = setTimeout(() => { get<Found>(`/v1/staff/search?q=${encodeURIComponent(term)}`).then((r) => alive && setFound(r)).catch(() => alive && setFound(null)); }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  useEffect(() => { const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off); }, []);
  const go = (to: string) => { setOpen(false); setQ(''); setFound(null); nav(to); };
  const empty = found && !found.orders.length && !found.customers.length && !found.products.length;
  const Row = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => <button className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent" onClick={onClick}>{children}</button>;
  return (
    <div ref={box} className="relative">
      <label className="flex w-[22rem] max-w-[34vw] items-center gap-2.5 rounded-full border border-border bg-card px-4 py-2.5 shadow-ui-sm focus-within:border-ring">
        <Search size={18} className="text-foreground/70" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          placeholder="Buscar pedidos, clientes ou itens…" aria-label="Buscar pedidos, clientes ou itens" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      </label>
      {open && q.trim().length >= 2 && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[26rem] max-w-[90vw] overflow-hidden rounded-2xl border border-border bg-card py-1 shadow-ui-md" role="listbox">
          {!found ? <div className="px-3 py-3 text-sm text-muted-foreground">Buscando…</div> : empty ? <div className="px-3 py-3 text-sm text-muted-foreground">Nada encontrado para “{q.trim()}”.</div> : (
            <>
              {found.orders.length > 0 && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pedidos</div>}
              {found.orders.map((o) => <Row key={o.number} onClick={() => go('/painel/pedidos')}><span><b>#{o.number}</b> · {o.customer_name || 'Sem nome'}</span><span className="text-xs text-muted-foreground">{o.status} · {brlc(o.total_cents)}</span></Row>)}
              {found.customers.length > 0 && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Clientes</div>}
              {found.customers.map((c) => <Row key={c.id} onClick={() => go(`/painel/clientes?q=${encodeURIComponent(c.email)}`)}><span>{c.name || 'Sem nome'}</span><span className="truncate text-xs text-muted-foreground">{c.email}</span></Row>)}
              {found.products.length > 0 && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Itens do cardápio</div>}
              {found.products.map((p) => <Row key={p.id} onClick={() => go('/painel/produtos')}><span>{p.name}</span><span className="text-xs text-muted-foreground">{brlc(Math.round(Number(p.price) * 100))}</span></Row>)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { me, logout } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off); }, []);
  const first = (me?.name ?? '').split(' ')[0] || 'você';
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-3 rounded-full py-1 pl-1 pr-2 hover:bg-accent" aria-expanded={open} aria-haspopup="menu">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">{first.charAt(0).toUpperCase()}</span>
        <span className="text-[17px] font-bold">Olá, {first}</span>
        <ChevronDown size={18} className="text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-border bg-card p-2 text-sm shadow-ui-md" role="menu">
          <div className="px-3 py-2"><b className="block truncate">{me?.name}</b><span className="text-xs text-muted-foreground">{me ? ROLE_LABEL[me.role] : ''}</span></div>
          <div className="flex items-center justify-between rounded-xl px-3 py-2 text-muted-foreground">Aparência do painel <ThemeToggle /></div>
          <button onClick={logout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-accent" role="menuitem"><LogOut size={15} /> Sair</button>
        </div>
      )}
    </div>
  );
}
