import test from 'node:test';
import assert from 'node:assert/strict';
import { mapsRouteUrl, parseAddress, planStops } from '../src/route-plan.js';

test('parseAddress: endereço do checkout (rua, nº, bairro, cidade, CEP — região)', () => {
  const p = parseAddress('Rua Eurípedes Barcaroli, 125 - apto 3, Jardim Palma, Franca-SP, CEP 14402-151 — Centro');
  assert.equal(p.zone, 'Centro'); assert.equal(p.cep, '14402151'); assert.equal(p.district, 'Jardim Palma'); assert.equal(p.num, 125); assert.equal(p.street, 'rua euripedes barcaroli');
});

test('parseAddress: endereço digitado à mão no PDV (sem CEP nem vírgulas certinhas)', () => {
  const p = parseAddress('Av. Brasil 900 casa 2 — Bairros vizinhos');
  assert.equal(p.zone, 'Bairros vizinhos'); assert.equal(p.cep, null); assert.equal(p.district, ''); assert.equal(p.street, 'av. brasil 900 casa'); // número no meio do texto: ordena pela rua inteira
  assert.equal(parseAddress('').zone, '');
});

test('planStops: agrupa por região (ordem alfabética), depois CEP, rua e número; sem CEP vai para o fim da região', () => {
  const s = (id: string, number: number, address: string) => ({ id, number, address });
  const r = planStops([
    s('a', 1001, 'Rua Z, 10, Vila Nova, Franca-SP, CEP 14500-000 — Centro'),
    s('b', 1002, 'Rua A, 50, Jardim Palma, Franca-SP, CEP 14402-151 — Centro'),
    s('c', 1003, 'Rua do Ipê 7 — Centro'),                                         // à mão, sem CEP
    s('d', 1004, 'Rua B, 3, Bairro X, Franca-SP, CEP 14100-000 — Bairros vizinhos'),
    s('e', 1005, 'Rua A, 20, Jardim Palma, Franca-SP, CEP 14402-151 — Centro'),    // mesma rua e CEP do 'b', número menor
  ]);
  assert.deepEqual(r.map((x) => x.id), ['d', 'e', 'b', 'a', 'c']);
  assert.deepEqual(r.map((x) => x.group), ['Bairro X', 'Jardim Palma', 'Jardim Palma', 'Vila Nova', 'Centro']);
});

test('planStops: mesmo endereço fica junto e desempata pelo número do pedido; lista vazia e de um', () => {
  const r = planStops([{ id: 'x', number: 1010, address: 'Rua A, 5 — Z' }, { id: 'y', number: 1009, address: 'Rua A, 5 — Z' }]);
  assert.deepEqual(r.map((x) => x.id), ['y', 'x']);
  assert.deepEqual(planStops([]), []); assert.equal(planStops([{ id: 'q', number: 1, address: 'Rua A, 1' }]).length, 1);
});

test('mapsRouteUrl: destino é a última parada, as outras viram waypoints, sem a região, no máximo 10 pontos', () => {
  assert.equal(mapsRouteUrl([]), null);
  assert.equal(mapsRouteUrl(['Rua A, 1 — Centro']), 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=Rua%20A%2C%201');
  const u = mapsRouteUrl(['Rua A, 1 — Centro', 'Rua B, 2', 'Rua C, 3'])!;
  assert.ok(u.includes('destination=Rua%20C%2C%203') && u.includes('waypoints=Rua%20A%2C%201%7CRua%20B%2C%202'));
  const many = mapsRouteUrl(Array.from({ length: 15 }, (_, i) => `Rua ${i}, 1`))!;
  assert.equal(many.split('%7C').length, 9);                                      // 9 intermediários + destino = 10 pontos
});
