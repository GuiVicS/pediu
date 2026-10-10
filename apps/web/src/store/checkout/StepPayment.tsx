import { Banknote, CreditCard, Loader2, QrCode, ShieldCheck, Smartphone, Ticket, Wallet } from 'lucide-react';
import type { PaymentMethod } from '@/lib/types';
import { brl } from '@/lib/format';
import { cx } from '@/ui/kit';
import { maskCpf, validCpf } from './format';
import { BigButton, ErrorLine, Input, Label } from './parts';
import type { Checkout } from './useCheckout';

const ICON: Record<PaymentMethod['type'], typeof QrCode> = { pix: QrCode, cash: Banknote, credit: CreditCard, debit: CreditCard, voucher: Ticket };

function explain(p: PaymentMethod): string {
  if (p.note) return p.note;
  if (p.online && p.type === 'pix') return 'A confirmação do pagamento é feita em poucos minutos. Use o aplicativo do seu banco para pagar.';
  if (p.online) return 'Você informa os dados do cartão na próxima tela, com segurança.';
  if (p.type === 'cash') return 'Pague em dinheiro na entrega ou na retirada.';
  return 'Pague na entrega ou na retirada.';
}

export function PaymentForm({ c }: { c: Checkout }) {
  const p = c.pay;
  const gateways = [...new Set(p.pays.filter((x) => x.online && x.gateway).map((x) => x.gateway))];
  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void p.submit(); }}>
      {gateways.includes('mercadopago') && <div className="flex items-center gap-2 text-sm text-t-muted-fg"><ShieldCheck size={16} aria-hidden /> Pagamentos online processados pelo <b className="text-t-fg">Mercado Pago</b></div>}
      {gateways.includes('sicoob') && <div className="flex items-center gap-2 text-sm text-t-muted-fg"><ShieldCheck size={16} aria-hidden /> Pix processado pelo <b className="text-t-fg">Sicoob</b></div>}

      {p.pays.length === 0 && <ErrorLine>Esta loja ainda não configurou formas de pagamento.</ErrorLine>}
      <div role="radiogroup" aria-label="Forma de pagamento" className="space-y-2">
        {p.pays.map((m) => {
          const on = p.pay?.id === m.id; const Icon = ICON[m.type] ?? Wallet;
          return (
            <div key={m.id} className={cx('rounded-2xl border transition', on ? 'border-2 border-t-fg bg-t-card' : 'border-t-border')}>
              <button type="button" role="radio" aria-checked={on} onClick={() => p.setPayId(m.id)} className="flex w-full items-center gap-3 p-4 text-left">
                <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', on ? 'border-t-fg' : 'border-t-border')}>{on && <span className="h-2.5 w-2.5 rounded-full bg-t-fg" />}</span>
                <Icon size={20} className="shrink-0 text-t-primary" aria-hidden />
                <span className="min-w-0 flex-1 font-semibold">{m.name}</span>
                {m.online && <span className="badge bg-t-primary/10 text-t-primary"><Smartphone size={10} className="mr-1" />online</span>}
              </button>
              {on && (
                <div className="space-y-3 px-4 pb-4">
                  <p className="text-sm">{explain(m)}</p>
                  {m.online && m.type === 'pix' && <div className="font-bold text-t-accent">Valor no Pix: {brl(c.sum.total)}</div>}
                  {m.online && (m.type === 'credit' || m.type === 'debit') && <div className="font-bold text-t-accent">Valor no cartão: {brl(c.sum.total)}</div>}
                  {m.type === 'cash' && (
                    <div><Label htmlFor="pay-change">Troco para quanto? <span className="font-normal text-t-muted-fg">(opcional)</span></Label>
                      <Input id="pay-change" inputMode="decimal" value={p.changeFor} onChange={(e) => p.setChangeFor(e.target.value)} placeholder="Ex.: 100" className="max-w-[180px]" /></div>
                  )}
                  {p.needsDoc && (
                    <div><Label htmlFor="pay-doc">CPF do pagador</Label>
                      <Input id="pay-doc" inputMode="numeric" autoComplete="off" value={maskCpf(p.document)} onChange={(e) => p.setDocument(e.target.value)} placeholder="000.000.000-00" invalid={p.document.length > 0 && !validCpf(p.document) && p.document.replace(/\D/g, '').length === 11} className="max-w-[240px]" />
                      <p className="mt-1 text-xs text-t-muted-fg">Exigido pelo banco para gerar o Pix.</p></div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ErrorLine>{p.error}</ErrorLine>
      <BigButton type="submit" busy={p.busy} disabled={!p.ok || p.busy || c.sum.total <= 0}>{p.busy ? <Loader2 size={16} className="animate-spin" /> : null} Finalizar compra · {brl(c.sum.total)}</BigButton>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-t-muted-fg"><ShieldCheck size={13} aria-hidden /> Seus dados estão protegidos. {p.pay?.online ? 'Os dados do cartão nunca passam pela loja.' : ''}</p>
    </form>
  );
}
