import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Activity, BellRing, Boxes, CreditCard, FileText, KeyRound, LayoutDashboard, Link2, LogOut, Menu, Rocket, ScrollText, Store, Truck, Rows3, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { get } from '@/lib/api';
import { cx } from '@/ui/kit';
import { ThemeToggle, useApplyPlatformTheme } from '@/ui/platformTheme';
import { ToastProvider } from '@/ui/Toast';
import { useLoad } from '@/ui/bits';

const NAV: { title: string; items: [string, string, LucideIcon][] }[] = [
  { title: 'Visão geral', items: [['/', 'Painel', LayoutDashboard], ['/lojas', 'Lojas', Store], ['/publicacoes', 'Publicações', Rocket]] },
  { title: 'Monitoramento', items: [['/desempenho', 'Desempenho', Rows3], ['/alertas', 'Alertas', BellRing], ['/saude', 'Saúde da API', Activity], ['/logs', 'Logs', ScrollText], ['/auditoria', 'Auditoria', FileText]] },
  { title: 'Negócio', items: [['/assinaturas', 'Assinaturas', CreditCard], ['/versoes', 'Versões por loja', Boxes], ['/ifood', 'iFood (plataforma)', Truck], ['/mcp', 'Tokens do MCP', KeyRound], ['/rodape', 'Rodapé das lojas', Link2]] },
];

export default function Layout() {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  useApplyPlatformTheme();
  const alerts = useLoad(() => get<{ alerts: { severity: string }[] }>('/v1/platform/alerts?status=active&limit=200'), [], 30_000);
  const crit = alerts.data?.alerts.filter((a) => a.severity === 'critical').length ?? 0;
  const total = alerts.data?.alerts.length ?? 0;
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-background font-brand text-foreground">
        {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}
        <aside className={cx('fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
          <div className="border-b border-sidebar-border px-5 py-4"><img src="/brand/logo.png" alt="Pediu" className="h-9 w-auto dark:hidden" /><img src="/brand/logo-white.png" alt="Pediu" className="hidden h-9 w-auto dark:block" /><div className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">Super admin</div></div>
          <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
            {NAV.map((g) => (
              <div key={g.title}><div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">{g.title}</div>
                {g.items.map(([to, label, Icon]) => (
                  <NavLink key={to} end={to === '/'} to={to} onClick={() => setOpen(false)} className={({ isActive }) => cx('flex items-center gap-2.5 rounded-ui-sm px-2.5 py-2 text-sm transition', isActive ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')}>
                    <Icon size={16} /><span className="flex-1">{label}</span>
                    {to === '/alertas' && total > 0 && <span className={cx('rounded-full px-1.5 text-[11px] font-bold', crit ? 'bg-destructive text-destructive-foreground' : 'bg-amber-500 text-white')}>{total}</span>}
                  </NavLink>))}
              </div>))}
          </nav>
          <div className="space-y-1 border-t border-sidebar-border p-3 text-sm">
            <div className="rounded-ui-sm bg-sidebar-accent px-2.5 py-2 text-sidebar-accent-foreground"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-xs">{me?.name}</b><span className="block truncate text-[11px] opacity-70">{me?.email}</span></span><button onClick={logout} title="Sair" aria-label="Sair" className="rounded p-1 hover:bg-sidebar-border"><LogOut size={15} /></button></div></div>
            <div className="flex items-center justify-between px-2.5 py-1 text-xs text-sidebar-foreground/60">Aparência <ThemeToggle /></div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-2.5 lg:hidden"><button onClick={() => setOpen(true)} aria-label="Menu"><Menu size={20} /></button><span className="flex-1 font-semibold">Super admin</span><ThemeToggle /></header>
          <main className="flex-1 p-4 lg:p-7"><Outlet /></main>
        </div>
      </div>
    </ToastProvider>
  );
}
