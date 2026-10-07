import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withPlatform, type Q } from '@pediu/db';
import {
  decryptSecret, encryptSecret, generateRecoveryCodes, generateTotpSecret, hashPassword, hashToken, otpauthUrl, verifyPassword, verifyTotp,
} from '@pediu/shared';
import { LOCK_MS, MAX_FAILED, SESSION_COOKIE, STEPUP_TTL_MS, type Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { createSession, guard } from './session.js';

const ISSUER = 'PediuLanchou';
let dummyHash: Promise<string> | undefined; // evita revelar por tempo de resposta se o e-mail existe

/** Confere o código TOTP com anti-replay. Grava o passo usado (dentro da transação do chamador). */
async function checkTotp(ctx: Ctx, q: Q, adminId: string, code: string) {
  const [a] = await q`select totp_secret_enc, totp_last_step from platform_admins where id = ${adminId} for update`;
  if (!a?.totp_secret_enc) return false;
  const r = verifyTotp(decryptSecret(a.totp_secret_enc, ctx.ring), code, { nowMs: ctx.clock.now().getTime(), lastUsedStep: a.totp_last_step == null ? null : Number(a.totp_last_step) });
  if (!r.ok) return false;
  await q`update platform_admins set totp_last_step = ${r.step} where id = ${adminId}`;
  return true;
}

/** Contabiliza falha e bloqueia a conta por 15 min a partir da 5ª. */
async function registerFailure(ctx: Ctx, q: Q, adminId: string, ip: string, why: string) {
  const [a] = await q`
    update platform_admins set failed_attempts = failed_attempts + 1,
      locked_until = case when failed_attempts + 1 >= ${MAX_FAILED} then ${new Date(ctx.clock.now().getTime() + LOCK_MS).toISOString()}::timestamptz else locked_until end
    where id = ${adminId} returning failed_attempts`;
  await audit(q, { actorKind: 'superadmin', actorId: adminId, action: 'auth.failed', ip, meta: { why, attempts: a?.failed_attempts } });
}

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const P = '/v1/platform/auth';
  const code6 = z.object({ code: z.string().trim().min(6).max(11) });

  app.post(`${P}/login`, { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(z.object({ email: z.string().email().transform((s) => s.toLowerCase()), password: z.string().min(1).max(200) }), req.body, reply);
    if (!body) return;
    const now = ctx.clock.now();
    const out = await withPlatform(ctx.pools, async (q) => {
      const [a] = await q`select * from platform_admins where email = ${body.email} for update`;
      if (!a) { await verifyPassword(body.password, await (dummyHash ??= hashPassword('dummy'))); return { error: 'invalid' as const }; }
      if (a.locked_until && new Date(a.locked_until) > now) return { error: 'locked' as const };
      if (!(await verifyPassword(body.password, a.password_hash))) { await registerFailure(ctx, q, a.id, req.ip, 'password'); return { error: 'invalid' as const }; }
      await q`update platform_admins set failed_attempts = 0, locked_until = null where id = ${a.id}`;
      await audit(q, { actorKind: 'superadmin', actorId: a.id, action: 'auth.login_password', ip: req.ip });
      return { admin: a };
    });
    if ('error' in out) {
      return out.error === 'locked'
        ? fail(reply, 423, 'locked', 'Conta bloqueada por tentativas erradas. Tente novamente em 15 minutos.')
        : fail(reply, 401, 'invalid_credentials', 'E-mail ou senha incorretos.');
    }
    await createSession(ctx, out.admin.id, req, reply);
    return { next: out.admin.totp_enabled ? 'totp' : 'enroll' };
  });

  // 1º acesso: gera o segredo e mostra o QR (não ativa até confirmar o primeiro código)
  app.post(`${P}/totp/enroll`, { preHandler: guard(ctx, { pending: true }) }, async (req, reply) => {
    const s = req.session!;
    if (s.totpEnabled) return fail(reply, 409, 'already_enabled', 'O autenticador já está ativo.');
    const secret = generateTotpSecret();
    await withPlatform(ctx.pools, (q) => q`update platform_admins set totp_secret_enc = ${encryptSecret(secret, ctx.ring)}, totp_last_step = null where id = ${s.adminId}`);
    return { secret, otpauthUrl: otpauthUrl(s.email, ISSUER, secret) };
  });

  app.post(`${P}/totp/confirm`, { preHandler: guard(ctx, { pending: true }), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(code6, req.body, reply); if (!body) return;
    const s = req.session!;
    const out = await withPlatform(ctx.pools, async (q) => {
      const [a] = await q`select totp_enabled from platform_admins where id = ${s.adminId}`;
      if (a?.totp_enabled) return { error: 'already' as const };
      if (!(await checkTotp(ctx, q, s.adminId, body.code))) { await registerFailure(ctx, q, s.adminId, req.ip, 'totp_confirm'); return { error: 'bad' as const }; }
      const { codes, hashes } = generateRecoveryCodes();
      await q`delete from platform_recovery_codes where admin_id = ${s.adminId}`;
      for (const h of hashes) await q`insert into platform_recovery_codes (admin_id, code_hash) values (${s.adminId}, ${h})`;
      await q`update platform_admins set totp_enabled = true where id = ${s.adminId}`;
      await q`update platform_sessions set totp_verified = true where id = ${s.id}`;
      await audit(q, { actorKind: 'superadmin', actorId: s.adminId, action: 'auth.totp_enabled', ip: req.ip });
      return { codes };
    });
    if ('error' in out) return out.error === 'already' ? fail(reply, 409, 'already_enabled', 'O autenticador já está ativo.') : fail(reply, 401, 'invalid_code', 'Código incorreto.');
    return { recoveryCodes: out.codes };
  });

  // login: segundo fator (código do app ou um código de recuperação de uso único)
  app.post(`${P}/totp/verify`, { preHandler: guard(ctx, { pending: true }), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(code6, req.body, reply); if (!body) return;
    const s = req.session!;
    const ok = await withPlatform(ctx.pools, async (q) => {
      let good = false, via = 'totp';
      if (/^\d{6}$/.test(body.code)) good = await checkTotp(ctx, q, s.adminId, body.code);
      else if (/^[0-9a-f]{5}-[0-9a-f]{5}$/i.test(body.code)) {
        const used = await q`update platform_recovery_codes set used_at = now() where admin_id = ${s.adminId} and code_hash = ${hashToken(body.code.toLowerCase())} and used_at is null returning id`;
        good = used.length === 1; via = 'recovery';
      }
      if (!good) { await registerFailure(ctx, q, s.adminId, req.ip, 'totp_verify'); return false; }
      await q`update platform_admins set failed_attempts = 0, locked_until = null where id = ${s.adminId}`;
      await q`update platform_sessions set totp_verified = true where id = ${s.id}`;
      await audit(q, { actorKind: 'superadmin', actorId: s.adminId, action: 'auth.login_totp', ip: req.ip, meta: { via } });
      return true;
    });
    return ok ? { ok: true } : fail(reply, 401, 'invalid_code', 'Código incorreto.');
  });

  // reconfirmação (step-up): libera ações sensíveis por 5 minutos
  app.post(`${P}/stepup`, { preHandler: guard(ctx), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(z.object({ code: z.string().regex(/^\d{6}$/, 'Informe o código de 6 dígitos') }), req.body, reply); if (!body) return;
    const s = req.session!;
    const until = new Date(ctx.clock.now().getTime() + STEPUP_TTL_MS);
    const ok = await withPlatform(ctx.pools, async (q) => {
      if (!(await checkTotp(ctx, q, s.adminId, body.code))) { await registerFailure(ctx, q, s.adminId, req.ip, 'stepup'); return false; }
      await q`update platform_sessions set stepup_until = ${until.toISOString()} where id = ${s.id}`;
      await audit(q, { actorKind: 'superadmin', actorId: s.adminId, action: 'auth.stepup', ip: req.ip });
      return true;
    });
    return ok ? { ok: true, until: until.toISOString() } : fail(reply, 401, 'invalid_code', 'Código incorreto (ou já usado: aguarde o próximo código do app).');
  });

  app.get(`${P}/me`, { preHandler: guard(ctx, { pending: true }) }, async (req) => {
    const s = req.session!;
    return { email: s.email, name: s.name, totpEnabled: s.totpEnabled, totpVerified: s.totpVerified, stepUpUntil: s.stepUpUntil };
  });

  app.post(`${P}/logout`, async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await withPlatform(ctx.pools, (q) => q`update platform_sessions set revoked_at = now() where token_hash = ${hashToken(token)}`);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get(`${P}/sessions`, { preHandler: guard(ctx) }, async (req) => {
    const s = req.session!;
    const rows = await withPlatform(ctx.pools, (q) => q`
      select id, ip::text as ip, user_agent, created_at, last_seen_at, expires_at from platform_sessions
      where admin_id = ${s.adminId} and revoked_at is null and expires_at > ${ctx.clock.now().toISOString()}::timestamptz order by created_at desc`);
    return { sessions: rows.map((r) => ({ ...r, current: r.id === s.id })) };
  });

  // encerra todas as outras sessões (ou todas, com all=true)
  app.post(`${P}/sessions/revoke-others`, { preHandler: guard(ctx) }, async (req) => {
    const s = req.session!;
    const rows = await withPlatform(ctx.pools, (q) => q`update platform_sessions set revoked_at = now() where admin_id = ${s.adminId} and id <> ${s.id} and revoked_at is null returning id`);
    return { revoked: rows.length };
  });
}
