import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get, post } from './api';
import { useStream, type StreamEvent } from './realtime';
import type { ApiOrder, OrderStatus } from './types';

export const brlc = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const timeAgo = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m < 1 ? 'agora' : m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} d`; };

export const STATUS_LABEL: Record<OrderStatus, string> = { aguardando: 'Aguardando pagamento', novo: 'Novo', preparo: 'Em preparo', pronto: 'Pronto', saiu: 'Saiu para entrega', entregue: 'Concluído', cancelado: 'Cancelado' };
export const STATUS_STYLE: Record<OrderStatus, string> = {
  aguardando: 'bg-slate-100 text-slate-700', novo: 'bg-blue-100 text-blue-700', preparo: 'bg-amber-100 text-amber-700', pronto: 'bg-emerald-100 text-emerald-700',
  saiu: 'bg-purple-100 text-purple-700', entregue: 'bg-green-100 text-green-700', cancelado: 'bg-red-100 text-red-700',
};
export const CHANNEL_LABEL = { loja: 'Loja online', pdv: 'Balcão', garcom: 'Garçom', ifood: 'iFood' } as const;
export const nextOf = (o: Pick<ApiOrder, 'type' | 'status'>): OrderStatus | null =>
  ({ novo: 'preparo', preparo: 'pronto', pronto: o.type === 'delivery' ? 'saiu' : 'entregue', saiu: 'entregue' } as Partial<Record<OrderStatus, OrderStatus>>)[o.status] ?? null;
export const nextLabel = (o: Pick<ApiOrder, 'type' | 'status'>) => ({ novo: 'Aceitar', preparo: 'Pronto', pronto: o.type === 'delivery' ? 'Saiu p/ entrega' : o.type === 'mesa' ? 'Servido' : 'Entregue ao cliente', saiu: 'Entregue' } as Record<string, string>)[o.status] ?? '';

/** Campainha curta (Web Audio): sem arquivo de áudio para baixar. Navegadores só tocam depois de um toque do usuário na página. */
let audio: AudioContext | null = null;
export function beep() {
  try {
    audio ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (audio.state === 'suspended') void audio.resume();
    [880, 1175, 880].forEach((f, i) => { const o = audio!.createOscillator(), g = audio!.createGain(); o.frequency.value = f; o.connect(g); g.connect(audio!.destination); const t = audio!.currentTime + i * 0.18; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); o.start(t); o.stop(t + 0.17); });
  } catch { /* sem áudio: segue sem som */ }
}

interface Opts { open?: boolean; status?: string; limit?: number; sound?: boolean; onNew?: (e: Extract<StreamEvent, { type: 'order' }>) => void }

/** Lista de pedidos da equipe em tempo real (SSE + reconsulta periódica). */
export function useOrders({ open = true, status, limit = 150, sound = false, onNew }: Opts = {}) {
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const soundRef = useRef(sound); soundRef.current = sound;
  const newRef = useRef(onNew); newRef.current = onNew;

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: String(limit), ...(open ? { open: '1' } : {}), ...(status ? { status } : {}) });
      const r = await get<{ orders: ApiOrder[] }>(`/v1/staff/orders?${qs}`);
      if (alive.current) { setOrders(r.orders); setError(null); setReady(true); }
    } catch (e) { if (alive.current) { setError(e instanceof ApiError ? e.message : 'Falha ao carregar pedidos'); setReady(true); } }
  }, [open, status, limit]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  useStream((e) => {
    if (e.type !== 'order') return;
    void load();
    if (e.kind === 'created' || (e.kind === 'status' && e.status === 'novo')) { if (soundRef.current) beep(); newRef.current?.(e); }
  }, load, 15_000);

  const act = useCallback(async <T,>(p: Promise<T>) => { try { return await p; } finally { void load(); } }, [load]);
  return {
    orders, ready, error, reload: load,
    setStatus: (id: string, to: OrderStatus, reason?: string) => act(post<{ ok: boolean; warning?: string }>(`/v1/staff/orders/${id}/status`, { to, reason })),
    pay: (id: string, paymentId: string, extra: { receivedCents?: number; reference?: string } = {}) => act(post<{ ok: boolean; totalCents: number; changeCents: number }>(`/v1/staff/orders/${id}/pay`, { paymentId, ...extra })),
    addItems: (id: string, lines: OrderLine[]) => act(post(`/v1/staff/orders/${id}/items`, { lines })),
    create: (body: NewOrder) => act(post<{ id: string; number: number; totalCents: number; changeCents: number }>('/v1/staff/orders', body)),
    reprint: (id: string, zoneId?: string) => act(post<{ jobs: number }>(`/v1/staff/print/orders/${id}/reprint`, { zoneId })),
  };
}

export interface OrderLine { productId: string; qty: number; note?: string; addons?: { groupId: string; addonIds: string[] }[] }
export interface NewOrder {
  type: 'delivery' | 'retirada' | 'mesa'; customerName?: string; phone?: string; address?: string; zoneId?: string; table?: number; note?: string;
  paymentId?: string; receiveNow?: boolean; lines: OrderLine[];
  /** PDV: valor recebido em dinheiro, autorização da maquininha, cupom e cliente da conta. */
  receivedCents?: number; reference?: string; couponCode?: string; customerId?: string;
}
