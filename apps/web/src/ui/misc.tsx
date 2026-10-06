import { useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

/** Executa uma ação assíncrona mostrando "carregando" e o erro, sem repetir esse código em cada botão. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError((e as Error).message); return undefined; } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

export const Spinner = ({ label = 'Carregando…' }: { label?: string }) => <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> {label}</div>;
export const ErrorBox = ({ children }: { children: ReactNode }) => children ? <div className="rounded-ui-sm bg-destructive/10 px-3 py-2 text-sm text-destructive">{children}</div> : null;

/** Relógio que força a tela a recalcular "há X min" sem recarregar dados. */
export function useTick(ms = 30_000) { const [, set] = useState(0); useEffect(() => { const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms]); }
