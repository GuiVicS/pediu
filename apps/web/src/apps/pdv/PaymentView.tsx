import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock, Copy, CreditCard, FileText, Handshake, Loader2, QrCode, Wallet, X } from 'lucide-react';
import type { Menu } from '@/store/StoreContext';
import { ApiError, get } from '@/lib/api';
import { brlc } from '@/lib/orders';
import { Modal, cx } from '@/ui/kit';
import { ErrorBox } from '@/ui/misc';
import { Keypad, PAY_LABEL, type PayType, type Receipt, type SummaryLine } from './shared';

type Gateway = 'mercadopago' | 'sicoob';
export interface PayTarget {
  heading: string; sub: string; lines: SummaryLine[]; subtotalCents: number; feeCents: number; discountCents: number; totalCents: number;
  submit: (p: { paymentId: string; receivedCents?: number; reference?: string }) => Promise<Receipt>;
  /** Só em pedido novo: lança como "a receber" sem cobrar agora. */
  later?: () => Promise<Receipt>;
  /** Cobrança Pix na tela (QR do gateway). `finish` monta o recibo quando o pagamento for confirmado. */
  startPix: (gateway: Gateway) => Promise<{ orderId: string; number: number; qrCode: string; qrImage: string; expiresAt: string; finish: () => Receipt }>;
}

const GATEWAY_LABEL: Record<Gateway, string> = { mercadopago: 'Mercado Pago', sicoob: 'Sicoob' };

/**
 * Escolha da forma de pagamento. Duas famílias:
 *  - Na tela: Pix por QR Code (gateway), confirmado automaticamente;
 *  - Externo: maquininha (cartão, ainda sem integração) e dinheiro — o sistema só registra o que o operador confirmou.
 */
