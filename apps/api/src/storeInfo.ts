// Conhecimento da loja para a extensão e o agente: tudo vem do banco, nada do que o cliente do WhatsApp diz.
import type { Q } from '@pediu/db';
import { fromCents, getOpenStatus, samePhone, toCents } from '@pediu/shared';
import type { Ctx } from './context.js';
import { buildLines } from './orders.js';

export interface LineIn { productId: string; qty: number; note?: string; addons?: { groupId: string; addonIds: string[] }[] }
const brl = (c: number) => `R$ ${fromCents(c).toFixed(2).replace('.', ',')}`;
export { brl };

export async function storeSnapshot(ctx: Ctx, q: Q, storeId: string) {
  const [st] = await q`select slug, name, status from stores where id = ${storeId}`;
  const [settings] = await q`select data from store_settings where store_id = ${storeId}`;
  const cfg = (settings?.data ?? {}) as Record<string, any>;
  const zones = await q`select id, name, fee, eta from delivery_zones where store_id = ${storeId} and active order by name`;
  const payments = await q`select id, name, type, note from payment_methods where store_id = ${storeId} and active order by sort`;
  const open = getOpenStatus(cfg, ctx.clock.now());
  return {
    name: st!.name as string, slug: st!.slug as string, live: st!.status === 'producao', open: open.open, openLabel: open.label,
    phone: cfg.phone ?? '', address: [cfg.address, cfg.city, cfg.state].filter(Boolean).join(', '), minOrderCents: cfg.minOrder ? toCents(Number(cfg.minOrder)) : 0, prepMinutes: cfg.prepTime ?? null,
    hours: (cfg.hours ?? []) as { day: number; closed: boolean; open: string; close: string }[], mode: cfg.mode ?? 'auto',
    zones: zones.map((z) => ({ id: z.id as string, name: z.name as string, feeCents: toCents(Number(z.fee)), eta: z.eta as number | null })),
    payments: payments.map((p) => ({ id: p.id as string, name: p.name as string, type: p.type as string, note: (p.note ?? '') as string })),
    link: `https://${st!.slug}.${ctx.baseDomain}`,
  };
}
export type Snapshot = Awaited<ReturnType<typeof storeSnapshot>>;

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const hoursText = (s: Snapshot) => s.hours.length ? [...s.hours].sort((a, b) => a.day - b.day).map((h) => `${DAYS[h.day]}: ${h.closed ? 'fechado' : `${h.open}–${h.close}`}`).join(' · ') : '';

/** Variáveis das respostas rápidas. */
export function replyVars(s: Snapshot, customerName = ''): Record<string, string> {
  return {
    loja: s.name, horario: hoursText(s), status: s.openLabel, cliente: customerName, link_loja: s.link,
    pedido_minimo: s.minOrderCents ? brl(s.minOrderCents) : 'sem pedido mínimo',
    taxas_entrega: s.zones.map((z) => `${z.name}: ${brl(z.feeCents)}${z.eta ? ` (~${z.eta} min)` : ''}`).join('\n'),
    pagamentos: s.payments.map((p) => p.name).join(', '),
  };
}

export type Quote =
  | { ok: true; lines: { productId: string; name: string; qty: number; unitCents: number; totalCents: number; addons: unknown[] }[]; subtotalCents: number; feeCents: number; totalCents: number; warnings: string[] }
  | { ok: false; error: string };

