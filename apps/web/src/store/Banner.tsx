import { useEffect, useState } from 'react';
import { cx } from '@/ui/kit';
import { Img } from './Img';
import { useStore } from './StoreContext';

export function BannerCarousel() {
  const banners = useStore().menu.banners;
  const [i, setI] = useState(0);

  useEffect(() => {
    if (banners.length < 2) return;
    const t = setInterval(() => setI((c) => (c + 1) % banners.length), 4500);
    return () => clearInterval(t);
  }, [banners.length]);

  if (banners.length === 0) return null;
  const cur = Math.min(i, banners.length - 1);
  return (
    <div className="relative w-full overflow-hidden md:rounded-t">
      <div className="flex transition-transform duration-500" style={{ transform: `translateX(-${cur * 100}%)` }}>
        {banners.map((b) => (
          <div key={b.id} className="relative aspect-[5/3] w-full shrink-0 sm:aspect-[5/2]">
            <Img src={b.imageUrl} alt={b.title} className="h-full w-full" />
            {(b.title || b.description) && (
              <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/10 to-transparent p-4 pb-9 text-white sm:p-6 sm:pb-10">
                <div className="text-lg font-bold drop-shadow sm:text-2xl">{b.title}</div>
                <div className="text-xs opacity-90 sm:text-sm">{b.description}</div>
              </div>
            )}
          </div>
        ))}
      </div>
      {banners.length > 1 && (
        <div className="absolute bottom-2 right-3 flex gap-1.5">
          {banners.map((b, k) => <button key={b.id} aria-label={`Banner ${k + 1}`} onClick={() => setI(k)} className={cx('h-1.5 rounded-full transition-all', k === cur ? 'w-6 bg-white' : 'w-1.5 bg-white/60')} />)}
        </div>
      )}
    </div>
  );
}
