import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withPlatform, type Q } from '@pediu/db';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { guard } from './session.js';
import { percentileFromBuckets } from './telemetry.js';
import { explainAlert } from './alertExplain.js';

const uuid = z.string().uuid();
const iso = (d: Date) => d.toISOString();

export interface Finding { dedupeKey: string; tenantId?: string | null; storeId?: string | null; title: string; detail: Record<string, unknown> }
export interface AlertNotice { id: string; ruleKey: string; severity: string; title: string; storeId: string | null; detail: unknown; occurrences: number }
export type Notifier = (n: AlertNotice) => Promise<void>;

type Rule = { key: string; params: Record<string, number>; };
type Checker = (q: Q, now: Date, p: Record<string, number>) => Promise<Finding[]>;

/** Cada regra devolve as condições que estão verdadeiras AGORA. O motor abre, atualiza e resolve sozinho. */
const CHECKS: Record<string, Checker> = {
  async 'store.no_orders'(q, now, p) {
    const since = iso(new Date(now.getTime() - p.hours! * 3_600_000)), prevFrom = iso(new Date(now.getTime() - (p.hours! + p.prev_days! * 24) * 3_600_000));
    const rows = await q`select s.id, s.tenant_id, s.name,
        (select count(*) from orders o where o.store_id = s.id and o.created_at >= ${prevFrom}::timestamptz and o.created_at < ${since}::timestamptz and o.status <> 'cancelado')::int as before,
        (select count(*) from orders o where o.store_id = s.id and o.created_at >= ${since}::timestamptz)::int as recent
      from stores s where s.status = 'producao'`;
    return rows.filter((r) => r.recent === 0 && r.before >= p.min_prev_orders!).map((r) => ({ dedupeKey: `store.no_orders:${r.id}`, tenantId: r.tenant_id, storeId: r.id,
      title: `${r.name}: sem pedidos há ${p.hours}h`, detail: { hours: p.hours, ordersBefore: r.before } }));
  },
  async 'store.cancel_rate'(q, now, p) {
    const since = iso(new Date(now.getTime() - p.window_hours! * 3_600_000));
    const rows = await q`select s.id, s.tenant_id, s.name, count(*)::int as n, count(*) filter (where o.status = 'cancelado')::int as c
      from orders o join stores s on s.id = o.store_id where o.created_at >= ${since}::timestamptz group by s.id, s.tenant_id, s.name`;
    return rows.filter((r) => r.n >= p.min_orders! && r.c / r.n > p.max_rate!).map((r) => ({ dedupeKey: `store.cancel_rate:${r.id}`, tenantId: r.tenant_id, storeId: r.id,
      title: `${r.name}: ${Math.round((r.c / r.n) * 100)}% de cancelamentos`, detail: { orders: r.n, cancelled: r.c, rate: Math.round((r.c / r.n) * 1000) / 1000 } }));
  },
  async 'store.slow_prep'(q, now, p) {
    const since = iso(new Date(now.getTime() - p.window_hours! * 3_600_000));
    const rows = await q`select s.id, s.tenant_id, s.name, count(*)::int as n, avg(extract(epoch from (o.ready_at - o.accepted_at)) / 60)::float as avg_min
      from orders o join stores s on s.id = o.store_id where o.created_at >= ${since}::timestamptz and o.ready_at is not null and o.accepted_at is not null group by s.id, s.tenant_id, s.name`;
    return rows.filter((r) => r.n >= p.min_orders! && r.avg_min > p.max_avg_minutes!).map((r) => ({ dedupeKey: `store.slow_prep:${r.id}`, tenantId: r.tenant_id, storeId: r.id,
      title: `${r.name}: preparo médio de ${Math.round(r.avg_min)} min`, detail: { orders: r.n, avgMinutes: Math.round(r.avg_min * 10) / 10 } }));
  },
  async 'store.order_stuck'(q, now, p) {
    const limit = iso(new Date(now.getTime() - p.max_minutes! * 60_000));
    const rows = await q`select s.id, s.tenant_id, s.name, count(*)::int as n, min(o.created_at) as oldest from orders o join stores s on s.id = o.store_id
      where o.status = 'novo' and o.created_at < ${limit}::timestamptz group by s.id, s.tenant_id, s.name`;
    return rows.map((r) => ({ dedupeKey: `store.order_stuck:${r.id}`, tenantId: r.tenant_id, storeId: r.id, title: `${r.name}: ${r.n} pedido(s) sem aceite`, detail: { orders: r.n, oldest: r.oldest } }));
  },
  async 'platform.api_errors'(q, now, p) {
    const since = iso(new Date(now.getTime() - p.window_min! * 60_000));
    const [r] = await q`select coalesce(sum(count), 0)::int as n, coalesce(sum(errors), 0)::int as e from metrics_minute where scope in ('platform', 'store', 'webhook') and bucket >= ${since}::timestamptz`;
    return r!.n >= p.min_requests! && r!.e / r!.n > p.max_rate! ? [{ dedupeKey: 'platform.api_errors', title: `API com ${Math.round((r!.e / r!.n) * 1000) / 10}% de erros 5xx`, detail: { requests: r!.n, errors: r!.e } }] : [];
  },
  async 'platform.api_latency'(q, now, p) {
    const since = iso(new Date(now.getTime() - p.window_min! * 60_000));
    const [r] = await q`select coalesce(sum(count), 0)::int as n, coalesce(sum(b0), 0)::int as b0, coalesce(sum(b1), 0)::int as b1, coalesce(sum(b2), 0)::int as b2, coalesce(sum(b3), 0)::int as b3,
        coalesce(sum(b4), 0)::int as b4, coalesce(sum(b5), 0)::int as b5, coalesce(sum(b6), 0)::int as b6 from metrics_minute where scope in ('platform', 'store') and bucket >= ${since}::timestamptz`;
    const p95 = percentileFromBuckets([r!.b0, r!.b1, r!.b2, r!.b3, r!.b4, r!.b5, r!.b6].map(Number), 0.95);
    return r!.n >= p.min_requests! && p95 != null && p95 > p.max_p95_ms! ? [{ dedupeKey: 'platform.api_latency', title: `API lenta: p95 acima de ${p95} ms`, detail: { requests: r!.n, p95Ms: p95 } }] : [];
  },
  async 'platform.webhook_stuck'(q, now, p) {
    const limit = iso(new Date(now.getTime() - p.stuck_min! * 60_000));
    const rows = await q`select provider, count(*)::int as n from webhook_inbox where processed_at is null and received_at < ${limit}::timestamptz group by provider`;
    return rows.map((r) => ({ dedupeKey: `platform.webhook_stuck:${r.provider}`, title: `${r.n} webhook(s) ${r.provider} sem processar`, detail: { provider: r.provider, count: r.n } }));
  },
  async 'security.auth_failures'(q, now, p) {
    const since = iso(new Date(now.getTime() - p.window_min! * 60_000));
    const rows = await q`select count(*)::int as n, count(distinct ip)::int as ips from audit_logs where action in ('auth.failed', 'staff.login_failed') and at >= ${since}::timestamptz`;
    return rows[0]!.n >= p.max! ? [{ dedupeKey: 'security.auth_failures', title: `${rows[0]!.n} falhas de login em ${p.window_min} min`, detail: { failures: rows[0]!.n, distinctIps: rows[0]!.ips } }] : [];
  },
  async 'billing.past_due'(q) {
    const rows = await q`select t.id, t.name, s.past_due_since from subscriptions s join tenants t on t.id = s.tenant_id where s.status in ('past_due', 'unpaid')`;
    return rows.map((r) => ({ dedupeKey: `billing.past_due:${r.id}`, tenantId: r.id, title: `${r.name}: pagamento em atraso`, detail: { since: r.past_due_since } }));
  },
  async 'mcp.token_expiring'(q, now, p) {
    const limit = iso(new Date(now.getTime() + p.days! * 86_400_000));
    const rows = await q`select id, name, expires_at from mcp_tokens where revoked_at is null and expires_at <= ${limit}::timestamptz and expires_at > ${iso(now)}::timestamptz`;
    return rows.map((r) => ({ dedupeKey: `mcp.token_expiring:${r.id}`, title: `Token do MCP "${r.name}" vence em breve`, detail: { expiresAt: r.expires_at } }));
  },
};
export const RULE_KEYS = Object.keys(CHECKS);

