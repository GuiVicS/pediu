import { EscPos } from './builder.js';
import { width } from './codepage.js';
import type { Codepage } from './codepage.js';

export interface TicketItem { qty: number; name: string; note?: string; unitCents: number; totalCents: number; addons: { group: string; name: string; priceCents: number }[] }
export interface TicketOrder {
  number: number; type: 'delivery' | 'retirada' | 'mesa'; channel: string; table?: number | null;
  customerName: string; phone?: string; address?: string; note?: string;
  subtotalCents: number; feeCents: number; discountCents: number; totalCents: number;
  paymentMethod?: string; paid: boolean; changeForCents?: number | null; createdAt: string | Date;
}
export type TicketKind = 'novo' | 'preparo' | 'items_added' | 'pronto' | 'cancelado' | 'reimpressao' | 'teste' | 'conta';
export interface PrinterProfile { columns: number; codepage: Codepage; cut: boolean; drawer: boolean }
export interface TicketOptions { storeName: string; zoneName: string; kind: TicketKind; showPrices: boolean; printer: PrinterProfile; tz?: string; cancelReason?: string; pixQr?: string }

const brl = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const TITLES: Record<TicketKind, string> = { novo: 'NOVO PEDIDO', preparo: 'PEDIDO ACEITO', items_added: 'ITENS ADICIONADOS', pronto: 'PEDIDO PRONTO', cancelado: '*** CANCELADO ***', reimpressao: 'REIMPRESSAO', teste: 'TESTE DE IMPRESSAO', conta: 'CONTA' };
const TYPES = { delivery: 'ENTREGA', retirada: 'RETIRADA', mesa: 'MESA' } as const;
const CHANNELS: Record<string, string> = { loja: 'Loja online', pdv: 'Balcao', garcom: 'Garcom', ifood: 'iFood' };

const fmtDate = (d: string | Date, tz = 'America/Sao_Paulo') =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(d));

/** Cupom de uma zona. A cozinha vê só os itens da própria zona; quem imprime preços e totais é a zona com `showPrices`. */
export function renderTicket(order: TicketOrder, items: TicketItem[], o: TicketOptions): { data: Uint8Array; preview: string } {
  const p = new EscPos(o.printer.columns, o.printer.codepage);
  p.align('center').bold(true).line(o.storeName).bold(false).line(`[${o.zoneName}]`).rule('=');
  p.big(2).bold(true).line(o.kind === 'cancelado' ? 'CANCELADO' : TITLES[o.kind]).big(1).bold(false);
  p.big(2).bold(true).line(`#${order.number}`).big(1).bold(false);
  p.line(`${TYPES[order.type]}${order.type === 'mesa' && order.table ? ' ' + order.table : ''} - ${CHANNELS[order.channel] ?? order.channel}`);
  p.line(fmtDate(order.createdAt, o.tz)).align('left').rule();

  if (order.type === 'mesa' && order.table) p.big(2).bold(true).line(`MESA ${order.table}`).big(1).bold(false);
  if (order.customerName && order.type !== 'mesa') p.bold(true).line(order.customerName).bold(false);
  if (order.phone && order.type !== 'mesa' && o.showPrices) p.line(order.phone);
  if (order.type === 'delivery' && order.address && o.showPrices) p.wrap(order.address);
  if (order.note) { p.rule(); p.bold(true).line('OBSERVACAO:').bold(false).wrap(order.note); }
  if (o.kind === 'cancelado' && o.cancelReason) p.wrap(`Motivo: ${o.cancelReason}`);
  p.rule();

  for (const it of items) {
    p.big(2).bold(true).line(`${it.qty}x ${it.name}`.slice(0, Math.floor(o.printer.columns / 2))).big(1).bold(false);
    if (width(`${it.qty}x ${it.name}`) > Math.floor(o.printer.columns / 2)) p.wrap(it.name, 3);
    for (const a of it.addons) p.wrap(`+ ${a.name}`, 2);
    if (it.note) p.bold(true).wrap(`OBS: ${it.note}`, 2).bold(false);
    if (o.showPrices) p.row('', `R$ ${brl(it.totalCents)}`);
    p.line();
  }

  if (o.showPrices) {
    p.rule();
    p.row('Subtotal', `R$ ${brl(order.subtotalCents)}`);
    if (order.feeCents) p.row('Entrega', `R$ ${brl(order.feeCents)}`);
    if (order.discountCents) p.row('Desconto', `-R$ ${brl(order.discountCents)}`);
    p.bold(true).row('TOTAL', `R$ ${brl(order.totalCents)}`).bold(false);
    p.line(`Pagamento: ${order.paymentMethod || '-'}${order.paid ? ' (PAGO)' : ' (A RECEBER)'}`);
    if (order.changeForCents && !order.paid) p.line(`Troco para R$ ${brl(order.changeForCents)}`);
    if (o.pixQr) { p.align('center').feed(1).qr(o.pixQr).line('Pague com o Pix').align('left'); }
  }
  p.feed(1).align('center').line(`${items.reduce((n, i) => n + i.qty, 0)} item(ns)`).align('left');
  p.feed(3);
  if (o.printer.drawer && o.showPrices && order.paymentMethod && /dinheiro/i.test(order.paymentMethod)) p.openDrawer();
  if (o.kind === 'novo' || o.kind === 'items_added') p.beep(2);
  if (o.printer.cut) p.cut();
  return { data: p.build(), preview: p.preview() };
}

/** Cupom de teste (botão "imprimir teste" no painel e no agente). */
export function renderTest(storeName: string, printerName: string, printer: PrinterProfile): { data: Uint8Array; preview: string } {
  const p = new EscPos(printer.columns, printer.codepage);
  p.align('center').big(2).bold(true).line('TESTE').big(1).bold(false).line(storeName).line(`Impressora: ${printerName}`).rule('=').align('left');
  p.line('Acentos: ação, coração, pão, índio, órgão').line('Cedilha e til: Ç ã õ  Á É Í Ó Ú').line(`Colunas: ${printer.columns}  Papel: ${printer.columns <= 32 ? '58mm' : '80mm'}`);
  p.rule().row('Item de teste', 'R$ 12,34').rule();
  p.align('center').qr('https://pediulanchou.com.br').line('QR Code').align('left').feed(3);
  if (printer.cut) p.cut();
  return { data: p.build(), preview: p.preview() };
}
