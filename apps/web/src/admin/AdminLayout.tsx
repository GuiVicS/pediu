import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Bell, Bike, ConciergeBell, CreditCard, Globe, Image, LayoutDashboard, Layers, ListPlus, LogOut, Menu, Monitor, Package, Palette, Printer,
  ShoppingBag, Star, Store as StoreIcon, UserCog, Users, ExternalLink, Truck, type LucideIcon,
  MessageCircle,
} from 'lucide-react';
import type { Perm } from '@pediu/shared/browser';
import { ROLE_LABEL } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { cx } from '@/ui/kit';
import { InstallButton } from '@/ui/InstallButton';
import { ThemeToggle, useApplyPlatformTheme } from '@/ui/platformTheme';
import { useOrders } from '@/lib/orders';
import { ToastProvider } from './AdminUI';

const NAV: { title: string; items: [to: string, label: string, Icon: LucideIcon, perm: Perm][] }[] = [
  { title: 'Operação', items: [['/painel', 'Dashboard', LayoutDashboard, 'admin.dashboard'], ['/painel/pedidos', 'Pedidos', ShoppingBag, 'admin.pedidos'], ['/painel/clientes', 'Clientes', Users, 'admin.pedidos']] },
  { title: 'Apps de operação', items: [['/pdv', 'PDV', Monitor, 'pdv'], ['/garcom', 'Garçom (mesas)', ConciergeBell, 'garcom'], ['/entregador', 'Entregador', Bike, 'motoboy']] },
  { title: 'Cardápio', items: [['/painel/produtos', 'Produtos', Package, 'admin.cardapio'], ['/painel/categorias', 'Categorias', Layers, 'admin.cardapio'], ['/painel/adicionais', 'Adicionais', ListPlus, 'admin.cardapio'], ['/painel/destaques', 'Destaques', Star, 'admin.cardapio']] },
  { title: 'Loja', items: [['/painel/aparencia', 'Aparência', Palette, 'admin.loja'], ['/painel/banners', 'Banners', Image, 'admin.loja'], ['/painel/pagamentos', 'Pagamentos', CreditCard, 'admin.loja'], ['/painel/loja', 'Loja e entrega', StoreIcon, 'admin.loja'], ['/painel/impressao', 'Impressão', Printer, 'admin.loja'], ['/painel/ifood', 'iFood', Truck, 'admin.loja'], ['/painel/dominios', 'Domínios', Globe, 'admin.loja'], ['/painel/whatsapp', 'Atendimento WhatsApp', MessageCircle, 'admin.pedidos']] },
  { title: 'Equipe', items: [['/painel/usuarios', 'Usuários', UserCog, 'admin.usuarios']] },
];

export default function AdminLayout() { return <ToastProvider><Shell /></ToastProvider>; }

function Shell() {
  const { me, can, logout } = useSession();
  const [open, setOpen] = useState(false);
  const { orders } = useOrders({ open: true, limit: 100, sound: true });
  const novos = orders.filter((o) => o.status === 'novo').length;
  useApplyPlatformTheme();
  useEffect(() => { document.title = 'Painel — PediuLanchou'; }, []);
  // a campainha só toca depois de um toque na página (regra dos navegadores): avisamos o lojista uma vez
  const [armed, setArmed] = useState(() => sessionStorage.getItem('pediu-sound') === '1');
  useEffect(() => { if (armed) return; const on = () => { sessionStorage.setItem('pediu-sound', '1'); setArmed(true); }; window.addEventListener('pointerdown', on, { once: true }); return () => window.removeEventListener('pointerdown', on); }, [armed]);

  return (
    <div className="flex min-h-screen bg-background font-brand text-foreground">
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
      <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="border-b border-sidebar-border px-5 py-4">
          <img src="/brand/logo.png" alt="PediuLanchou" className="h-9 w-auto dark:hidden" />
          <img src="/brand/logo-white.png" alt="PediuLanchou" className="hidden h-9 w-auto dark:block" />
          <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">Painel do lojista</div>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {NAV.map((g) => ({ ...g, items: g.items.filter(([, , , perm]) => can(perm)) })).filter((g) => g.items.length > 0).map((g) => (
            <div key={g.title}>
              <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">{g.title}</div>
              {g.items.map(([to, label, Icon]) => (
                <NavLink key={to} end={to === '/painel'} to={to} onClick={() => setOpen(false)}
                  className={({ isActive }) => cx('flex items-center gap-2.5 rounded-ui-sm px-2.5 py-2 text-sm transition', isActive ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')}>
                  <Icon size={16} /> <span className="flex-1">{label}</span>
                  {to === '/painel/pedidos' && novos > 0 && <span className="rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">{novos}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="space-y-1 border-t border-sidebar-border p-3 text-sm">
          {me && (
            <div className="mb-1 rounded-ui-sm bg-sidebar-accent px-2.5 py-2 text-sidebar-accent-foreground">
              <div className="flex items-center gap-2"><span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-xs">{me.name}</b><span className="text-[11px] opacity-70">{ROLE_LABEL[me.role]}</span></span>
                <button onClick={logout} title="Sair" aria-label="Sair" className="rounded p-1 hover:bg-sidebar-border"><LogOut size={15} /></button></div>
            </div>
          )}
          <InstallButton label="Instalar painel como app" className="flex w-full items-center gap-2 rounded-ui-sm bg-sidebar-primary px-2.5 py-2 font-medium text-sidebar-primary-foreground hover:bg-sidebar-primary/90" />
          <a className="flex items-center gap-2 rounded-ui-sm px-2.5 py-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" href="/" target="_blank" rel="noreferrer"><ExternalLink size={15} /> Ver loja{me?.store?.status === 'desenvolvimento' && <span className="badge ml-auto bg-amber-500/20 text-amber-600">rascunho</span>}</a>
          <div className="flex items-center justify-between px-2.5 py-1 text-xs text-sidebar-foreground/60">Aparência do painel <ThemeToggle /></div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Menu"><Menu size={20} /></button>
          <img src="/brand/bubble.png" alt="PediuLanchou" className="h-7 w-7" />
          <span className="flex-1 truncate font-semibold">Painel</span>
          <ThemeToggle />
          <span className="relative"><Bell size={18} />{novos > 0 && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-destructive" />}</span>
        </header>
        {!armed && <div className="bg-blue-500/10 px-4 py-1.5 text-center text-xs text-blue-700 dark:text-blue-300">Toque em qualquer lugar da página para ativar o som de pedido novo.</div>}
        <main className="flex-1 p-4 lg:p-7"><Outlet /></main>
      </div>
    </div>
  );
}