/** Roda todas as regras ativas: abre/atualiza alertas, resolve os que passaram e devolve o que precisa ser notificado (respeitando o intervalo da regra). */
export async function evaluateAlerts(ctx: Ctx, notify?: Notifier): Promise<{ opened: number; resolved: number; notified: number }> {
  const now = ctx.clock.now();
  const result = await withPlatform(ctx.pools, async (q) => {
    const rules = await q`select key, severity, enabled, params, cooldown_min from alert_rules where enabled`;
    let opened = 0, resolved = 0; const toNotify: AlertNotice[] = [];
    for (const r of rules) {
      const check = CHECKS[r.key]; if (!check) continue;
      const findings = await check(q, now, r.params as Rule['params']);
      const keys = findings.map((f) => f.dedupeKey);
      for (const f of findings) {
        const [a] = await q`
          insert into alerts (rule_key, severity, tenant_id, store_id, title, detail, dedupe_key, first_seen, last_seen)
          values (${r.key}, ${r.severity}, ${f.tenantId ?? null}, ${f.storeId ?? null}, ${f.title}, ${JSON.stringify(f.detail)}::jsonb, ${f.dedupeKey}, ${iso(now)}, ${iso(now)})
          on conflict (dedupe_key) where status <> 'resolved' do update set last_seen = ${iso(now)}, title = excluded.title, detail = excluded.detail, occurrences = alerts.occurrences + 1, severity = excluded.severity
          returning id, status, occurrences, last_notified_at, (xmax = 0) as inserted`;
        if (a!.inserted) opened++;
        const due = !a!.last_notified_at || new Date(a!.last_notified_at).getTime() <= now.getTime() - r.cooldown_min * 60_000;
        if (a!.status === 'open' && due) toNotify.push({ id: a!.id, ruleKey: r.key, severity: r.severity, title: f.title, storeId: f.storeId ?? null, detail: f.detail, occurrences: a!.occurrences });
      }
      // condição deixou de valer → resolve sozinho
      const gone = await q`update alerts set status = 'resolved', resolved_at = ${iso(now)}, resolved_by = 'auto'
        where rule_key = ${r.key} and status <> 'resolved' and dedupe_key not in (select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)) returning id`;
      resolved += gone.length;
    }
    // regras desativadas: o que estava aberto dela é resolvido
    const off = await q`update alerts set status = 'resolved', resolved_at = ${iso(now)}, resolved_by = 'regra desativada' where status <> 'resolved' and rule_key in (select key from alert_rules where not enabled) returning id`;
    resolved += off.length;
    return { opened, resolved, toNotify };
  });

  let notified = 0;
  if (notify) for (const n of result.toNotify) {
    try { await notify(n); notified++; await withPlatform(ctx.pools, (q) => q`update alerts set last_notified_at = ${iso(now)} where id = ${n.id}`); } catch { /* tenta de novo no próximo ciclo */ }
  }
  return { opened: result.opened, resolved: result.resolved, notified };
}

