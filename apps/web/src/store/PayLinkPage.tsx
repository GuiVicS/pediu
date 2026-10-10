import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Copy, CreditCard, Loader2 } from 'lucide-react';
import QRCode from 'qrcode';
import { get } from '@/lib/api';
import { DLink } from '@/lib/nav';
import { brl } from '@/lib/format';
import { CardModal, rememberOrder } from './PaymentModals';
import { useStore } from './StoreContext';

interface PayInfo {
  number: number; totalCents: number; paid: boolean; cancelled: boolean;
  pix: { qrCode: string; expiresAt: string; amountCents: number } | null;
  card: { publicKey: string; expiresAt: string; amountCents: number } | null;
}
type View = 'carregando' | 'aberto' | 'pago' | 'expirado' | 'invalido';

/** Link de pagamento enviado pela loja (/pagar/<token do pedido>): o cliente paga com cartão online e/ou com o Pix pendente; a confirmação é automática. */
export default function PayLinkPage() {
  const { token = '' } = useParams();
  const { slug, theme } = useStore();
  const [info, setInfo] = useState<PayInfo | null>(null);
  const [view, setView] = useState<View>('carregando');
  const [cardOpen, setCardOpen] = useState(false);
  const [qr, setQr] = useState(''); const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!/^[0-9a-f]{64}$/.test(token)) { setView('invalido'); return; }
    let gone = false; let done = false;
    const load = async () => {
      if (gone || done) return;
      try {
        const p = await get<PayInfo>(`/v1/track/${token}/pay`);
        if (gone) return;
        setInfo(p);
        if (p.paid) { done = true; rememberOrder(slug, { token, number: p.number }); setView('pago'); }
        else if (p.cancelled || (!p.pix && !p.card)) setView('expirado');
        else setView('aberto');
      } catch { if (!gone) setView((v) => (v === 'carregando' ? 'invalido' : v)); }      // falha de rede no meio do caminho: mantém a tela e tenta de novo
    };
    void load(); const t = setInterval(load, 3000); const c = setInterval(() => setNow(Date.now()), 1000);
    return () => { gone = true; clearInterval(t); clearInterval(c); };
  }, [token, slug]);
  const pixCode = info?.pix?.qrCode;
  useEffect(() => { if (pixCode) void QRCode.toDataURL(pixCode, { margin: 1, width: 280 }).then(setQr); }, [pixCode]);

  const left = info?.pix ? Math.max(0, Math.round((new Date(info.pix.expiresAt).getTime() - now) / 1000)) : 0;
  const pix = info?.pix && left > 0 ? info.pix : null;
  const card = info?.card ?? null;
  const shown: View = view === 'aberto' && !pix && !card ? 'expirado' : view;
  const mmss = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  const copy = async () => { try { await navigator.clipboard.writeText(pix?.qrCode ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* o usuário copia à mão */ } };

  return (
    <div className="mx-auto max-w-md px-3 pt-6 md:pt-10">
      <div className="flex flex-col items-center gap-3 rounded-theme border border-t-border bg-t-card p-5 text-center">
        {shown === 'carregando' ? <Loader2 className="animate-spin" /> : shown === 'pago' ? (
          <>
            <CheckCircle2 size={64} className="text-t-accent" />
            <h1 className="text-lg font-bold">Pedido #{info?.number} pago!</h1>
            <p className="text-sm text-t-muted-fg">{theme.thanksMessage}</p>
            <DLink to="/pedidos" className="t-btn"><ClipboardList size={16} /> Acompanhar pedido</DLink>
          </>
        ) : shown === 'aberto' && info ? (
          <>
            <h1 className="text-lg font-bold">Pagamento do pedido #{info.number}</h1>
            <div className="text-sm text-t-muted-fg">Total: <b className="text-t-fg">{brl(info.totalCents / 100)}</b></div>
            {card && <button className="t-btn w-full" onClick={() => setCardOpen(true)}><CreditCard size={16} /> Pagar com cartão</button>}
            {pix && (
              <>
                {card && <div className="text-xs text-t-muted-fg">ou pague com Pix</div>}
                {qr ? <img src={qr} alt="QR Code do Pix" className="h-56 w-56 rounded-lg border border-t-border bg-white p-2" /> : <Loader2 className="animate-spin" />}
                <button onClick={copy} className="t-btn-ghost w-full"><Copy size={16} /> {copied ? 'Código copiado!' : 'Copiar código Pix (copia e cola)'}</button>
                <p className="text-xs text-t-muted-fg">Abra o app do seu banco, escolha <b>Pix → Ler QR Code</b> ou <b>Copia e Cola</b>. Expira em <b className="text-t-fg">{mmss}</b>.</p>
              </>
            )}
            <p className="flex items-center gap-1.5 text-xs text-t-muted-fg"><Loader2 size={12} className="animate-spin" /> Aguardando o pagamento… a confirmação é automática.</p>
          </>
        ) : shown === 'expirado' ? (
          <>
            <h1 className="text-lg font-bold">{info?.cancelled ? 'Este pedido foi cancelado' : 'Este link de pagamento expirou'}</h1>
            <p className="text-sm text-t-muted-fg">{info?.cancelled ? `O pedido #${info.number} não pode mais ser pago.` : 'O pagamento deste pedido não está mais disponível. Peça um link novo para a loja.'}</p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold">Link de pagamento não encontrado</h1>
            <p className="text-sm text-t-muted-fg">Confira se o link foi copiado inteiro ou peça um novo para a loja.</p>
          </>
        )}
      </div>
      {info && card && cardOpen && shown === 'aberto' && (
        <CardModal open email="" onClose={() => setCardOpen(false)}
          created={{ number: info.number, totalCents: info.totalCents, trackingToken: token, payment: { id: '', method: 'card', expiresAt: card.expiresAt, publicKey: card.publicKey, amountCents: card.amountCents } }} />
      )}
    </div>
  );
}
