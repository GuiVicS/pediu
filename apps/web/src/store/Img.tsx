import { useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import type { ImageFit } from '@/lib/types';
import { cx } from '@/ui/kit';

/** Imagem com ícone lucide de fallback. `contain` é para recortes de fundo transparente. */
export function Img({ src, alt, className, fit = 'cover' }: { src: string; alt: string; className?: string; fit?: ImageFit }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={cx('flex items-center justify-center bg-t-muted text-t-muted-fg', className)} role="img" aria-label={alt}>
        <UtensilsCrossed className="h-1/3 w-1/3 max-h-10 max-w-10" strokeWidth={1.5} />
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className={cx(fit === 'contain' ? 'bg-t-muted object-contain p-3' : 'object-cover', className)} />;
}
