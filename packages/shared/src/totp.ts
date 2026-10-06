import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').replace(/\s/g, '').toUpperCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Segredo base32 inválido');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));

/** HOTP (RFC 4226) e TOTP (RFC 6238, HMAC-SHA1, janela de 30 s). */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1]! & 0x0f;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const totpStep = (nowMs: number, period = 30) => Math.floor(nowMs / 1000 / period);
export const totpAt = (secretB32: string, nowMs: number, digits = 6, period = 30) => hotp(base32Decode(secretB32), totpStep(nowMs, period), digits);

export interface VerifyOptions { nowMs?: number; window?: number; lastUsedStep?: number | null }
export type VerifyResult = { ok: true; step: number } | { ok: false };

/**
 * Confere o código com tolerância de ±window passos. `lastUsedStep` impede reutilizar o mesmo código
 * (ou um mais antigo): quem chama grava o `step` devolvido.
 */
export function verifyTotp(secretB32: string, code: string, opts: VerifyOptions = {}): VerifyResult {
  if (!/^\d{6}$/.test(code)) return { ok: false };
  const now = totpStep(opts.nowMs ?? Date.now());
  const secret = base32Decode(secretB32);
  const win = opts.window ?? 1;
  for (let step = now - win; step <= now + win; step++) {
    if (opts.lastUsedStep != null && step <= opts.lastUsedStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return { ok: true, step };
  }
  return { ok: false };
}

export const otpauthUrl = (account: string, issuer: string, secretB32: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
