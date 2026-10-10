import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withPlatform } from '@pediu/db';
import { decryptSecret, encryptSecret } from '@pediu/shared';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { resendMailer, type Mailer, type ResendConfig } from './mailer.js';
import { guard } from './session.js';

/**
 * E-mail da plataforma. Prioridade: Resend salvo na tela do super admin (cifrado no banco) > SMTP das variáveis de ambiente.
 * O remetente é sempre da PediuLanchou; a marca da loja (cor, logo, nome) vai dentro do corpo do e-mail.
 */
const KEY = 'mail.resend';
const TTL_MS = 30_000;

export interface MailRuntime extends Mailer {
  describe(): Promise<{ active: 'resend' | 'smtp' | null; saved: { from: string; hasKey: boolean } | null }>;
  invalidate(): void;
}

export function createMailRuntime(ctx: Ctx, smtp: Mailer | undefined, fetchImpl?: typeof fetch): MailRuntime {
  let cache: { at: number; cfg: ResendConfig | null } | null = null;
  const load = async () => {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.cfg;
    const [r] = await withPlatform(ctx.pools, (q) => q`select value_enc from platform_settings where key = ${KEY}`);
    let cfg: ResendConfig | null = null;
    try { cfg = r ? JSON.parse(decryptSecret(r.value_enc, ctx.ring)) as ResendConfig : null; } catch { cfg = null; }
    cache = { at: Date.now(), cfg };
    return cfg;
  };
  return {
    ready: async () => !!(await load()) || !!smtp,
    send: async (m) => {
      const cfg = await load();
      if (cfg) return resendMailer(cfg, fetchImpl).send(m);
      if (smtp) return smtp.send(m);
      throw new Error('Nenhum provedor de e-mail configurado.');
    },
    describe: async () => { const c = await load(); return { active: c ? 'resend' : smtp ? 'smtp' : null, saved: c ? { from: c.from, hasKey: !!c.apiKey } : null }; },
    invalidate: () => { cache = null; },
  };
}

const from = z.string().trim().max(200).refine((v) => /^(?:[^<>@\r\n]+<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(v), 'Informe um remetente válido, ex.: PediuLanchou <nao-responda@pediulanchou.com.br>.');

export function mailSettingsRoutes(app: FastifyInstance, ctx: Ctx, runtime: MailRuntime) {
  const P = '/v1/platform/mail-settings';

  app.get(P, { preHandler: guard(ctx) }, async () => runtime.describe());

  // a chave é gravada cifrada e nunca volta nas respostas; trocar exige o autenticador reconfirmado
  app.put(P, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const b = parse(z.object({ apiKey: z.string().trim().min(10).max(300).optional(), from }), req.body, reply); if (!b) return;
    const out = await withPlatform(ctx.pools, async (q) => {
      const [cur] = await q`select value_enc from platform_settings where key = ${KEY}`;
      let prev: ResendConfig | null = null; try { prev = cur ? JSON.parse(decryptSecret(cur.value_enc, ctx.ring)) as ResendConfig : null; } catch { prev = null; }
      const apiKey = b.apiKey ?? prev?.apiKey;
      if (!apiKey) return 'no_key' as const;
      await q`insert into platform_settings (key, value_enc, updated_by) values (${KEY}, ${encryptSecret(JSON.stringify({ apiKey, from: b.from } satisfies ResendConfig), ctx.ring)}, ${req.session!.adminId})
              on conflict (key) do update set value_enc = excluded.value_enc, updated_by = excluded.updated_by, updated_at = now()`;
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'platform.mail_settings_updated', ip: req.ip, meta: { from: b.from, keyChanged: !!b.apiKey } });
      return 'ok' as const;
    });
    if (out === 'no_key') return fail(reply, 400, 'key_required', 'Informe a chave de API do Resend.');
    runtime.invalidate();
    return { ok: true };
  });

  app.delete(P, { preHandler: guard(ctx, { stepUp: true }) }, async (req) => {
    await withPlatform(ctx.pools, async (q) => {
      await q`delete from platform_settings where key = ${KEY}`;
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'platform.mail_settings_removed', ip: req.ip });
    });
    runtime.invalidate();
    return { ok: true };
  });

  // e-mail de teste para o endereço informado (mostra o erro do provedor, sem a chave)
  app.post(`${P}/test`, { preHandler: guard(ctx), config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({ to: z.string().trim().toLowerCase().email().max(160) }), req.body, reply); if (!b) return;
    if (!(await runtime.ready!())) return { ok: false, error: 'Nenhum provedor de e-mail configurado.' };
    const t0 = Date.now();
    try {
      await runtime.send({ to: b.to, subject: 'Teste de e-mail — PediuLanchou', text: 'Se você recebeu esta mensagem, o envio de e-mails da plataforma está funcionando.', html: '<p>Se você recebeu esta mensagem, o envio de e-mails da <b>PediuLanchou</b> está funcionando.</p>' });
      return { ok: true, ms: Date.now() - t0 };
    } catch (e) {
      const cfg = (await withPlatform(ctx.pools, (q) => q`select value_enc from platform_settings where key = ${KEY}`))[0];
      let key = ''; try { key = cfg ? (JSON.parse(decryptSecret(cfg.value_enc, ctx.ring)) as ResendConfig).apiKey : ''; } catch { /* sem chave para esconder */ }
      return { ok: false, error: String((e as Error).message).split(key || '\u0000').join('••••').slice(0, 300) };
    }
  });
}
