import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@pediu/db';
import { INTEGRATION_APPS, PAYMENT_APPS, type IntegrationApp } from '@pediu/shared';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { staffGuard } from './staff.js';

const isPayment = (a: IntegrationApp) => (PAYMENT_APPS as readonly string[]).includes(a);

/** Hub de Integrações: apps instaláveis por loja. Pagamentos instalam ao conectar a conta (rotas /v1/staff/gateways). */
export function appRoutes(app: FastifyInstance, ctx: Ctx) {
  const A = '/v1/staff/apps';
  const adm = staffGuard(ctx, 'admin.loja');
  const appParam = z.enum(INTEGRATION_APPS);

  // qualquer pessoa da equipe vê o que está instalado (o menu esconde o que não está)
  app.get(A, { preHandler: staffGuard(ctx) }, async (req) => {
    const s = req.staff!;
    return withTenant(ctx.pools, s.tenantId, async (q) => {
      const rows = await q`select app, installed_at from store_apps where store_id = ${s.storeId}`;
      const gws = await q`select provider, status, meta, updated_at from store_gateways where store_id = ${s.storeId}`;   // credenciais nunca saem
      const methods = await q`select gateway, type, active from payment_methods where store_id = ${s.storeId} and online`;
      const on = (gw: string, type: string) => methods.some((m) => m.gateway === gw && m.type === type && m.active);
      return {
        apps: INTEGRATION_APPS.map((id) => {
          const r = rows.find((x) => x.app === id); const g = gws.find((x) => x.provider === id);
          return {
            id, installed: !!r, installedAt: r?.installed_at ?? null,
            ...(isPayment(id) ? { webhookUrl: id === 'mercadopago' && ctx.publicUrl ? `${ctx.publicUrl}/v1/webhooks/mercadopago?store=${s.storeId}` : null, account: g?.meta ?? null, methods: { pix: on(id, 'pix'), card: id === 'mercadopago' ? on(id, 'credit') : undefined }, cardReady: id === 'mercadopago' && !!g?.meta?.publicKey } : {}),
          };
        }),
      };
    });
  });

  // iFood e WhatsApp: instalar só mostra o app no menu (a configuração continua na tela de cada um)
  app.post(`${A}/:app/install`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!; const id = parse(appParam, (req.params as { app: string }).app, reply); if (!id) return;
    if (isPayment(id)) return fail(reply, 422, 'connect_required', 'Para instalar um app de pagamento, conecte a conta (credenciais).');
    await withTenant(ctx.pools, s.tenantId, async (q) => {
      await q`insert into store_apps (store_id, tenant_id, app, installed_by) values (${s.storeId}, ${s.tenantId}, ${id}, ${s.staffId}) on conflict do nothing`;
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: `app.${id}.installed`, ip: req.ip });
    });
    return { ok: true };
  });

  app.delete(`${A}/:app`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!; const id = parse(appParam, (req.params as { app: string }).app, reply); if (!id) return;
    await withTenant(ctx.pools, s.tenantId, async (q) => {
      await q`delete from store_apps where store_id = ${s.storeId} and app = ${id}`;
      if (isPayment(id)) {
        // desinstalar pagamento = desconectar: apaga as credenciais e desliga as formas online dele
        await q`delete from store_gateways where store_id = ${s.storeId} and provider = ${id}`;
        await q`update payment_methods set online = false, gateway = null, active = false where store_id = ${s.storeId} and gateway = ${id}`;
      }
      if (id === 'ifood') await q`update ifood_links set active = false where store_id = ${s.storeId}`;   // para de receber pedidos do iFood
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: `app.${id}.uninstalled`, ip: req.ip });
    });
    return { ok: true };
  });

  // atalho do app de pagamento: liga/desliga "Pix online" e "Cartão online" (cria a forma de pagamento se ainda não existir)
  app.put(`${A}/:app/methods`, { preHandler: adm }, async (req, reply) => {
    const s = req.staff!; const id = parse(appParam, (req.params as { app: string }).app, reply); if (!id) return;
    if (!isPayment(id)) return fail(reply, 422, 'not_payment', 'Este app não tem formas de pagamento.');
    const b = parse(z.object({ pix: z.boolean().optional(), card: z.boolean().optional() }), req.body, reply); if (!b) return;
    if (b.card !== undefined && id !== 'mercadopago') return fail(reply, 422, 'no_card', 'Cartão online é pelo Mercado Pago.');
    const out = await withTenant(ctx.pools, s.tenantId, async (q) => {
      const [g] = await q`select meta from store_gateways where store_id = ${s.storeId} and provider = ${id} and status = 'ativo'`;
      if (!g) return 'not_connected' as const;
      if (b.card && !g.meta?.publicKey) return 'no_public_key' as const;
      for (const [type, want, name] of [['pix', b.pix, 'Pix'], ['credit', b.card, 'Cartão de crédito']] as const) {
        if (want === undefined) continue;
        const [m] = await q`select id from payment_methods where store_id = ${s.storeId} and online and gateway = ${id} and type = ${type} order by sort limit 1`;
        if (m) await q`update payment_methods set active = ${want} where id = ${m.id}`;
        else if (want) {
          const [{ n }] = (await q`select coalesce(max(sort), 0) + 1 as n from payment_methods where store_id = ${s.storeId}`) as [{ n: number }];
          await q`insert into payment_methods (store_id, tenant_id, name, type, note, sort, active, online, gateway) values (${s.storeId}, ${s.tenantId}, ${name}, ${type}, ${type === 'pix' ? 'Pague na hora, aprovação automática' : 'Pague aqui mesmo, sem sair da loja'}, ${n}, true, true, ${id})`;
        }
      }
      await audit(q, { actorKind: 'staff', actorId: s.staffId, tenantId: s.tenantId, storeId: s.storeId, action: `app.${id}.methods`, ip: req.ip, meta: b });
      return 'ok' as const;
    });
    if (out === 'not_connected') return fail(reply, 409, 'not_connected', 'Conecte a conta antes de ativar as formas de pagamento.');
    if (out === 'no_public_key') return fail(reply, 409, 'no_public_key', 'Para o cartão no checkout transparente, informe a Public Key do Mercado Pago.');
    return { ok: true };
  });
}