/** Notificação por webhook genérico (Slack-compatível: {text}); o corpo traz também o alerta completo. */
export const webhookNotifier = (url: string, fetchImpl: typeof fetch = fetch): Notifier => async (n) => {
  const icon = n.severity === 'critical' ? '🔴' : n.severity === 'warn' ? '🟠' : '🔵';
  const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `${icon} [${n.severity}] ${n.title}`, alert: n }) });
  if (!res.ok) throw new Error(`webhook respondeu ${res.status}`);
};

/** Retenção: logs 30 dias, métricas 90, alertas resolvidos 90. Roda uma vez por dia. */
export async function runRetention(ctx: Ctx, days = { logs: 30, metrics: 90, alerts: 90 }) {
  const ago = (d: number) => iso(new Date(ctx.clock.now().getTime() - d * 86_400_000));
  return withPlatform(ctx.pools, async (q) => ({
    logs: (await q`delete from app_logs where at < ${ago(days.logs)}::timestamptz returning id`).length,
    metrics: (await q`delete from metrics_minute where bucket < ${ago(days.metrics)}::timestamptz returning 1 as x`).length,
    alerts: (await q`delete from alerts where status = 'resolved' and resolved_at < ${ago(days.alerts)}::timestamptz returning id`).length,
  }));
}

