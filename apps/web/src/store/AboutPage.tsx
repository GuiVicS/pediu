import { Bike, Clock, CreditCard, Info, MapPin, Phone } from 'lucide-react';
import { brl } from '@/lib/format';
import { DAY_LABELS } from '@/lib/types';
import { useStore } from './StoreContext';
import { Img } from './Img';

export default function AboutPage() {
  const { theme, store, status, menu } = useStore();
  const zones = menu.zones, pays = menu.payments;
  const today = new Date().getDay();
  const card = 'rounded-theme border border-t-border bg-t-card p-4';
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-3 pt-4 md:pt-8">
      <div className={`${card} flex items-center gap-4`}>
        <Img src={theme.logoUrl} alt={store.name} className="h-20 w-20 rounded-full" />
        <div>
          <h1 className="text-xl font-bold">{store.name}</h1>
          <p className="text-sm text-t-muted-fg">{store.slogan}</p>
          <p className={`mt-1 text-xs font-bold ${status.open ? 'text-green-600' : 'text-t-danger'}`}>{status.label}</p>
        </div>
      </div>
      {theme.aboutUs && <div className={card}><h2 className="mb-1 flex items-center gap-2 font-bold"><Info size={16} className="text-t-primary" /> Sobre nós</h2><p className="text-sm text-t-muted-fg">{theme.aboutUs}</p></div>}
      <div className={`${card} space-y-1 text-sm`}>
        <div className="flex items-center gap-2"><MapPin size={15} className="text-t-primary" />{store.address} — {store.city}/{store.state}</div>
        <div className="flex items-center gap-2"><Phone size={15} className="text-t-primary" />{store.phone}</div>
      </div>
      <div className={card}>
        <h2 className="mb-2 flex items-center gap-2 font-bold"><Clock size={16} className="text-t-primary" /> Horários</h2>
        {store.hours.map((h) => (
          <div key={h.day} className={`flex justify-between py-0.5 text-sm ${h.day === today ? 'font-bold' : 'text-t-muted-fg'}`}>
            <span>{DAY_LABELS[h.day]}</span><span>{h.closed ? 'Fechado' : `${h.open} – ${h.close}`}</span>
          </div>
        ))}
      </div>
      <div className={card}>
        <h2 className="mb-2 flex items-center gap-2 font-bold"><Bike size={16} className="text-t-primary" /> Entrega</h2>
        {zones.map((z) => <div key={z.id} className="flex justify-between py-0.5 text-sm"><span>{z.name} · ~{z.eta} min</span><span>{brl(z.fee)}</span></div>)}
        <p className="mt-2 text-xs text-t-muted-fg">Pedido mínimo {brl(store.minOrder)}</p>
      </div>
      <div className={card}>
        <h2 className="mb-2 flex items-center gap-2 font-bold"><CreditCard size={16} className="text-t-primary" /> Pagamento</h2>
        <div className="flex flex-wrap gap-2">{pays.map((p) => <span key={p.id} className="rounded-full bg-t-muted px-3 py-1 text-xs font-medium">{p.name}</span>)}</div>
      </div>
    </div>
  );
}
