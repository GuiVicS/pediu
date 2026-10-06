import type { TicketKind } from '@pediu/escpos';
import type { Ctx } from './context.js';
import { enqueuePrint } from './printing.js';
import { bus } from './realtime.js';

export interface OrderChange {
  kind: 'created' | 'status' | 'items' | 'paid';
  id: string; number: number; orderType: string; status: string;
  print?: TicketKind[]; itemIds?: string[]; cancelReason?: string;
}

/**
 * Depois de gravar uma mudança no pedido (a transação já terminou): avisa as telas em tempo real e manda imprimir.
 * Nunca lança erro: uma falha aqui não pode desfazer nem atrasar o pedido do cliente.
 */
export async function afterOrder(ctx: Ctx, s: { tenantId: string; storeId: string }, c: OrderChange): Promise<void> {
  bus.emit(s.storeId, { type: 'order', kind: c.kind, id: c.id, number: c.number, orderType: c.orderType, status: c.status });
  for (const kind of c.print ?? []) {
    try { await enqueuePrint(ctx, { tenantId: s.tenantId, storeId: s.storeId, orderId: c.id, kind, itemIds: c.itemIds, cancelReason: c.cancelReason }); }
    catch (e) { ctx.telemetry?.log({ level: 'error', service: 'print', event: 'print.enqueue_failed', message: String((e as Error).message).slice(0, 300), storeId: s.storeId, tenantId: s.tenantId, data: { orderId: c.id, kind } }); }
  }
}