type AlertRow = { rule_key: string; detail: unknown; store_id: string | null; first_seen: string | Date; last_seen: string | Date; rule_params: Record<string, number> | null };
export interface Fact { label: string; value: string }
const ageLabel = (iso: unknown, now: Date) => { const m = Math.max(0, (now.getTime() - new Date(String(iso)).getTime()) / 60_000); return m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}`; };

/** Dados concretos que ajudam a decidir o que fazer (quais pedidos, quais motivos…), por regra. */
async function alertFacts(q: Q, a: AlertRow, now: Date): Promise<Fact[]> {
  const d = (a.detail ?? {}) as Record<string, any>; const sid = a.store_id;
  if (a.rule_key === 'store.order_stuck' && sid) {
    const limit = iso(new Date(now.getTime() - (a.rule_params?.max_minutes ?? 10) * 60_000));
    const rows = await q`select number, type, channel, created_at, total_cents from orders where store_id = ${sid} and status = 'novo' and created_at < ${limit}::timestamptz order by created_at limit 12`;
    return rows.map((r) => ({ label: `Pedido #${r.number} (${r.type === 'delivery' ? 'entrega' : r.type === 'mesa' ? 'mesa' : 'retirada'}, ${r.channel})`, value: `esperando há ${ageLabel(r.created_at, now)} · R$ ${(Number(r.total_cents) / 100).toFixed(2).replace('.', ',')}` }));
  }
  if (a.rule_key === 'store.cancel_rate' && sid) {
    const since = iso(new Date(now.getTime() - (a.rule_params?.window_hours ?? 24) * 3_600_000));
    const rows = await q`select coalesce(nullif(cancel_reason, ''), '(sem motivo informado)') as reason, count(*)::int as n from orders where store_id = ${sid} and status = 'cancelado' and created_at >= ${since}::timestamptz group by 1 order by n desc limit 6`;
    return rows.map((r) => ({ label: `Motivo: ${r.reason}`, value: `${r.n} pedido(s)` }));
  }
  if (a.rule_key === 'store.no_orders' && sid) {
    const [r] = await q`select max(created_at) as last, count(*)::int as total from orders where store_id = ${sid}`;
    return r?.last ? [{ label: 'Último pedido recebido', value: `há ${ageLabel(r.last, now)}` }, { label: 'Pedidos no total', value: String(r.total) }] : [{ label: 'Pedidos recebidos', value: 'nenhum ainda' }];
  }
  if (a.rule_key === 'platform.webhook_stuck') {
    const rows = await q`select event_id, received_at, error from webhook_inbox where provider = ${String(d.provider ?? '')} and processed_at is null order by received_at limit 8`;
    return rows.map((r) => ({ label: `${d.provider}: evento ${String(r.event_id).slice(0, 24)}`, value: `recebido há ${ageLabel(r.received_at, now)}${r.error ? ` · erro: ${String(r.error).slice(0, 120)}` : ''}` }));
  }
  return [];
}

export interface RelatedLog { at: string; level: string; service: string; event: string; message: string; status: number | null; store_name: string | null; data: unknown }

/** Logs que ajudam a explicar o alerta: da própria loja (quando é de loja) ou erros da plataforma (quando é geral), no período em que ele existiu. */
async function alertLogs(q: Q, a: AlertRow, now: Date): Promise<RelatedLog[]> {
  const first = new Date(a.first_seen).getTime(), last = Math.max(new Date(a.last_seen).getTime(), first);
  const from = iso(new Date(first - 2 * 3_600_000)), to = iso(new Date(Math.min(now.getTime(), last + 10 * 60_000)));
  const cols = (rows: Record<string, any>[]): RelatedLog[] => rows.map((r) => ({ at: r.at, level: r.level, service: r.service, event: r.event, message: r.message, status: r.status ?? null, store_name: r.store_name ?? null, data: r.data ?? null }));
  if (a.rule_key === 'security.auth_failures') {
    const rows = await q`select at, action, ip, meta from audit_logs where action in ('auth.failed', 'staff.login_failed') and at >= ${from}::timestamptz and at <= ${to}::timestamptz order by at desc limit 30`;
    return rows.map((r) => ({ at: r.at, level: 'warn', service: 'api', event: r.action, message: `Falha de login${r.ip ? ` vinda de ${r.ip}` : ''}`, status: null, store_name: null, data: r.meta ?? null }));
  }
  if (a.store_id) {
    return cols(await q`select l.at, l.level, l.service, l.event, l.message, l.status, l.data, s.name as store_name from app_logs l left join stores s on s.id = l.store_id
      where l.store_id = ${a.store_id} and l.level in ('warn', 'error') and l.at >= ${from}::timestamptz and l.at <= ${to}::timestamptz order by l.at desc limit 30`);
  }
  if (a.rule_key === 'platform.webhook_stuck') {
    const prov = `%${String((a.detail as Record<string, unknown> | null)?.provider ?? 'webhook')}%`;
    return cols(await q`select l.at, l.level, l.service, l.event, l.message, l.status, l.data, s.name as store_name from app_logs l left join stores s on s.id = l.store_id
      where l.level in ('warn', 'error') and l.at >= ${from}::timestamptz and (l.event ilike '%webhook%' or l.message ilike ${prov} or l.event ilike ${prov}) order by l.at desc limit 30`);
  }
  if (a.rule_key.startsWith('platform.')) {
    return cols(await q`select l.at, l.level, l.service, l.event, l.message, l.status, l.data, s.name as store_name from app_logs l left join stores s on s.id = l.store_id
      where l.level = 'error' and l.at >= ${from}::timestamptz and l.at <= ${to}::timestamptz order by l.at desc limit 30`);
  }
  return [];
}

