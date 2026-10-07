import { useCustomer } from '@/lib/customer';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bike, CheckCircle2, ClipboardList, Copy, CreditCard, ExternalLink, Loader2, Map, MapPin, MessageSquare, Phone, QrCode, Send, Store as StoreIcon, User } from 'lucide-react';
import QRCode from 'qrcode';
import { ApiError, get, post } from '@/lib/api';
import { useCart } from '@/lib/cart';
import { DLink } from '@/lib/nav';
import { brl } from '@/lib/format';
import { Field, Modal } from '@/ui/kit';
import { useStore } from './StoreContext';

export const myOrdersKey = (slug: string) => `pediu-myorders-${slug}`;
export interface MyOrder { token: string; number: number; at: number }
export const loadMyOrders = (slug: string): MyOrder[] => { try { return JSON.parse(localStorage.getItem(myOrdersKey(slug)) ?? '[]'); } catch { return []; } };

interface Created { number: number; totalCents: number; trackingToken: string; payment?: { id: string; method: 'pix' | 'card'; qrCode?: string; checkoutUrl?: string; expiresAt: string } }
const onlyDigits = (s: string) => s.replace(/\D/g, '');

export function CheckoutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cart = useCart();
  const { slug, theme, store, menu } = useStore();
  const [type, setType] = useState<'delivery' | 'retirada'>('delivery');
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [address, setAddress] = useState('');
  const [document, setDocument] = useState(''); const [email, setEmail] = useState('');
  const [zoneId, setZoneId] = useState(''); const [payId, setPayId] = useState(''); const [changeFor, setChangeFor] = useState('');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<Created | null>(null);
  const { customer } = useCustomer();
  // cliente logado: nome, telefone e e-mail já vêm preenchidos (e o pedido entra no histórico da conta)
  useEffect(() => { if (customer) { setName((n) => n || customer.name); setPhone((p) => p || customer.phone); setEmail((m) => m || customer.email); } }, [customer]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);

  const zones = menu.zones; const pays = menu.payments;
  const zone = zones.find((z) => z.id === (zoneId || zones[0]?.id));
  const pay = pays.find((p) => p.id === (payId || pays[0]?.id));
  const fee = type === 'delivery' ? zone?.fee ?? 0 : 0;
  const total = cart.subtotal + fee;
  const needsDoc = !!pay?.online && pay.gateway === 'sicoob';
  const valid = name.trim().length >= 2 && onlyDigits(phone).length >= 8 && (type === 'retirada' || (address.trim() && zone)) && pay && (!needsDoc || [11, 14].includes(onlyDigits(document).length));

  async function submit() {
    if (!pay) return;
    setBusy(true); setError(null);
    try {
      const r = await post<Created>(`/v1/store/${slug}/orders`, {
        type, customerName: name.trim(), phone: onlyDigits(phone), address: type === 'delivery' ? address.trim() : '', zoneId: type === 'delivery' ? zone?.id : undefined,
        paymentId: pay.id, note: note.trim(), changeFor: pay.type === 'cash' && changeFor ? Number(changeFor.replace(',', '.')) : undefined,
        email: email.trim() || undefined, document: onlyDigits(document) || undefined,
        lines: cart.lines.map((l) => ({ productId: l.productId, qty: l.qty, note: l.note, addons: Object.values(l.addons.reduce<Record<string, { groupId: string; addonIds: string[] }>>((acc, a) => { (acc[a.groupId] ??= { groupId: a.groupId, addonIds: [] }).addonIds.push(a.addonId); return acc; }, {})) })),
      });
      const mine = loadMyOrders(slug); localStorage.setItem(myOrdersKey(slug), JSON.stringify([{ token: r.trackingToken, number: r.number, at: Date.now() }, ...mine].slice(0, 30)));
      cart.clear(); setDone(r);
      if (r.payment?.method === 'card' && r.payment.checkoutUrl) window.location.href = r.payment.checkoutUrl;
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Não foi possível enviar o pedido.'); } finally { setBusy(false); }
  }
  const close = () => { setDone(null); setError(null); onClose(); };

  if (done?.payment?.method === 'pix') return <PixModal open={open} created={done} onClose={close} />;
  if (done) {
    return (
      <Modal themed open={open} onClose={close} title="Pedido enviado">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 size={56} className="text-t-accent" />
          <div className="text-lg font-bold">Pedido #{done.number}</div>
          <p className="text-sm text-t-muted-fg">{theme.thanksMessage}</p>
          <div className="rounded-lg bg-t-muted px-4 py-2 text-sm">Total: <b>{brl(done.totalCents / 100)}</b> · Previsão: {store.prepTime} min</div>
          <DLink to="/pedidos" onClick={close} className="t-btn"><ClipboardList size={16} /> Acompanhar pedido</DLink>
        </div>
      </Modal>
    );
  }

  return (
    <Modal themed open={open} onClose={close} title="Finalizar pedido"
      footer={<button className="t-btn w-full" disabled={!valid || busy} onClick={submit}>{busy ? <Loader2 size={16} className="animate-spin" /> : pay?.online ? <QrCode size={16} /> : <Send size={16} />} {pay?.online ? (pay.type === 'credit' ? 'Pagar com cartão' : 'Pagar com Pix') : 'Enviar pedido'} · {brl(total)}</button>}>
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="grid grid-cols-2 gap-2">
          {(['delivery', 'retirada'] as const).map((t) => (
            <button key={t} onClick={() => setType(t)} className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${type === t ? 'border-t-primary bg-t-primary text-t-primary-fg' : 'border-t-border text-t-fg hover:bg-t-muted'}`}>
              <span className="flex items-center justify-center gap-1.5">{t === 'delivery' ? <><Bike size={16} /> Entrega</> : <><StoreIcon size={16} /> Retirar na loja</>}</span>
            </button>
          ))}
        </div>
        <Field label="Seu nome" icon={User}><input className="t-input" value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Telefone / WhatsApp" icon={Phone}><input className="t-input" value={phone} inputMode="tel" autoComplete="tel" onChange={(e) => setPhone(e.target.value)} placeholder="(16) 99999-9999" /></Field>
        {type === 'delivery' && (
          <>
            <Field label="Região de entrega" icon={Map}>
              <select className="t-input" value={zone?.id ?? ''} onChange={(e) => setZoneId(e.target.value)}>{zones.map((z) => <option key={z.id} value={z.id}>{z.name} — {brl(z.fee)} · ~{z.eta} min</option>)}</select>
            </Field>
            <Field label="Endereço completo" icon={MapPin}><input className="t-input" value={address} autoComplete="street-address" onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número, complemento" /></Field>
          </>
        )}
        <Field label="Forma de pagamento" icon={CreditCard}>
          <select className="t-input" value={pay?.id ?? ''} onChange={(e) => setPayId(e.target.value)}>{pays.map((p) => <option key={p.id} value={p.id}>{p.name}{p.online ? ' (online)' : ''}{p.note ? ` — ${p.note}` : ''}</option>)}</select>
        </Field>
        {pay?.type === 'cash' && <Field label="Troco para quanto? (opcional)" icon={CreditCard}><input className="t-input" inputMode="decimal" value={changeFor} onChange={(e) => setChangeFor(e.target.value)} placeholder="Ex.: 100" /></Field>}
        {pay?.online && <Field label="E-mail (opcional, para o comprovante)" icon={User}><input className="t-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>}
        {needsDoc && <Field label="CPF ou CNPJ do pagador" icon={User}><input className="t-input" inputMode="numeric" value={document} onChange={(e) => setDocument(e.target.value)} /></Field>}
        <Field label="Observações" icon={MessageSquare}><textarea className="t-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="space-y-1 rounded-lg bg-t-muted p-3 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span>{brl(cart.subtotal)}</span></div>
          <div className="flex justify-between"><span className="flex items-center gap-1.5"><Bike size={14} /> Taxa de entrega</span><span>{brl(fee)}</span></div>
          <div className="flex justify-between border-t border-t-border pt-1 font-bold"><span>Total</span><span>{brl(total)}</span></div>
          <p className="pt-1 text-[11px] text-t-muted-fg">O valor final é confirmado pela loja ao enviar.</p>
        </div>
      </div>
    </Modal>
  );
}

/** Tela do Pix: QR + copia-e-cola, contagem regressiva e confirmação automática (consulta o acompanhamento a cada 3 s). */
function PixModal({ open, created, onClose }: { open: boolean; created: Created; onClose: () => void }) {
  const { slug, theme } = useStore();
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
  void slug;
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
void ExternalLink;
