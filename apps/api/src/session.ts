import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { hashToken } from '@pediu/shared';
import { withPlatform } from '@pediu/db';
import { SESSION_COOKIE, SESSION_IDLE_MS, SESSION_TTL_MS, type Ctx } from './context.js';
import { fail } from './http.js';

export interface PlatformSession {
  id: string; adminId: string; email: string; name: string;
  totpEnabled: boolean; totpVerified: boolean; stepUpUntil: Date | null;
}
declare module 'fastify' { interface FastifyRequest { session?: PlatformSession } }

export async function createSession(ctx: Ctx, adminId: string, req: FastifyRequest, reply: FastifyReply) {
  const token = randomBytes(32).toString('base64url');
  const now = ctx.clock.now();
  await withPlatform(ctx.pools, (q) => q`
    insert into platform_sessions (admin_id, token_hash, ip, user_agent, expires_at, created_at, last_seen_at)
    values (${adminId}, ${hashToken(token)}, ${req.ip ?? null}, ${String(req.headers['user-agent'] ?? '').slice(0, 300)},
            ${new Date(now.getTime() + SESSION_TTL_MS).toISOString()}, ${now.toISOString()}, ${now.toISOString()})`);
  reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: ctx.cookieSecure, path: '/', maxAge: SESSION_TTL_MS / 1000 });
}

export async function loadSession(ctx: Ctx, req: FastifyRequest): Promise<PlatformSession | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const now = ctx.clock.now();
  const rows = await withPlatform(ctx.pools, async (q) => {
    const r = await q`
      select s.id, s.admin_id, s.totp_verified, s.stepup_until, a.email, a.name, a.totp_enabled
      from platform_sessions s join platform_admins a on a.id = s.admin_id
      where s.token_hash = ${hashToken(token)} and s.revoked_at is null
        and s.expires_at > ${now.toISOString()}::timestamptz
        and s.last_seen_at > ${new Date(now.getTime() - SESSION_IDLE_MS).toISOString()}::timestamptz`;
    if (r[0]) await q`update platform_sessions set last_seen_at = ${now.toISOString()} where id = ${r[0].id}`;
    return r;
  });
  const s = rows[0];
  if (!s) return null;
  return {
    id: s.id, adminId: s.admin_id, email: s.email, name: s.name, totpEnabled: s.totp_enabled,
    totpVerified: s.totp_verified, stepUpUntil: s.stepup_until ? new Date(s.stepup_until) : null,
  };
}

/**
 * Proteção de rota. Padrão: sessão com 2º fator concluído. `pending` aceita a sessão só com senha (telas de autenticador).
 * `stepUp` exige que o código tenha sido reconfirmado nos últimos 5 minutos.
 */
export function guard(ctx: Ctx, opts: { pending?: boolean; stepUp?: boolean } = {}): preHandlerAsyncHookHandler {
  return async (req, reply) => {
    const s = await loadSession(ctx, req);
    if (!s) return fail(reply, 401, 'unauthenticated', 'Entre para continuar.');
    req.session = s;
    if (!opts.pending && !s.totpVerified) return fail(reply, 403, 'totp_required', 'Conclua o código do autenticador.');
    if (opts.stepUp && !(s.stepUpUntil && s.stepUpUntil.getTime() > ctx.clock.now().getTime())) {
      return fail(reply, 403, 'stepup_required', 'Confirme novamente com o código do autenticador para esta ação.');
    }
  };
}
