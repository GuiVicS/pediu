import { useEffect, useState } from 'react';
import { ArrowLeft, ClipboardList, Eye, EyeOff, KeyRound, Loader2, Lock, LogIn, LogOut, Mail, Phone, Ticket, User, UserPlus } from 'lucide-react';
import { ApiError, get, post, put } from '@/lib/api';
import { brl } from '@/lib/format';
import { useCustomer, type Customer } from '@/lib/customer';
import { DLink } from '@/lib/nav';
import { Field } from '@/ui/kit';
import { useStore } from './StoreContext';

/** Conta do cliente: entra com e-mail e senha (ou cria a conta), vê os dados e vai para "Meus pedidos". O código por e-mail fica para "esqueci a senha". */
export default function AccountPage() {
  const { customer, ready } = useCustomer();
  if (!ready) return <div className="p-8 text-center text-sm text-t-muted-fg">Carregando…</div>;
  return (
    <div className="mx-auto max-w-md px-3 pt-4 md:pt-8">
      {customer ? <Profile customer={customer} /> : <SignIn />}
    </div>
  );
}

/** Campo de senha com "mostrar/ocultar". */
function PasswordInput({ value, onChange, autoComplete, placeholder }: { value: string; onChange: (v: string) => void; autoComplete: string; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input className="t-input pr-10" type={show ? 'text' : 'password'} value={value} autoComplete={autoComplete} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-t-muted-fg" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShow(!show)}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
    </div>
  );
}

function SignIn() {
  const { slug, store } = useStore();
  const { setCustomer } = useCustomer();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'code'>('login');
  const [email, setEmail] = useState(''); const [pass, setPass] = useState(''); const [pass2, setPass2] = useState('');
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);
  const go = (m: typeof mode) => { setMode(m); setError(null); setInfo(null); };

  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Algo deu errado. Tente de novo.'); } finally { setBusy(false); } };
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const login = () => run(async () => { const r = await post<{ customer: Customer }>(`/v1/store/${slug}/customer/login`, { email: email.trim(), password: pass }); setCustomer(r.customer); });
  const register = () => run(async () => {
    if (pass !== pass2) throw new ApiError(400, 'mismatch', 'As senhas não conferem.');
    const r = await post<{ customer: Customer }>(`/v1/store/${slug}/customer/register`, { name: name.trim(), email: email.trim(), phone: phone.trim(), password: pass }); setCustomer(r.customer);
  });
  const sendCode = () => run(async () => {
    await post(`/v1/store/${slug}/customer/code`, { email: email.trim() });
    setMode('code'); setCode(''); setWait(30); setInfo(`Se ${email.trim()} tiver conta, enviamos um código de 6 dígitos. Confira também o spam.`);
  });
  const verify = () => run(async () => { const r = await post<{ customer: Customer }>(`/v1/store/${slug}/customer/verify`, { email: email.trim(), code }); setCustomer({ ...r.customer, via: 'code' }); });

  const title = mode === 'register' ? 'Criar sua conta' : mode === 'login' ? 'Entrar na sua conta' : 'Esqueci minha senha';
  return (
    <div className="rounded-theme border border-t-border bg-t-card p-5">
      <h1 className="flex items-center gap-2 text-xl font-bold">{mode === 'register' ? <UserPlus size={22} /> : <User size={22} />} {title}</h1>
      <p className="mt-1 text-sm text-t-muted-fg">{mode === 'forgot' || mode === 'code' ? 'Enviamos um código para o seu e-mail. Depois de entrar, defina uma senha nova em "Minha senha".' : 'Acompanhe seus pedidos e veja o histórico em qualquer aparelho.'}</p>
      {error && <div role="alert" className="mt-3 rounded-lg bg-t-danger/10 p-2.5 text-sm text-t-danger">{error}</div>}

      {mode === 'login' && (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); if (validEmail && pass && !busy) void login(); }}>
          <Field label="E-mail" icon={Mail}><input className="t-input" type="email" value={email} autoComplete="email" inputMode="email" onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" required /></Field>
          <Field label="Senha" icon={Lock}><PasswordInput value={pass} onChange={setPass} autoComplete="current-password" /></Field>
          <div className="text-right"><button type="button" className="text-xs text-t-muted-fg hover:underline" onClick={() => go('forgot')}>Esqueci minha senha</button></div>
          <button className="t-btn w-full" disabled={!validEmail || !pass || busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />} Entrar</button>
          <p className="text-center text-sm">ou <button type="button" className="font-semibold text-t-primary hover:underline" onClick={() => go('register')}>crie sua conta aqui</button></p>
        </form>
      )}

      {mode === 'register' && (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); if (!busy) void register(); }}>
          <Field label="Nome" icon={User}><input className="t-input" value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="E-mail" icon={Mail}><input className="t-input" type="email" value={email} autoComplete="email" inputMode="email" onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" required /></Field>
          <Field label="Telefone / WhatsApp (opcional)" icon={Phone}><input className="t-input" value={phone} inputMode="tel" autoComplete="tel" onChange={(e) => setPhone(e.target.value)} placeholder="(16) 99999-9999" /></Field>
          <Field label="Senha (mínimo 8 caracteres)" icon={Lock}><PasswordInput value={pass} onChange={setPass} autoComplete="new-password" /></Field>
          <Field label="Repita a senha" icon={Lock}><PasswordInput value={pass2} onChange={setPass2} autoComplete="new-password" /></Field>
          <button className="t-btn w-full" disabled={name.trim().length < 2 || !validEmail || pass.length < 8 || !pass2 || busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />} Criar conta</button>
          <p className="text-center text-sm">Já tem conta? <button type="button" className="font-semibold text-t-primary hover:underline" onClick={() => go('login')}>Entrar</button></p>
        </form>
      )}

      {mode === 'forgot' && (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); if (validEmail && !busy) void sendCode(); }}>
          <Field label="Seu e-mail" icon={Mail}><input className="t-input" type="email" value={email} autoComplete="email" inputMode="email" onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" required /></Field>
          <button className="t-btn w-full" disabled={!validEmail || busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Receber código</button>
          <button type="button" className="flex items-center gap-1 text-sm text-t-muted-fg hover:underline" onClick={() => go('login')}><ArrowLeft size={14} /> Voltar para o login</button>
        </form>
      )}

      {mode === 'code' && (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); if (code.length === 6 && !busy) void verify(); }}>
          {info && <p className="text-sm text-t-muted-fg">{info}</p>}
          <Field label="Código de 6 dígitos" icon={KeyRound}>
            <input className="t-input text-center text-2xl font-bold tracking-[0.4em]" value={code} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" />
          </Field>
          <button className="t-btn w-full" disabled={code.length !== 6 || busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : null} Entrar</button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="flex items-center gap-1 text-t-muted-fg hover:underline" onClick={() => go('login')}><ArrowLeft size={14} /> Voltar</button>
            <button type="button" className="text-t-primary hover:underline disabled:opacity-50 disabled:no-underline" disabled={wait > 0 || busy} onClick={() => void sendCode()}>{wait > 0 ? `Reenviar em ${wait}s` : 'Reenviar código'}</button>
          </div>
        </form>
      )}
      <p className="mt-4 text-center text-xs text-t-muted-fg">Ao entrar, você concorda em receber de {store.name} apenas e-mails sobre o seu acesso e pedidos.</p>
    </div>
  );
}

