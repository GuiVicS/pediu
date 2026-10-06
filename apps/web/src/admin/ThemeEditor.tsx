import { useEffect, useRef, useState } from 'react';
import { Code, Globe, LayoutGrid, Monitor, Palette, RotateCcw, Smartphone, Type } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { THEME_DEFAULTS, type Theme } from '@/lib/types';
import { useKV } from '@/lib/data';
import { FONTS } from '@/lib/theme';
import { Field, ImageInput, cx } from '@/ui/kit';
import { PageHeader, useToast } from './AdminUI';

type Tab = 'visual' | 'textos' | 'layout' | 'integracoes' | 'avancado';
const TABS: [Tab, string, LucideIcon][] = [['visual', 'Visual', Palette], ['textos', 'Textos', Type], ['layout', 'Layout', LayoutGrid], ['integracoes', 'Contato e SEO', Globe], ['avancado', 'Avançado', Code]];

const COLORS: [keyof Theme, string][] = [
  ['primary', 'Principal'], ['primaryFg', 'Texto sobre a principal'], ['secondary', 'Secundária'], ['secondaryFg', 'Texto sobre a secundária'],
  ['accent', 'Destaque'], ['accentFg', 'Texto sobre o destaque'], ['background', 'Fundo'], ['foreground', 'Texto'],
  ['card', 'Cartões'], ['muted', 'Áreas suaves'], ['mutedFg', 'Texto suave'], ['border', 'Bordas'], ['danger', 'Alerta / erro'],
];

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-10 shrink-0 cursor-pointer rounded border border-border bg-card p-0.5" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
        <input className="input !py-1 font-mono text-xs uppercase" value={value} maxLength={7} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && onChange(e.target.value)} />
      </div>
    </div>
  );
}

