import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ClipboardList, Copy, Loader2 } from 'lucide-react';
import QRCode from 'qrcode';
import { get } from '@/lib/api';
import { DLink } from '@/lib/nav';
import { brl } from '@/lib/format';
import { rememberOrder } from './PaymentModals';
import { useStore } from './StoreContext';

interface Pay { status: string; method: string; qr_code: string | null; expires_at: string | null; amount_cents: number; order_status: string }
type View = 'carregando' | 'aguardando' | 'pago' | 'expirado' | 'invalido';

/** Link de pagamento enviado pela loja (/pagar/<token do pedido>): mostra o Pix pendente do pedido e confirma sozinho quando o cliente paga. */
export default function PayLinkPage() {
  const { token = '' } = useParams();
  const { slug, theme } = useStore();
  const [number, setNumber] = useState<number | null>(null);
  const [pay, setPay] = useState<Pay | null>(null);
  const [view, setView] = useState<View>('carregando');
  const [qr, setQr] = useState(''); const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!/^[0-9a-f]{64}$/.test(token)) { setView('invalido'); return; }
    let gone = false; let done = false;
    const load = async () => {
      if (gone || done) return;
      try {
        const [o, p] = await Promise.all([get<{ number: number }>(`/v1/track/${token}`), get<Pay>(`/v1/track/${token}/payment`)]);
        if (gone) return;
        setNumber(o.number); setPay(p);
        if (p.status === 'aprovado') { done = true; rememberOrder(slug, { token, number: o.number }); setView('pago'); }
        else if (p.status !== 'pendente' || p.method !== 'pix' || !p.qr_code || p.order_status === 'cancelado') { done = true; setView('expirado'); }
        else setView('aguardando');
      } catch { if (!gone) setView((v) => (v === 'carregando' ? 'invalido' : v)); }      // falha de rede no meio do caminho: mantém a tela e tenta de novo
    };
    void load(); const t = setInterval(load, 3000); const c = setInterval(() => setNow(Date.now()), 1000);
    return () => { gone = true; clearInterval(t); clearInterval(c); };
  }, [token, slug]);
  useEffect(() => { if (pay?.qr_code) void QRCode.toDataURL(pay.qr_code, { margin: 1, width: 280 }).then(setQr); }, [pay?.qr_code]);

  const left = pay?.expires_at ? Math.max(0, Math.round((new Date(pay.expires_at).getTime() - now) / 1000)) : 0;
  const shown: View = view === 'aguardando' && left === 0 ? 'expirado' : view;
  const mmss = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  const copy = async () => { try { await navigator.clipboard.writeText(pay?.qr_code ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* o usuário copia à mão */ } };

  return (
    <div className="mx-auto max-w-md px-3 pt-6 md:pt-10">
      <div className="flex flex-col items-center gap-3 rounded-theme border border-t-border bg-t-card p-5 text-center">
        {shown === 'carregando' ? <Loader2 className="animate-spin" /> : shown === 'pago' ? (
          <>
            <CheckCircle2 size={64} className="text-t-accent" />
            <h1 className="text-lg font-bold">Pedido #{number} pago!</h1>
            <p className="text-sm text-t-muted-fg">{theme.thanksMessage}</p>
            <DLink to="/pedidos" className="t-btn"><ClipboardList size={16} /> Acompanhar pedido</DLink>
          </>
        ) : shown === 'aguardando' && pay ? (
          <>
            <h1 className="text-lg font-bold">Pague com Pix</h1>
            <div className="text-sm text-t-muted-fg">Pedido #{number} · <b className="text-t-fg">{brl(pay.amount_cents / 100)}</b></div>
            {qr ? <img src={qr} alt="QR Code do Pix" className="h-56 w-56 rounded-lg border border-t-border bg-white p-2" /> : <Loader2 className="animate-spin" />}
            <button onClick={copy} className="t-btn-ghost w-full"><Copy size={16} /> {copied ? 'Código copiado!' : 'Copiar código Pix (copia e cola)'}</button>
            <p className="text-xs text-t-muted-fg">Abra o app do seu banco, escolha <b>Pix → Ler QR Code</b> ou <b>Copia e Cola</b>. Expira em <b className="text-t-fg">{mmss}</b>.</p>
            <p className="flex items-center gap-1.5 text-xs text-t-muted-fg"><Loader2 size={12} className="animate-spin" /> Aguardando o pagamento… a confirmação é automática.</p>
          </>
        ) : shown === 'expirado' ? (
          <>
            <h1 className="text-lg font-bold">Este link de pagamento expirou</h1>
            <p className="text-sm text-t-muted-fg">{number ? `O Pix do pedido #${number} não está mais disponível.` : 'O Pix deste pedido não está mais disponível.'} Peça um link novo para a loja.</p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold">Link de pagamento não encontrado</h1>
            <p className="text-sm text-t-muted-fg">Confira se o link foi copiado inteiro ou peça um novo para a loja.</p>
          </>
        )}
      </div>
    </div>
  );
}
