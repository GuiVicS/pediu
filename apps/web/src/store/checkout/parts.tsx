import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, Loader2, Lock, Minus, Plus, Ticket, Trash2, X } from 'lucide-react';
import { brl } from '@/lib/format';
import { cx } from '@/ui/kit';
import { Img } from '../Img';
import type { Checkout, Step } from './useCheckout';

export const Secure = ({ className }: { className?: string }) => (
  <div className={cx('flex items-center gap-2 text-t-muted-fg', className)}>
    <Lock size={18} aria-hidden />
    <span className="text-[10px] font-bold uppercase leading-tight tracking-wide">Pagamento<br />100% seguro</span>
  </div>
);

export const ErrorLine = ({ children }: { children?: ReactNode }) => (children ? <div role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{children}</div> : null);

export const Label = ({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">{children}</label>;

/** Campo de texto redondo do checkout (mesmas variáveis de tema da loja). */
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) => {
  const { invalid, className, ...rest } = p;
  return <input {...rest} aria-invalid={invalid || undefined} className={cx('t-input !rounded-full !px-4 !py-3', invalid && '!border-t-danger', className)} />;
};

export const BigButton = ({ busy, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) => (
  <button {...p} disabled={p.disabled || busy} className={cx('t-btn w-full !rounded-full !py-3.5 !text-base', p.className)}>{busy && <Loader2 size={16} className="animate-spin" />}{children}</button>
);

/** Cartão de etapa. Desktop: as três ficam visíveis (a futura esmaecida, a concluída vira resumo). Mobile: só a etapa atual. */
export function StepCard({ n, title, hint, state, summary, onEdit, children }: { n: Step; title: string; hint: string; state: 'active' | 'done' | 'locked'; summary?: ReactNode; onEdit?: () => void; children: ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} aria-current={state === 'active' ? 'step' : undefined}
      className={cx('rounded-[28px] p-6 transition', state === 'active' ? 'border-2 border-t-fg/60 bg-t-card shadow-sm' : 'border border-t-border bg-t-card/70', state === 'locked' && 'opacity-50', state !== 'active' && 'hidden lg:block')}>
      <div className="flex items-start gap-2">
        <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold', state === 'locked' ? 'bg-t-muted text-t-muted-fg' : 'bg-t-fg text-t-bg')}>{state === 'done' ? <Check size={14} /> : n}</span>
        <div className="min-w-0 flex-1">
          <h2 id={`step-${n}`} className={cx('text-xl font-bold', state === 'locked' && 'text-t-muted-fg')}>{title}</h2>
          {state !== 'done' && <p className="mt-1 text-sm text-t-muted-fg">{hint}</p>}
        </div>
        {state === 'done' && onEdit && <button type="button" onClick={onEdit} className="text-sm font-semibold text-t-primary hover:underline">Editar</button>}
      </div>
      {state === 'done' && <div className="mt-3 pl-8 text-sm text-t-muted-fg">{summary}</div>}
      {state === 'active' && <div className="mt-5">{children}</div>}
    </section>
  );
}

/** Indicador 1-2-3 do topo (só no celular). */
export function Stepper({ step, maxStep, go }: { step: Step; maxStep: Step; go: (s: Step) => void }) {
  const items: [Step, string][] = [[1, 'Informações pessoais'], [2, 'Entrega'], [3, 'Pagamento']];
  return (
    <ol className="flex items-start px-4 pt-4 lg:hidden" aria-label="Etapas do pedido">
      {items.map(([n, label], i) => {
        const reached = n <= maxStep;
        return (
          <li key={n} className="flex flex-1 flex-col items-center gap-1 text-center">
            <div className="flex w-full items-center">
              <span className={cx('h-0.5 flex-1', i === 0 ? 'opacity-0' : n <= step ? 'bg-t-primary' : 'bg-t-border')} />
              <button type="button" disabled={!reached || n === step} onClick={() => go(n)} aria-label={`Etapa ${n}: ${label}`}
                className={cx('flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold', n <= step ? 'bg-t-primary text-t-primary-fg' : 'bg-t-muted text-t-muted-fg')}>{n < step ? <Check size={16} /> : n}</button>
              <span className={cx('h-0.5 flex-1', i === items.length - 1 ? 'opacity-0' : n < step ? 'bg-t-primary' : 'bg-t-border')} />
            </div>
            <span className={cx('text-xs', n === step ? 'font-bold' : 'text-t-muted-fg')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Resumo: itens, cupom, observação e totais. Desktop = coluna fixa; mobile = recolhível no topo. */
export function Summary({ c }: { c: Checkout }) {
  const [open, setOpen] = useState(false);
  const { cart, sum } = c;
  const body = (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-sm">Tem um cupom?</div>
        {sum.applied ? (
          <div className="flex items-center justify-between rounded-full bg-t-muted px-4 py-2.5 text-sm"><span><b>{sum.applied.code}</b>{sum.applied.description ? ` · ${sum.applied.description}` : ''}</span>
            <button type="button" aria-label="Remover cupom" onClick={() => { sum.setApplied(null); sum.setCouponMsg(null); }}><X size={16} /></button></div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="relative flex-1"><Ticket size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-t-muted-fg" aria-hidden />
              <Input className="!pl-10" aria-label="Código do cupom" value={sum.couponInput} placeholder="Código do cupom" autoCapitalize="characters"
                onChange={(e) => sum.setCouponInput(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void sum.applyCoupon(); } }} /></div>
            <button type="button" className="text-sm font-bold text-t-primary disabled:opacity-40" disabled={sum.couponBusy || !sum.couponInput.trim()} onClick={() => void sum.applyCoupon()}>{sum.couponBusy ? <Loader2 size={16} className="animate-spin" /> : 'Adicionar'}</button>
          </div>
        )}
        {sum.couponMsg && <p className="mt-1 text-xs text-t-danger">{sum.couponMsg}</p>}
      </div>
      <div>
        <label htmlFor="obs" className="mb-1 block text-sm">Observação da compra <span className="text-t-muted-fg">(opcional)</span></label>
        <textarea id="obs" className="t-input !rounded-2xl !px-4 !py-3" rows={2} maxLength={300} value={c.pay.note} onChange={(e) => c.pay.setNote(e.target.value)} placeholder="Deixe uma observação sobre sua compra." />
        <div className="mt-1 text-xs text-t-muted-fg">{c.pay.note.length}/300 caracteres</div>
      </div>
      <div className="space-y-1.5 rounded-2xl bg-t-muted/60 p-4 text-sm">
        <div className="flex justify-between"><span>Produtos</span><span>{brl(cart.subtotal)}</span></div>
        {c.del.type === 'delivery' && <div className="flex justify-between"><span>Entrega</span><span>{c.del.zone ? brl(sum.fee) : 'a calcular'}</span></div>}
        {sum.applied && <div className="flex justify-between text-t-accent"><span>Cupom {sum.applied.code}</span><span>− {brl(sum.discount)}</span></div>}
        <div className="flex justify-between border-t border-t-border pt-2 text-lg font-extrabold"><span>Total</span><span className="text-t-primary">{brl(sum.total)}</span></div>
      </div>
      <ul className="space-y-3">
        {cart.lines.map((l) => (
          <li key={l.key} className="flex gap-3">
            <Img src={l.imageUrl} alt="" fit={l.imageFit} className="h-14 w-14 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-medium leading-tight">{l.name}</div>
              {l.addons.map((a, i) => <div key={i} className="truncate text-xs text-t-muted-fg">+ {a.name}</div>)}
              <div className="mt-1 flex items-center justify-between">
                <span className="font-semibold">{brl(l.unitPrice * l.qty)}</span>
                <span className="flex items-center gap-1 rounded-full bg-t-muted px-1">
                  <button type="button" aria-label={l.qty === 1 ? `Remover ${l.name}` : `Diminuir ${l.name}`} onClick={() => cart.setQty(l.key, l.qty - 1)} className="p-1.5">{l.qty === 1 ? <Trash2 size={13} className="text-t-danger" /> : <Minus size={13} />}</button>
                  <span className="min-w-5 text-center font-semibold" aria-live="polite">{l.qty}</span>
                  <button type="button" aria-label={`Aumentar ${l.name}`} onClick={() => cart.setQty(l.key, l.qty + 1)} className="p-1.5"><Plus size={13} /></button>
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <>
      <div className="mb-4 rounded-[28px] bg-t-muted lg:hidden">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-5 py-4 text-left">
          <span><span className="block text-sm font-bold">RESUMO ({cart.count})</span><span className="text-xs text-t-muted-fg">Informações da sua compra</span></span>
          <span className="flex items-center gap-2"><b className="text-lg text-t-primary">{brl(sum.total)}</b><ChevronDown size={18} className={cx('transition', open && 'rotate-180')} /></span>
        </button>
        {open && <div className="px-5 pb-5">{body}</div>}
      </div>
      <aside className="hidden self-start rounded-[28px] border border-t-border bg-t-card p-6 shadow-sm lg:sticky lg:top-6 lg:col-start-3 lg:row-start-1 lg:block" aria-label="Resumo do pedido">
        <h2 className="mb-4 text-lg font-extrabold uppercase">Resumo</h2>
        {body}
      </aside>
    </>
  );
}
