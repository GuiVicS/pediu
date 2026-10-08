import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { LogIn, Loader2 } from 'lucide-react';
import { HOME, storeSlug, useSession } from '@/lib/session';
import { permForPath } from '@/lib/paths';
import { can } from '@pediu/shared/browser';
import { ThemeToggle, useApplyPlatformTheme } from '@/ui/platformTheme';
import { BannerSlider, useBanners } from '@/ui/BannerSlider';
import { ErrorBox, useAction } from '@/ui/misc';

/** Entrada da equipe: tela dividida ao meio. À esquerda o formulário; à direita os banners da plataforma (cadastrados no super admin), que passam sozinhos. */
export default function Login() {
  const { me, login } = useSession();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const act = useAction();
  useApplyPlatformTheme();
  const banners = useBanners('login');
  const hasBanners = !!banners && banners.length > 0;   // enquanto carrega ou sem banner cadastrado: só o formulário
  const slug = storeSlug();
  if (me) {
    const next = params.get('next') ?? '';
    const perm = permForPath(next);
    return <Navigate to={perm && can(me.role, perm) ? next : HOME[me.role]} replace />;
  }
  return (
    <div className={`grid h-screen max-h-screen overflow-hidden bg-background font-brand text-foreground ${hasBanners ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''}`}>
      {/* a página nunca passa de 100vh: se a janela for muito baixa, só o formulário rola por dentro */}
      <div className="min-h-0 min-w-0 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center px-4 py-6">
        <form onSubmit={(e) => { e.preventDefault(); void act.run(() => login(email.trim(), password)); }} className="card w-full max-w-sm space-y-4 p-6">
          <div className="flex items-center justify-between"><img src="/brand/logo.png" alt="PediuLanchou" className="h-9 w-auto dark:hidden" /><img src="/brand/logo-white.png" alt="PediuLanchou" className="hidden h-9 w-auto dark:block" /><ThemeToggle /></div>
          <div><h1 className="text-lg font-bold">Entrar na equipe</h1><p className="text-xs text-muted-foreground">{slug ? <>Loja: <b>{slug}</b></> : 'Em desenvolvimento, abra com ?loja=slug-da-loja'}</p></div>
          <ErrorBox>{act.error}</ErrorBox>
          <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">E-mail</span><input className="input" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Senha</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="btn w-full !py-2.5" disabled={!email || !password || !slug || act.busy}>{act.busy ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />} Entrar</button>
          <p className="text-center text-[11px] text-muted-foreground">5 erros bloqueiam o acesso por 15 minutos.</p>
        </form>
        </div>
      </div>
      {/* metade da direita: só em telas grandes e só quando o super admin cadastrou banners */}
      {hasBanners && (
        <aside className="relative hidden h-full min-h-0 overflow-hidden lg:block" aria-label="Novidades">
          <BannerSlider banners={banners!} variant="panel" />
        </aside>
      )}
    </div>
  );
}
