import test from 'node:test';
import assert from 'node:assert/strict';
import { describeEvent, namesLabel, type TableEvent } from '../src/apps/tableHistory.js';

const f = { money: (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`, status: (s: string) => ({ preparo: 'Em preparo', pronto: 'Pronto' } as Record<string, string>)[s] ?? s };
const ev = (event: string, data: Record<string, unknown> | null, name: string | null = 'Ana Souza', kind: TableEvent['actor_kind'] = 'staff'): TableEvent => ({ at: '2026-10-10T12:00:00Z', actor_kind: kind, actor_name: name, event, data });

test('frases do histórico da mesa', () => {
  assert.deepEqual(describeEvent(ev('created', { table: 5, items: [{ name: 'Calabresa', qty: 1 }, { name: 'Coca', qty: 2 }] }), f), { who: 'Ana Souza', text: 'abriu a mesa 5: 1× Calabresa, 2× Coca' });
  assert.equal(describeEvent(ev('created', { table: null }), f).text, 'abriu a comanda');
  assert.equal(describeEvent(ev('items_added', { items: [{ name: 'Marguerita', qty: 2 }] }), f).text, 'adicionou 2× Marguerita');
  assert.equal(describeEvent(ev('items_added', { added: 3 }), f).text, 'adicionou 3 item(ns)');                    // eventos antigos, sem resumo
  assert.equal(describeEvent(ev('table_moved', { from: 3, to: 5 }), f).text, 'passou a comanda da mesa 3 para a mesa 5');
  assert.equal(describeEvent(ev('bill_requested', {}), f).text, 'pediu a conta');
  assert.equal(describeEvent(ev('bill_cancelled', {}), f).text, 'cancelou o pedido de conta');
  assert.equal(describeEvent(ev('paid', { totalCents: 15990, method: 'Pix' }), f).text, 'recebeu R$ 159,90 (Pix)');
  assert.equal(describeEvent(ev('status:preparo', { from: 'novo' }), f).text, 'marcou como "Em preparo"');
  assert.equal(describeEvent(ev('status:cancelado', { reason: 'cliente saiu' }), f).text, 'cancelou o pedido: cliente saiu');
});

test('quem fez: nome da pessoa, ou o totem/sistema quando não há', () => {
  assert.equal(describeEvent(ev('items_added', {}, null, 'customer'), f).who, 'O cliente (totem)');
  assert.equal(describeEvent(ev('paid', {}, null, 'system'), f).who, 'O sistema');
  assert.equal(describeEvent(ev('bill_requested', {}, null, 'staff'), f).who, 'Alguém da equipe');   // funcionário removido
});

test('resumo de quem mexeu na mesa', () => {
  assert.equal(namesLabel(['Ana Souza']), 'Ana'); assert.equal(namesLabel(['Ana Souza', 'Carlos Lima']), 'Ana e Carlos');
  assert.equal(namesLabel(['Ana A', 'Bia B', 'Caio C']), 'Ana, Bia e Caio'); assert.equal(namesLabel([], 'Dani Dias'), 'Dani'); assert.equal(namesLabel(undefined), '');
});
