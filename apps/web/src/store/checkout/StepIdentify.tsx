import { Loader2, LogOut, Mail } from 'lucide-react';
import { maskPhone } from './format';
import { BigButton, ErrorLine, Input, Label } from './parts';
import type { Checkout } from './useCheckout';

export function IdentifyForm({ c }: { c: Checkout }) {
  const { id, customer } = c;
  const loggedIn = !!customer;
  const mail = id.email.trim();
  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void id.submit(); }}>
      <p className="-mt-2 text-sm text-t-muted-fg">Usaremos seu e-mail para identificar seu perfil, histórico de compras, notificação de pedidos e carrinho de compras.</p>

      {loggedIn && (
        <div className="flex items-center gap-3 rounded-2xl bg-t-muted/70 px-4 py-3 text-sm">
          <Mail size={18} className="shrink-0 text-t-primary" aria-hidden />
          <div className="min-w-0 flex-1"><div className="font-semibold">Você está conectado</div><div className="truncate text-t-muted-fg">{customer.email}</div></div>
          <button type="button" onClick={() => void id.notMe()} className="flex shrink-0 items-center gap-1 text-t-primary hover:underline"><LogOut size={14} /> Não sou eu</button>
        </div>
      )}

      <div><Label htmlFor="ck-name">Nome completo</Label>
        <Input id="ck-name" autoComplete="name" value={id.name} onChange={(e) => id.setName(e.target.value)} placeholder="ex.: Maria de Almeida Cruz" /></div>

      {!loggedIn && (
        <div><Label htmlFor="ck-email">E-mail</Label>
          <Input id="ck-email" type="email" inputMode="email" autoComplete="email" value={id.email} onChange={(e) => id.changeEmail(e.target.value)} onBlur={() => void id.checkEmail()} placeholder="ex.: maria@gmail.com" />
          {id.mode === 'checking' && <p className="mt-1 flex items-center gap-1.5 text-xs text-t-muted-fg"><Loader2 size={12} className="animate-spin" /> Verificando…</p>}
        </div>
      )}

      <div><Label htmlFor="ck-phone">Celular / WhatsApp</Label>
        <div className="flex gap-2">
          <span className="flex items-center rounded-full border border-t-border bg-t-muted px-4 text-sm font-semibold" aria-hidden>+55</span>
          <Input id="ck-phone" className="flex-1" type="tel" inputMode="tel" autoComplete="tel-national" value={id.phone} onChange={(e) => id.setPhone(maskPhone(e.target.value))} placeholder="(00) 00000-0000" />
        </div>
      </div>

      {!loggedIn && id.mode === 'login' && (
        <div className="space-y-2 rounded-2xl border border-t-border p-4">
          <p className="text-sm">Encontramos uma conta com <b>{mail}</b>. Digite sua senha para continuar.</p>
          <Label htmlFor="ck-pass">Senha</Label>
          <Input id="ck-pass" type="password" autoComplete="current-password" value={id.password} onChange={(e) => id.setPassword(e.target.value)} />
          <button type="button" className="text-sm font-semibold text-t-primary hover:underline" disabled={id.authBusy || !id.fieldsOk} onClick={() => void id.sendCode()}>Esqueci minha senha</button>
        </div>
      )}

      {!loggedIn && id.mode === 'register' && (
        <div className="space-y-2 rounded-2xl border border-t-border p-4">
          <p className="text-sm">Crie uma senha para acompanhar seus pedidos depois. Sua conta é criada e você já entra automaticamente.</p>
          <Label htmlFor="ck-newpass">Crie uma senha</Label>
          <Input id="ck-newpass" type="password" autoComplete="new-password" value={id.password} onChange={(e) => id.setPassword(e.target.value)} placeholder="Mínimo de 8 caracteres" invalid={id.password.length > 0 && id.password.length < 8} />
        </div>
      )}

      {!loggedIn && id.mode === 'recover' && (
        <div className="space-y-2 rounded-2xl border border-t-border p-4">
          {!id.recover.sent ? (
            <>
              <p className="text-sm">Esta conta ainda não tem senha, ou você esqueceu a sua. Enviaremos um código para <b>{mail}</b> para você definir uma senha nova.</p>
              <button type="button" className="t-btn-ghost !rounded-full" disabled={id.authBusy || !id.fieldsOk} onClick={() => void id.sendCode()}>{id.authBusy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Enviar código por e-mail</button>
            </>
          ) : (
            <>
              <p className="text-sm">Enviamos um código de 6 dígitos para <b>{mail}</b> (veja também o spam).</p>
              <Label htmlFor="ck-code">Código</Label>
              <Input id="ck-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={id.recover.code} onChange={(e) => id.setRecover({ ...id.recover, code: e.target.value.replace(/\D/g, '') })} placeholder="000000" />
              <Label htmlFor="ck-recpass">Nova senha</Label>
              <Input id="ck-recpass" type="password" autoComplete="new-password" value={id.recover.password} onChange={(e) => id.setRecover({ ...id.recover, password: e.target.value })} placeholder="Mínimo de 8 caracteres" />
              <button type="button" className="text-sm font-semibold text-t-primary hover:underline" disabled={id.authBusy} onClick={() => void id.sendCode()}>Reenviar código</button>
            </>
          )}
        </div>
      )}

      <ErrorLine>{id.authError}</ErrorLine>
      <BigButton type="submit" busy={id.authBusy} disabled={!id.can}>{loggedIn ? 'Ir para Entrega' : id.mode === 'register' ? 'Criar conta e ir para Entrega' : id.mode === 'login' || id.mode === 'recover' ? 'Entrar e ir para Entrega' : 'Ir para Entrega'}</BigButton>
      {!loggedIn && id.mode === 'unknown' && id.fieldsOk && <p className="text-center text-xs text-t-muted-fg">Digite o e-mail e saia do campo para continuar.</p>}
    </form>
  );
}
