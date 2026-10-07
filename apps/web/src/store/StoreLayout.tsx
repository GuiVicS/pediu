import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, NavLink, useSearchParams } from 'react-router-dom';
import { ClipboardList, Home, Info, ShoppingBag, User, X } from 'lucide-react';
import { THEME_DEFAULTS, STORE_DEFAULTS, type Store, type Theme } from '@/lib/types';
import { get } from '@/lib/api';
import { applyTheme } from '@/lib/theme';
import { CartProvider, useCart } from '@/lib/cart';
import { CustomerProvider, useCustomer } from '@/lib/customer';
import { storeSlug } from '@/lib/session';
import { DLink } from '@/lib/nav';
import { brl } from '@/lib/format';
import DraftLoader from './DraftLoader';
import { StoreContext, normalizeMenu, useStore as useStoreCtx, type Menu } from './StoreContext';
import { CartPanel } from './CartPanel';
import { CheckoutModal } from './CheckoutModal';
import { Img } from './Img';
import { cx } from '@/ui/kit';

interface Loaded { theme: Theme; store: Store; status: { open: boolean; label: string }; menu: Menu; landingUrl: string }

/** Loja pública: carrega dados e cardápio da API e atualiza a cada 60 s (e ao voltar para a aba), para preço/disponibilidade nunca ficarem velhos. */
export default function StoreLayout() {
  const slug = storeSlug();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const preview = params.get('preview') === '1';

  const load = useCallback(async () => {
    try {
      const [info, menu] = await Promise.all([get<any>(`/v1/store/${slug}`), get<any>(`/v1/store/${slug}/menu`)]);
      const cfg = info.settings ?? {};
      const store: Store = { ...STORE_DEFAULTS, ...cfg, name: info.name, hours: cfg.hours ?? [] };
      setData({ theme: { ...THEME_DEFAULTS, ...(info.theme ?? {}) }, store, status: { open: !!info.open?.open, label: info.open?.label ?? '' }, menu: normalizeMenu(menu), landingUrl: info.platform?.landingUrl ?? '' });
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [slug]);
  useEffect(() => { void load(); const t = setInterval(load, 60_000); const v = () => document.visibilityState === 'visible' && void load(); document.addEventListener('visibilitychange', v); return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); }; }, [load]);
  useEffect(() => { if (data) applyTheme(data.theme); }, [data?.theme]); // eslint-disable-line react-hooks/exhaustive-deps
  // pré-visualização: o editor de aparência (mesma origem) manda o rascunho por postMessage
  useEffect(() => {
    if (!preview) return;
    const on = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.type === 'theme-draft') setData((d) => (d ? { ...d, theme: { ...THEME_DEFAULTS, ...e.data.theme } } : d)); };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, [preview]);

  const value = useMemo(() => (data ? { slug, ...data, reload: load } : null), [data, slug, load]);
  if (!slug) return <div className="p-8 text-center text-sm text-slate-500">Endereço sem loja. Em desenvolvimento use <code>?loja=slug-da-loja</code>.</div>;
  if (error && !data) return <div className="p-8 text-center text-sm text-slate-500">{error}</div>;
  if (!value) return <div className="p-8 text-center text-sm text-slate-500">Carregando…</div>;
  const { theme } = value;

  return (
    <StoreContext.Provider value={value}>
      <CustomerProvider slug={slug}>
      <CartProvider>
        <div className="min-h-screen bg-t-bg font-t text-t-fg" style={theme.backgroundImageUrl ? { backgroundImage: `url(${theme.backgroundImageUrl})`, backgroundSize: 'cover', backgroundAttachment: 'fixed' } : undefined}>
          {preview && <div className="bg-amber-500/90 px-3 py-1 text-center text-[11px] font-semibold text-black">Pré-visualização</div>}
          <DraftLoader />
          <Header />
          <main className="pb-24 md:pb-10"><Outlet /></main>
          <Footer />
          <BottomNav />
          <CartDrawer />
        </div>
      </CartProvider>
      </CustomerProvider>
    </StoreContext.Provider>
  );
}

