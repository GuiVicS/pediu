import { useEffect, useState } from 'react';

/** Registra o service worker (só em produção, para não atrapalhar o HMR do Vite). */
export function registerSW() {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }
}

function setLink(rel: string, href: string, extra?: Record<string, string>) {
  let el = document.querySelector<HTMLLinkElement>(`link[rel='${rel}']${extra?.sizes ? `[sizes='${extra.sizes}']` : ''}`);
  if (!el) { el = document.createElement('link'); el.rel = rel; document.head.appendChild(el); }
  Object.entries(extra ?? {}).forEach(([k, v]) => el!.setAttribute(k, v));
  el.href = href;
}

export function setThemeColor(color: string) {
  let m = document.querySelector<HTMLMetaElement>("meta[name='theme-color']");
  if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
  m.content = color;
}

interface BeforeInstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** Estado de instalação: prompt nativo (Chrome/Edge/Android) ou instruções (iOS). */
export function useInstall() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const before = (e: Event) => { e.preventDefault(); setEvt(e as BeforeInstallPromptEvent); };
    const done = () => { setInstalled(true); setEvt(null); };
    window.addEventListener('beforeinstallprompt', before);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('beforeinstallprompt', before); window.removeEventListener('appinstalled', done); };
  }, []);

  return {
    installed,
    canPrompt: !!evt && !installed,
    showIOSHelp: isIOS() && !installed,
    install: async () => { if (!evt) return; await evt.prompt(); await evt.userChoice; setEvt(null); },
  };
}
