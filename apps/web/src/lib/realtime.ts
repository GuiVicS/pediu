import { useEffect, useRef } from 'react';

export type StreamEvent =
  | { type: 'order'; kind: 'created' | 'status' | 'items' | 'paid'; id: string; number: number; orderType: string; status: string }
  | { type: 'menu'; collection: string }
  | { type: 'print'; jobId: string; status: string; error?: string | null; orderId?: string | null }
  | { type: 'agent'; agentId: string; online: boolean };

/**
 * Escuta os eventos da loja (SSE). O navegador reconecta sozinho. Como rede móvel perde eventos, `onResync` também é chamado
 * ao reconectar, ao voltar para a aba e a cada `pollMs`: a tela nunca fica desatualizada por mais que isso.
 */
export function useStream(onEvent: (e: StreamEvent) => void, onResync: () => void, pollMs = 20_000) {
  const ev = useRef(onEvent), rs = useRef(onResync);
  ev.current = onEvent; rs.current = onResync;
  useEffect(() => {
    let es: EventSource | null = null; let closed = false; let opened = false;
    const open = () => {
      if (closed) return;
      es = new EventSource('/v1/staff/stream');
      for (const t of ['order', 'menu', 'print', 'agent'] as const) es.addEventListener(t, (m) => { try { ev.current(JSON.parse((m as MessageEvent).data)); } catch { /* ignora */ } });
      es.addEventListener('ready', () => { if (opened) rs.current(); opened = true; });
    };
    open();
    const poll = setInterval(() => rs.current(), pollMs);
    const vis = () => { if (document.visibilityState === 'visible') rs.current(); };
    document.addEventListener('visibilitychange', vis);
    return () => { closed = true; es?.close(); clearInterval(poll); document.removeEventListener('visibilitychange', vis); };
  }, [pollMs]);
}
