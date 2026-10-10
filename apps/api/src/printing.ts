import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import websocket from '@fastify/websocket';
import { z } from 'zod';
import { withPlatform, withTenant, type Q } from '@pediu/db';
import { DEFAULT_TZ, can, generateToken, hashToken } from '@pediu/shared';
import { renderTest, renderTicket, toBase64, type PrinterProfile, type TicketItem, type TicketKind, type TicketOrder } from '@pediu/escpos';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { bus } from './realtime.js';
import { staffGuard } from './staff.js';

export const ACK_TIMEOUT_MS = 15_000;      // sem confirmação do agente → reenvia
export const MAX_ATTEMPTS = 3;             // tentativas na mesma impressora antes de ir para a reserva
export const FAILOVER_AFTER_MS = 45_000;   // agente offline por tanto tempo → tenta a impressora reserva
export const GIVE_UP_MS = 180_000;         // sem reserva e sem sucesso → marca como falhou e avisa

// ---------------- hub de agentes conectados ----------------
interface Conn { socket: WebSocket; storeId: string; tenantId: string }
class Hub {
  private conns = new Map<string, Conn>();
  set(agentId: string, c: Conn) { this.conns.get(agentId)?.socket.close(4000, 'substituído por nova conexão'); this.conns.set(agentId, c); }
  delete(agentId: string, socket: WebSocket) { if (this.conns.get(agentId)?.socket === socket) { this.conns.delete(agentId); return true; } return false; }
  get(agentId: string) { return this.conns.get(agentId); }
  has(agentId: string) { return this.conns.has(agentId); }
  kick(agentId: string) { this.conns.get(agentId)?.socket.close(4001, 'revogado'); this.conns.delete(agentId); }
  count() { return this.conns.size; }
}
export const hub = new Hub();

// ---------------- geração dos jobs ----------------
const EVENT_NAMESPACE: Record<string, string> = { novo: 'chegada', preparo: 'chegada' };   // criado já em preparo não imprime duas vezes

export interface EnqueueInput { tenantId: string; storeId: string; orderId: string; kind: TicketKind; itemIds?: string[]; zoneId?: string | null; cancelReason?: string; manual?: boolean }