/** Definir (depois de entrar pelo código) ou trocar a senha. */
function PasswordCard({ customer }: { customer: Customer }) {
  const { slug } = useStore();
  const { setCustomer } = useCustomer();
  const needsCurrent = !!customer.hasPassword && customer.via !== 'code';
  const [cur, setCur] = useState(''); const [pass, setPass] = useState(''); const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    if (pass !== pass2) { setMsg({ ok: false, text: 'As senhas não conferem.' }); return; }
    setBusy(true); setMsg(null);
    try { await put(`/v1/store/${slug}/customer/password`, { password: pass, currentPassword: needsCurrent ? cur : undefined }); setCustomer({ ...customer, hasPassword: true }); setCur(''); setPass(''); setPass2(''); setMsg({ ok: true, text: 'Senha salva.' }); }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Não foi possível salvar.' }); } finally { setBusy(false); }
  };
  return (
    <form className="space-y-3 rounded-theme border border-t-border bg-t-card p-5" onSubmit={(e) => { e.preventDefault(); if (pass.length >= 8 && !busy) void save(); }}>
      <h2 className="flex items-center gap-2 font-bold"><Lock size={18} /> Minha senha</h2>
      {!customer.hasPassword && <p className="text-xs text-t-muted-fg">Defina uma senha para entrar com e-mail e senha.</p>}
      {needsCurrent && <Field label="Senha atual" icon={Lock}><PasswordInput value={cur} onChange={setCur} autoComplete="current-password" /></Field>}
      <Field label="Nova senha (mínimo 8 caracteres)" icon={Lock}><PasswordInput value={pass} onChange={setPass} autoComplete="new-password" /></Field>
      <Field label="Repita a nova senha" icon={Lock}><PasswordInput value={pass2} onChange={setPass2} autoComplete="new-password" /></Field>
      {msg && <p className={`text-sm ${msg.ok ? 'text-t-muted-fg' : 'text-t-danger'}`} role="status">{msg.text}</p>}
      <button className="t-btn w-full" disabled={pass.length < 8 || !pass2 || (needsCurrent && !cur) || busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : null} {customer.hasPassword ? 'Trocar senha' : 'Definir senha'}</button>
    </form>
  );
}

