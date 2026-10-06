import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { cx } from './kit';

export const PageHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-bold">{title}</h1>{subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}</div><div className="flex flex-wrap items-center gap-2">{actions}</div></div>
);
export const Empty = ({ children }: { children: ReactNode }) => <div className="rounded-ui border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{children}</div>;
export const Stat = ({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) => (
  <div className="card p-4"><div className="text-xs text-muted-foreground">{label}</div><div className={cx('text-xl font-bold', tone === 'bad' && 'text-destructive', tone === 'warn' && 'text-amber-600', tone === 'ok' && 'text-green-600')}>{value}</div>{sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}</div>
);
export const Delta = ({ v }: { v: number | null | undefined }) => v == null ? <span className="text-muted-foreground">—</span> : <span className={v > 0 ? 'text-green-600' : v < 0 ? 'text-destructive' : 'text-muted-foreground'}>{v > 0 ? '▲' : v < 0 ? '▼' : '•'} {Math.abs(Math.round(v * 100))}%</span>;
export const SEVERITY: Record<string, string> = { critical: 'bg-red-100 text-red-700', warn: 'bg-amber-100 text-amber-700', info: 'bg-blue-100 text-blue-700' };
export const STORE_STATUS: Record<string, string> = { desenvolvimento: 'bg-blue-100 text-blue-700', producao: 'bg-green-100 text-green-700', suspensa: 'bg-amber-100 text-amber-700', arquivada: 'bg-slate-200 text-slate-600' };
export const STORE_STATUS_LABEL: Record<string, string> = { desenvolvimento: 'Desenvolvimento', producao: 'Produção', suspensa: 'Suspensa', arquivada: 'Arquivada' };
export const Badge = ({ children, cls }: { children: ReactNode; cls?: string }) => <span className={cx('badge', cls ?? 'bg-muted text-muted-foreground')}>{children}</span>;
export const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className="card overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground">{head.map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead><tbody className="divide-y divide-border">{children}</tbody></table></div>
);

/** Carrega dados de uma rota e permite recarregar; `every` (ms) atualiza sozinho. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], every?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { try { setData(await fn()); setError(null); } catch (e) { setError((e as Error).message); } }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); if (!every) return; const t = setInterval(load, every); return () => clearInterval(t); }, [load, every]);
  return { data, error, reload: load };
}
