import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withPlatform, type Q } from '@pediu/db';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import { guard } from './session.js';
import { IMAGE_TYPES, MAX_IMAGE_BYTES, storageFromEnv, storeImage, type StorageConfig } from './uploads.js';

/** Pasta (no armazenamento) das imagens que não pertencem a nenhuma loja: banners da plataforma. */
export const PLATFORM_STORAGE_ID = '00000000-0000-0000-0000-0000000000ba';

const uuid = z.string().uuid();
const PLACEMENTS = ['login', 'dashboard'] as const;
/** Imagem do banner: endereço http(s) ou caminho relativo de upload (/uploads/…), que funciona em qualquer domínio que aponte para a plataforma. */
const httpUrl = z.string().trim().max(2048).refine((u) => /^https?:\/\/[^\s]+$/i.test(u) || /^\/uploads\/[A-Za-z0-9\-._~/]+$/.test(u), 'Informe um endereço http(s) ou um caminho de upload válido.');
/** Link do banner: http(s) ou um caminho do próprio painel (ex.: /painel/cupons). Nunca javascript: ou data:. */
const linkUrl = z.string().trim().max(2048).refine((u) => u === '' || /^https?:\/\/[^\s]+$/i.test(u) || /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?#]*$/.test(u), 'O link deve ser http(s) ou um caminho como /painel.');

const Input = z.object({
  placement: z.enum(PLACEMENTS), title: z.string().trim().max(120).default(''), imageUrl: httpUrl, linkUrl: linkUrl.default(''),
  active: z.boolean().default(true), sort: z.number().int().min(0).max(9999).default(0),
  startsAt: z.string().datetime().nullable().default(null), endsAt: z.string().datetime().nullable().default(null),
}).refine((b) => !b.startsAt || !b.endsAt || b.endsAt > b.startsAt, { message: 'O fim precisa ser depois do início.', path: ['endsAt'] });

const pub = (r: Record<string, any>) => ({ id: r.id, placement: r.placement, title: r.title, imageUrl: r.image_url, linkUrl: r.link_url });
const adm = (r: Record<string, any>) => ({ ...pub(r), active: r.active, sort: r.sort, startsAt: r.starts_at, endsAt: r.ends_at, createdAt: r.created_at });

export function bannerRoutes(app: FastifyInstance, ctx: Ctx, cfg: StorageConfig = storageFromEnv()) {
  // ---- público (tela de login do lojista, antes de qualquer sessão; e painel): só os banners ativos e dentro da validade ----
  app.get('/v1/banners', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({ placement: z.enum(PLACEMENTS) }), req.query, reply); if (!b) return;
    const rows = await ctx.pools.app.begin((q: Q) => q`
      select id, placement, title, image_url, link_url from platform_banners
      where placement = ${b.placement} and active and (starts_at is null or starts_at <= ${ctx.clock.now().toISOString()}::timestamptz)
        and (ends_at is null or ends_at > ${ctx.clock.now().toISOString()}::timestamptz) order by sort, created_at limit 12`);
    reply.header('cache-control', 'public, max-age=60');
    return { banners: rows.map(pub) };
  });

  // ---- super admin ----
  const P = '/v1/platform/banners';
  app.get(P, { preHandler: guard(ctx) }, async () => ({
    banners: (await withPlatform(ctx.pools, (q) => q`select * from platform_banners order by placement, sort, created_at`)).map(adm),
  }));

  // os banners aparecem para todos os lojistas (e levam a um link): criar, editar e apagar exigem o autenticador reconfirmado
  app.post(P, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const b = parse(Input, req.body, reply); if (!b) return;
    const row = await withPlatform(ctx.pools, async (q) => {
      const [r] = await q`insert into platform_banners (placement, title, image_url, link_url, active, sort, starts_at, ends_at, created_by)
        values (${b.placement}, ${b.title}, ${b.imageUrl}, ${b.linkUrl}, ${b.active}, ${b.sort}, ${b.startsAt}, ${b.endsAt}, ${req.session!.adminId}) returning *`;
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'platform.banner_created', ip: req.ip, meta: { id: r!.id, placement: b.placement, linkUrl: b.linkUrl } });
      return r!;
    });
    return reply.status(201).send(adm(row));
  });

  app.put(`${P}/:id`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const b = parse(Input, req.body, reply); if (!b) return;
    const row = await withPlatform(ctx.pools, async (q) => {
      const [r] = await q`update platform_banners set placement = ${b.placement}, title = ${b.title}, image_url = ${b.imageUrl}, link_url = ${b.linkUrl}, active = ${b.active}, sort = ${b.sort},
        starts_at = ${b.startsAt}, ends_at = ${b.endsAt} where id = ${id} returning *`;
      if (r) await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'platform.banner_updated', ip: req.ip, meta: { id, placement: b.placement, linkUrl: b.linkUrl, active: b.active } });
      return r;
    });
    return row ? adm(row) : fail(reply, 404, 'not_found', 'Banner não encontrado.');
  });

  app.delete(`${P}/:id`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const id = parse(uuid, (req.params as { id: string }).id, reply); if (!id) return;
    const n = await withPlatform(ctx.pools, async (q) => {
      const r = await q`delete from platform_banners where id = ${id} returning id`;
      if (r.length) await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'platform.banner_deleted', ip: req.ip, meta: { id } });
      return r.length;
    });
    return n ? { ok: true } : fail(reply, 404, 'not_found', 'Banner não encontrado.');
  });

  // envio da imagem do banner (mesmas regras das imagens das lojas: PNG, JPEG, WebP ou GIF até 5 MB, conferindo o conteúdo)
  app.post('/v1/platform/uploads', { preHandler: guard(ctx), bodyLimit: Math.ceil(MAX_IMAGE_BYTES * 1.4) }, async (req, reply) => {
    const b = parse(z.object({ contentType: z.string(), dataBase64: z.string().min(20) }), req.body, reply); if (!b) return;
    const t = IMAGE_TYPES[b.contentType];
    if (!t) return fail(reply, 415, 'unsupported', 'Use PNG, JPEG, WebP ou GIF.');
    const bytes = Buffer.from(b.dataBase64, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) return fail(reply, 413, 'too_large', 'A imagem passa de 5 MB.');
    if (!t.magic(bytes)) return fail(reply, 422, 'bad_image', 'O arquivo não é uma imagem válida deste tipo.');
    try { return { url: await storeImage(cfg, PLATFORM_STORAGE_ID, bytes, t.ext, b.contentType) }; }
    catch { return fail(reply, 502, 'storage_failed', 'Não foi possível salvar a imagem agora.'); }
  });
}
