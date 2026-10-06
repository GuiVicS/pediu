import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { DLink } from '@/lib/nav';
import { cx } from '@/ui/kit';
import { CartPanel } from './CartPanel';
import { ProductCard, gridCols } from './ProductCard';
import { ProductModal } from './ProductModal';
import { useStore } from './StoreContext';
import { useCatalog, type ProductView } from './useCatalog';

export default function CategoryPage() {
  const { id } = useParams();
  const { theme } = useStore();
  const { categories, products, ready } = useCatalog();
  const [open, setOpen] = useState<ProductView | null>(null);
  const cat = categories.find((c) => c.id === id);
  const list = products.filter((p) => p.categoryId === id);

  return (
    <div className="mx-auto max-w-[1200px] px-3 pt-4 md:px-6 md:pt-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div>
          <DLink to="/" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-t-primary"><ArrowLeft size={16} /> Voltar</DLink>
          <h1 className="mb-4 text-2xl font-bold">{cat?.name ?? (ready ? 'Categoria não encontrada' : '')}</h1>
          {ready && list.length === 0 && <p className="py-8 text-center text-sm text-t-muted-fg">Nenhum produto nesta categoria.</p>}
          <div className={cx('grid gap-3', gridCols(theme.productGridColumns))}>
            {list.map((p) => <ProductCard key={p.id} product={p} onOpen={setOpen} />)}
          </div>
        </div>
        <aside className="hidden lg:block"><CartPanel /></aside>
      </div>
      {open && <ProductModal product={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