const paramSchemas: Record<string, z.ZodTypeAny> = {};
export function alertRoutes(app: FastifyInstance, ctx: Ctx) {
  const P = '/v1/platform';

  app.get(`${P}/alerts`, { preHandler: guard(ctx) }, async (req, reply) => {
    const qs = parse(z.object({ status: z.enum(['open', 'acknowledged', 'resolved', 'active']).default('active'), store: uuid.optional(), severity: z.enum(['info', 'warn', 'critical']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query, reply); if (!qs) return;
    const now = ctx.clock.now();
    return withPlatform(ctx.pools, async (q) => ({
      alerts: (await q`select a.id, a.rule_key, a.severity, a.title, a.detail, a.status, a.occurrences, a.first_seen, a.last_seen, a.ack_at, a.resolved_at, a.resolved_by, a.store_id, s.name as store_name, s.slug as store_slug, r.params as rule_params
        from alerts a left join stores s on s.id = a.store_id left join alert_rules r on r.key = a.rule_key
        where (${qs.status}::text = 'active' and a.status <> 'resolved' or a.status = ${qs.status}) and (${qs.store ?? null}::uuid is null or a.store_id = ${qs.store ?? null}::uuid)
          and (${qs.severity ?? null}::text is null or a.severity = ${qs.severity ?? null})
        order by case a.severity when 'critical' then 0 when 'warn' then 1 else 2 end, a.last_seen desc limit ${qs.limit}`)
        .map(({ rule_params, ...a }) => ({ ...a, plain: explainAlert({ ruleKey: a.rule_key, detail: a.detail, params: rule_params, storeName: a.store_name, now }).what })),
    }));
  });

  // "Entender este alerta": explicação em português, fatos concretos e os logs relacionados
  app.get(`${P}/alerts/:id/context`, { preHandler: guard(ctx) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const now = ctx.clock.now();
    const out = await withPlatform(ctx.pools, async (q) => {
      const [a] = await q`select a.id, a.rule_key, a.severity, a.title, a.detail, a.status, a.occurrences, a.first_seen, a.last_seen, a.store_id, a.tenant_id, s.name as store_name, s.slug as store_slug, r.params as rule_params, r.title as rule_title
        from alerts a left join stores s on s.id = a.store_id left join alert_rules r on r.key = a.rule_key where a.id = ${id}`;
      if (!a) return null;
      const d = (a.detail ?? {}) as Record<string, any>;
      const explanation = explainAlert({ ruleKey: a.rule_key, detail: d, params: a.rule_params, storeName: a.store_name, now });
      const facts = await alertFacts(q, a as unknown as AlertRow, now);
      const logs = await alertLogs(q, a as unknown as AlertRow, now);
      return { alert: { id: a.id, rule_key: a.rule_key, rule_title: a.rule_title, severity: a.severity, title: a.title, status: a.status, occurrences: a.occurrences, first_seen: a.first_seen, last_seen: a.last_seen, store_id: a.store_id, store_name: a.store_name, store_slug: a.store_slug }, explanation, facts, logs };
    });
    return out ?? fail(reply, 404, 'not_found', 'Alerta não encontrado.');
  });

  const act = (path: string, to: 'acknowledged' | 'resolved') => app.post(`${P}/alerts/:id/${path}`, { preHandler: guard(ctx) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const n = await withPlatform(ctx.pools, async (q) => {
      const r = to === 'acknowledged'
        ? await q`update alerts set status = 'acknowledged', ack_by = ${req.session!.adminId}, ack_at = now() where id = ${id} and status = 'open' returning id`
        : await q`update alerts set status = 'resolved', resolved_at = now(), resolved_by = ${req.session!.email} where id = ${id} and status <> 'resolved' returning id`;
      if (r.length) await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: `alert.${to}`, ip: req.ip, meta: { alertId: id } });
      return r.length;
    });
    return n ? { ok: true } : fail(reply, 409, 'invalid_state', 'Alerta não encontrado ou já está neste estado.');
  });
  act('ack', 'acknowledged'); act('resolve', 'resolved');

  app.get(`${P}/alert-rules`, { preHandler: guard(ctx) }, async () => withPlatform(ctx.pools, async (q) => ({ rules: await q`select key, scope, severity, title, description, enabled, params, cooldown_min from alert_rules order by scope, key` })));

  app.put(`${P}/alert-rules/:key`, { preHandler: guard(ctx) }, async (req, reply) => {
    const key = (req.params as { key: string }).key;
    if (!RULE_KEYS.includes(key)) return fail(reply, 404, 'not_found', 'Regra não encontrada.');
    const b = parse(z.object({ enabled: z.boolean().optional(), severity: z.enum(['info', 'warn', 'critical']).optional(), cooldownMin: z.number().int().min(1).max(10080).optional(), params: z.record(z.number().finite().min(0).max(1_000_000)).optional() }), req.body, reply); if (!b) return;
    const out = await withPlatform(ctx.pools, async (q) => {
      const [cur] = await q`select params from alert_rules where key = ${key}`;
      const known = Object.keys(cur!.params as object);
      const unknown = Object.keys(b.params ?? {}).filter((k) => !known.includes(k));
      if (unknown.length) return { error: `Parâmetros desconhecidos: ${unknown.join(', ')}. Válidos: ${known.join(', ') || '(nenhum)'}.` };
      const merged = { ...(cur!.params as object), ...(b.params ?? {}) };
      await q`update alert_rules set enabled = coalesce(${b.enabled ?? null}::boolean, enabled), severity = coalesce(${b.severity ?? null}, severity),
              cooldown_min = coalesce(${b.cooldownMin ?? null}::int, cooldown_min), params = ${JSON.stringify(merged)}::jsonb, updated_at = now() where key = ${key}`;
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'alert_rule.updated', ip: req.ip, meta: { key, ...b } });
      return { ok: true };
    });
    return 'error' in out ? fail(reply, 422, 'invalid_params', out.error!) : out;
  });

  app.post(`${P}/alerts/evaluate`, { preHandler: guard(ctx) }, async () => evaluateAlerts(ctx, ctx.notifier));
  void paramSchemas;
}

