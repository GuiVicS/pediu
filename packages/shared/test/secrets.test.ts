import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, generateRecoveryCodes, generateToken, hashPassword, hashToken, parseKeyring, verifyPassword } from '../src/index.js';

const key = () => randomBytes(32).toString('base64');

test('senha: confere a certa, recusa a errada, e cada hash é único', async () => {
  const h1 = await hashPassword('correto cavalo');
  const h2 = await hashPassword('correto cavalo');
  assert.notEqual(h1, h2);
  assert.equal(await verifyPassword('correto cavalo', h1), true);
  assert.equal(await verifyPassword('errada', h1), false);
  assert.equal(await verifyPassword('x', 'lixo'), false);
});

test('token: devolve o hash sha256 e guarda só os 4 últimos como dica', () => {
  const t = generateToken('pmcp');
  assert.match(t.token, /^pmcp_/);
  assert.equal(t.hash, hashToken(t.token));
  assert.equal(t.hint, t.token.slice(-4));
});

test('códigos de recuperação: 10, formato xxxxx-xxxxx, hashes correspondem', () => {
  const { codes, hashes } = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  codes.forEach((c, i) => { assert.match(c, /^[0-9a-f]{5}-[0-9a-f]{5}$/); assert.equal(hashToken(c), hashes[i]); });
});

test('cofre: cifra e decifra; chave errada ou adulteração falham', () => {
  const ring = parseKeyring(`k1:${key()}`);
  const blob = encryptSecret('sk_live_segredo', ring);
  assert.equal(decryptSecret(blob, ring), 'sk_live_segredo');
  assert.notEqual(encryptSecret('sk_live_segredo', ring), blob); // IV novo a cada vez
  assert.throws(() => decryptSecret(blob, parseKeyring(`k1:${key()}`)));
  const parts = blob.split(':'); parts[4] = Buffer.from('adulterado').toString('base64');
  assert.throws(() => decryptSecret(parts.join(':'), ring));
});

test('cofre: rotação — chave nova cifra, a antiga ainda decifra', () => {
  const k1 = key(), k2 = key();
  const antigo = encryptSecret('abc', parseKeyring(`k1:${k1}`));
  const ring = parseKeyring(`k2:${k2},k1:${k1}`);
  assert.equal(ring.current, 'k2');
  assert.equal(decryptSecret(antigo, ring), 'abc');
  assert.match(encryptSecret('abc', ring), /^v1:k2:/);
});

test('keyring recusa chave com tamanho errado', () => {
  assert.throws(() => parseKeyring('k1:' + Buffer.from('curta').toString('base64')));
  assert.throws(() => parseKeyring(''));
});