/** Cria os jobs de impressão do pedido, um por zona, respeitando eventos, zona padrão, impressora principal e cópias. Devolve quantos jobs novos nasceram. */
export async function enqueuePrint(ctx: Ctx, i: EnqueueInput): Promise<number> {
  const created = await withTenant(ctx.pools, i.tenantId, async (q) => {
    const [o] = await q`select * from orders where id = ${i.orderId} and store_id = ${i.storeId}`;
    if (!o) return 0;
    const [store] = await q`select name from stores where id = ${i.storeId}`;
    const [cfg] = await q`select data from store_settings where store_id = ${i.storeId}`;
    const tz = (cfg?.data?.timezone as string | undefined) ?? DEFAULT_TZ;
    const allItems = await q`select id, name, qty, unit_cents, total_cents, note, addons, print_zone_id from order_items where order_id = ${i.orderId} order by created_at`;
    const zones = await q`select * from print_zones where store_id = ${i.storeId} and active order by name`;
    const active = new Set(zones.map((z) => z.id));
    const wanted = zones.filter((z) => (i.zoneId ? z.id === i.zoneId : i.manual ? true : z.auto_print && (z.events as string[]).includes(i.kind)));
    const order: TicketOrder = {
      number: o.number, type: o.type, channel: o.channel, table: o.table_number, customerName: o.customer_name, phone: o.customer_phone, address: o.address, note: o.note,
      subtotalCents: o.subtotal_cents, feeCents: o.fee_cents, discountCents: o.discount_cents, totalCents: o.total_cents, paymentMethod: o.payment_method, paid: o.paid, changeForCents: o.change_for_cents, createdAt: o.created_at,
    };
    let n = 0;
    const unrouted = allItems.filter((it) => !it.print_zone_id || !active.has(it.print_zone_id));
    if (unrouted.length && !zones.some((z) => z.is_default) && wanted.length) ctx.telemetry?.log({ level: 'warn', service: 'print', event: 'print.no_default_zone', message: `${unrouted.length} item(ns) sem zona e a loja não tem zona padrão (pedido #${o.number})`, storeId: i.storeId, tenantId: i.tenantId });

    for (const z of wanted) {
      // zonas que mostram preços (caixa/expedição) recebem o pedido inteiro; as de produção (cozinha, bar) só os próprios itens
      let items = z.show_prices ? allItems : allItems.filter((it) => it.print_zone_id === z.id || (z.is_default && (!it.print_zone_id || !active.has(it.print_zone_id))));
      if (i.itemIds) items = items.filter((it) => i.itemIds!.includes(it.id));
      if (!items.length) continue;
      const printers = await q`select zp.priority, zp.copies, p.* from zone_printers zp join printers p on p.id = zp.printer_id where zp.zone_id = ${z.id} and p.active order by zp.priority, p.name`;
      const main = printers[0];
      if (!main) { ctx.telemetry?.log({ level: 'warn', service: 'print', event: 'print.zone_without_printer', message: `Zona "${z.name}" sem impressora ativa (pedido #${o.number})`, storeId: i.storeId, tenantId: i.tenantId }); continue; }
      const profile: PrinterProfile = { columns: main.columns, codepage: main.codepage, cut: main.cut, drawer: main.drawer };
      const tItems: TicketItem[] = items.map((it) => ({ qty: it.qty, name: it.name, note: it.note, unitCents: it.unit_cents, totalCents: it.total_cents, addons: it.addons ?? [] }));
      const { data, preview } = renderTicket(order, tItems, { storeName: store!.name, zoneName: z.name, kind: i.manual ? 'reimpressao' : i.kind, showPrices: z.show_prices, printer: profile, tz, cancelReason: i.cancelReason });
      const copies = Math.max(1, main.copies);
      const bytes = copies === 1 ? data : Uint8Array.from(Array.from({ length: copies }, () => [...data]).flat());
      const ns = i.manual ? `manual:${Date.now()}` : (EVENT_NAMESPACE[i.kind] ?? i.kind) + (i.kind === 'items_added' ? `:${(i.itemIds ?? []).join(',')}` : '');
      const dedupe = `${i.orderId}:${ns}:${z.id}`;
      const [job] = await q`
        insert into print_jobs (store_id, tenant_id, order_id, zone_id, printer_id, kind, dedupe_key, data_b64, preview)
        values (${i.storeId}, ${i.tenantId}, ${i.orderId}, ${z.id}, ${main.id}, ${i.manual ? 'reimpressao' : i.kind}, ${dedupe}, ${toBase64(bytes)}, ${preview})
        on conflict (store_id, dedupe_key) do nothing returning id`;
      if (job) n++;
    }
    return n;
  });
  if (created) void dispatchJobs(ctx, i.storeId).catch(() => {});
  return created;
}

/** Job de teste direto numa impressora (botão "imprimir teste"). */
export async function enqueueTest(ctx: Ctx, tenantId: string, storeId: string, printerId: string): Promise<string | null> {
  const id = await withTenant(ctx.pools, tenantId, async (q) => {
    const [p] = await q`select * from printers where id = ${printerId} and store_id = ${storeId}`;
    const [s] = await q`select name from stores where id = ${storeId}`;
    if (!p) return null;
    const { data, preview } = renderTest(s!.name, p.name, { columns: p.columns, codepage: p.codepage, cut: p.cut, drawer: p.drawer });
    const [j] = await q`insert into print_jobs (store_id, tenant_id, printer_id, kind, dedupe_key, data_b64, preview) values (${storeId}, ${tenantId}, ${printerId}, 'teste', ${`teste:${printerId}:${Date.now()}`}, ${toBase64(data)}, ${preview}) returning id`;
    return j!.id as string;
  });
  if (id) void dispatchJobs(ctx, storeId).catch(() => {});
  return id;
}

