import { useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ErrorBox, useAction } from '@/ui/misc';
import { ThemeToggle, useApplyPlatformTheme } from '@/ui/platformTheme';

type Step = 'senha' | 'enroll' | 'codigos' | 'totp';

/** Login em dois fatores: senha → (1º acesso: cadastrar o autenticador e guardar os códigos) → código do app. */
export default function Login() {
  const { me, refresh } = useAuth();
  const [step, setStep] = useState<Step>(me && !me.totpVerified ? (me.totpEnabled ? 'totp' : 'enroll') : 'senha');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [code, setCode] = useState('');
  const [enroll, setEnroll] = useState<{ secret: string; otpauthUrl: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]); const [saved, setSaved] = useState(false);
  const act = useAction();
  useApplyPlatformTheme();

  useEffect(() => { if (step === 'enroll' && !enroll) void act.run(async () => { const r = await post<{ secret: string; otpauthUrl: string }>('/v1/platform/auth/totp/enroll'); setEnroll({ ...r, qr: await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 220 }) }); }); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitPassword = () => act.run(async () => { const r = await post<{ next: 'enroll' | 'totp' }>('/v1/platform/auth/login', { email: email.trim(), password }); setPassword(''); setStep(r.next); });
  const confirm = () => act.run(async () => { const r = await post<{ recoveryCodes: string[] }>('/v1/platform/auth/totp/confirm', { code }); setCodes(r.recoveryCodes); setCode(''); setStep('codigos'); });
  const verify = () => act.run(async () => { await post('/v1/platform/auth/totp/verify', { code: code.trim() }); await refresh(); });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 font-brand text-foreground">
      <div className="card w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center justify-between"><img src="/brand/logo.png" alt="Pediu" className="h-9 w-auto dark:hidden" /><img src="/brand/logo-white.png" alt="Pediu" className="hidden h-9 w-auto dark:block" /><ThemeToggle /></div>
        <div><h1 className="text-lg font-bold">Super admin</h1><p className="text-xs text-muted-foreground">Acesso restrito, com autenticador obrigatório.</p></div>
        <ErrorBox>{act.error}</ErrorBox>

        {step === 'senha' && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submitPassword(); }}>
            <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">E-mail</span><input className="input" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="block text-sm"><span className="mb-1 block text-xs font-medium text-muted-foreground">Senha</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <button className="btn w-full !py-2.5" disabled={!email || !password || act.busy}>{act.busy ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />} Continuar</button>
          </form>
        )}

        {step === 'enroll' && (
          <div className="space-y-3 text-sm">
            <p><b>Primeiro acesso:</b> cadastre o autenticador (Google Authenticator, Authy, 1Password…).</p>
            {enroll ? <>
              <img src={enroll.qr} alt="QR Code do autenticador" className="mx-auto h-44 w-44 rounded-ui-sm border border-border bg-white p-1" />
              <div className="rounded-ui-sm bg-muted p-2 text-center text-xs"><div className="text-muted-foreground">ou digite a chave</div><code className="break-all">{enroll.secret}</code></div>
              <input className="input text-center text-xl tracking-[0.4em]" inputMode="numeric" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <button className="btn w-full" disabled={code.length !== 6 || act.busy} onClick={confirm}><ShieldCheck size={15} /> Ativar autenticador</button>
            </> : <div className="flex justify-center p-6"><Loader2 className="animate-spin" /></div>}
          </div>
        )}

        {step === 'codigos' && (
          <div className="space-y-3 text-sm">
            <p className="rounded-ui-sm bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-300"><b>Guarde estes 10 códigos agora.</b> Eles não aparecem de novo. Cada um vale uma vez e substitui o app se você perder o celular.</p>
            <div className="grid grid-cols-2 gap-1.5 rounded-ui-sm bg-muted p-3 font-mono text-sm">{codes.map((c) => <span key={c}>{c}</span>)}</div>
            <button className="btn-ghost w-full" onClick={() => navigator.clipboard.writeText(codes.join('\n'))}><Copy size={14} /> Copiar</button>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> Guardei os códigos em local seguro</label>
            <button className="btn w-full" disabled={!saved} onClick={() => void refresh()}><Check size={15} /> Entrar</button>
          </div>
        )}

        {step === 'totp' && (
          <form className="space-y-3 text-sm" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
            <label className="block"><span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><KeyRound size={13} /> Código do autenticador (ou código de recuperação)</span>
              <input autoFocus className="input text-center text-xl tracking-[0.3em]" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="000000" /></label>
            <button className="btn w-full !py-2.5" disabled={code.length < 6 || act.busy}>{act.busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Entrar</button>
            <p className="text-center text-[11px] text-muted-foreground">5 erros bloqueiam a conta por 15 minutos.</p>
          </form>
        )}
      </div>
    </div>
  );
}
