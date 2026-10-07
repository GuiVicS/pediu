import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { get } from '@/lib/api';
import { cx } from './kit';

export interface PlatformBanner { id: string; placement: 'login' | 'dashboard'; title: string; imageUrl: string; linkUrl: string }

/** Banners cadastrados no super admin para uma área (login ou dashboard). Falha de rede = sem banners, nunca um erro na tela. */
export function useBanners(placement: PlatformBanner['placement']) {
  const [banners, setBanners] = useState<PlatformBanner[] | null>(null);
  useEffect(() => {
    let alive = true;
    get<{ banners: PlatformBanner[] }>(`/v1/banners?placement=${placement}`).then((r) => alive && setBanners(r.banners)).catch(() => alive && setBanners([]));
    return () => { alive = false; };
  }, [placement]);
  return banners;
}

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Carrossel de banners: troca sozinho a cada 5 s (pausa com o mouse/foco por cima e para quem prefere menos movimento), setas, bolinhas e clique no banner.
 * variant "strip" = faixa fina acima do dashboard; "panel" = ocupa a coluna inteira (lado da tela de login).
 */
export function BannerSlider({ banners, variant, className, empty }: { banners: PlatformBanner[]; variant: 'strip' | 'panel'; className?: string; empty?: React.ReactNode }) {
  const nav = useNavigate();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = banners.length;
  const go = useCallback((to: number) => setI(((to % n) + n) % n), [n]);
  useEffect(() => { if (i >= n) setI(0); }, [n, i]);
  const timer = useRef<ReturnType<typeof setInterval>>();
  useEffect(() => {
    if (n < 2 || paused || reduced()) return;
    timer.current = setInterval(() => setI((x) => (x + 1) % n), 5000);
    return () => clearInterval(timer.current);
  }, [n, paused]);

  if (n === 0) return <>{empty ?? null}</>;
  const open = (b: PlatformBanner) => {
    if (!b.linkUrl) return;
    if (/^https?:\/\//i.test(b.linkUrl)) window.open(b.linkUrl, '_blank', 'noopener,noreferrer');
    else nav(b.linkUrl);
  };
  const strip = variant === 'strip';
  return (
    <section aria-roledescription="carrossel" aria-label="Novidades da plataforma" className={cx('group relative overflow-hidden', strip ? 'h-24 rounded-2xl border border-border shadow-ui-sm sm:h-28' : 'h-full w-full', className)}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div className="flex h-full transition-transform duration-500 ease-out motion-reduce:transition-none" style={{ width: `${n * 100}%`, transform: `translateX(-${(i * 100) / n}%)` }}>
        {banners.map((b, k) => (
          <div key={b.id} className="h-full" style={{ width: `${100 / n}%` }} role="group" aria-roledescription="slide" aria-label={`${k + 1} de ${n}`} aria-hidden={k !== i}>
            <button type="button" onClick={() => open(b)} tabIndex={k === i ? 0 : -1} disabled={!b.linkUrl} aria-label={b.title ? `${b.title}${b.linkUrl ? ' (abrir)' : ''}` : 'Banner'}
              className={cx('block h-full w-full', b.linkUrl ? 'cursor-pointer' : 'cursor-default')}>
              <img src={b.imageUrl} alt={b.title} loading={k === 0 ? 'eager' : 'lazy'} className="h-full w-full object-cover" draggable={false} />
            </button>
          </div>
        ))}
      </div>
      {n > 1 && (
        <>
          <button type="button" onClick={() => go(i - 1)} aria-label="Banner anterior" className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white opacity-0 transition hover:bg-black/60 focus:opacity-100 group-hover:opacity-100 sm:block"><ChevronLeft size={strip ? 16 : 20} /></button>
          <button type="button" onClick={() => go(i + 1)} aria-label="Próximo banner" className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white opacity-0 transition hover:bg-black/60 focus:opacity-100 group-hover:opacity-100 sm:block"><ChevronRight size={strip ? 16 : 20} /></button>
          <div className={cx('absolute left-1/2 flex -translate-x-1/2 gap-1.5', strip ? 'bottom-1.5' : 'bottom-5')}>
            {banners.map((b, k) => <button key={b.id} type="button" onClick={() => go(k)} aria-label={`Ir para o banner ${k + 1}`} aria-current={k === i} className={cx('rounded-full transition-all', strip ? 'h-1.5' : 'h-2', k === i ? (strip ? 'w-5' : 'w-6') + ' bg-white' : (strip ? 'w-1.5' : 'w-2') + ' bg-white/55 hover:bg-white/80')} />)}
          </div>
        </>
      )}
    </section>
  );
}
