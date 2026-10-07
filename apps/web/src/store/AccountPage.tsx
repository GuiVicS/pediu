import { useEffect, useState } from 'react';
import { ArrowLeft, ClipboardList, KeyRound, Loader2, LogOut, Mail, Phone, User } from 'lucide-react';
import { ApiError, post, put } from '@/lib/api';
import { useCustomer, type Customer } from '@/lib/customer';
import { DLink } from '@/lib/nav';
import { Field } from '@/ui/kit';
import { useStore } from './StoreContext';

/** Conta do cliente: entra com o e-mail (recebe um código de 6 dígitos), vê os dados e vai para "Meus pedidos". */
export default function AccountPage() {
  const { customer, ready } = useCustomer();
  if (!ready) return <div className="p-8 text-center text-sm text-t-muted-fg">Carregando…</div>;
  return (
    <div className="mx-auto max-w-md px-3 pt-4 md:pt-8">
      {customer ? <Profile customer={customer} /> : <SignIn />}
    </div>
  );
}

function SignIn() {
  const { slug, store } = useStore();
  const { setCustomer } = useCustomer();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);

  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Algo deu errado. Tente de novo.'); } finally { setBusy(false); } };
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const sendCode = () => run(async () => {
    await post(`/v1/store/${slug}/customer/code`, { email: email.trim(), name: name.trim(), phone: phone.trim() });
    setStep('code'); setCode(''); setWait(30); setInfo(`Enviamos um código de 6 dígitos para ${email.trim()}. Confira também o spam.`);
  });
  const verify = () => run(async () => { const r = await post<{ customer: Customer }>(`/v1/store/${slug}/customer/verify`, { email: email.trim(), code }); setCustomer(r.customer); });

  return (
    <div className="rounded-t border border-t-border bg-t-card p-5">
      <h1 className="flex items-center gap-2 text-xl font-bold"><User size={22} /> Entrar na sua conta</h1>
      <p className="mt-1 text-sm text-t-muted-fg">Acompanhe seus pedidos e veja o histórico em qualquer aparelho. Sem senha: enviamos um código para o seu e-mail.</p>
      {error && <div role="alert" className="mt-3 rounded-lg bg-t-danger/10 p-2.5 text-sm text-t-danger">{error}</div>}

      {step === 'email' ? (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); if (validEmail && !busy) void sendCode(); }}>
          <Field label="Seu e-mail" icon={Mail}><input className="t-input" type="email" value={email} autoComplete="email" inputMode="email" onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" required /></Field>
          <Field label="Seu nome (opcional)" icon={User}><input className="t-input" value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Telefone / WhatsApp (opcional)" icon={Phone}><input className="t-input" value={phone} inputMode="tel" autoComplete="tel" onChange={(e) => setPhone(e.target.value)} placeholder="(16) 99999-9999" /></Field>
          <button className="t-btn w-full" disabled={!validEmail || busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Receber código</button>
        </form>
      ) : (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); if (code.length === 6 && !busy) void verify(); }}>
          {info && <p className="text-sm text-t-muted-fg">{info}</p>}
          <Field label="Código de 6 dígitos" icon={KeyRound}>
            <input className="t-input text-center text-2xl font-bold tracking-[0.4em]" value={code} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} autoFocus
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" />
          </Field>
          <button className="t-btn w-full" disabled={code.length !== 6 || busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : null} Entrar</button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" className="flex items-center gap-1 text-t-muted-fg hover:underline" onClick={() => { setStep('email'); setError(null); }}><ArrowLeft size={14} /> Trocar e-mail</button>
            <button type="button" className="text-t-primary hover:underline disabled:opacity-50 disabled:no-underline" disabled={wait > 0 || busy} onClick={() => void sendCode()}>{wait > 0 ? `Reenviar em ${wait}s` : 'Reenviar código'}</button>
          </div>
        </form>
      )}
      <p className="mt-4 text-center text-xs text-t-muted-fg">Ao entrar, você concorda em receber de {store.name} apenas e-mails sobre o seu acesso e pedidos.</p>
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
      <div className="rounded-t border border-t-border bg-t-card p-5">
        <h1 className="text-xl font-bold">Olá{customer.name ? `, ${customer.name.split(' ')[0]}` : ''}!</h1>
        <p className="text-sm text-t-muted-fg">{customer.email}</p>
        <DLink to="/pedidos" className="t-btn mt-4 w-full"><ClipboardList size={16} /> Meus pedidos</DLink>
      </div>
      <form className="space-y-3 rounded-t border border-t-border bg-t-card p-5" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2 && !busy) void save(); }}>
        <h2 className="font-bold">Meus dados</h2>
        <Field label="Nome" icon={User}><input className="t-input" value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Telefone / WhatsApp" icon={Phone}><input className="t-input" value={phone} inputMode="tel" autoComplete="tel" onChange={(e) => setPhone(e.target.value)} /></Field>
        {msg && <p className="text-sm text-t-muted-fg" role="status">{msg}</p>}
        <button className="t-btn w-full" disabled={name.trim().length < 2 || busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : null} Salvar</button>
      </form>
      <button className="flex w-full items-center justify-center gap-2 rounded-t border border-t-border bg-t-card p-3 text-sm font-medium text-t-muted-fg hover:bg-t-muted" onClick={() => void logout()}><LogOut size={16} /> Sair</button>
    </div>
  );
}
