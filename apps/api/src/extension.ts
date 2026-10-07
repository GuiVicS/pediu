import { randomInt } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@pediu/db';
import { generateToken, hashToken, type Role } from '@pediu/shared';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { staffGuard } from './staff.js';

export const PAIRING_TTL_MS = 5 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I
const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const normalizeCode = (c: string) => c.toUpperCase().replace(/[\s-]/g, '');

export interface ExtensionDevice { deviceId: string; staffId: string; tenantId: string; storeId: string; role: Role; storeName: string }
declare module 'fastify' { interface FastifyRequest { extension?: ExtensionDevice } }

/** Valida a credencial da extensão (Bearer) em cada chamada; a loja vem sempre dela, nunca do pedido. */
export function extensionGuard(ctx: Ctx): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest, reply) => {
    const m = /^Bearer (pext_[A-Za-z0-9_-]{20,100})$/.exec(String(req.headers.authorization ?? ''));
    const [r] = m ? await ctx.pools.app.begin((q) => q`select * from app.extension_device(${hashToken(m[1]!)}, ${ctx.clock.now().toISOString()}::timestamptz)`) : [];
    if (!r) return fail(reply, 401, 'unauthenticated', 'Extensão não conectada. Gere um novo código no painel.');
    req.extension = { deviceId: r.device_id, staffId: r.staff_id, tenantId: r.tenant_id, storeId: r.store_id, role: r.role, storeName: r.store_name };
  };
}

export function extensionRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---- lojista logado no painel gera o código de pareamento (uso único, 5 min) ----
  app.post('/v1/staff/extension/pairing', { preHandler: staffGuard(ctx, 'admin.pedidos'), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const s = req.staff!;
    const code = newCode();
    const expires = new Date(ctx.clock.now().getTime() + PAIRING_TTL_MS).toISOString();
    const ok = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [f] = await q`select 1 as ok from store_features where store_id = ${s.storeId} and feature = 'whatsapp_support' and enabled`;
      if (!f) return false;
      // um código ativo por pessoa: o anterior deixa de valer
      await q`update extension_pairings set used_at = now() where staff_id = ${s.staffId} and used_at is null`;
      await q`insert into extension_pairings (tenant_id, store_id, staff_id, session_id, code_hash, expires_at) values (${s.tenantId}, ${s.storeId}, ${s.staffId}, ${s.id}, ${hashToken(code)}, ${expires})`;
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'extension.pairing_created', ip: req.ip });
      return true;
    });
    if (!ok) return fail(reply, 403, 'feature_disabled', 'O atendimento por WhatsApp não está liberado para esta loja.');
    return { code, expiresAt: expires };
  });

  // ---- a extensão troca o código pela credencial dela ----
  app.post('/v1/extension/pair', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({ code: z.string().min(8).max(12), name: z.string().trim().max(80).default('Chrome') }), req.body, reply); if (!b) return;
    const t = generateToken('pext');
    const [r] = await ctx.pools.app.begin((q) => q`select * from app.extension_pair(${hashToken(normalizeCode(b.code))}, ${t.hash}, ${b.name}, ${ctx.clock.now().toISOString()}::timestamptz)`);
    if (!r) return fail(reply, 400, 'invalid_code', 'Código inválido, vencido ou já usado.');
    await withTenant(ctx.pools, r.tenant_id, (q) => audit(q, { actorKind: 'staff', tenantId: r.tenant_id, storeId: r.store_id, action: 'extension.paired', ip: req.ip, meta: { deviceId: r.device_id, name: b.name } }));
    return reply.status(201).send({ token: t.token, storeName: r.store_name });
  });

  app.get('/v1/extension/me', { preHandler: extensionGuard(ctx) }, async (req) => {
    const e = req.extension!;
    const rows = await withTenant(ctx.pools, e.tenantId, (q) => q`select feature from store_features where store_id = ${e.storeId} and enabled`);
    return { storeName: e.storeName, features: rows.map((r) => r.feature as string) };
  });

  // ---- gestão dos dispositivos pelo lojista ----
  app.get('/v1/staff/extension/devices', { preHandler: staffGuard(ctx, 'admin.pedidos') }, async (req) => {
    const s = req.staff!;
    return { devices: await withTenant(ctx.pools, s.tenantId, (q) => q`
      select d.id, d.name, d.created_at, d.last_seen_at, u.name as staff_name from extension_devices d join staff_users u on u.id = d.staff_id
      where d.store_id = ${s.storeId} and d.revoked_at is null order by d.created_at desc`) };
  });

  app.delete('/v1/staff/extension/devices/:id', { preHandler: staffGuard(ctx, 'admin.pedidos') }, async (req, reply) => {
    const id = parse(z.string().uuid(), (req.params as { id: string }).id, reply); if (!id) return;
    const s = req.staff!;
    const n = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const r = await q`update extension_devices set revoked_at = now() where id = ${id} and store_id = ${s.storeId} and revoked_at is null returning id`;
      if (r.length) await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'extension.device_revoked', ip: req.ip, meta: { deviceId: id } });
      return r.length;
    });
    return n ? { ok: true } : fail(reply, 404, 'not_found', 'Dispositivo não encontrado.');
  });
}
