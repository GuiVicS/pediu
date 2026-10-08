/** @type {import('tailwindcss').Config} */
const v = (n) => `rgb(var(--t-${n}) / <alpha-value>)`;
// Tema da plataforma (tweakcn, valores em oklch): relative color mantém os modificadores de opacidade (bg-primary/10)
const p = (n) => `oklch(from var(--${n}) l c h / <alpha-value>)`;
export default {
  darkMode: 'class', // só o painel da plataforma alterna; as lojas seguem o tema de cada nicho
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: p('background'), foreground: p('foreground'),
        card: { DEFAULT: p('card'), foreground: p('card-foreground') },
        popover: { DEFAULT: p('popover'), foreground: p('popover-foreground') },
        primary: { DEFAULT: p('primary'), foreground: p('primary-foreground') },
        secondary: { DEFAULT: p('secondary'), foreground: p('secondary-foreground') },
        muted: { DEFAULT: p('muted'), foreground: p('muted-foreground') },
        accent: { DEFAULT: p('accent'), foreground: p('accent-foreground') },
        destructive: { DEFAULT: p('destructive'), foreground: p('destructive-foreground') },
        border: p('border'), input: p('input'), ring: p('ring'),
        sidebar: { DEFAULT: p('sidebar'), foreground: p('sidebar-foreground'), primary: p('sidebar-primary'), 'primary-foreground': p('sidebar-primary-foreground'), accent: p('sidebar-accent'), 'accent-foreground': p('sidebar-accent-foreground'), border: p('sidebar-border'), ring: p('sidebar-ring') },
        // Cores do tema da loja, definidas em runtime pelo editor de aparência
        t: {
          primary: v('primary'), 'primary-fg': v('primary-fg'),
          secondary: v('secondary'), 'secondary-fg': v('secondary-fg'),
          accent: v('accent'), 'accent-fg': v('accent-fg'),
          bg: v('bg'), fg: v('fg'), card: v('card'),
          muted: v('muted'), 'muted-fg': v('muted-fg'),
          border: v('border'), danger: v('danger'),
        },
      },
      // raio e sombras da plataforma em nomes próprios: rounded-lg/xl e shadow-* continuam como estavam (a loja usa)
      // raio do tema da loja: "theme" (e não "t") porque rounded-t já é o utilitário do Tailwind para só as quinas de cima
      borderRadius: { theme: 'var(--t-radius)', ui: 'var(--radius)', 'ui-sm': 'calc(var(--radius) - 8px)', 'ui-xs': 'calc(var(--radius) - 12px)' },
      boxShadow: { ui: 'var(--shadow)', 'ui-sm': 'var(--shadow-sm)', 'ui-lg': 'var(--shadow-lg)' },
      fontFamily: { t: 'var(--t-font)', brand: ['Montserrat', 'system-ui', 'sans-serif'] }, // fonte da marca Pediu Lanchou (docs/branding)
    },
  },
  plugins: [],
};
