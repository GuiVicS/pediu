import type { FastifyInstance } from 'fastify';
import type { Ctx } from './context.js';
import { staffGuard } from './staff.js';

export type BusEvent =
  | { type: 'order'; kind: 'created' | 'status' | 'items' | 'paid'; id: string; number: number; orderType: string; status: string }
  | { type: 'menu'; collection: string }
  | { type: 'print'; jobId: string; status: string; error?: string | null; orderId?: string | null }
  | { type: 'agent'; agentId: string; online: boolean };

type Listener = (e: BusEvent) => void;

/** Barramento em memória por loja. Com UMA instância da API basta; para várias, troque por Redis pub/sub mantendo esta interface. */
class Bus {
  private subs = new Map<string, Set<Listener>>();
  emit(storeId: string, e: BusEvent) { for (const l of this.subs.get(storeId) ?? []) { try { l(e); } catch { /* um ouvinte ruim não afeta os outros */ } } }
  subscribe(storeId: string, l: Listener) {
    let set = this.subs.get(storeId); if (!set) this.subs.set(storeId, (set = new Set()));
    set.add(l);
    return () => { set!.delete(l); if (!set!.size) this.subs.delete(storeId); };
  }
  count(storeId?: string) { return storeId ? this.subs.get(storeId)?.size ?? 0 : [...this.subs.values()].reduce((n, s) => n + s.size, 0); }
}
export const bus = new Bus();

/** SSE para as telas da equipe: pedido novo, mudança de status, cardápio alterado, impressão e agente. Sem dados pessoais no evento. */
export function realtimeRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/v1/staff/stream', { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const s = req.staff!;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 3000\n\n');
    const send = (e: BusEvent) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    const off = bus.subscribe(s.storeId, send);
    const beat = setInterval(() => res.write(': ping\n\n'), 25_000);
    const end = () => { clearInterval(beat); off(); };
    req.raw.on('close', end); res.on('error', end);
    res.write(`event: ready\ndata: {"storeId":"${s.storeId}"}\n\n`);
  });
}
