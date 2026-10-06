import type { Pools } from '@pediu/db';

/** Faixas do histograma de latência (ms): ≤50 ≤100 ≤250 ≤500 ≤1000 ≤2500 >2500. */
export const BUCKET_LIMITS = [50, 100, 250, 500, 1000, 2500] as const;
export const bucketIndex = (ms: number) => { const i = BUCKET_LIMITS.findIndex((l) => ms <= l); return i < 0 ? BUCKET_LIMITS.length : i; };

export interface MetricSample { scope: 'platform' | 'store' | 'mcp' | 'webhook'; tenantId?: string | null; storeId?: string | null; route: string; method: string; status: number; ms: number }
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry { level: LogLevel; service: 'api' | 'mcp' | 'worker' | 'print' | 'payments'; event: string; message: string; tenantId?: string | null; storeId?: string | null; requestId?: string; status?: number; durationMs?: number; data?: unknown }

const statusClass = (s: number) => `${Math.floor(s / 100)}xx`;
const redact = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, /pass|senha|token|secret|segredo|pin|authorization|cookie|card|cartao|cvv|document|cpf|cnpj/i.test(k) ? '[oculto]' : redact(x)]));
  return v;
};

/**
 * Agrega métricas por minuto na memória e grava em lote; logs vão numa fila limitada. Nunca derruba a requisição:
 * se o banco falhar, o lote é descartado e o erro conta em `dropped`.
 */
export class Telemetry {
  private metrics = new Map<string, any>();
  private logs: LogEntry[] = [];
  private timer?: NodeJS.Timeout;
  dropped = 0;
  constructor(private pools: Pools, private now: () => Date = () => new Date(), private maxLogs = 2000) {}

  start(intervalMs = 10_000) { this.timer = setInterval(() => void this.flush(), intervalMs); this.timer.unref(); }
  async stop() { if (this.timer) clearInterval(this.timer); await this.flush(); }

  metric(s: MetricSample) {
    const bucket = new Date(Math.floor(this.now().getTime() / 60_000) * 60_000).toISOString();
    const cls = statusClass(s.status);
    const key = [bucket, s.scope, s.storeId ?? '', s.route, s.method, cls].join('|');
    const m = this.metrics.get(key) ?? { bucket, scope: s.scope, tenant_id: s.tenantId ?? null, store_id: s.storeId ?? null, route: s.route, method: s.method, status_class: cls,
      count: 0, errors: 0, sum_ms: 0, max_ms: 0, b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, b5: 0, b6: 0 };
    m.count++; if (s.status >= 500) m.errors++; m.sum_ms += Math.round(s.ms); m.max_ms = Math.max(m.max_ms, Math.round(s.ms)); m[`b${bucketIndex(s.ms)}`]++;
    this.metrics.set(key, m);
  }

  log(e: LogEntry) {
    if (this.logs.length >= this.maxLogs) { this.dropped++; return; }
    this.logs.push({ ...e, data: e.data === undefined ? undefined : redact(e.data) });
  }

  async flush() {
    const metrics = [...this.metrics.values()]; this.metrics.clear();
    const logs = this.logs.splice(0);
    const at = this.now().toISOString();
    try {
      if (metrics.length) await this.pools.platform.begin((q) => q`select app.record_metrics(${JSON.stringify(metrics)}::jsonb)`);
      if (logs.length) {
        const rows = logs.map((l) => ({ at, level: l.level, service: l.service, tenant_id: l.tenantId ?? null, store_id: l.storeId ?? null, request_id: l.requestId ?? null, event: l.event, message: l.message, status: l.status ?? null, duration_ms: l.durationMs ?? null, data: l.data ?? null }));
        await this.pools.platform.begin((q) => q`select app.write_logs(${JSON.stringify(rows)}::jsonb)`);
      }
    } catch { this.dropped += metrics.length + logs.length; }
  }
}

/** p95 a partir do histograma (devolve o limite superior da faixa que contém o percentil). */
export function percentileFromBuckets(b: number[], p: number): number | null {
  const total = b.reduce((s, n) => s + n, 0);
  if (!total) return null;
  let acc = 0;
  for (let i = 0; i < b.length; i++) { acc += b[i]!; if (acc / total >= p) return i < BUCKET_LIMITS.length ? BUCKET_LIMITS[i]! : BUCKET_LIMITS.at(-1)! * 2; }
  return null;
}