/** Orçamento com as mesmas regras do checkout (preço, adicionais, taxa). Avisa loja fechada e pedido mínimo, mas não bloqueia a conversa. */
export async function quote(ctx: Ctx, q: Q, storeId: string, input: { type: 'delivery' | 'retirada'; zoneId?: string; lines: LineIn[] }): Promise<Quote> {
  if (!input.lines.length) return { ok: false, error: 'Nenhum item informado.' };
  const built = await buildLines(q, storeId, input.lines.map((l) => ({ productId: l.productId, qty: l.qty, note: l.note ?? '', addons: l.addons ?? [] })));
  if ('error' in built) return { ok: false, error: built.error! };
  const lines = built.lines!;
  const subtotalCents = lines.reduce((s, l) => s + l.totalCents, 0);
  let feeCents = 0;
  if (input.type === 'delivery') {
    const [z] = input.zoneId ? await q`select fee from delivery_zones where id = ${input.zoneId} and store_id = ${storeId} and active` : [];
    if (!z) return { ok: false, error: 'Região de entrega inválida. Confirme o bairro do cliente.' };
    feeCents = toCents(Number(z.fee));
  }
  const snap = await storeSnapshot(ctx, q, storeId);
  const warnings: string[] = [];
  if (!snap.open) warnings.push(`A loja está fechada (${snap.openLabel}).`);
  if (snap.minOrderCents && subtotalCents < snap.minOrderCents) warnings.push(`Pedido mínimo: ${brl(snap.minOrderCents)}.`);
  return { ok: true, lines: lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unitCents: l.unitCents, totalCents: l.totalCents, addons: l.addons })), subtotalCents, feeCents, totalCents: subtotalCents + feeCents, warnings };
}

/** Consulta de pedido pelo número, exigindo que o telefone informado confira. Sem telefone verificado não devolve nada. */
export async function lookupOrder(q: Q, storeId: string, number: number, phone: string) {
  const [o] = await q`select id, number, status, type, total_cents, customer_phone, created_at, accepted_at, ready_at, dispatched_at, delivered_at, cancelled_at from orders where store_id = ${storeId} and number = ${number}`;
  if (!o || !samePhone(String(o.customer_phone), phone)) return null;
  const items = await q`select name, qty from order_items where order_id = ${o.id} order by created_at`;
  return { number: o.number as number, status: o.status as string, type: o.type as string, totalCents: o.total_cents as number, createdAt: o.created_at as string, items: items.map((i) => ({ name: i.name as string, qty: i.qty as number })) };
}

export interface MenuEntry { id: string; name: string; description: string; priceCents: number; available: boolean; category: string; options: { groupId: string; group: string; min: number; max: number; required: boolean; addons: { id: string; name: string; priceCents: number }[] }[] }

/** Busca no cardápio por texto (nome/descrição/categoria). Sem texto devolve os primeiros itens. */
export async function searchMenu(q: Q, storeId: string, text: string, limit = 12): Promise<MenuEntry[]> {
  const t = text.trim().toLowerCase();
  const prods = await q`select p.id, p.name, p.description, p.price, p.available, c.name as category,
      coalesce((select jsonb_agg(group_id) from product_addon_groups pg where pg.product_id = p.id), '[]') as group_ids
    from products p join categories c on c.id = p.category_id where p.store_id = ${storeId} and p.active and c.active order by c.sort, p.sort`;
  const groups = await q`select g.id, g.name, g.min, g.max, g.required,
      coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price) order by a.sort) from addons a where a.group_id = g.id and a.active), '[]') as addons
    from addon_groups g where g.store_id = ${storeId} and g.active`;
  const words = t.split(/\s+/).filter((w) => w.length > 1);
  return prods
    .filter((p) => !words.length || words.some((w) => `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(w)))
    .slice(0, limit)
    .map((p) => ({
      id: p.id, name: p.name, description: p.description ?? '', priceCents: toCents(Number(p.price)), available: p.available, category: p.category,
      options: (p.group_ids as string[]).map((gid) => groups.find((g) => g.id === gid)).filter((g) => !!g).map((g) => ({
        groupId: g!.id, group: g!.name, min: g!.min, max: g!.max, required: g!.required,
        addons: (g!.addons as { id: string; name: string; price: string | number }[]).map((a) => ({ id: a.id, name: a.name, priceCents: toCents(Number(a.price)) })),
      })),
    }));
}
