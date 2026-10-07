import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL, normalizeMessage, parseEnvelope } from '../src/protocol.js';

test('normaliza texto, áudio e imagem', () => {
  const base = { id: { _serialized: 'a', fromMe: false }, from: { _serialized: '55119@c.us' }, t: 10 };
  assert.equal(normalizeMessage({ ...base, type: 'chat', body: 'oi' })?.kind, 'text');
  assert.equal(normalizeMessage({ ...base, type: 'ptt', mimetype: 'audio/ogg; codecs=opus' })?.kind, 'audio');
  const img = normalizeMessage({ ...base, type: 'image', mimetype: 'image/jpeg', caption: 'foto' });
  assert.equal(img?.kind, 'image');
  assert.equal(img?.text, 'foto');
});

test('rejeita mensagem sem id ou chat', () => {
  assert.equal(normalizeMessage({ type: 'chat' }), null);
  assert.equal(normalizeMessage(null), null);
});

test('marca mensagens próprias', () => {
  const m = normalizeMessage({ id: { _serialized: 'b', fromMe: true }, from: '1@c.us', type: 'chat', body: 'x' });
  assert.equal(m?.fromMe, true);
});

test('envelope exige canal e tipo conhecido', () => {
  assert.equal(parseEnvelope({ event: { type: 'ready' } }), null);
  assert.equal(parseEnvelope({ channel: CHANNEL, event: { type: 'send', to: 'x' } }), null);
  assert.deepEqual(parseEnvelope({ channel: CHANNEL, event: { type: 'disconnected' } }), { type: 'disconnected' });
  assert.equal(parseEnvelope({ channel: CHANNEL, event: { type: 'message', message: { id: 1 } } }), null);
});

test('trunca texto longo', () => {
  const e = parseEnvelope({ channel: CHANNEL, event: { type: 'message', message: { id: 'a', chatId: 'b', kind: 'text', text: 'x'.repeat(9000) } } });
  assert.equal(e?.type === 'message' && e.message.text.length, 4096);
});
