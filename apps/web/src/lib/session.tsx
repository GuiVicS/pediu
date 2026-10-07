import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LogOut, ShieldAlert } from 'lucide-react';
import { can as canRole, ROLE_PERMS, type Perm, type Role } from '@pediu/shared/browser';
import { get, post } from './api';
import { useApplyPlatformTheme } from '@/ui/platformTheme';

export interface Me { name: string; role: Role; storeId: string; store?: { slug: string; name: string; status: string } | null }
interface Ctx { me: Me | null; ready: boolean; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>; can: (p: Perm) => boolean; refresh: () => Promise<void> }
const SessionCtx = createContext<Ctx | null>(null);

/** Slug da loja deste domínio: o web-edge injeta window.__PEDIU__; em desenvolvimento use ?loja=slug (fica salvo). */
export function storeSlug(): string {
  const w = (window as unknown as { __PEDIU__?: { slug?: string } }).__PEDIU__?.slug;
  if (w) return w;
  const q = new URLSearchParams(location.search).get('loja');
  if (q) { localStorage.setItem('pediu-dev-loja', q); return q; }
  return localStorage.getItem('pediu-dev-loja') ?? '';
}

export const HOME: Record<Role, string> = { admin: '/painel', gerente: '/painel', suporte: '/painel', balcao: '/pdv', garcom: '/garcom', entregador: '/entregador' };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => { try { setMe(await get<Me>('/v1/staff/me')); } catch { setMe(null); } finally { setReady(true); } }, []);
  useEffect(() => { void refresh(); const off = () => setMe(null); window.addEventListener('pediu:unauthenticated', off); return () => window.removeEventListener('pediu:unauthenticated', off); }, [refresh]);
  const value = useMemo<Ctx>(() => ({
    me, ready, refresh,
    login: async (email, password) => { await post('/v1/staff/login', { store: storeSlug(), email, password }); await refresh(); },
    logout: async () => { try { await post('/v1/staff/logout'); } finally { setMe(null); } },
    can: (p) => !!me && canRole(me.role, p),
  }), [me, ready, refresh]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
export const useSession = () => { const c = useContext(SessionCtx); if (!c) throw new Error('SessionProvider ausente'); return c; };

export function RequirePerm({ perm, children }: { perm: Perm; children: ReactNode }) {
  const { me, ready, can, logout } = useSession();
  const loc = useLocation();
  useApplyPlatformTheme();
  if (!ready) return <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>;
  if (!me) return <Navigate to={`/entrar?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (!can(perm)) return (
    <div className="flex min-h-[60vh] items-center justify-center p-6 font-brand">
      <div className="card max-w-md space-y-3 p-8 text-center">
        <ShieldAlert size={44} className="mx-auto text-destructive" />
        <h1 className="text-lg font-bold">Sem acesso a esta área</h1>
        <p className="text-sm text-muted-foreground">O seu perfil não tem permissão para abrir esta tela.</p>
        <div className="flex justify-center gap-2"><a className="btn" href={HOME[me.role]}>Ir para a minha área</a><button className="btn-ghost" onClick={logout}><LogOut size={14} /> Sair</button></div>
      </div>
    </div>
  );
  return <>{children}</>;
}
export { ROLE_PERMS };