export default function ThemeEditor() {
  const toast = useToast();
  const [saved, saveTheme] = useKV<Theme>('theme');
  const [draft, setDraft] = useState<Theme | null>(null);
  const [tab, setTab] = useState<Tab>('visual');
  const [device, setDevice] = useState<'mobile' | 'desktop'>('mobile');
  const frame = useRef<HTMLIFrameElement>(null);

  const merged = saved ? ({ ...THEME_DEFAULTS, ...saved } as Theme) : undefined;
  useEffect(() => { if (merged && !draft) setDraft(merged); }, [merged, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = (t: Theme) => frame.current?.contentWindow?.postMessage({ type: 'theme-draft', theme: t }, location.origin);
  useEffect(() => { if (draft) send(draft); }, [draft]);

  if (!draft) return null;
  const set = <K extends keyof Theme>(k: K, v: Theme[K]) => setDraft({ ...draft, [k]: v });
  const dirty = JSON.stringify(draft) !== JSON.stringify(merged);
  const text = (k: keyof Theme, label: string, rows = 0) => (
    <Field label={label}>{rows ? <textarea className="input" rows={rows} value={draft[k] as string} onChange={(e) => set(k, e.target.value as never)} /> : <input className="input" value={draft[k] as string} onChange={(e) => set(k, e.target.value as never)} />}</Field>
  );

  return (
    <>
      <PageHeader title="Aparência da loja" subtitle="Cores, tipografia, logo e textos. O preview ao lado mostra o rascunho antes de salvar." actions={
        <>
          <button className="btn-ghost" disabled={!dirty} onClick={() => merged && setDraft(merged)}><RotateCcw size={14} /> Descartar</button>
          <button className="btn" disabled={!dirty} onClick={async () => { await saveTheme(Object.fromEntries(Object.keys(THEME_DEFAULTS).map((k) => [k, (draft as unknown as Record<string, unknown>)[k]])) as unknown as Theme); toast('Aparência publicada na loja'); }}>Salvar e publicar</button>
        </>
      } />
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div className="card min-w-0 p-4">
          <div className="mb-4 flex flex-wrap gap-1 border-b border-border pb-3">
            {TABS.map(([k, l, Icon]) => <button key={k} onClick={() => setTab(k)} className={cx('flex items-center gap-1.5 rounded-ui-sm px-3 py-1.5 text-sm font-medium', tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}><Icon size={14} />{l}</button>)}
          </div>

          {tab === 'visual' && (
            <div className="space-y-6">
              <section>
                <h3 className="mb-2 text-sm font-semibold">Logotipos e imagens</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ImageInput label="Logo" value={draft.logoUrl} onChange={(v) => set('logoUrl', v)} />
                  <ImageInput label="Ícone do perfil (círculo sobre o banner)" value={draft.profileUrl} onChange={(v) => set('profileUrl', v)} />
                  <ImageInput label="Favicon" value={draft.faviconUrl} onChange={(v) => set('faviconUrl', v)} />
                  <ImageInput wide label="Imagem de fundo (opcional)" value={draft.backgroundImageUrl} onChange={(v) => set('backgroundImageUrl', v)} />
                </div>
              </section>
              <section>
                <h3 className="mb-2 text-sm font-semibold">Paleta de cores</h3>
                <div className="grid gap-3 sm:grid-cols-2">{COLORS.map(([k, l]) => <ColorField key={k} label={l} value={draft[k] as string} onChange={(v) => set(k, v as never)} />)}</div>
              </section>
              <section>
                <h3 className="mb-2 text-sm font-semibold">Tipografia e formas</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Fonte"><select className="input" value={draft.fontFamily} onChange={(e) => set('fontFamily', e.target.value)}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select></Field>
                  <Field label={`Arredondamento dos cantos: ${draft.radius}px`}><input type="range" min={0} max={32} value={draft.radius} onChange={(e) => set('radius', Number(e.target.value))} className="w-full" /></Field>
                </div>
              </section>
            </div>
          )}
          {tab === 'textos' && (
            <div className="space-y-4">
              {text('welcomeMessage', 'Mensagem de boas-vindas')}
              {text('aboutUs', 'Sobre nós', 3)}
              {text('ctaButtonText', 'Texto do botão dos produtos')}
              {text('thanksMessage', 'Mensagem pós-compra', 2)}
              {text('emptyCartMessage', 'Mensagem de sacola vazia')}
              {text('footerText', 'Texto do rodapé')}
            </div>
          )}
          {tab === 'layout' && (
            <div className="space-y-4">
              <Field label="Colunas da grade de produtos (desktop)"><select className="input" value={draft.productGridColumns} onChange={(e) => set('productGridColumns', Number(e.target.value) as Theme['productGridColumns'])}><option value={2}>2 colunas</option><option value={3}>3 colunas</option><option value={4}>4 colunas</option></select></Field>
            </div>
          )}
          {tab === 'integracoes' && (
            <div className="space-y-4">
              {text('whatsapp', 'WhatsApp (com DDI, só números)')}
              <div className="grid gap-4 sm:grid-cols-2">{text('metaPixelId', 'Meta Pixel ID')}{text('googleAnalyticsId', 'Google Analytics ID')}</div>
              {text('seoTitle', 'Título da página (SEO)')}
              {text('seoDescription', 'Descrição (SEO)', 2)}
            </div>
          )}
          {tab === 'avancado' && (
            <div className="space-y-2">
              {text('customCss', 'CSS personalizado', 10)}
              <p className="text-xs text-muted-foreground">Dica: use as classes do Tailwind ou as variáveis <code>--t-primary</code>, <code>--t-bg</code>… para ajustes finos.</p>
            </div>
          )}
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold">Preview ao vivo</span>
            <div className="flex gap-1">{([['mobile', Smartphone], ['desktop', Monitor]] as const).map(([d, Icon]) => <button key={d} onClick={() => setDevice(d)} className={cx('rounded-ui-xs p-1.5', device === d ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground')}><Icon size={15} /></button>)}</div>
          </div>
          <div className={cx('mx-auto overflow-hidden border-4 border-border bg-card', device === 'mobile' ? 'w-[375px] max-w-full rounded-[28px]' : 'w-full rounded-ui-sm')}>
            <iframe ref={frame} onLoad={() => send(draft)} title="Preview" src={`/?preview=1`} className="h-[640px] w-full border-0" />
          </div>
        </aside>
      </div>
    </>
  );
}