// ---------------- despacho, confirmação, reenvio e reserva ----------------
const emitPrint = (storeId: string, jobId: string, status: string, orderId: string | null, error?: string | null) => bus.emit(storeId, { type: 'print', jobId, status, orderId, error });

async function failover(q: Q, j: Record<string, any>, now: Date): Promise<'trocada' | 'sem-reserva'> {
  const tried = [...(j.tried_printers as string[]), ...(j.printer_id ? [j.printer_id as string] : [])];
  const candidates = j.zone_id ? await q`select zp.printer_id, zp.priority from zone_printers zp join printers p on p.id = zp.printer_id where zp.zone_id = ${j.zone_id} and p.active order by zp.priority, p.name` : [];
  const pick = candidates.find((c) => !tried.includes(c.printer_id));
  if (!pick) return 'sem-reserva';
  await q`update print_jobs set printer_id = ${pick.printer_id}, tried_printers = (select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(${JSON.stringify(tried)}::jsonb) x), attempts = 0, status = 'pendente', last_error = 'trocada para a impressora reserva', sent_at = null where id = ${j.id}`;
  return 'trocada';
}

/** Um ciclo do despachante: envia pendentes aos agentes conectados, reenvia os sem confirmação, troca para a reserva e dá baixa nos que não têm jeito. Roda a cada poucos segundos e a cada job novo. */
export async function dispatchJobs(ctx: Ctx, onlyStore?: string, nowMs = ctx.clock.now().getTime()): Promise<{ sent: number; failedOver: number; failed: number }> {
  const now = new Date(nowMs);
  const res = { sent: 0, failedOver: 0, failed: 0 };
  const events: (() => void)[] = [];
  await withPlatform(ctx.pools, async (q) => {
    const jobs = await q`
      select j.*, p.agent_id, p.connection, p.address, p.name as printer_name, p.active as printer_active
      from print_jobs j left join printers p on p.id = j.printer_id
      where j.status in ('pendente', 'enviado') and (${onlyStore ?? null}::uuid is null or j.store_id = ${onlyStore ?? null}::uuid)
      order by j.created_at limit 300 for update of j skip locked`;
    for (const j of jobs) {
      const age = nowMs - new Date(j.created_at).getTime();
      const sentAt = j.sent_at ? new Date(j.sent_at).getTime() : 0;
      const conn = j.agent_id ? hub.get(j.agent_id) : undefined;

      // enviado e sem confirmação dentro do prazo: conta como tentativa falha
      if (j.status === 'enviado' && nowMs - sentAt > ACK_TIMEOUT_MS) {
        await q`update print_jobs set status = 'pendente', last_error = coalesce(last_error, 'sem confirmação do agente') where id = ${j.id}`;
        j.status = 'pendente'; j.last_error ??= 'sem confirmação do agente';
      }
      if (j.status !== 'pendente') continue;

      if (j.attempts >= MAX_ATTEMPTS) {
        const r = await failover(q, j, now);
        if (r === 'trocada') { res.failedOver++; events.push(() => { emitPrint(j.store_id, j.id, 'pendente', j.order_id, 'trocada para a impressora reserva'); ctx.telemetry?.log({ level: 'warn', service: 'print', event: 'print.failover', message: `Job ${j.id}: ${j.printer_name} falhou ${MAX_ATTEMPTS}x, usando reserva`, storeId: j.store_id, tenantId: j.tenant_id }); }); continue; }
        await q`update print_jobs set status = 'falhou' where id = ${j.id}`;
        res.failed++; events.push(() => { emitPrint(j.store_id, j.id, 'falhou', j.order_id, j.last_error); ctx.telemetry?.log({ level: 'error', service: 'print', event: 'print.failed', message: `Impressão falhou: ${j.last_error ?? 'sem detalhe'} (${j.printer_name})`, storeId: j.store_id, tenantId: j.tenant_id, data: { jobId: j.id } }); });
        continue;
      }

      if (conn && j.printer_active !== false) {
        try {
          conn.socket.send(JSON.stringify({ type: 'job', id: j.id, kind: j.kind, printer: { name: j.printer_name, connection: j.connection, address: j.address }, data: j.data_b64 }));
          await q`update print_jobs set status = 'enviado', attempts = attempts + 1, sent_at = ${now.toISOString()} where id = ${j.id}`;
          res.sent++;
        } catch { /* conexão caiu no meio: o próximo ciclo trata */ }
        continue;
      }

      // agente desconectado (ou impressora desativada): espera um pouco e depois vai para a reserva ou desiste
      if (age > FAILOVER_AFTER_MS) {
        const r = await failover(q, j, now);
        if (r === 'trocada') { res.failedOver++; events.push(() => emitPrint(j.store_id, j.id, 'pendente', j.order_id, 'agente offline: trocada para a reserva')); continue; }
        if (age > GIVE_UP_MS) {
          await q`update print_jobs set status = 'falhou', last_error = coalesce(last_error, 'agente de impressão offline') where id = ${j.id}`;
          res.failed++; events.push(() => { emitPrint(j.store_id, j.id, 'falhou', j.order_id, 'agente de impressão offline'); ctx.telemetry?.log({ level: 'error', service: 'print', event: 'print.failed', message: `Impressão não saiu: agente offline (${j.printer_name ?? 'sem impressora'})`, storeId: j.store_id, tenantId: j.tenant_id, data: { jobId: j.id } }); });
        }
      }
    }
  });
  events.forEach((e) => e());
  return res;
}

