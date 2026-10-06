import type { Theme } from './types';
import { hexToRgb } from './format';

/** Aplica o tema como variáveis CSS na raiz do documento. */
export function applyTheme(t: Theme) {
  const r = document.documentElement.style;
  const set = (n: string, v: string) => r.setProperty(`--t-${n}`, hexToRgb(v));
  set('primary', t.primary); set('primary-fg', t.primaryFg);
  set('secondary', t.secondary); set('secondary-fg', t.secondaryFg);
  set('accent', t.accent); set('accent-fg', t.accentFg);
  set('bg', t.background); set('fg', t.foreground);
  set('card', t.card); set('muted', t.muted); set('muted-fg', t.mutedFg);
  set('border', t.border); set('danger', t.danger);
  // fundo escuro: controles nativos (select, rolagem, time) também ficam escuros
  const [br, bg, bb] = hexToRgb(t.background).split(' ').map(Number);
  r.colorScheme = (0.299 * br + 0.587 * bg + 0.114 * bb) / 255 < 0.5 ? 'dark' : 'light';
  r.setProperty('--t-radius', `${t.radius}px`);
  r.setProperty('--t-font', `${t.fontFamily}, system-ui, sans-serif`);

  let css = document.getElementById('t-custom-css');
  if (!css) { css = document.createElement('style'); css.id = 't-custom-css'; document.head.appendChild(css); }
  css.textContent = t.customCss || '';

  if (t.faviconUrl) {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = t.faviconUrl;
  }
  if (t.seoTitle) document.title = t.seoTitle;
  let meta = document.querySelector<HTMLMetaElement>("meta[name='theme-color']");
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
  meta.content = t.primary;
}

export const FONTS = ['Montserrat', 'Poppins', 'Nunito', 'Lora', 'Playfair Display', 'Barlow'];
