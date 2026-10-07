import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { alertRoutes, logRoutes } from './alerts.js';
import { analyticsRoutes, staffDashboardRoutes } from './analytics.js';
import { authRoutes } from './auth.js';
import { billingRoutes } from './billing.js';
import type { Ctx } from './context.js';
import { fail } from './http.js';
import { collectionRoutes } from './collections.js';
import { customerRoutes } from './customers.js';
import { ifoodRoutes } from './ifood.js';
import { orderRoutes } from './orders.js';
import { paymentRoutes } from './payments.js';
import { printingRoutes } from './printing.js';
import { realtimeRoutes } from './realtime.js';
import { releaseRoutes } from './releases.js';
import { uploadRoutes } from './uploads.js';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { staffRoutes } from './staff.js';
import { extensionRoutes } from './extension.js';
import { featureRoutes, storeRoutes } from './stores.js';

export function buildApp(ctx: Ctx, opts: { trustProxy?: boolean; logger?: boolean; platformUiDir?: string } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: opts.trustProxy ?? false, bodyLimit: 1_000_000 });
  app.register(cookie);
  app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  // Defesa extra contra CSRF: corpo só em JSON (exige preflight CORS) além do SameSite=Strict do cookie.
  app.addHook('preValidation', async (req, reply) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && (req.url.startsWith('/v1/platform') || req.url.startsWith('/v1/staff')) && req.headers['content-length'] !== '0'
      && req.body !== undefined && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return fail(reply, 415, 'json_required', 'Envie o corpo como application/json.');
    }
  });

  // métricas e logs de toda requisição (a rota é o padrão, nunca a URL com ids/tokens)
  app.addHook('onResponse', async (req, reply) => {
    const t = ctx.telemetry; if (!t) return;
    const route = req.routeOptions?.url ?? 'desconhecida';
    if (route === '/health') return;
    const ms = reply.elapsedTime;
    const scope = route.startsWith('/v1/webhooks') ? 'webhook' : route.startsWith('/v1/platform') ? 'platform' : 'store';
    const storeId = req.staff?.storeId ?? null, tenantId = req.staff?.tenantId ?? null;
    t.metric({ scope, route, method: req.method, status: reply.statusCode, ms, storeId, tenantId });
    if (reply.statusCode >= 500) t.log({ level: 'error', service: 'api', event: 'http.5xx', message: `${req.method} ${route} → ${reply.statusCode}`, status: reply.statusCode, durationMs: Math.round(ms), requestId: req.id, storeId, tenantId });
    else if (reply.statusCode === 401 || reply.statusCode === 403 || reply.statusCode === 423) t.log({ level: 'warn', service: 'api', event: 'http.denied', message: `${req.method} ${route} → ${reply.statusCode}`, status: reply.statusCode, requestId: req.id, storeId, tenantId });
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    return payload;
  });

  app.get('/health', async () => ({ ok: true }));
  authRoutes(app, ctx);
  storeRoutes(app, ctx);
  featureRoutes(app, ctx);
  extensionRoutes(app, ctx);
  billingRoutes(app, ctx);
  analyticsRoutes(app, ctx);
  staffDashboardRoutes(app, ctx);
  alertRoutes(app, ctx);
  logRoutes(app, ctx);
  staffRoutes(app, ctx);
  orderRoutes(app, ctx);
  customerRoutes(app, ctx);
  collectionRoutes(app, ctx);
  realtimeRoutes(app, ctx);
  uploadRoutes(app, ctx);
  printingRoutes(app, ctx);
  paymentRoutes(app, ctx);
  ifoodRoutes(app, ctx);
  releaseRoutes(app, ctx);

  // tela do super admin (build do apps/platform) servida pela própria API: mesma origem, cookie SameSite=Strict funciona sem CORS
  if (opts.platformUiDir && existsSync(opts.platformUiDir)) {
    app.register(fastifyStatic, { root: opts.platformUiDir, wildcard: false, index: ['index.html'], cacheControl: false, setHeaders: (res, path) => { if (/\/assets\//.test(path)) res.setHeader('cache-control', 'public, max-age=31536000, immutable'); else res.setHeader('cache-control', 'no-cache'); } });
    app.setNotFoundHandler((req, reply) => (req.method === 'GET' && !req.url.startsWith('/v1') ? reply.sendFile('index.html') : fail(reply, 404, 'not_found', 'Rota inexistente.')));
  }

  app.setErrorHandler((err, req, reply) => {
    const e = err as { statusCode?: number; message: string };
    if (e.statusCode && e.statusCode < 500) return fail(reply, e.statusCode, 'bad_request', e.message);
    req.log.error(err);
    ctx.telemetry?.log({ level: 'error', service: 'api', event: 'unhandled', message: String(e.message).slice(0, 500), requestId: req.id });
    return fail(reply, 500, 'internal', 'Erro interno.');
  });
  return app;
}
