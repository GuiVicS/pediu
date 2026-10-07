import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLink, normalizeBase, pair, type Fetch } from '../src/api.js';

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test('normalizeBase aceita https e localhost, rejeita o resto', () => {
  assert.equal(normalizeBase(' https://app.exemplo.com/painel '), 'https://app.exemplo.com');
  assert.equal(normalizeBase('http://localhost:3000/x'), 'http://localhost:3000');
  assert.equal(normalizeBase('http://exemplo.com'), null);
  assert.equal(normalizeBase('javascript:alert(1)'), null);
  assert.equal(normalizeBase('texto'), null);
});

test('pair devolve a credencial ou a mensagem de erro da API', async () => {
  const ok: Fetch = async () => res(201, { token: 'pext_x', storeName: 'Loja' });
  assert.deepEqual(await pair(ok, 'https://a.com', ' ABC ', 'Chrome'), { apiBase: 'https://a.com', token: 'pext_x', storeName: 'Loja' });
  const bad: Fetch = async () => res(400, { error: { message: 'Código inválido, vencido ou já usado.' } });
  await assert.rejects(pair(bad, 'https://a.com', 'X', 'Chrome'), /inválido/);
});

test('checkLink distingue revogado de offline', async () => {
  const link = { apiBase: 'https://a.com', token: 'pext_x', storeName: 'L' };
  assert.deepEqual(await checkLink(async () => res(401, {}), link), { state: 'revoked' });
  assert.deepEqual(await checkLink(async () => res(200, { features: ['whatsapp_support'] }), link), { state: 'ok', features: ['whatsapp_support'] });
  assert.deepEqual(await checkLink(async () => { throw new Error('rede'); }, link), { state: 'offline' });
  assert.deepEqual(await checkLink(async () => res(500, {}), link), { state: 'offline' });
});
