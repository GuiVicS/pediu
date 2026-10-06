import { Plus } from 'lucide-react';
import { brl } from '@/lib/format';
import { Img } from './Img';
import { useStore } from './StoreContext';
import type { ProductView } from './useCatalog';

export function ProductCard({ product, onOpen }: { product: ProductView; onOpen: (p: ProductView) => void }) {
  const { theme } = useStore();
  const unavailable = !product.available;
  return (
    <div
      onClick={() => !unavailable && onOpen(product)}
      className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-t border border-t-border bg-t-card transition hover:shadow-lg"
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        <Img src={product.imageUrl} alt={product.name} fit={product.imageFit} className="h-full w-full transition duration-300 group-hover:scale-105" />
        {unavailable && <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-semibold text-white">Indisponível</div>}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-tight">{product.name}</h3>
        <p className="line-clamp-2 text-xs text-t-muted-fg">{product.description}</p>
        <div className="mt-auto pt-2">
          <div className="mb-2 text-sm font-bold">{product.hasOptions && product.fromPrice > 0 ? 'A partir de ' : ''}{brl(product.fromPrice)}</div>
          <button
            disabled={unavailable}
            onClick={(e) => { e.stopPropagation(); onOpen(product); }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-t-primary py-2 text-xs font-semibold text-t-primary-fg transition hover:opacity-90 disabled:opacity-40"
          >
            <Plus size={15} /> {theme.ctaButtonText}
          </button>
        </div>
      </div>
    </div>
  );
}

export const gridCols = (n: number) => (n === 2 ? 'grid-cols-2' : n === 4 ? 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4' : 'grid-cols-2 md:grid-cols-3');
