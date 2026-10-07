import test from 'node:test';
import assert from 'node:assert/strict';
import { BridgeError, tickBroadcast, type BroadcastDeps } from '../src/broadcast.js';

function make(send: BroadcastDeps['send'], features = ['broadcasts']) {
  const results: [string, string, string?][] = [];
  const d: BroadcastDeps = {
    features: () => new Set(features),
    api: { async nextBroadcast() { return { none: false, recipientId: 'r1', phone: '5516999991111', text: 'oi' }; }, async broadcastResult(id, st, err) { results.push([id, st, err]); } },
    send,
  };
  return { d, results };
}

test('envia para um número novo e reporta sucesso', async () => {
  let args: unknown[] = [];
  const { d, results } = make(async (...a) => { args = a; return 'id'; });
  assert.equal(await tickBroadcast(d), true);
  assert.deepEqual(args, ['5516999991111@c.us', 'oi', true]); assert.deepEqual(results, [['r1', 'enviada', undefined]]);
});

test('falha definitiva é reportada; dúvida (tempo esgotado) não é reportada para não virar reenvio', async () => {
  const f = make(async () => { throw new BridgeError('número inválido', false); });
  assert.equal(await tickBroadcast(f.d), false); assert.equal(f.results[0]![1], 'falhou');
  const u = make(async () => { throw new BridgeError('timeout', true); });
  assert.equal(await tickBroadcast(u.d), false); assert.equal(u.results.length, 0);
});

test('sem a funcionalidade não pede destinatário', async () => {
  const { d, results } = make(async () => 'x', []);
  assert.equal(await tickBroadcast(d), false); assert.equal(results.length, 0);
});
