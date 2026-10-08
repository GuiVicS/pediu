import { useRef, useState, type ReactNode } from 'react';
import { ImagePlus, Trash2, Upload, X, type LucideIcon } from 'lucide-react';
import { uploadImage } from '@/lib/api';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** `themed` usa as cores do tema da loja (checkout); sem ele, o visual neutro do painel. */
export function Modal({ open, onClose, title, children, footer, wide, themed }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; themed?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        className={cx('flex max-h-[92vh] w-full flex-col overflow-hidden shadow-2xl', themed ? 'rounded-t-3xl bg-t-card font-t text-t-fg sm:rounded-theme' : 'rounded-t-2xl bg-card text-foreground sm:rounded-ui', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={cx('flex items-center justify-between border-b px-5 py-3', themed ? 'border-t-border' : 'border-border')}>
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className={cx('rounded-full p-1', themed ? 'text-t-muted-fg hover:bg-t-muted' : 'text-muted-foreground hover:bg-muted')} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className={cx('flex justify-end gap-2 border-t px-5 py-3', themed ? 'border-t-border' : 'border-border')}>{footer}</div>}
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
      <button
        type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 rounded-full transition', checked ? 'bg-primary' : 'bg-input')}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-card transition', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {label}
    </label>
  );
}

/** Imagem por upload (vai para o armazenamento do servidor; o banco guarda só a URL). */
export function ImageInput({ value, onChange, label, wide }: { value: string; onChange: (v: string) => void; label?: string; wide?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      {label && <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>}
      <div className="flex flex-wrap items-center gap-3">
        <div className={cx('flex shrink-0 items-center justify-center overflow-hidden rounded-ui-sm border border-dashed border-border bg-muted/50', wide ? 'h-16 w-32' : 'h-16 w-16')}>
          {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="text-muted-foreground" size={20} />}
        </div>
        <div className="flex flex-col gap-1">
          <input ref={ref} type="file" accept="image/*" className="hidden"
            onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy(true); setErr(null); try { onChange(await uploadImage(f)); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); } }} />
          <div className="flex gap-2">
            <button type="button" disabled={busy} className="btn-ghost whitespace-nowrap" onClick={() => ref.current?.click()}><Upload size={14} /> {busy ? 'Enviando…' : 'Enviar imagem'}</button>
            {value && <button type="button" className="btn-ghost whitespace-nowrap" onClick={() => onChange('')}><Trash2 size={14} /> Remover</button>}
          </div>
          {err && <div className="text-xs text-destructive">{err}</div>}
        </div>
      </div>
    </div>
  );
}

export function Field({ label, hint, icon: Icon, children }: { label: string; hint?: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium opacity-70">{Icon && <Icon size={13} />}{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] opacity-50">{hint}</span>}
    </label>
  );
}