/** Confirmação do agente. */
async function handleAck(ctx: Ctx, tenantId: string, storeId: string, agentId: string, m: { id: string; ok: boolean; error?: string }) {
  const out = await withTenant(ctx.pools, tenantId, async (q) => {
    if (m.ok) return (await q`update print_jobs set status = 'impresso', printed_at = now(), last_error = null where id = ${m.id} and store_id = ${storeId} and status in ('enviado', 'pendente') returning id, order_id`)[0];
    return (await q`update print_jobs set status = 'pendente', last_error = ${String(m.error ?? 'erro desconhecido').slice(0, 300)} where id = ${m.id} and store_id = ${storeId} and status = 'enviado' returning id, order_id`)[0];
  });
  if (out) { emitPrint(storeId, m.id, m.ok ? 'impresso' : 'pendente', out.order_id, m.ok ? null : m.error); if (!m.ok) void dispatchJobs(ctx, storeId).catch(() => {}); }
  void agentId;
}

const helloSchema = z.object({ type: z.literal('hello'), version: z.string().max(40).optional(), platform: z.string().max(40).optional(), printers: z.array(z.object({ name: z.string().max(120) }).passthrough()).max(50).default([]) });
const ackSchema = z.object({ type: z.literal('ack'), id: z.string().uuid(), ok: z.boolean(), error: z.string().max(500).optional() });

