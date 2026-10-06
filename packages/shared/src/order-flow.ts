import { can, type Role } from './roles.js';

/** 'aguardando' = pedido com pagamento online ainda não confirmado (Pix/cartão); só vira 'novo' depois de pago. */
export const ORDER_STATUS = ['aguardando', 'novo', 'preparo', 'pronto', 'saiu', 'entregue', 'cancelado'] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];
export const ORDER_TYPES = ['delivery', 'retirada', 'mesa'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
export const ORDER_CHANNELS = ['loja', 'pdv', 'garcom', 'ifood'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const isTerminal = (s: OrderStatus) => s === 'entregue' || s === 'cancelado';
/** Status que a cozinha e o entregador enxergam (aguardando pagamento fica fora). */
export const isActionable = (s: OrderStatus) => s !== 'aguardando' && !isTerminal(s);

/** Fluxo: novo → preparo → pronto → (saiu, só entrega) → entregue. Cancelar vale até antes de entregar. */
export function nextStatuses(type: OrderType, from: OrderStatus): OrderStatus[] {
  switch (from) {
    case 'aguardando': return ['novo', 'cancelado'];
    case 'novo': return ['preparo', 'cancelado'];
    case 'preparo': return ['pronto', 'cancelado'];
    case 'pronto': return type === 'delivery' ? ['saiu', 'cancelado'] : ['entregue', 'cancelado'];
    case 'saiu': return ['entregue', 'cancelado'];
    default: return [];
  }
}
export const canTransition = (type: OrderType, from: OrderStatus, to: OrderStatus) => nextStatuses(type, from).includes(to);

/** Quem pode fazer cada passo. O entregador só assume (pronto→saiu) e conclui (saiu→entregue) entregas. */
export function roleCanTransition(role: Role, type: OrderType, from: OrderStatus, to: OrderStatus): boolean {
  if (!canTransition(type, from, to)) return false;
  if (from === 'aguardando' && to === 'novo') return false;   // só o pagamento confirmado libera o pedido (ou o recebimento manual no PDV)
  if (to === 'cancelado') return can(role, 'orders.cancel');
  if (role === 'entregador') return type === 'delivery' && ((from === 'pronto' && to === 'saiu') || (from === 'saiu' && to === 'entregue'));
  if (type === 'mesa') return can(role, 'garcom') || can(role, 'pdv') || can(role, 'admin.pedidos');
  return can(role, 'pdv') || can(role, 'admin.pedidos');
}
