import test from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, hotp, totpAt, verifyTotp, generateTotpSecret } from '../src/index.js';

// Vetores do RFC 4226 (HOTP) e RFC 6238 (TOTP, SHA-1, segredo "12345678901234567890").
const SECRET = Buffer.from('12345678901234567890');
const SECRET_B32 = base32Encode(SECRET);

test('HOTP bate com os vetores do RFC 4226', () => {
  const esperado = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  esperado.forEach((code, i) => assert.equal(hotp(SECRET, i), code));
});

test('TOTP bate com os vetores do RFC 6238 (8 dígitos)', () => {
  assert.equal(totpAt(SECRET_B32, 59_000, 8), '94287082');
  assert.equal(totpAt(SECRET_B32, 1_111_111_109_000, 8), '07081804');
  assert.equal(totpAt(SECRET_B32, 20_000_000_000_000, 8), '65353130');
});

test('base32 faz ida e volta', () => {
  const s = generateTotpSecret();
  assert.equal(base32Encode(base32Decode(s)), s);
  assert.throws(() => base32Decode('1!!'));
});

test('verifyTotp aceita ±1 passo e recusa fora da janela', () => {
  const now = 1_700_000_000_000;
  const code = totpAt(SECRET_B32, now);
  assert.equal(verifyTotp(SECRET_B32, code, { nowMs: now }).ok, true);
  assert.equal(verifyTotp(SECRET_B32, code, { nowMs: now + 30_000 }).ok, true);
  assert.equal(verifyTotp(SECRET_B32, code, { nowMs: now + 90_000 }).ok, false);
  assert.equal(verifyTotp(SECRET_B32, '12345', { nowMs: now }).ok, false);
  assert.equal(verifyTotp(SECRET_B32, 'abcdef', { nowMs: now }).ok, false);
});

test('verifyTotp não deixa reutilizar o mesmo código (anti-replay)', () => {
  const now = 1_700_000_000_000;
  const code = totpAt(SECRET_B32, now);
  const first = verifyTotp(SECRET_B32, code, { nowMs: now });
  assert.ok(first.ok);
  assert.equal(verifyTotp(SECRET_B32, code, { nowMs: now, lastUsedStep: first.step }).ok, false);
});
