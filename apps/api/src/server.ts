import { createPools } from '@pediu/db';
import { buildApp } from './app.js';
import { evaluateAlerts, runRetention, webhookNotifier } from './alerts.js';
import { pollIfood } from './ifood.js';
import { reconcilePayments } from './payments.js';
import { dispatchJobs } from './printing.js';
import { runDunning } from './billing.js';
import { Telemetry } from './telemetry.js';
import { systemClock, type Ctx } from './context.js';
import { loadEnv } from './env.js';
import { smtpMailer } from './mailer.js';
import { anthropicLlm, openAiTranscriber } from './llm.js';

const env = loadEnv();
const pools = createPools({ app: env.APP_DATABASE_URL, platform: env.PLATFORM_DATABASE_URL, mcp: env.MCP_DATABASE_URL });
const telemetry = new Telemetry(pools);
const mailer = env.SMTP_HOST ? smtpMailer({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE === 'true', user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.MAIL_FROM }) : undefined;
const llm = env.ANTHROPIC_API_KEY ? anthropicLlm({ apiKey: env.ANTHROPIC_API_KEY, model: env.AGENT_MODEL }) : undefined;
const transcriber = env.TRANSCRIBE_API_KEY || env.TRANSCRIBE_URL ? openAiTranscriber({ url: env.TRANSCRIBE_URL ?? 'https://api.openai.com/v1/audio/transcriptions', apiKey: env.TRANSCRIBE_API_KEY, model: env.TRANSCRIBE_MODEL }) : undefined;
const ctx: Ctx = { pools, mailer, llm, transcriber, ring: env.ring, clock: systemClock, baseDomain: env.BASE_DOMAIN, cookieSecure: env.cookieSecure, publicUrl: env.PUBLIC_API_URL, telemetry, notifier: env.ALERT_WEBHOOK_URL ? webhookNotifier(env.ALERT_WEBHOOK_URL) : undefined };
telemetry.start();
const app = buildApp(ctx, { trustProxy: env.trustProxy, logger: true, platformUiDir: env.PLATFORM_UI_DIR });

// régua de cobrança: roda de hora em hora (com várias instâncias, a suspensão é idempotente)
const dunning = setInterval(() => runDunning(ctx).then((r) => r.suspended.length && app.log.info({ suspended: r.suspended }, 'lojas suspensas por atraso')).catch((e) => app.log.error(e)), 3_600_000);
dunning.unref();
// alertas a cada minuto; retenção de dados antigos uma vez por dia
const alerts = setInterval(() => evaluateAlerts(ctx, ctx.notifier).catch((e) => app.log.error(e)), 60_000); alerts.unref();
const retention = setInterval(() => runRetention(ctx).then((r) => app.log.info(r, 'retenção')).catch((e) => app.log.error(e)), 86_400_000); retention.unref();

// impressão: reenvio, reserva e baixa a cada 5 s; pagamentos: conciliação a cada 30 s; iFood: polling a cada 30 s (só roda se as credenciais existirem)
const every = (ms: number, name: string, fn: () => Promise<unknown>) => { const t = setInterval(() => fn().catch((e) => app.log.error({ err: e }, name)), ms); t.unref(); return t; };
const timers = [every(5_000, 'print.dispatch', () => dispatchJobs(ctx)), every(30_000, 'payments.reconcile', () => reconcilePayments(ctx)), every(30_000, 'ifood.poll', () => pollIfood(ctx))];

const stop = async () => { timers.forEach(clearInterval); clearInterval(dunning); clearInterval(alerts); clearInterval(retention); await app.close(); await telemetry.stop(); await pools.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
await app.listen({ port: env.PORT, host: '0.0.0.0' });
