import { useEffect, useMemo, useState } from 'react';
import { Banknote, Bike, CheckCircle2, ChefHat, ConciergeBell, Globe, Printer, QrCode, Receipt, ShoppingCart, Store as StoreIcon, Truck, Wallet, X, Loader2, Copy, CalendarDays } from 'lucide-react';
import QRCode from 'qrcode';
import type { ApiOrder } from '@/lib/types';
import { ApiError, get, post } from '@/lib/api';
import { CHANNEL_LABEL, STATUS_LABEL, STATUS_STYLE, brlc, nextLabel, nextOf, timeAgo, useOrders } from '@/lib/orders';
import { useSession } from '@/lib/session';
import { Modal, cx } from '@/ui/kit';
import { ErrorBox, Spinner, useAction, useTick } from '@/ui/misc';
import { useToast } from '@/admin/AdminUI';
import AppShell from './AppShell';
import OrderBuilder, { sumLines, toOrderLines, type Line } from './OrderBuilder';
import { useStaffMenu } from './menuHook';

export default function PdvApp() { return <AppShell title="PDV — Frente de caixa" wide><PdvTabs /></AppShell>; }

function PdvTabs() {
  const { menu, error } = useStaffMenu();
  const o = useOrders({ open: false, limit: 200, sound: true });
  const [tab, setTab] = useState<'venda' | 'caixa'>('venda');
  const toReceive = o.orders.filter((x) => !x.paid && !['cancelado', 'aguardando'].includes(x.status)).length;
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!menu) return <Spinner />;
  return (
    <>
      <div className="mb-4 grid max-w-md grid-cols-2 gap-1.5">
        {([['venda', 'Nova venda', ShoppingCart], ['caixa', 'Pedidos e caixa', Receipt]] as const).map(([t, label, Icon]) => (
          <button key={t} onClick={() => setTab(t)} className={cx('flex items-center justify-center gap-1.5 rounded-ui-sm py-2 text-sm font-medium', tab === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70')}>
            <Icon size={15} />{label}{t === 'caixa' && toReceive > 0 && <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">{toReceive}</span>}
          </button>
        ))}
      </div>
      {tab === 'venda' ? <Sale menu={menu} o={o} /> : <Cashier menu={menu} o={o} />}
    </>
  );
}

type Orders = ReturnType<typeof useOrders>;
type MenuT = NonNullable<ReturnType<typeof useStaffMenu>['menu']>;
const isCash = (n: string) => /dinheiro/i.test(n);
const money = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);

function Sale({ menu, o }: { menu: MenuT; o: Orders }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [type, setType] = useState<'retirada' | 'delivery'>('retirada');
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [address, setAddress] = useState('');
  const [zoneId, setZoneId] = useState(''); const [payId, setPayId] = useState(''); const [received, setReceived] = useState('');
  const [receiveNow, setReceiveNow] = useState(true);
  const [done, setDone] = useState<{ number: number; total: number; method: string; change: number } | null>(null);
  const act = useAction();
  const pays = menu.payments.filter((p) => !p.online);                     // cobrança online no balcão é pelo Pix na tela, na aba de caixa
  const zone = menu.zones.find((z) => z.id === (zoneId || menu.zones[0]?.id));
  const pay = pays.find((p) => p.id === (payId || pays[0]?.id));

  if (done) return (
    <div className="card mx-auto max-w-md space-y-3 p-8 text-center">
      <CheckCircle2 size={44} className="mx-auto text-green-600" /><h2 className="text-xl font-bold">Venda #{done.number} registrada</h2>
      <p className="text-sm text-muted-foreground">Enviada para a cozinha e para as zonas de impressão.</p>
      <div className="text-3xl font-extrabold">{brlc(done.total)}</div>
      <div className="text-sm text-muted-foreground">{done.method}{done.change > 0 ? ` · troco ${brlc(done.change)}` : ''}</div>
      <button className="btn w-full !py-3" onClick={() => { setDone(null); setReceived(''); }}>Nova venda</button>
    </div>
  );

  return (
    <OrderBuilder menu={menu} lines={lines} setLines={setLines} footer={(subtotal) => {
      const fee = type === 'delivery' ? Math.round((zone?.fee ?? 0) * 100) : 0;
      const total = Math.round(subtotal * 100) + fee;
      const recv = received ? money(received) : 0;
      const ok = lines.length > 0 && (type === 'retirada' || (name.trim() && address.trim() && zone)) && (!receiveNow || !!pay);
      const submit = () => act.run(async () => {
        const r = await o.create({ type, customerName: name.trim() || undefined, phone: phone.trim() || undefined, address: address.trim() || undefined, zoneId: type === 'delivery' ? zone?.id : undefined, paymentId: pay?.id, receiveNow, lines: toOrderLines(lines) });
        setDone({ number: r.number, total: r.totalCents, method: receiveNow ? pay?.name ?? '' : 'A receber', change: receiveNow && pay && isCash(pay.name) && recv > total ? recv - total : 0 });
        setLines([]); setName(''); setPhone(''); setAddress(''); setType('retirada');
      });
      return (
        <>
          <ErrorBox>{act.error}</ErrorBox>
          <div className="grid grid-cols-2 gap-1.5">{([['retirada', 'Balcão', StoreIcon], ['delivery', 'Entrega', Bike]] as const).map(([t, label, Icon]) => (
            <button key={t} onClick={() => setType(t)} className={cx('flex items-center justify-center gap-1.5 rounded-ui-sm border py-2 text-sm font-medium', type === t ? 'border-primary bg-primary/10 text-primary' : 'border-border')}><Icon size={14} /> {label}</button>))}</div>
          <input className="input" placeholder={type === 'delivery' ? 'Nome do cliente' : 'Nome (opcional)'} value={name} onChange={(e) => setName(e.target.value)} />
          {type === 'delivery' && (<>
            <input className="input" placeholder="Telefone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <input className="input" placeholder="Endereço" value={address} onChange={(e) => setAddress(e.target.value)} />
            <select className="input" value={zone?.id ?? ''} onChange={(e) => setZoneId(e.target.value)}>{menu.zones.map((z) => <option key={z.id} value={z.id}>{z.name} — {brlc(Math.round(z.fee * 100))}</option>)}</select>
          </>)}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={receiveNow} onChange={(e) => setReceiveNow(e.target.checked)} /> Receber agora</label>
          {receiveNow && (<>
            <select className="input" value={pay?.id ?? ''} onChange={(e) => setPayId(e.target.value)}>{pays.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            {pay && isCash(pay.name) && <input className="input" inputMode="decimal" placeholder="Valor recebido" value={received} onChange={(e) => setReceived(e.target.value)} />}
          </>)}
          <div className="space-y-0.5 text-sm">
            {fee > 0 && <div className="flex justify-between text-muted-foreground"><span>Entrega</span><span>{brlc(fee)}</span></div>}
            <div className="flex justify-between text-lg font-extrabold"><span>Total</span><span>{brlc(total)}</span></div>
            {receiveNow && pay && isCash(pay.name) && recv >= total && total > 0 && <div className="flex justify-between text-green-700"><span>Troco</span><b>{brlc(recv - total)}</b></div>}
          </div>
          <button className="btn w-full !py-3 text-base" disabled={!ok || act.busy} onClick={submit}>{act.busy ? <Loader2 className="animate-spin" size={16} /> : null} {receiveNow ? 'Finalizar venda' : 'Lançar pedido'}</button>
        </>
      );
    }} />
  );
}

const origem = (o: ApiOrder) => (o.type === 'mesa' ? { label: `Mesa ${o.table_number}`, Icon: ConciergeBell } : o.channel === 'ifood' ? { label: 'iFood', Icon: Truck } : o.channel === 'pdv' ? { label: 'Balcão', Icon: StoreIcon } : o.type === 'delivery' ? { label: 'Entrega', Icon: Bike } : { label: 'Retirada', Icon: Globe });

function Cashier({ menu, o }: { menu: MenuT; o: Orders }) {
  const { can } = useSession();
  const toast = useToast();
  const act = useAction();
  const [filter, setFilter] = useState<'receber' | 'abertos' | 'todos'>('receber');
  const [paying, setPaying] = useState<ApiOrder | null>(null);
  const [cancel, setCancel] = useState<ApiOrder | null>(null);
  const [reason, setReason] = useState('');
  const [methodId, setMethodId] = useState(''); const [received, setReceived] = useState('');
  const [pix, setPix] = useState<{ order: ApiOrder; qr: string; code: string; expiresAt: string } | null>(null);
  useTick();
  const pays = menu.payments.filter((p) => !p.online);
  const today = new Date().setHours(0, 0, 0, 0);
  const sorted = useMemo(() => [...o.orders].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [o.orders]);
  const list = sorted.filter((x) => (filter === 'receber' ? !x.paid && !['cancelado', 'aguardando'].includes(x.status) : filter === 'abertos' ? !['entregue', 'cancelado'].includes(x.status) : new Date(x.created_at).getTime() >= today));
  const caixa = useMemo(() => { const by = new Map<string, number>(); for (const x of o.orders) if (x.paid && x.status !== 'cancelado' && x.paid_at && new Date(x.paid_at).getTime() >= today) by.set(x.payment_method || '—', (by.get(x.payment_method || '—') ?? 0) + x.total_cents); return [...by.entries()]; }, [o.orders, today]);
  const total = caixa.reduce((s, [, v]) => s + v, 0);

  const openPay = (x: ApiOrder) => { setPaying(x); setMethodId(pays[0]?.id ?? ''); setReceived(''); };
  const method = pays.find((p) => p.id === methodId);
  const recv = received ? money(received) : 0;
  const move = (x: ApiOrder, to: ApiOrder['status'], why?: string) => act.run(async () => { const r = await o.setStatus(x.id, to, why); toast(r.warning ?? `Pedido #${x.number}: ${STATUS_LABEL[to]}`); });
  const charge = (x: ApiOrder, gateway: 'mercadopago' | 'sicoob') => act.run(async () => {
    const r = await post<{ qrCode: string; expiresAt: string }>(`/v1/staff/orders/${x.id}/charge`, { gateway });
    setPix({ order: x, qr: await QRCode.toDataURL(r.qrCode, { margin: 1, width: 300 }), code: r.qrCode, expiresAt: r.expiresAt }); setPaying(null);
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <section>
        <ErrorBox>{act.error ?? o.error}</ErrorBox>
        <div className="mb-3 flex flex-wrap gap-1.5">{([['receber', 'A receber', Banknote], ['abertos', 'Em andamento', ChefHat], ['todos', 'Hoje', CalendarDays]] as const).map(([f, label, Icon]) => (
          <button key={f} onClick={() => setFilter(f)} className={cx('flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium', filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70')}><Icon size={14} />{label}</button>))}</div>
        <div className="space-y-3">
          {list.map((x) => { const { label, Icon } = origem(x); return (
            <div key={x.id} className={cx('card space-y-2 p-4', x.status === 'cancelado' && 'opacity-60')}>
              <div className="flex flex-wrap items-center gap-2"><b>#{x.number}</b><span className="badge bg-muted text-foreground"><Icon size={11} className="mr-1" />{label}</span><span className={cx('badge', STATUS_STYLE[x.status])}>{STATUS_LABEL[x.status]}</span>
                <span className={cx('badge', x.paid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>{x.paid ? 'Recebido' : 'A receber'}</span><span className="ml-auto text-xs text-muted-foreground">{timeAgo(x.created_at)}</span></div>
              <div className="flex items-end justify-between gap-3 text-sm">
                <div className="min-w-0"><div className="truncate font-medium">{x.customer_name || '—'}</div><div className="truncate text-xs text-muted-foreground">{x.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</div><div className="text-xs text-muted-foreground">{CHANNEL_LABEL[x.channel]} · {x.payment_method || 'sem forma definida'}</div></div>
                <div className="text-lg font-extrabold">{brlc(x.total_cents)}</div></div>
              {x.status !== 'cancelado' && (
                <div className="flex flex-wrap gap-2">
                  {!x.paid && <button className="btn" onClick={() => openPay(x)}><Banknote size={14} /> Receber</button>}
                  {nextOf(x) && x.type !== 'mesa' && <button className="btn-ghost" disabled={act.busy} onClick={() => move(x, nextOf(x)!)}>{nextLabel(x)}</button>}
                  <button className="btn-ghost" disabled={act.busy} onClick={() => act.run(async () => { const r = await o.reprint(x.id); toast(`${r.jobs} cupom(ns) enviado(s)`); })}><Printer size={14} /> Reimprimir</button>
                  {!['entregue'].includes(x.status) && can('orders.cancel') && <button className="btn-danger ml-auto" onClick={() => { setCancel(x); setReason(''); }}><X size={14} /> Cancelar</button>}
                </div>
              )}
            </div>); })}
          {list.length === 0 && <div className="rounded-ui border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{filter === 'receber' ? 'Nada a receber' : 'Nenhum pedido'}</div>}
        </div>
      </section>
      <aside className="card h-fit p-4 lg:sticky lg:top-20">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Wallet size={15} /> Caixa de hoje</h2>
        <div className="text-2xl font-extrabold">{brlc(total)}</div>
        <div className="mt-3 divide-y divide-border text-sm">{caixa.map(([m, v]) => <div key={m} className="flex justify-between py-1.5"><span>{m}</span><b>{brlc(v)}</b></div>)}{caixa.length === 0 && <div className="py-2 text-xs text-muted-foreground">Nenhum recebimento ainda</div>}</div>
      </aside>

      <Modal open={!!paying} onClose={() => setPaying(null)} title={`Receber pedido #${paying?.number ?? ''} — ${paying ? brlc(paying.total_cents) : ''}`}
        footer={paying && <><button className="btn-ghost" onClick={() => setPaying(null)}>Voltar</button><button className="btn" disabled={!methodId || act.busy} onClick={() => act.run(async () => { await o.pay(paying.id, methodId); toast(`Pedido #${paying.number} recebido`); setPaying(null); })}><Banknote size={14} /> Confirmar {brlc(paying.total_cents)}</button></>}>
        {paying && <div className="space-y-3 text-sm">
          <ErrorBox>{act.error}</ErrorBox>
          <select className="input" value={methodId} onChange={(e) => setMethodId(e.target.value)}>{pays.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          {method && isCash(method.name) && (<><input className="input" inputMode="decimal" placeholder="Valor recebido" value={received} onChange={(e) => setReceived(e.target.value)} />{recv >= paying.total_cents && <div className="flex justify-between text-green-700"><span>Troco</span><b>{brlc(recv - paying.total_cents)}</b></div>}</>)}
          <div className="border-t border-border pt-3"><div className="mb-1.5 text-xs font-medium text-muted-foreground">Ou cobrar por Pix (QR na tela)</div>
            <div className="flex gap-2">{(['mercadopago', 'sicoob'] as const).map((g) => <button key={g} className="btn-ghost" disabled={act.busy} onClick={() => charge(paying, g)}><QrCode size={14} /> {g === 'mercadopago' ? 'Mercado Pago' : 'Sicoob'}</button>)}</div></div>
        </div>}
      </Modal>

      <Modal open={!!cancel} onClose={() => setCancel(null)} title={`Cancelar pedido #${cancel?.number ?? ''}`}
        footer={<><button className="btn-ghost" onClick={() => setCancel(null)}>Voltar</button><button className="btn-danger" disabled={!reason.trim() || act.busy} onClick={async () => { if (cancel) { await move(cancel, 'cancelado', reason.trim()); setCancel(null); } }}><X size={14} /> Confirmar</button></>}>
        <input autoFocus className="input" placeholder="Motivo (obrigatório)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>

      {pix && <PixCharge pix={pix} onClose={() => setPix(null)} onPaid={() => { toast(`Pedido #${pix.order.number} pago por Pix`); setPix(null); void o.reload(); }} />}
    </div>
  );
}

/** QR do Pix para o cliente pagar no balcão; consulta o pagamento até confirmar. */
function PixCharge({ pix, onClose, onPaid }: { pix: { order: ApiOrder; qr: string; code: string; expiresAt: string }; onClose: () => void; onPaid: () => void }) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((new Date(pix.expiresAt).getTime() - Date.now()) / 1000)));
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const c = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    const p = setInterval(async () => { try { const r = await get<{ payments: { status: string }[] }>(`/v1/staff/orders/${pix.order.id}/payments`); if (r.payments.some((x) => x.status === 'aprovado')) onPaid(); } catch (e) { if (e instanceof ApiError && e.status === 401) onClose(); } }, 3000);
    return () => { clearInterval(c); clearInterval(p); };
  }, [pix.order.id, onPaid, onClose]);
  return (
    <Modal open onClose={onClose} title={`Pix — pedido #${pix.order.number}`}>
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="text-2xl font-extrabold">{brlc(pix.order.total_cents)}</div>
        <img src={pix.qr} alt="QR Code do Pix" className="h-64 w-64 rounded-ui border border-border bg-white p-2" />
        <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(pix.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}><Copy size={14} /> {copied ? 'Copiado!' : 'Copiar código'}</button>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 size={12} className="animate-spin" /> Aguardando o pagamento… expira em {String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')}</p>
      </div>
    </Modal>
  );
}
