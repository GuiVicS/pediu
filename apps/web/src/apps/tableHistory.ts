/** Linha do tempo da mesa em português: "Ana adicionou 2× Calabresa". Função pura (sem React) para poder testar. */
export interface TableEvent { at: string; actor_kind: 'customer' | 'staff' | 'system'; actor_name: string | null; actor_role?: string | null; event: string; data: Record<string, any> | null }
export interface Fmt { money: (cents: number) => string; status: (s: string) => string }

const who = (e: TableEvent) => e.actor_name ?? (e.actor_kind === 'customer' ? 'O cliente (totem)' : e.actor_kind === 'system' ? 'O sistema' : 'Alguém da equipe');
const list = (items: unknown): string => (Array.isArray(items) ? items.map((i: { name?: string; qty?: number }) => `${i.qty ?? 1}× ${i.name ?? 'item'}`).join(', ') : '');

export function describeEvent(e: TableEvent, f: Fmt): { who: string; text: string } {
  const d = e.data ?? {}; const name = who(e);
  switch (true) {
    case e.event === 'created': { const it = list(d.items); return { who: name, text: `abriu ${d.table ? `a mesa ${d.table}` : 'a comanda'}${it ? `: ${it}` : ''}` }; }
    case e.event === 'items_added': { const it = list(d.items); return { who: name, text: it ? `adicionou ${it}` : `adicionou ${d.added ?? ''} item(ns)`.trim() }; }
    case e.event === 'table_moved': return { who: name, text: `passou a comanda da mesa ${d.from} para a mesa ${d.to}` };
    case e.event === 'bill_requested': return { who: name, text: 'pediu a conta' };
    case e.event === 'bill_cancelled': return { who: name, text: 'cancelou o pedido de conta' };
    case e.event === 'paid': return { who: name, text: `recebeu ${f.money(Number(d.totalCents ?? 0))}${d.method ? ` (${d.method})` : ''}` };
    case e.event.startsWith('status:'): { const to = e.event.slice(7); return { who: name, text: to === 'cancelado' ? `cancelou o pedido${d.reason ? `: ${d.reason}` : ''}` : `marcou como "${f.status(to)}"` }; }
    default: return { who: name, text: e.event };
  }
}

/** Quem mexeu na mesa, para o resumo ("Ana e Carlos"). */
export const namesLabel = (names: string[] | undefined, fallback?: string | null) => {
  const n = (names && names.length ? names : fallback ? [fallback] : []).map((x) => x.split(' ')[0]!);
  return n.length <= 1 ? n[0] ?? '' : `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;
};
