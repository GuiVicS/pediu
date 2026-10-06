import type { FastifyReply } from 'fastify';
import { z, type ZodTypeAny } from 'zod';
import type { Q } from '@pediu/db';

export const fail = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.status(status).send({ error: { code, message } });

/** Valida o corpo/params; em caso de erro já responde 400 e devolve null. */
export function parse<T extends ZodTypeAny>(schema: T, data: unknown, reply: FastifyReply): z.infer<T> | null {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  fail(reply, 400, 'invalid_input', r.error.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`).join('; '));
  return null;
}

export interface AuditEntry {
  actorKind: 'superadmin' | 'mcp' | 'staff' | 'billing' | 'system';
  actorId?: string | null; tenantId?: string | null; storeId?: string | null;
  action: string; ip?: string | null; before?: unknown; after?: unknown; meta?: unknown;
}
const j = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

export const audit = (q: Q, e: AuditEntry) => q`
  insert into audit_logs (actor_kind, actor_id, tenant_id, store_id, action, ip, before, after, meta)
  values (${e.actorKind}, ${e.actorId ?? null}, ${e.tenantId ?? null}, ${e.storeId ?? null}, ${e.action}, ${e.ip ?? null},
          ${j(e.before)}::jsonb, ${j(e.after)}::jsonb, ${j(e.meta)}::jsonb)`;
