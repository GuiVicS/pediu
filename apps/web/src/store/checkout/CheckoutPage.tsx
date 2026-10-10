import { useEffect } from 'react';
import { ArrowLeft, ClipboardList, CheckCircle2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { brl } from '@/lib/format';
import { DLink } from '@/lib/nav';
import { Img } from '../Img';
import { Footer } from '../StoreLayout';
import { useStore } from '../StoreContext';
import { CardModal, PixModal } from '../PaymentModals';
import { DeliveryForm } from './StepDelivery';
import { IdentifyForm } from './StepIdentify';
import { PaymentForm } from './StepPayment';
import { Secure, StepCard, Stepper, Summary } from './parts';
import { composeAddress, maskPhone } from './format';
import { useCheckout, type Checkout, type Step } from './useCheckout';

/** Checkout em 3 etapas: Identificação · Entrega · Pagamento. Desktop em colunas com resumo; celular uma etapa por tela. */
export default function CheckoutPage() {
  const { theme, store, status, unpublished } = useStore();
  const c = useCheckout();
  const nav = useNavigate();
  useEffect(() => { document.title = `Finalizar compra — ${store.name}`; }, [store.name]);

  const finished = c.pay.done;
  // sacola vazia (e nenhum pedido acabou de ser feito): volta para a loja
  useEffect(() => { if (!finished && c.cart.lines.length === 0) nav('/', { replace: true }); }, [finished, c.cart.lines.length, nav]);

  const blocked = unpublished ? 'Loja em desenvolvimento: os pedidos só são liberados depois da publicação.' : !status.open ? `Loja fechada — não é possível finalizar agora. ${status.label}` : c.cart.subtotal < store.minOrder ? `Pedido mínimo: ${brl(store.minOrder)}.` : null;
  const back = () => nav('/');

  return (
    <div className="min-h-screen bg-t-bg font-t text-t-fg">
      <header className="border-b border-t-border bg-t-card">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-4 lg:px-6">
          <button type="button" onClick={back} aria-label="Voltar para a loja" className="flex items-center gap-1 text-sm text-t-muted-fg hover:text-t-fg lg:w-40"><ArrowLeft size={18} /><span className="hidden sm:inline">Voltar à loja</span></button>
          <DLink to="/" className="flex items-center gap-2"><Img src={theme.logoUrl} alt={store.name} className="h-9 w-9 rounded-full" /><span className="font-bold">{store.name}</span></DLink>
          <Secure className="lg:w-40 lg:justify-end" />
        </div>
      </header>

      {finished ? <Finished c={c} /> : (
        <>
          <Stepper step={c.step} maxStep={c.maxStep} go={c.go} />
          <main className="mx-auto max-w-[1240px] px-4 py-5 lg:px-6 lg:py-8">
            {blocked && <div role="alert" className="mb-4 rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-900">{blocked} <Link to="/" className="font-semibold underline">Voltar à loja</Link></div>}
            <div className="lg:grid lg:grid-cols-[1fr_1fr_360px] lg:items-start lg:gap-5">
              <Summary c={c} />
              <div className="space-y-5 lg:col-start-1 lg:row-start-1">
                <Step c={c} n={1} />
                <Step c={c} n={2} />
              </div>
              <div className="mt-5 lg:col-start-2 lg:row-start-1 lg:mt-0"><Step c={c} n={3} blocked={!!blocked} /></div>
            </div>
          </main>
        </>
      )}
      <div className="flex justify-center border-t border-t-border bg-t-card py-5"><Secure /></div>
      <Footer />
    </div>
  );
}

function Step({ c, n, blocked }: { c: Checkout; n: Step; blocked?: boolean }) {
  const state = c.step === n ? 'active' : n < c.step ? 'done' : 'locked';
  const goBack = () => c.go(n);
  if (n === 1) return (
    <StepCard n={1} title="Identificação" hint="Informe seus dados para continuar." state={state} onEdit={goBack}
      summary={<>{c.id.name}<br />{c.id.email} · {maskPhone(c.id.phone)}</>}><IdentifyForm c={c} /></StepCard>
  );
  if (n === 2) return (
    <StepCard n={2} title="Entrega" hint="Informe como e onde você quer receber." state={state} onEdit={goBack}
      summary={c.del.type === 'retirada' ? <>Retirar na loja</> : <>{c.del.selected ? <>{composeAddress(c.del.selected)}</> : c.del.form.street ? composeAddress(c.del.form) : '—'}<br />{c.del.zone ? `${c.del.zone.name} · ${c.del.zone.fee > 0 ? brl(c.del.zone.fee) : 'Grátis'}` : ''}</>}><DeliveryForm c={c} /></StepCard>
  );
  return (
    <StepCard n={3} title="Pagamento" hint="Escolha uma forma de pagamento." state={blocked && state === 'active' ? 'locked' : state}>
      <PaymentForm c={c} /></StepCard>
  );
}

/** Depois de criar o pedido: Pix e cartão abrem a cobrança; os demais mostram a confirmação. */
function Finished({ c }: { c: Checkout }) {
  const { theme, store } = useStore();
  const nav = useNavigate();
  const done = c.pay.done!;
  const toOrders = () => nav('/pedidos');
  if (done.payment?.method === 'pix') return <><Waiting /><PixModal open created={done} onClose={toOrders} /></>;
  if (done.payment?.method === 'card' && done.payment.publicKey) return <><Waiting /><CardModal open created={done} email={c.id.email.trim()} onClose={toOrders} /></>;
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <CheckCircle2 size={64} className="text-t-accent" aria-hidden />
      <h1 className="text-2xl font-bold">Pedido #{done.number} enviado!</h1>
      <p className="text-t-muted-fg">{theme.thanksMessage}</p>
      <div className="rounded-2xl bg-t-muted px-5 py-3 text-sm">Total: <b>{brl(done.totalCents / 100)}</b> · Previsão: {store.prepTime} min</div>
      <DLink to="/pedidos" className="t-btn !rounded-full"><ClipboardList size={16} /> Acompanhar pedido</DLink>
    </main>
  );
}
const Waiting = () => <main className="px-4 py-24 text-center text-sm text-t-muted-fg">Finalizando seu pedido…</main>;