export function printingRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---- agente: pareamento e WebSocket ----
  app.post('/v1/agent/pair', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({ code: z.string().regex(/^\d{6}$/), name: z.string().min(2).max(60), platform: z.string().max(40).default(''), version: z.string().max(40).default('') }), req.body, reply); if (!b) return;
    const t = generateToken('pag');
    const [r] = await ctx.pools.app.begin((q) => q`select * from app.agent_pair(${hashToken(b.code)}, ${t.hash}, ${b.name}, ${b.platform}, ${b.version})`);
    if (!r) return fail(reply, 400, 'invalid_code', 'Código inválido ou expirado. Gere outro no painel.');
    await withTenant(ctx.pools, r.tenant_id, (q) => audit(q, { actorKind: 'system', tenantId: r.tenant_id, storeId: r.store_id, action: 'print.agent_paired', ip: req.ip, meta: { agentId: r.agent_id, name: b.name } }));
    bus.emit(r.store_id, { type: 'agent', agentId: r.agent_id, online: false });   // o painel recarrega a lista na hora
    return reply.status(201).send({ token: t.token, agentId: r.agent_id, storeId: r.store_id });
  });

  app.register(async (inst) => {
    await inst.register(websocket, { options: { maxPayload: 256 * 1024 } });
    inst.get('/v1/agent/ws', { websocket: true }, async (socket, req) => {
      const bearer = String(req.headers.authorization ?? '').match(/^Bearer (pag_[A-Za-z0-9_-]{20,})$/)?.[1] ?? (req.query as { token?: string }).token;
      const [a] = bearer ? await ctx.pools.app.begin((q) => q`select * from app.agent_auth(${hashToken(bearer)})`) : [];
      if (!a) { socket.close(4401, 'token inválido ou revogado'); return; }
      const conn: Conn = { socket, storeId: a.store_id, tenantId: a.tenant_id };
      hub.set(a.agent_id, conn);
      bus.emit(a.store_id, { type: 'agent', agentId: a.agent_id, online: true });
      socket.send(JSON.stringify({ type: 'welcome', agentId: a.agent_id, storeId: a.store_id, ackTimeoutMs: ACK_TIMEOUT_MS }));
      void dispatchJobs(ctx, a.store_id).catch(() => {});
      const alive = setInterval(() => { try { socket.ping(); } catch { /* fecha no 'close' */ } }, 20_000);
      socket.on('message', async (raw: Buffer) => {
        try {
          const m = JSON.parse(raw.toString());
          if (m?.type === 'hello') {
            const h = helloSchema.parse(m);
            await withTenant(ctx.pools, a.tenant_id, (q) => q`update print_agents set version = ${h.version ?? null}, platform = ${h.platform ?? null}, discovered = ${JSON.stringify(h.printers)}::jsonb, last_seen_at = now() where id = ${a.agent_id}`);
          } else if (m?.type === 'ack') await handleAck(ctx, a.tenant_id, a.store_id, a.agent_id, ackSchema.parse(m));
        } catch (e) { ctx.telemetry?.log({ level: 'warn', service: 'print', event: 'print.agent_bad_message', message: String((e as Error).message).slice(0, 200), storeId: a.store_id }); }
      });
      const gone = () => { clearInterval(alive); if (hub.delete(a.agent_id, socket)) { bus.emit(a.store_id, { type: 'agent', agentId: a.agent_id, online: false }); void withTenant(ctx.pools, a.tenant_id, (q) => q`update print_agents set last_seen_at = now() where id = ${a.agent_id}`).catch(() => {}); } };
      socket.on('close', gone); socket.on('error', gone);
    });
  });

  // ---- painel: agentes, impressoras, zonas, fila ----
  const P = '/v1/staff/print';
  const uuid = z.string().uuid();
  const adm = staffGuard(ctx, 'admin.loja');

  app.get(`${P}/overview`, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const s = req.staff!;
    if (!(can(s.role, 'admin.loja') || can(s.role, 'pdv'))) return fail(reply, 403, 'forbidden', 'Seu perfil não acessa a impressão.');
    return withTenant(ctx.pools, s.tenantId, async (q) => {
      const agents = await q`select id, name, platform, version, last_seen_at, discovered, revoked_at from print_agents where store_id = ${s.storeId} and revoked_at is null order by created_at`;
      return {
        agents: agents.map((a) => ({ ...a, online: hub.has(a.id) })),
        printers: await q`select * from printers where store_id = ${s.storeId} order by name`,
        zonePrinters: await q`select zone_id, printer_id, priority, copies from zone_printers where store_id = ${s.storeId} order by priority`,
        jobs: await q`select id, order_id, zone_id, printer_id, kind, status, attempts, last_error, created_at, printed_at, preview from print_jobs where store_id = ${s.storeId} order by created_at desc limit 40`,
      };
    });
  });

  app.post(`${P}/pairing`, { preHandler: adm }, async (req) => {
    const s = req.staff!;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expires = new Date(ctx.clock.now().getTime() + 10 * 60_000);
    await withTenant(ctx.pools, s.tenantId, async (q) => {
      await q`delete from print_pairing_codes where store_id = ${s.storeId} and (used_at is not null or expires_at < now())`;
      await q`insert into print_pairing_codes (code_hash, store_id, tenant_id, expires_at) values (${hashToken(code)}, ${s.storeId}, ${s.tenantId}, ${expires.toISOString()})`;
    });
    return { code, expiresAt: expires.toISOString() };
  });

  app.delete(`${P}/agents/:id`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!; const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const n = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const r = await q`update print_agents set revoked_at = now() where id = ${id} and store_id = ${s.storeId} and revoked_at is null returning id`;
      if (r.length) await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'print.agent_revoked', ip: req.ip, meta: { id } });
      return r.length;
    });
    if (!n) return fail(reply, 404, 'not_found', 'Agente não encontrado.');
    hub.kick(id);
    return { ok: true };
  });

  const printerBody = z.object({
    id: uuid.optional(), name: z.string().min(1).max(60), connection: z.enum(['rede', 'windows', 'cups']), address: z.string().min(1).max(200), agentId: uuid.nullable().optional(),
    paper: z.enum(['58mm', '80mm']).default('80mm'), columns: z.number().int().min(20).max(80).default(48), codepage: z.enum(['cp860', 'cp850', 'cp437']).default('cp860'),
    cut: z.boolean().default(true), drawer: z.boolean().default(false), active: z.boolean().default(true),
  }).superRefine((v, c) => { if (v.connection === 'rede' && !/^[A-Za-z0-9.-]+(:\d{2,5})?$/.test(v.address)) c.addIssue({ code: 'custom', path: ['address'], message: 'Use IP ou nome com porta opcional, ex.: 192.168.0.50:9100' }); });

  app.put(`${P}/printers`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!; const b = parse(printerBody, req.body, reply); if (!b) return;
    try {
      const row = await withTenant(ctx.pools, s.tenantId, async (q) => {
        if (b.agentId) { const [a] = await q`select id from print_agents where id = ${b.agentId} and store_id = ${s.storeId} and revoked_at is null`; if (!a) return 'agent' as const; }
        const cols = [b.name, b.connection, b.address.trim(), b.agentId ?? null, b.paper, b.columns, b.codepage, b.cut, b.drawer, b.active];
        if (b.id) {
          const r = await q`update printers set name = ${cols[0] as string}, connection = ${cols[1] as string}, address = ${cols[2] as string}, agent_id = ${cols[3] as string | null}, paper = ${cols[4] as string}, columns = ${cols[5] as number},
                            codepage = ${cols[6] as string}, cut = ${cols[7] as boolean}, drawer = ${cols[8] as boolean}, active = ${cols[9] as boolean} where id = ${b.id} and store_id = ${s.storeId} returning *`;
          return r[0] ?? null;
        }
        return (await q`insert into printers (store_id, tenant_id, name, connection, address, agent_id, paper, columns, codepage, cut, drawer, active)
                        values (${s.storeId}, ${s.tenantId}, ${cols[0] as string}, ${cols[1] as string}, ${cols[2] as string}, ${cols[3] as string | null}, ${cols[4] as string}, ${cols[5] as number}, ${cols[6] as string}, ${cols[7] as boolean}, ${cols[8] as boolean}, ${cols[9] as boolean}) returning *`)[0]!;
      });
      if (row === 'agent') return fail(reply, 422, 'invalid_agent', 'Agente não encontrado nesta loja.');
      return row ? { printer: row } : fail(reply, 404, 'not_found', 'Impressora não encontrada.');
    } catch (e) { throw e; }
  });

  app.delete(`${P}/printers/:id`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!; const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const n = await withTenant(ctx.pools, s.tenantId, async (q) => (await q`delete from printers where id = ${id} and store_id = ${s.storeId} returning id`).length);
    return n ? { ok: true } : fail(reply, 404, 'not_found', 'Impressora não encontrada.');
  });

  // impressoras de uma zona: principal (prioridade 0) + reservas (1, 2…) + cópias
  app.put(`${P}/zones/:id/printers`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!; const zoneId = parse(uuid, (req.params as { id: string }).id, reply); if (!zoneId) return;
    const b = parse(z.object({ printers: z.array(z.object({ printerId: uuid, priority: z.number().int().min(0).max(9), copies: z.number().int().min(1).max(5).default(1) })).max(10) }), req.body, reply); if (!b) return;
    if (new Set(b.printers.map((p) => p.printerId)).size !== b.printers.length) return fail(reply, 400, 'invalid_input', 'Impressora repetida na zona.');
    try {
      const ok = await withTenant(ctx.pools, s.tenantId, async (q) => {
        const [zn] = await q`select id from print_zones where id = ${zoneId} and store_id = ${s.storeId}`;
        if (!zn) return false;
        await q`delete from zone_printers where zone_id = ${zoneId} and store_id = ${s.storeId}`;
        for (const p of b.printers) await q`insert into zone_printers (store_id, tenant_id, zone_id, printer_id, priority, copies) values (${s.storeId}, ${s.tenantId}, ${zoneId}, ${p.printerId}, ${p.priority}, ${p.copies})`;
        await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'print.zone_printers', ip: req.ip, meta: { zoneId, printers: b.printers } });
        return true;
      });
      return ok ? { ok: true } : fail(reply, 404, 'not_found', 'Zona não encontrada.');
    } catch (e) { if ((e as { code?: string }).code === '23503') return fail(reply, 422, 'invalid_reference', 'Impressora de outra loja.'); throw e; }
  });

  app.post(`${P}/printers/:id/test`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!; const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const jobId = await enqueueTest(ctx, s.tenantId, s.storeId, id);
    return jobId ? { jobId } : fail(reply, 404, 'not_found', 'Impressora não encontrada.');
  });

  // reimprimir um pedido (todas as zonas ou uma). Perfis de operação também podem.
  app.post(`${P}/orders/:id/reprint`, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const s = req.staff!;
    if (!(can(s.role, 'pdv') || can(s.role, 'admin.loja') || can(s.role, 'garcom'))) return fail(reply, 403, 'forbidden', 'Seu perfil não reimprime.');
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(z.object({ zoneId: uuid.optional() }), req.body ?? {}, reply); if (!b) return;
    const n = await enqueuePrint(ctx, { tenantId: s.tenantId, storeId: s.storeId, orderId: id, kind: 'reimpressao', zoneId: b.zoneId, manual: true });
    await withTenant(ctx.pools, s.tenantId, (q) => audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: 'print.reprint', ip: req.ip, meta: { orderId: id, zoneId: b.zoneId ?? null, jobs: n } }));
    return n ? { jobs: n } : fail(reply, 422, 'nothing_to_print', 'Nada para imprimir: confira se as zonas têm impressora e itens.');
  });

  app.post(`${P}/jobs/:id/retry`, { preHandler: staffGuard(ctx) }, async (req, reply) => {
    const s = req.staff!;
    if (!(can(s.role, 'pdv') || can(s.role, 'admin.loja'))) return fail(reply, 403, 'forbidden', 'Seu perfil não reenvia impressões.');
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const n = await withTenant(ctx.pools, s.tenantId, async (q) => (await q`update print_jobs set status = 'pendente', attempts = 0, last_error = null, sent_at = null, tried_printers = '{}', created_at = now() where id = ${id} and store_id = ${s.storeId} and status in ('falhou', 'pendente', 'enviado') returning id`).length);
    if (!n) return fail(reply, 404, 'not_found', 'Impressão não encontrada ou já impressa.');
    void dispatchJobs(ctx, s.storeId).catch(() => {});
    return { ok: true };
  });
}