export default function PaymentView({ menu, target, onBack, onDone }: { menu: Menu; target: PayTarget; onBack: () => void; onDone: (r: Receipt) => void }) {
  const [panel, setPanel] = useState<'choose' | 'cash' | 'card' | 'other'>('choose');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [pix, setPix] = useState<Awaited<ReturnType<PayTarget['startPix']>> | null>(null);
  const methods = menu.payments.filter((p) => !p.online);
  const cash = methods.find((p) => p.type === 'cash');
  const cards = methods.filter((p) => p.type === 'credit' || p.type === 'debit');
  const others = methods.filter((p) => p.type === 'pix' || p.type === 'voucher');
  const gateways = [...new Set([...(menu.gateways ?? []), ...menu.payments.filter((p) => p.online && p.gateway).map((p) => p.gateway as string)])].filter((g): g is Gateway => g === 'mercadopago' || g === 'sicoob');

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível concluir. Tente novamente.'); return undefined; } finally { setBusy(false); }
  };
  const pay = async (p: { paymentId: string; receivedCents?: number; reference?: string }) => { const r = await run(() => target.submit(p)); if (r) onDone(r); };
  const startPix = async (g: Gateway) => { const r = await run(() => target.startPix(g)); if (r) setPix(r); };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <Summary target={target} />
      <section className="card p-5 lg:p-6">
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <button className="flex items-center gap-2 rounded-2xl bg-accent px-4 py-3 font-semibold text-primary hover:bg-accent/70" onClick={() => (panel === 'choose' ? onBack() : (setPanel('choose'), setError(null)))}><ArrowLeft size={18} /> Voltar</button>
          <div><h1 className="text-2xl font-extrabold leading-tight sm:text-3xl">{panel === 'cash' ? 'Pagamento em dinheiro' : panel === 'card' ? 'Pagamento na maquininha' : panel === 'other' ? 'Outras formas de pagamento' : 'Escolha a forma de pagamento'}</h1>
            <p className="text-muted-foreground">{panel === 'cash' ? 'Informe o valor recebido para calcular o troco.' : panel === 'card' ? 'Passe o cartão na maquininha e confirme aqui.' : 'Selecione como o cliente deseja pagar este pedido.'}</p></div>
        </div>
        <ErrorBox>{error}</ErrorBox>

        {panel === 'choose' && (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <Option tone="teal" icon={<QrCode size={46} />} title="Pix na tela" desc="QR Code na tela, confirmação automática pelo gateway." group="Pagar na tela"
                disabled={gateways.length === 0} disabledHint="Conecte o Mercado Pago ou o Sicoob em Pagamentos para usar o Pix na tela.">
                {gateways.map((g) => <button key={g} className="btn !rounded-2xl !py-3.5 text-base font-bold" disabled={busy} onClick={() => void startPix(g)}>{busy ? <Loader2 size={16} className="animate-spin" /> : null} Pix · {GATEWAY_LABEL[g]} <ArrowRight size={18} /></button>)}
              </Option>
              <Option tone="blue" icon={<CreditCard size={46} />} title="Maquininha" desc="Crédito ou débito na maquininha. Ainda não integrada: só registra." group="Pagamento externo"
                disabled={cards.length === 0} disabledHint="Cadastre as formas Cartão de crédito/débito em Pagamentos.">
                <button className="btn !rounded-2xl !py-3.5 text-base font-bold" onClick={() => { setPanel('card'); setError(null); }}>Pagar na maquininha <ArrowRight size={18} /></button>
              </Option>
              <Option tone="amber" icon={<Wallet size={46} />} title="Dinheiro" desc="Receber em dinheiro, com cálculo de troco." group="Pagamento externo"
                disabled={!cash} disabledHint="Cadastre a forma Dinheiro em Pagamentos.">
                <button className="btn !rounded-2xl !py-3.5 text-base font-bold" onClick={() => { setPanel('cash'); setError(null); }}>Pagar com dinheiro <ArrowRight size={18} /></button>
              </Option>
            </div>
            {others.length > 0 && <button className="mt-3 flex w-full items-center justify-between rounded-2xl border border-border px-4 py-3 text-left hover:bg-accent" onClick={() => { setPanel('other'); setError(null); }}><span className="flex items-center gap-2 font-semibold"><Handshake size={18} className="text-primary" /> Outras formas de pagamento</span><span className="text-sm text-muted-foreground">{others.map((o) => o.name).join(' · ')}</span></button>}
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl bg-muted/60 p-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card text-primary"><FileText size={22} /></span>
              <div className="min-w-0 flex-1"><div className="text-sm text-muted-foreground">Total do pedido</div><div className="text-3xl font-extrabold">{brlc(target.totalCents)}</div></div>
              {target.later && <button className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 font-semibold hover:bg-accent" disabled={busy} onClick={async () => { const r = await run(() => target.later!()); if (r) onDone(r); }}><Clock size={17} /> Pagar depois</button>}
              <button className="flex items-center gap-2 rounded-2xl bg-card px-4 py-3 font-semibold text-muted-foreground hover:bg-accent" onClick={onBack}><X size={17} /> Cancelar pagamento</button>
            </div>
          </>
        )}

        {panel === 'cash' && cash && <CashPanel total={target.totalCents} busy={busy} onConfirm={(received) => pay({ paymentId: cash.id, receivedCents: received })} />}
        {panel === 'card' && <CardPanel cards={cards.map((c) => ({ id: c.id, name: c.name, type: c.type as PayType }))} busy={busy} onConfirm={(id, ref) => pay({ paymentId: id, reference: ref })} />}
        {panel === 'other' && (
          <div className="space-y-2">{others.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border p-4"><div className="min-w-0 flex-1"><div className="font-bold">{o.name}</div><div className="text-sm text-muted-foreground">{o.note || PAY_LABEL[o.type]}</div></div>
              <button className="btn !rounded-2xl" disabled={busy} onClick={() => void pay({ paymentId: o.id })}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={16} />} Confirmar recebimento</button></div>
          ))}<p className="text-xs text-muted-foreground">O pagamento acontece fora do sistema; aqui você só registra que foi recebido.</p></div>
        )}
      </section>

      {pix && <PixModal pix={pix} total={target.totalCents} onClose={() => setPix(null)} onPaid={() => { const r = pix.finish(); setPix(null); onDone(r); }} />}
    </div>
  );
}

