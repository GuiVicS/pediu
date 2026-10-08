import { useMemo, useState } from 'react';
import { ChevronRight, Clock, MapPin, Search, Star, UtensilsCrossed } from 'lucide-react';
import { DLink, useDemoNavigate } from '@/lib/nav';
import { BannerCarousel } from './Banner';
import { CartPanel } from './CartPanel';
import { Img } from './Img';
import { ProductCard, gridCols } from './ProductCard';
import { ProductModal } from './ProductModal';
import { useStore } from './StoreContext';
import { useCatalog, type ProductView } from './useCatalog';
import { cx } from '@/ui/kit';

export default function HomePage() {
  const { theme, store, status, menu } = useStore();
  const nav = useDemoNavigate();
  const { categories, products, ready } = useCatalog();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ProductView | null>(null);

  const highlights = useMemo(
    () => menu.featured.map((id) => products.find((p) => p.id === id)).filter((p): p is ProductView => !!p),
    [menu.featured, products],
  );
  const q = query.trim().toLowerCase();
  const found = q ? products.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q)) : [];

  return (
    <div className="mx-auto max-w-[1200px] md:px-6 md:pt-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <div>
            <BannerCarousel />
            <div className="relative z-10 mx-3 -mt-6 flex items-center gap-3 rounded-theme border border-t-border bg-t-card p-3 shadow-lg md:mx-4">
              <Img src={theme.profileUrl || theme.logoUrl} alt={store.name} className="h-16 w-16 shrink-0 rounded-full border-2 border-t-bg" />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-lg font-bold leading-tight">{store.name}</h1>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-t-muted-fg">
                  <span className="flex items-center gap-1"><MapPin size={12} />{store.city} - {store.state}</span>
                  <DLink to="/empresa" className="flex items-center font-medium text-t-primary">Saiba mais <ChevronRight size={12} /></DLink>
                </div>
              </div>
              <span className={cx('flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold', status.open ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                <Clock size={12} />{status.open ? 'ABERTO' : 'FECHADO'}
              </span>
            </div>
            {!status.open && <p className="mx-4 mt-2 rounded-lg bg-t-muted px-3 py-2 text-xs text-t-muted-fg">{store.closedMessage}</p>}
            {theme.welcomeMessage && <p className="mx-4 mt-3 text-sm text-t-muted-fg">{theme.welcomeMessage}</p>}
          </div>

          {highlights.length > 0 && !q && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 px-3 text-lg font-bold md:px-0"><Star size={18} className="text-t-primary" /> Destaques</h2>
              <div className="no-scrollbar flex snap-x gap-3 overflow-x-auto px-3 pb-1 md:px-0">
                {highlights.map((p) => <div key={p.id} className="w-[44%] shrink-0 snap-start sm:w-[30%] lg:w-[22%]"><ProductCard product={p} onOpen={setOpen} /></div>)}
              </div>
            </section>
          )}

          <section className="px-3 md:px-0">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><UtensilsCrossed size={18} className="text-t-primary" /> Cardápio</h2>
            <div className="relative mb-4">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-t-muted-fg" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pesquisar produto"
                className="h-11 w-full rounded-theme border border-t-border bg-t-card pl-9 pr-3 text-sm outline-none focus:border-t-primary" />
            </div>
            {!ready ? <p className="py-8 text-center text-sm text-t-muted-fg">Carregando…</p>
              : q ? (
                found.length ? <div className={cx('grid gap-3', gridCols(theme.productGridColumns))}>{found.map((p) => <ProductCard key={p.id} product={p} onOpen={setOpen} />)}</div>
                  : <p className="py-8 text-center text-sm text-t-muted-fg">Nenhum produto encontrado.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  {categories.map((c) => (
                    <button key={c.id} onClick={() => nav(`/categoria/${c.id}`)}
                      className="group flex min-h-[96px] items-center justify-between gap-2 overflow-hidden rounded-theme border border-t-border bg-t-card p-3 text-left transition hover:shadow-md">
                      <span className="text-base font-semibold leading-tight">{c.name}</span>
                      <Img src={c.imageUrl} alt={c.name} fit={c.imageFit} className="h-16 w-16 shrink-0 rounded-xl transition group-hover:scale-105" />
                    </button>
                  ))}
                </div>
              )}
          </section>
        </div>
        <aside className="hidden lg:block"><CartPanel /></aside>
      </div>
      {open && <ProductModal product={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
