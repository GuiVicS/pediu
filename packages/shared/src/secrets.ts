import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

// ---- senhas: scrypt (node:crypto, sem dependência nativa) ----
const N = 2 ** 15, R = 8, P = 1;
const MAXMEM = 128 * 1024 * 1024; // 128*N*r = 32 MiB: o limite padrão do Node é exatamente esse
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p, maxmem: MAXMEM });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// ---- tokens e códigos de recuperação: só o hash vai para o banco ----
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function generateToken(prefix: string): { token: string; hash: string; hint: string } {
  const token = `${prefix}_${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashToken(token), hint: token.slice(-4) };
}

export function generateRecoveryCodes(n = 10): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: n }, () => {
    const raw = randomBytes(5).toString('hex');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map(hashToken) };
}

// ---- cofre de credenciais (Mercado Pago, Sicoob, iFood, Focus, Stripe): AES-256-GCM com id de chave para rotação ----
export type Keyring = Record<string, Buffer>;

/** Lê SECRETS_KEYS="kid1:<base64 de 32 bytes>,kid2:..."; a primeira chave é a usada para cifrar. */
export function parseKeyring(env: string): { keys: Keyring; current: string } {
  const keys: Keyring = {};
  let current = '';
  for (const part of env.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [kid, b64] = part.split(':');
    const key = Buffer.from(b64 ?? '', 'base64');
    if (!kid || key.length !== 32) throw new Error('SECRETS_KEYS inválido: cada chave precisa de id e 32 bytes em base64');
    keys[kid] = key;
    current ||= kid;
  }
  if (!current) throw new Error('SECRETS_KEYS vazio');
  return { keys, current };
}

export function encryptSecret(plain: string, ring: { keys: Keyring; current: string }): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', ring.keys[ring.current]!, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', ring.current, iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(blob: string, ring: { keys: Keyring }): string {
  const [v, kid, iv, tag, ct] = blob.split(':');
  const key = kid ? ring.keys[kid] : undefined;
  if (v !== 'v1' || !key || !iv || !tag || !ct) throw new Error('Segredo cifrado inválido ou chave desconhecida');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
