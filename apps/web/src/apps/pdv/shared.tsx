import { Delete } from 'lucide-react';
import type { Menu } from '@/store/StoreContext';
import { brlc } from '@/lib/orders';
import { cx } from '@/ui/kit';
import { sumLines, type Line } from '../OrderBuilder';

export type Mode = 'balcao' | 'retirada' | 'delivery';
export type PayType = 'pix' | 'cash' | 'credit' | 'debit' | 'voucher';
export interface PdvCustomer { id: string; name: string; email: string }
export interface AppliedCoupon { code: string; discountCents: number; description: string }

/** Pedido em montagem na tela de venda (fica guardado ao ir para o pagamento e voltar). */
export interface Draft { lines: Line[]; mode: Mode; name: string; phone: string; address: string; zoneId: string; customer: PdvCustomer | null; coupon: AppliedCoupon | null }
export const emptyDraft = (): Draft => ({ lines: [], mode: 'balcao', name: '', phone: '', address: '', zoneId: '', customer: null, coupon: null });

export const MODE_LABEL: Record<Mode, string> = { balcao: 'Balcão', retirada: 'Retirada', delivery: 'Delivery' };
export const PAY_LABEL: Record<string, string> = { pix: 'Pix', cash: 'Dinheiro', credit: 'Cartão de crédito', debit: 'Cartão de débito', voucher: 'Vale / voucher', outros: 'Outros' };

export interface Totals { subtotalCents: number; feeCents: number; discountCents: number; totalCents: number; count: number }
/** Mesmos números que o servidor calcula (o servidor sempre recalcula e recusa se não bater): itens + entrega − cupom. */
export function totalsOf(d: Draft, menu: Menu): Totals {
  const subtotalCents = Math.round(sumLines(d.lines) * 100);
  const zone = menu.zones.find((z) => z.id === (d.zoneId || menu.zones[0]?.id));
  const feeCents = d.mode === 'delivery' ? Math.round((zone?.fee ?? 0) * 100) : 0;
  const discountCents = Math.min(d.coupon?.discountCents ?? 0, subtotalCents);
  return { subtotalCents, feeCents, discountCents, totalCents: subtotalCents + feeCents - discountCents, count: d.lines.reduce((n, l) => n + l.qty, 0) };
}

/** Linha para os resumos de pedido (venda nova ou pedido já lançado). */
export interface SummaryLine { key: string; name: string; detail?: string; qty: number; totalCents: number; image?: string }
export const summaryOf = (d: Draft, menu: Menu): SummaryLine[] => d.lines.map((l) => ({
  key: l.key, name: l.name, qty: l.qty, totalCents: Math.round(l.unitPrice * l.qty * 100), image: menu.products.find((p) => p.id === l.productId)?.imageUrl || undefined,
  detail: [...l.picks.map((p) => p.name), l.note].filter(Boolean).join(' · ') || undefined,
}));

/** Resultado de um pagamento/lançamento, para a tela de "pedido finalizado". */
export interface Receipt {
  orderId: string; number: number; totalCents: number; paid: boolean; changeCents: number; receivedCents: number | null;
  method: string; type: PayType | null; mode: 'tela' | 'externo' | null; ref: string | null;
  heading: string; lines: SummaryLine[]; subtotalCents: number; feeCents: number; discountCents: number; customer: string; modeLabel: string; at: string;
}

export const Money = ({ cents, className }: { cents: number; className?: string }) => <span className={className}>{brlc(cents)}</span>;

/**
 * Valor em reais digitado como em máquina de caixa: cada tecla entra pela direita (1, 0, 0, 0, 0 = R$ 100,00).
 * Mostrado em `value` (centavos); `onChange` recebe o novo valor.
 */
export function Keypad({ value, onChange, max = 100_000_000, className }: { value: number; onChange: (v: number) => void; max?: number; className?: string }) {
  const push = (d: string) => onChange(Math.min(max, Number(`${value || ''}${d}`)));
  const key = 'flex h-14 items-center justify-center rounded-2xl bg-muted text-2xl font-bold transition active:scale-95 hover:bg-muted/70 sm:h-16';
  return (
    <div className={cx('grid grid-cols-3 gap-2.5', className)} role="group" aria-label="Teclado numérico">
      {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((d) => <button key={d} type="button" className={key} onClick={() => push(d)}>{d}</button>)}
      <button type="button" className={key} onClick={() => push('0')}>0</button>
      <button type="button" className={key} onClick={() => push('00')}>00</button>
      <button type="button" className={key} onClick={() => onChange(Math.floor(value / 10))} aria-label="Apagar"><Delete size={26} /></button>
    </div>
  );
}

/** Texto dos cartões de ação (ícone + título), para as telas de pagamento e de turno. */
export const ChipStatus = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <span className={cx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}><span className={cx('h-2 w-2 rounded-full', ok ? 'bg-emerald-500' : 'bg-red-500')} />{children}</span>
);
