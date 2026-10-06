import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, getOpenStatus, groupPriceCents, nextStatuses, priceLine, roleCanTransition, toCents, type AddonGroupDef, type ProductDef } from '../src/index.js';

const g = (o: Partial<AddonGroupDef> = {}): AddonGroupDef => ({ id: 'g1', name: 'Borda', min: 0, max: 2, required: false, pricing: 'sum', active: true,
  addons: [{ id: 'a1', name: 'Catupiry', priceCents: 800, active: true }, { id: 'a2', name: 'Cheddar', priceCents: 700, active: true }, { id: 'a3', name: 'Off', priceCents: 100, active: false }], ...o });
const p = (o: Partial<ProductDef> = {}): ProductDef => ({ id: 'p1', name: 'Pizza', priceCents: 5000, active: true, available: true, groupIds: ['g1'], ...o });

test('preço: soma, maior, menor e média (arredondada em centavos)', () => {
  assert.equal(groupPriceCents('sum', [800, 700]), 1500);
  assert.equal(groupPriceCents('highest', [800, 700]), 800);
  assert.equal(groupPriceCents('lowest', [800, 700]), 700);
  assert.equal(groupPriceCents('average', [800, 701]), 751); // 750,5 → 751
  assert.equal(groupPriceCents('sum', []), 0);
  assert.equal(toCents(19.9), 1990); assert.equal(toCents(0.1 + 0.2), 30);
});

test('priceLine: calcula o unitário e devolve os adicionais com preço do servidor', () => {
  const r = priceLine(p(), [g()], [{ groupId: 'g1', addonIds: ['a1', 'a2'] }]);
  assert.ok(r.ok); assert.equal(r.unitCents, 5000 + 1500);
  assert.deepEqual(r.addons.map((a) => a.name), ['Catupiry', 'Cheddar']);
  assert.equal((priceLine(p(), [g()], []) as any).unitCents, 5000);
});

test('priceLine: recusa mínimo, máximo, item inativo/inexistente e grupo alheio', () => {
  assert.match((priceLine(p(), [g({ required: true })], []) as any).error, /ao menos 1/);
  assert.match((priceLine(p(), [g({ max: 1 })], [{ groupId: 'g1', addonIds: ['a1', 'a2'] }]) as any).error, /no máximo 1/);
  assert.equal(priceLine(p(), [g()], [{ groupId: 'g1', addonIds: ['a3'] }]).ok, false);
  assert.equal(priceLine(p(), [g()], [{ groupId: 'g1', addonIds: ['nao-existe'] }]).ok, false);
  assert.equal(priceLine(p({ groupIds: [] }), [g()], [{ groupId: 'g1', addonIds: ['a1'] }]).ok, false);
  assert.equal(priceLine(p({ available: false }), [g()]).ok, false);
  assert.equal(priceLine(p({ active: false }), [g()]).ok, false);
  // repetir o mesmo adicional não cobra duas vezes
  assert.equal((priceLine(p(), [g()], [{ groupId: 'g1', addonIds: ['a1', 'a1'] }]) as any).unitCents, 5800);
});

const semana = (open: string, close: string, closedDays: number[] = []) => Array.from({ length: 7 }, (_, day) => ({ day, closed: closedDays.includes(day), open, close }));
// 2026-10-07 é quarta-feira (3). 21:00 UTC = 18:00 em São Paulo (UTC-3)
const at = (iso: string) => new Date(iso);

test('horário: respeita o fuso da loja, não o do servidor', () => {
  const h = { mode: 'auto' as const, hours: semana('18:00', '23:00') };
  assert.equal(getOpenStatus(h, at('2026-10-07T21:30:00Z')).open, true);   // 18:30 em SP
  assert.equal(getOpenStatus(h, at('2026-10-07T19:00:00Z')).open, false);  // 16:00 em SP
  assert.match(getOpenStatus(h, at('2026-10-07T19:00:00Z')).label, /Abrimos hoje às 18:00/);
  assert.equal(getOpenStatus(h, at('2026-10-07T21:30:00Z'), 'UTC').open, true);
  assert.equal(getOpenStatus(h, at('2026-10-08T03:30:00Z')).open, false);  // 00:30 em SP, depois de fechar
});

test('horário: dia fechado, modo manual e madrugada', () => {
  assert.equal(getOpenStatus({ hours: semana('18:00', '23:00', [3]) }, at('2026-10-07T21:30:00Z')).open, false); // quarta fechada
  assert.equal(getOpenStatus({ mode: 'open', hours: [] }, at('2026-10-07T15:00:00Z')).open, true);
  assert.equal(getOpenStatus({ mode: 'closed', hours: semana('00:00', '23:59') }, at('2026-10-07T21:30:00Z')).open, false);
  assert.equal(getOpenStatus({}, at('2026-10-07T21:30:00Z')).open, false); // sem horário definido
  const noite = { hours: semana('18:00', '02:00') };
  assert.equal(getOpenStatus(noite, at('2026-10-08T03:30:00Z')).open, true);   // 00:30 em SP: ainda aberta do dia anterior
  assert.equal(getOpenStatus(noite, at('2026-10-08T06:00:00Z')).open, false);  // 03:00 em SP
});

test('fluxo: entrega passa por "saiu"; retirada e mesa não; terminais não andam', () => {
  assert.deepEqual(nextStatuses('delivery', 'pronto'), ['saiu', 'cancelado']);
  assert.deepEqual(nextStatuses('retirada', 'pronto'), ['entregue', 'cancelado']);
  assert.deepEqual(nextStatuses('mesa', 'pronto'), ['entregue', 'cancelado']);
  assert.deepEqual(nextStatuses('delivery', 'entregue'), []);
  assert.equal(canTransition('delivery', 'novo', 'entregue'), false);
  assert.equal(canTransition('retirada', 'pronto', 'saiu'), false);
});

test('permissões do fluxo por perfil', () => {
  assert.equal(roleCanTransition('balcao', 'retirada', 'novo', 'preparo'), true);
  assert.equal(roleCanTransition('balcao', 'retirada', 'novo', 'cancelado'), false);  // balcão não cancela
  assert.equal(roleCanTransition('suporte', 'retirada', 'novo', 'cancelado'), true);
  assert.equal(roleCanTransition('garcom', 'mesa', 'preparo', 'pronto'), true);
  assert.equal(roleCanTransition('garcom', 'delivery', 'novo', 'preparo'), false);
  assert.equal(roleCanTransition('entregador', 'delivery', 'pronto', 'saiu'), true);
  assert.equal(roleCanTransition('entregador', 'delivery', 'saiu', 'entregue'), true);
  assert.equal(roleCanTransition('entregador', 'delivery', 'novo', 'preparo'), false);
  assert.equal(roleCanTransition('entregador', 'mesa', 'pronto', 'entregue'), false);
  assert.equal(roleCanTransition('entregador', 'delivery', 'saiu', 'cancelado'), false);
});
