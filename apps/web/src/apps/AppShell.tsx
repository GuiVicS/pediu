import { useEffect, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Bike, ConciergeBell, LayoutDashboard, LogOut, Monitor, type LucideIcon } from 'lucide-react';
import type { Perm } from '@pediu/shared/browser';
import { ROLE_LABEL } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { cx } from '@/ui/kit';
import { ThemeToggle, useApplyPlatformTheme } from '@/ui/platformTheme';
import { setThemeColor } from '@/lib/pwa';
import { ToastProvider } from '@/admin/AdminUI';

export const APPS: { to: string; label: string; Icon: LucideIcon; perm: Perm }[] = [
  { to: '/pdv', label: 'PDV', Icon: Monitor, perm: 'pdv' }, { to: '/garcom', label: 'Garçom', Icon: ConciergeBell, perm: 'garcom' }, { to: '/entregador', label: 'Entregador', Icon: Bike, perm: 'motoboy' },
];

/** Moldura dos apps de operação: cabeçalho, troca entre apps conforme o perfil e toasts. */
export default function AppShell({ title, wide, right, children }: { title: string; wide?: boolean; right?: ReactNode; children: ReactNode }) {
  const { me, can, logout } = useSession();
  useApplyPlatformTheme();
  useEffect(() => { setThemeColor('#0091FF'); document.title = `${title} — Pediu Lanchou`; }, [title]);
  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-background font-brand text-foreground">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card px-4 py-2.5">
          <img src="/brand/bubble.png" alt="Pediu Lanchou" className="h-8 w-8" />
          <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-sm font-bold">{title}</div><div className="truncate text-xs text-muted-foreground">{me?.name} · {me ? ROLE_LABEL[me.role] : ''}</div></div>
          {right}
          <nav className="flex gap-1">
            {APPS.filter((a) => can(a.perm)).map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} title={label} className={({ isActive }) => cx('flex items-center gap-1.5 rounded-ui-sm px-2.5 py-1.5 text-xs font-medium', isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}><Icon size={14} /><span className="hidden sm:inline">{label}</span></NavLink>
            ))}
            {can('admin.dashboard') && <a href="/painel" title="Painel" className="flex items-center gap-1.5 rounded-ui-sm px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"><LayoutDashboard size={14} /><span className="hidden sm:inline">Painel</span></a>}
          </nav>
          <ThemeToggle />
          <button onClick={logout} title="Sair" aria-label="Sair" className="rounded-ui-sm p-2 text-muted-foreground hover:bg-muted"><LogOut size={15} /></button>
        </header>
        <main className={cx('mx-auto w-full flex-1 p-4', wide ? 'max-w-6xl' : 'max-w-2xl')}>{children}</main>
      </div>
    </ToastProvider>
  );
}