interface MyCoupon { code: string; description: string; kind: 'percent' | 'fixed'; percent: number | null; amount_cents: number | null; max_discount_cents: number | null; min_order_cents: number; ends_at: string | null }

/** Cupons exclusivos do cliente: é só digitar o código no checkout. */
function MyCoupons() {
  const { slug } = useStore();
  const [list, setList] = useState<MyCoupon[]>([]); const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { get<{ coupons: MyCoupon[] }>(`/v1/store/${slug}/customer/coupons`).then((r) => setList(r.coupons)).catch(() => setList([])); }, [slug]);
  if (!list.length) return null;
  return (
    <div className="space-y-2 rounded-theme border border-t-border bg-t-card p-5">
      <h2 className="flex items-center gap-2 font-bold"><Ticket size={18} /> Meus cupons</h2>
      {list.map((c) => (
        <div key={c.code} className="flex items-center justify-between gap-3 rounded-lg bg-t-muted px-3 py-2 text-sm">
          <div className="min-w-0">
            <div className="font-bold">{c.kind === 'percent' ? `${c.percent}% de desconto` : `${brl((c.amount_cents ?? 0) / 100)} de desconto`}{c.max_discount_cents ? ` (até ${brl(c.max_discount_cents / 100)})` : ''}</div>
            <div className="truncate text-xs text-t-muted-fg">{c.description || 'Cupom exclusivo'}{c.min_order_cents ? ` · pedido mínimo ${brl(c.min_order_cents / 100)}` : ''}{c.ends_at ? ` · até ${new Date(c.ends_at).toLocaleDateString('pt-BR')}` : ''}</div>
          </div>
          <button type="button" className="t-btn-ghost shrink-0 font-mono" onClick={() => { void navigator.clipboard?.writeText(c.code); setCopied(c.code); setTimeout(() => setCopied(null), 1500); }}>{copied === c.code ? 'Copiado' : c.code}</button>
        </div>))}
      <p className="text-xs text-t-muted-fg">Digite o código em “Cupom de desconto” ao finalizar o pedido.</p>
    </div>
  );
}

function Profile({ customer }: { customer: Customer }) {
  const { slug } = useStore();
  const { setCustomer, logout } = useCustomer();
  const [name, setName] = useState(customer.name); const [phone, setPhone] = useState(customer.phone);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setMsg(null);
    try { const r = await put<{ customer: Customer }>(`/v1/store/${slug}/customer/me`, { name: name.trim(), phone: phone.trim() }); setCustomer(r.customer); setMsg('Dados salvos.'); }
    catch (e) { setMsg(e instanceof ApiError ? e.message : 'Não foi possível salvar.'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="rounded-theme border border-t-border bg-t-card p-5">
        <h1 className="text-xl font-bold">Olá{customer.name ? `, ${customer.name.split(' ')[0]}` : ''}!</h1>
        <p className="text-sm text-t-muted-fg">{customer.email}</p>
        <DLink to="/pedidos" className="t-btn mt-4 w-full"><ClipboardList size={16} /> Meus pedidos</DLink>
      </div>
      <MyCoupons />
      <form className="space-y-3 rounded-theme border border-t-border bg-t-card p-5" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2 && !busy) void save(); }}>
        <h2 className="font-bold">Meus dados</h2>
        <Field label="Nome" icon={User}><input className="t-input" value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Telefone / WhatsApp (contato do pedido)" icon={Phone}><input className="t-input" value={phone} inputMode="tel" autoComplete="tel" onChange={(e) => setPhone(e.target.value)} /></Field>
        {!phone.trim() && <p className="text-xs text-t-muted-fg">Informe seu telefone para a loja poder falar com você sobre o pedido.</p>}
        {msg && <p className="text-sm text-t-muted-fg" role="status">{msg}</p>}
        <button className="t-btn w-full" disabled={name.trim().length < 2 || busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : null} Salvar</button>
      </form>
      <PasswordCard customer={customer} />
      <button className="flex w-full items-center justify-center gap-2 rounded-theme border border-t-border bg-t-card p-3 text-sm font-medium text-t-muted-fg hover:bg-t-muted" onClick={() => void logout()}><LogOut size={16} /> Sair</button>
    </div>
  );
}