const TONES = { teal: 'from-teal-50 to-emerald-50 border-teal-100', blue: 'from-sky-50 to-blue-50 border-blue-100', amber: 'from-amber-50 to-orange-50 border-amber-100' } as const;
function Option({ tone, icon, title, desc, group, disabled, disabledHint, children }: { tone: keyof typeof TONES; icon: ReactNode; title: string; desc: string; group: string; disabled: boolean; disabledHint: string; children: ReactNode }) {
  return (
    <div className={cx('flex flex-col items-center gap-3 rounded-3xl border bg-gradient-to-b p-5 text-center dark:from-card dark:to-card', TONES[tone], disabled && 'opacity-60')}>
      <span className="rounded-full bg-white/70 px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground/60 dark:bg-muted">{group}</span>
      <span className="flex h-28 w-28 items-center justify-center rounded-full bg-white text-primary shadow-ui-sm dark:bg-muted">{icon}</span>
      <h2 className="text-3xl font-extrabold">{title}</h2>
      <p className="min-h-[3rem] text-sm text-foreground/70">{desc}</p>
      <div className="mt-auto flex w-full flex-col gap-2">{disabled ? <p className="rounded-xl bg-white/70 p-3 text-xs text-foreground/70 dark:bg-muted">{disabledHint}</p> : children}</div>
    </div>
  );
}

function Summary({ target }: { target: PayTarget }) {
  return (
    <aside className="card flex flex-col p-5 lg:max-h-[calc(100vh-8rem)]">
      <h2 className="text-2xl font-extrabold leading-tight">{target.heading}</h2>
      <p className="text-sm text-muted-foreground">{target.sub}</p>
      <div className="mt-3 min-h-0 flex-1 divide-y divide-border overflow-y-auto border-t border-border">
        {target.lines.map((l) => (
          <div key={l.key} className="flex items-center gap-3 py-3">
            {l.image ? <img src={l.image} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : <span className="h-14 w-14 shrink-0 rounded-xl bg-muted" />}
            <div className="min-w-0 flex-1"><div className="font-bold leading-tight">{l.name}</div><div className="truncate text-sm text-muted-foreground">{l.qty} × {l.detail ?? brlc(Math.round(l.totalCents / l.qty))}</div></div>
            <b className="shrink-0">{brlc(l.totalCents)}</b>
          </div>
        ))}
      </div>
      <div className="space-y-1.5 border-t border-border pt-3 text-sm">
        <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{brlc(target.subtotalCents)}</span></div>
        {target.feeCents > 0 && <div className="flex justify-between text-muted-foreground"><span>Entrega</span><span>{brlc(target.feeCents)}</span></div>}
        <div className="flex justify-between text-muted-foreground"><span>Desconto</span><span>{target.discountCents > 0 ? `− ${brlc(target.discountCents)}` : brlc(0)}</span></div>
        <div className="flex items-end justify-between pt-1"><span className="text-lg font-extrabold">Total do pedido</span><span className="text-2xl font-extrabold text-primary">{brlc(target.totalCents)}</span></div>
      </div>
    </aside>
  );
}

function CashPanel({ total, busy, onConfirm }: { total: number; busy: boolean; onConfirm: (receivedCents: number) => void }) {
  const [received, setReceived] = useState(0);
  const change = received - total;
  const ok = received >= total && total > 0;
  const quick = [2000, 5000, 10000, 20000].filter((v) => v >= total).slice(0, 3);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><div className="mb-1 text-sm text-muted-foreground">Valor total</div><div className="rounded-2xl bg-muted px-5 py-4 text-3xl font-extrabold sm:text-4xl">{brlc(total)}</div></div>
        <div><div className="mb-1 text-sm font-semibold text-primary">Valor recebido</div><div className="rounded-2xl border-2 border-primary bg-card px-5 py-4 text-3xl font-extrabold sm:text-4xl" aria-live="polite">{brlc(received)}</div></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Keypad value={received} onChange={setReceived} />
        <div className="flex flex-col gap-3">
          <div className={cx('rounded-2xl p-4', ok ? 'bg-emerald-50 text-emerald-800' : received > 0 ? 'bg-red-50 text-red-700' : 'bg-muted text-muted-foreground')} aria-live="polite">
            <div className="font-semibold">{ok ? 'Troco' : received > 0 ? 'Faltam' : 'Troco'}</div>
            <div className="text-3xl font-extrabold sm:text-4xl">{brlc(ok ? change : received > 0 ? total - received : 0)}</div>
          </div>
          <div className="flex flex-wrap gap-2"><button className="rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-accent" onClick={() => setReceived(total)}>Valor exato</button>
            {quick.map((v) => <button key={v} className="rounded-xl border border-border px-3 py-2 text-sm font-semibold hover:bg-accent" onClick={() => setReceived(v)}>{brlc(v)}</button>)}
            <button className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-accent" onClick={() => setReceived(0)}>Limpar</button></div>
        </div>
      </div>
      <button className="btn !w-full !rounded-2xl !py-4 text-lg font-bold" disabled={!ok || busy} onClick={() => onConfirm(received)}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={20} />} Confirmar pagamento <ArrowRight size={18} /></button>
    </div>
  );
}

