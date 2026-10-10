import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ClipboardList, Copy, CreditCard, Loader2 } from 'lucide-react';
import QRCode from 'qrcode';
import { ApiError, get, post } from '@/lib/api';
import { DLink } from '@/lib/nav';
import { brl } from '@/lib/format';
import { Modal } from '@/ui/kit';
import { useStore } from './StoreContext';

export const myOrdersKey = (slug: string) => `pediu-myorders-${slug}`;
export interface MyOrder { token: string; number: number; at: number }
export const loadMyOrders = (slug: string): MyOrder[] => { try { return JSON.parse(localStorage.getItem(myOrdersKey(slug)) ?? '[]'); } catch { return []; } };
/** Guarda o pedido neste navegador: serve para "Meus pedidos" sem conta e para vincular o pedido à conta criada depois. */
export const rememberOrder = (slug: string, o: { token: string; number: number }) =>
  localStorage.setItem(myOrdersKey(slug), JSON.stringify([{ token: o.token, number: o.number, at: Date.now() }, ...loadMyOrders(slug)].slice(0, 30)));

export interface Created { number: number; totalCents: number; trackingToken: string; payment?: { id: string; method: 'pix' | 'card'; qrCode?: string; expiresAt: string; publicKey?: string; amountCents?: number } }

/** Tela do Pix: QR + copia-e-cola, contagem regressiva e confirmação automática (consulta o acompanhamento a cada 3 s). */
export function PixModal({ open, created, onClose }: { open: boolean; created: Created; onClose: () => void }) {
  const { theme } = useStore();
  const pay = created.payment!;
  const [qr, setQr] = useState(''); const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<'aguardando' | 'pago' | 'expirado'>('aguardando');
  const [left, setLeft] = useState(() => Math.max(0, Math.round((new Date(pay.expiresAt).getTime() - Date.now()) / 1000)));
  const stop = useRef(false);

  useEffect(() => { if (pay.qrCode) void QRCode.toDataURL(pay.qrCode, { margin: 1, width: 280 }).then(setQr); }, [pay.qrCode]);
  useEffect(() => {
    stop.current = false;
    const poll = async () => {
      if (stop.current) return;
      try { const o = await get<{ status: string }>(`/v1/track/${created.trackingToken}`); if (o.status === 'cancelado') { setStatus('expirado'); stop.current = true; } else if (o.status !== 'aguardando') { setStatus('pago'); stop.current = true; } } catch { /* tenta de novo */ }
    };
    const t = setInterval(poll, 3000); void poll();
    const c = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => { stop.current = true; clearInterval(t); clearInterval(c); };
  }, [created.trackingToken]);
  useEffect(() => { if (left === 0 && status === 'aguardando') setStatus('expirado'); }, [left, status]);

  const mmss = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  const copy = async () => { try { await navigator.clipboard.writeText(pay.qrCode ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* o usuário copia à mão */ } };
  return (
    <Modal themed open={open} onClose={onClose} title={status === 'pago' ? 'Pagamento confirmado' : 'Pague com Pix'}>
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        {status === 'pago' ? (
          <>
            <CheckCircle2 size={64} className="text-t-accent" />
            <div className="text-lg font-bold">Pedido #{created.number} pago!</div>
            <p className="text-sm text-t-muted-fg">{theme.thanksMessage}</p>
            <DLink to="/pedidos" onClick={onClose} className="t-btn"><ClipboardList size={16} /> Acompanhar pedido</DLink>
          </>
        ) : status === 'expirado' ? (
          <>
            <p className="text-sm text-t-danger">O tempo do Pix acabou e o pedido foi cancelado. Faça um novo pedido.</p>
            <button className="t-btn" onClick={onClose}>Fechar</button>
          </>
        ) : (
          <>
            <div className="text-sm text-t-muted-fg">Pedido #{created.number} · <b className="text-t-fg">{brl(created.totalCents / 100)}</b></div>
            {qr ? <img src={qr} alt="QR Code do Pix" className="h-56 w-56 rounded-lg border border-t-border bg-white p-2" /> : <Loader2 className="animate-spin" />}
            <button onClick={copy} className="t-btn-ghost w-full"><Copy size={16} /> {copied ? 'Código copiado!' : 'Copiar código Pix (copia e cola)'}</button>
            <p className="text-xs text-t-muted-fg">Abra o app do seu banco, escolha <b>Pix → Ler QR Code</b> ou <b>Copia e Cola</b>. Expira em <b className="text-t-fg">{mmss}</b>.</p>
            <p className="flex items-center gap-1.5 text-xs text-t-muted-fg"><Loader2 size={12} className="animate-spin" /> Aguardando o pagamento… a confirmação é automática.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------- cartão: checkout transparente (Card Payment Brick do Mercado Pago) ----------------
declare global { interface Window { MercadoPago?: new (key: string, o?: { locale?: string }) => { bricks(): { create(kind: string, id: string, settings: unknown): Promise<{ unmount(): void }> } } } }
let sdk: Promise<void> | null = null;
/** SDK oficial do Mercado Pago: os campos do cartão rodam em iframes do MP (o número do cartão nunca passa pela loja). */
const loadMpSdk = () => (sdk ??= new Promise<void>((resolve, reject) => {
  if (window.MercadoPago) return resolve();
  const s = document.createElement('script'); s.src = 'https://sdk.mercadopago.com/js/v2'; s.async = true;
  s.onload = () => resolve(); s.onerror = () => { sdk = null; reject(new Error('Não foi possível carregar o formulário de cartão.')); };
  document.head.appendChild(s);
}));

type CardResult = { status: 'aprovado' } | { status: 'em_analise' } | { status: 'recusado'; message: string };
export function CardModal({ open, created, email, onClose }: { open: boolean; created: Created; email: string; onClose: () => void }) {
  const { theme } = useStore();
  const pay = created.payment!;
  const [state, setState] = useState<'carregando' | 'pronto' | 'aprovado' | 'em_analise'>('carregando');
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const boxId = `card-brick-${created.number}`;
  useEffect(() => {
    if (!open || state === 'aprovado' || state === 'em_analise') return;
    let ctrl: { unmount(): void } | null = null; let gone = false;
    loadMpSdk().then(async () => {
      if (gone || !window.MercadoPago || !box.current) return;
      const mp = new window.MercadoPago(pay.publicKey!, { locale: 'pt-BR' });
      ctrl = await mp.bricks().create('cardPayment', boxId, {
        initialization: { amount: (pay.amountCents ?? created.totalCents) / 100, ...(email ? { payer: { email } } : {}) },
        customization: { visual: { style: { theme: 'default', customVariables: { baseColor: theme.primary } } }, paymentMethods: { maxInstallments: 12 } },
        callbacks: {
          onReady: () => setState('pronto'),
          onError: () => setError('Não foi possível carregar o formulário de cartão. Atualize a página ou pague com Pix.'),
          // o valor cobrado é o do servidor; daqui vão só o token do cartão, a bandeira, o emissor e as parcelas
          onSubmit: async (d: { token: string; payment_method_id: string; issuer_id?: string | number; installments: number; payer: { email: string; identification?: { type: string; number: string } } }) => {
            setError(null);
            try {
              const r = await post<CardResult>(`/v1/track/${created.trackingToken}/card`, { token: d.token, paymentMethodId: d.payment_method_id, issuerId: d.issuer_id ? String(d.issuer_id) : undefined, installments: Number(d.installments), payer: d.payer });
              if (r.status === 'recusado') setError(r.message); else setState(r.status);
            } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível processar o cartão agora.'); }
          },
        },
      });
      if (gone) ctrl.unmount();
    }).catch((e: Error) => setError(e.message));
    return () => { gone = true; ctrl?.unmount(); };
  }, [open, state === 'aprovado' || state === 'em_analise']);   // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'aprovado' || state === 'em_analise') {
    return (
      <Modal themed open={open} onClose={onClose} title={state === 'aprovado' ? 'Pagamento aprovado' : 'Pagamento em análise'}>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          {state === 'aprovado' ? <CheckCircle2 size={56} className="text-t-accent" /> : <Loader2 size={48} className="animate-spin text-t-primary" />}
          <div className="text-lg font-bold">Pedido #{created.number}</div>
          <p className="text-sm text-t-muted-fg">{state === 'aprovado' ? theme.thanksMessage : 'O Mercado Pago está analisando o pagamento. Assim que for aprovado, o pedido segue para a cozinha (você acompanha em Meus pedidos).'}</p>
          <DLink to="/pedidos" onClick={onClose} className="t-btn"><ClipboardList size={16} /> Acompanhar pedido</DLink>
        </div>
      </Modal>
    );
  }
  return (
    <Modal themed open={open} onClose={onClose} title={`Pagar com cartão · ${brl((pay.amountCents ?? created.totalCents) / 100)}`}>
      <div className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs text-t-muted-fg"><CreditCard size={14} /> Pedido #{created.number}. Pagamento seguro processado pelo Mercado Pago: os dados do cartão não passam pela loja.</p>
        {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}
        {state === 'carregando' && !error && <div className="flex items-center justify-center gap-2 py-8 text-sm text-t-muted-fg"><Loader2 size={18} className="animate-spin" /> Carregando pagamento seguro…</div>}
        <div id={boxId} ref={box} />
        <p className="text-[11px] text-t-muted-fg">Se preferir, feche e faça o pedido de novo com Pix. Este pagamento expira em 1 hora.</p>
      </div>
    </Modal>
  );
}