function Header() {
  const { theme, store } = useStoreCtx();
  const cart = useCart();
  const { customer } = useCustomer();
  const account = customer ? (customer.name.split(' ')[0] || 'Minha conta') : 'Entrar';
  const link = ({ isActive }: { isActive: boolean }) => cx('rounded-full px-3 py-1.5 text-sm font-medium transition', isActive ? 'bg-t-primary text-t-primary-fg' : 'text-t-fg hover:bg-t-muted');
  return (
    <header className="sticky top-0 z-40 hidden border-b border-t-border bg-t-card/95 backdrop-blur md:block">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
        <DLink to="/" className="flex items-center gap-3">
          <Img src={theme.logoUrl} alt={store.name} className="h-11 w-11 rounded-full" />
          <span className="text-lg font-bold">{store.name}</span>
        </DLink>
        <nav className="flex items-center gap-1">
          <NavLink end to="/" className={link}><span className="flex items-center gap-1.5"><Home size={15} />Início</span></NavLink>
          <NavLink to="/pedidos" className={link}><span className="flex items-center gap-1.5"><ClipboardList size={15} />Meus pedidos</span></NavLink>
          <NavLink to="/conta" className={link}><span className="flex items-center gap-1.5"><User size={15} />{account}</span></NavLink>
          <NavLink to="/empresa" className={link}><span className="flex items-center gap-1.5"><Info size={15} />Sobre</span></NavLink>
          <button onClick={() => cart.setOpen(true)} className="ml-2 flex items-center gap-2 rounded-full bg-t-primary px-4 py-2 text-sm font-semibold text-t-primary-fg lg:hidden">
            <ShoppingBag size={16} /> {cart.count > 0 ? `${cart.count} · ${brl(cart.subtotal)}` : 'Sacola'}
          </button>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  const { theme, store, landingUrl } = useStoreCtx();
  // só http(s): o link vem de configuração; qualquer outro esquema cai no site padrão
  const lp = /^https?:\/\//i.test(landingUrl) ? landingUrl : 'https://pediulanchou.com.br';
  return (
    <footer className="border-t border-t-border bg-t-card px-4 pb-24 pt-6 text-center text-xs text-t-muted-fg md:pb-6">
      <div className="font-semibold text-t-fg">{store.name}</div>
      <div>{[store.address, store.city && `${store.city}/${store.state}`, store.phone].filter(Boolean).join(' · ')}</div>
      <div className="mt-1">© {new Date().getFullYear()} {theme.footerText}</div>
      <a href={lp} target="_blank" rel="noopener noreferrer" className="mx-auto mt-4 flex w-fit flex-col items-center gap-1.5 opacity-90 transition hover:opacity-100" aria-label="Desenvolvido com muita fome — Pediu Lanchou">
        <span>Desenvolvido com muita fome</span>
        <span className="rounded-md bg-white px-2.5 py-1.5 shadow-sm"><img src="/brand/logo-allblack.png" alt="Pediu Lanchou" className="h-5 w-auto" /></span>
      </a>
    </footer>
  );
}

function BottomNav() {
  const cart = useCart();
  const { customer } = useCustomer();
  const item = ({ isActive }: { isActive: boolean }) => cx('flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', isActive ? 'opacity-100' : 'opacity-70');
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-t-border bg-t-primary text-t-primary-fg md:hidden">
      <div className="relative flex h-16 items-center">
        <NavLink end to="/" className={item}><Home size={20} />Início</NavLink>
        <NavLink to="/pedidos" className={item}><ClipboardList size={20} />Pedidos</NavLink>
        <div className="flex flex-1 justify-center">
          <button onClick={() => cart.setOpen(true)} aria-label="Abrir sacola" className="absolute -top-6 flex h-16 w-16 items-center justify-center rounded-full border-4 border-t-card bg-t-accent text-t-accent-fg shadow-xl">
            <ShoppingBag size={26} />
            {cart.count > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-t-danger px-1 text-[11px] font-bold text-white">{cart.count}</span>}
          </button>
        </div>
        <NavLink to="/empresa" className={item}><Info size={20} />Sobre</NavLink>
        <NavLink to="/conta" className={item}><User size={20} />{customer ? 'Conta' : 'Entrar'}</NavLink>
      </div>
    </nav>
  );
}

function CartDrawer() {
  const cart = useCart();
  const { theme } = useStoreCtx();
  const [checkout, setCheckout] = useState(false);
  useEffect(() => {
    const on = () => { cart.setOpen(false); setCheckout(true); };
    window.addEventListener('open-checkout', on);
    return () => window.removeEventListener('open-checkout', on);
  });
  return (
    <>
      {cart.open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-t-bg lg:hidden">
          <div className="flex items-center justify-between border-b border-t-border bg-t-card px-4 py-3">
            <h2 className="flex items-center gap-2 text-lg font-bold"><ShoppingBag size={20} /> Sua sacola</h2>
            <button onClick={() => cart.setOpen(false)} aria-label="Fechar sacola" className="rounded-full p-2 text-t-muted-fg hover:bg-t-muted"><X size={20} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-4"><CartPanel flat emptyText={theme.emptyCartMessage} /></div>
        </div>
      )}
      <CheckoutModal open={checkout} onClose={() => setCheckout(false)} />
    </>
  );
}