// ---------------- logs ----------------
export function logRoutes(app: FastifyInstance, ctx: Ctx) {
  const P = '/v1/platform';
  const page = { limit: z.coerce.number().int().min(1).max(200).default(50), before: z.coerce.number().int().positive().optional() };
  const ts = z.string().datetime().optional();

  // logs técnicos (filtráveis) — qualquer loja ou todas
  app.get(`${P}/logs`, { preHandler: guard(ctx) }, async (req, reply) => {
    const qs = parse(z.object({ ...page, store: uuid.optional(), level: z.enum(['debug', 'info', 'warn', 'error']).optional(), service: z.enum(['api', 'mcp', 'worker', 'print', 'payments']).optional(),
      event: z.string().max(80).optional(), q: z.string().max(100).optional(), from: ts, to: ts }), req.query, reply); if (!qs) return;
    const like = qs.q ? `%${qs.q.replace(/[%_\\]/g, '\\$&')}%` : null;
    return withPlatform(ctx.pools, async (q) => {
      const rows = await q`select l.id, l.at, l.level, l.service, l.event, l.message, l.status, l.duration_ms, l.request_id, l.data, l.store_id, s.name as store_name
        from app_logs l left join stores s on s.id = l.store_id
        where (${qs.store ?? null}::uuid is null or l.store_id = ${qs.store ?? null}::uuid) and (${qs.level ?? null}::text is null or l.level = ${qs.level ?? null})
          and (${qs.service ?? null}::text is null or l.service = ${qs.service ?? null}) and (${qs.event ?? null}::text is null or l.event = ${qs.event ?? null})
          and (${like}::text is null or l.message ilike ${like} or l.event ilike ${like})
          and (${qs.from ?? null}::timestamptz is null or l.at >= ${qs.from ?? null}::timestamptz) and (${qs.to ?? null}::timestamptz is null or l.at < ${qs.to ?? null}::timestamptz)
          and (${qs.before ?? null}::bigint is null or l.id < ${qs.before ?? null}::bigint)
        order by l.id desc limit ${qs.limit + 1}`;
      const more = rows.length > qs.limit;
      return { logs: rows.slice(0, qs.limit), nextBefore: more ? rows[qs.limit - 1]!.id : null };
    });
  });

  // atividade de UMA loja: logs técnicos + auditoria (+ eventos de pedidos) em ordem cronológica
  app.get(`${P}/stores/:id/activity`, { preHandler: guard(ctx) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const qs = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(100), sources: z.string().default('logs,audit,orders'), before: z.string().datetime().optional() }), req.query, reply); if (!qs) return;
    const src = new Set(qs.sources.split(','));
    return withPlatform(ctx.pools, async (q) => {
      const [store] = await q`select id, name, slug from stores where id = ${id}`;
      if (!store) return fail(reply, 404, 'not_found', 'Loja não encontrada.');
      const before = qs.before ?? null;
      const logs = src.has('logs') ? await q`select at, 'log' as source, level as severity, event, message, data from app_logs where store_id = ${id} and (${before}::timestamptz is null or at < ${before}::timestamptz) order by at desc limit ${qs.limit}` : [];
      const audits = src.has('audit') ? await q`select a.at, 'auditoria' as source, 'info' as severity, a.action as event, a.actor_kind || coalesce(':' || a.actor_id, '') as message, jsonb_build_object('before', a.before, 'after', a.after, 'meta', a.meta) as data
        from audit_logs a where a.store_id = ${id} and (${before}::timestamptz is null or a.at < ${before}::timestamptz) order by a.at desc limit ${qs.limit}` : [];
      const orders = src.has('orders') ? await q`select e.at, 'pedido' as source, 'info' as severity, e.event, ('Pedido #' || o.number) as message, e.data
        from order_events e join orders o on o.id = e.order_id where e.store_id = ${id} and (${before}::timestamptz is null or e.at < ${before}::timestamptz) order by e.at desc limit ${qs.limit}` : [];
      const merged = [...logs, ...audits, ...orders].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, qs.limit);
      return { store, items: merged, nextBefore: merged.length === qs.limit ? merged.at(-1)!.at : null };
    });
  });

  // log do super admin: tudo o que a plataforma fez (ações, logins, falhas), com o e-mail de quem fez
  app.get(`${P}/audit`, { preHandler: guard(ctx) }, async (req, reply) => {
    const qs = parse(z.object({ ...page, actor: z.enum(['superadmin', 'mcp', 'staff', 'billing', 'system']).optional(), action: z.string().max(80).optional(), store: uuid.optional(), from: ts, to: ts }), req.query, reply); if (!qs) return;
    const like = qs.action ? `${qs.action.replace(/[%_\\]/g, '\\$&')}%` : null;
    return withPlatform(ctx.pools, async (q) => {
      const rows = await q`select a.id, a.at, a.actor_kind, a.actor_id, a.action, a.ip::text as ip, a.store_id, a.before, a.after, a.meta, p.email as admin_email, s.name as store_name
        from audit_logs a left join platform_admins p on a.actor_kind = 'superadmin' and p.id::text = a.actor_id left join stores s on s.id = a.store_id
        where (${qs.actor ?? null}::text is null or a.actor_kind = ${qs.actor ?? null}) and (${like}::text is null or a.action like ${like}) and (${qs.store ?? null}::uuid is null or a.store_id = ${qs.store ?? null}::uuid)
          and (${qs.from ?? null}::timestamptz is null or a.at >= ${qs.from ?? null}::timestamptz) and (${qs.to ?? null}::timestamptz is null or a.at < ${qs.to ?? null}::timestamptz)
          and (${qs.before ?? null}::bigint is null or a.id < ${qs.before ?? null}::bigint)
        order by a.id desc limit ${qs.limit + 1}`;
      const more = rows.length > qs.limit;
      return { entries: rows.slice(0, qs.limit), nextBefore: more ? rows[qs.limit - 1]!.id : null };
    });
  });
}