function CardPanel({ cards, busy, onConfirm }: { cards: { id: string; name: string; type: PayType }[]; busy: boolean; onConfirm: (paymentId: string, ref?: string) => void }) {
  const [id, setId] = useState(cards[0]?.id ?? ''); const [ref, setRef] = useState('');
  return (
    <div className="max-w-xl space-y-4">
      <div role="radiogroup" aria-label="Tipo de cartão" className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => <button key={c.id} role="radio" aria-checked={id === c.id} onClick={() => setId(c.id)} className={cx('flex items-center gap-3 rounded-2xl border-2 p-4 text-left font-bold transition', id === c.id ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50')}><CreditCard size={22} className="text-primary" />{c.name}<span className="ml-auto text-xs font-medium text-muted-foreground">{PAY_LABEL[c.type]}</span></button>)}
      </div>
      <label className="block text-sm"><span className="mb-1 block font-semibold">Nº da autorização ou NSU (opcional)</span><input className="input !py-3 text-lg" value={ref} maxLength={40} onChange={(e) => setRef(e.target.value)} placeholder="Ex.: 832947" inputMode="numeric" /></label>
      <p className="rounded-2xl bg-muted/60 p-3 text-sm text-muted-foreground">A maquininha ainda não é integrada ao sistema. Passe o cartão nela e, quando aprovar, confirme abaixo para registrar o pagamento.</p>
      <button className="btn !w-full !rounded-2xl !py-4 text-lg font-bold" disabled={!id || busy} onClick={() => onConfirm(id, ref.trim() || undefined)}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={20} />} A maquininha aprovou — registrar pagamento</button>
    </div>
  );
}

/** QR do Pix para o cliente pagar na tela; consulta o pagamento até o gateway confirmar. */
function PixModal({ pix, total, onClose, onPaid }: { pix: { orderId: string; number: number; qrCode: string; qrImage: string; expiresAt: string }; total: number; onClose: () => void; onPaid: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((new Date(pix.expiresAt).getTime() - Date.now()) / 1000)));
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const c = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    const p = setInterval(async () => { try { const r = await get<{ payments: { status: string }[] }>(`/v1/staff/orders/${pix.orderId}/payments`); if (r.payments.some((x) => x.status === 'aprovado')) onPaid(); } catch (e) { if (e instanceof ApiError && e.status === 401) onClose(); } }, 3000);
    return () => { clearInterval(c); clearInterval(p); };
  }, [pix.orderId, onPaid, onClose]);
  return (
    <Modal open onClose={onClose} title={`Pix — pedido #${pix.number}`}>
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="text-3xl font-extrabold">{brlc(total)}</div>
        <img src={pix.qrImage} alt="QR Code do Pix" className="h-64 w-64 rounded-2xl border border-border bg-white p-2" />
        <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(pix.qrCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}><Copy size={14} /> {copied ? 'Copiado!' : 'Copiar código Pix'}</button>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status"><Loader2 size={14} className="animate-spin" /> {left > 0 ? <>Aguardando o pagamento… expira em {String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')}</> : 'O QR Code expirou. Feche e gere outro.'}</p>
        <p className="text-xs text-muted-foreground">O pedido fica "a receber" até o Pix ser aprovado. Se o cliente desistir, escolha outra forma de pagamento.</p>
      </div>
    </Modal>
  );
}
