import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { IMAGE_TYPES, MAX_IMAGE_BYTES, storageFromEnv, storeImage, type StorageConfig } from '@pediu/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from './context.js';
import { fail, parse } from './http.js';
import { staffGuard } from './staff.js';

// tipos, limite e gravação ficam no @pediu/shared (o MCP usa os mesmos)
export { IMAGE_TYPES, MAX_IMAGE_BYTES, storageFromEnv, storeImage, type StorageConfig } from '@pediu/shared';
const MAX = MAX_IMAGE_BYTES;
const TYPES = IMAGE_TYPES;

export function uploadRoutes(app: FastifyInstance, ctx: Ctx, cfg: StorageConfig = storageFromEnv()) {
  app.post('/v1/staff/uploads', { preHandler: staffGuard(ctx), bodyLimit: Math.ceil(MAX * 1.4) }, async (req, reply) => {
    const s = req.staff!;
    if (!['admin', 'gerente'].includes(s.role)) return fail(reply, 403, 'forbidden', 'Seu perfil não envia imagens.');
    const b = parse(z.object({ contentType: z.string(), dataBase64: z.string().min(20) }), req.body, reply); if (!b) return;
    const t = TYPES[b.contentType];
    if (!t) return fail(reply, 415, 'unsupported', 'Use PNG, JPEG, WebP ou GIF.');
    const bytes = Buffer.from(b.dataBase64, 'base64');
    if (bytes.length > MAX) return fail(reply, 413, 'too_large', 'A imagem passa de 5 MB.');
    if (!t.magic(bytes)) return fail(reply, 422, 'bad_image', 'O arquivo não é uma imagem válida deste tipo.');
    try { return { url: await storeImage(cfg, s.storeId, bytes, t.ext, b.contentType) }; }
    catch (e) { ctx.telemetry?.log({ level: 'error', service: 'api', event: 'upload.failed', message: String((e as Error).message).slice(0, 300), storeId: s.storeId }); return fail(reply, 502, 'storage_failed', 'Não foi possível salvar a imagem agora.'); }
  });

  // leitura pública das imagens salvas em disco (com Supabase Storage as URLs já apontam para lá)
  app.get('/uploads/:store/:file', async (req, reply) => {
    const { store, file } = req.params as { store: string; file: string };
    if (!/^[0-9a-f-]{36}$/.test(store) || !/^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/.test(file)) return fail(reply, 404, 'not_found', 'Arquivo inexistente.');
    const path = normalize(join(cfg.dir, store, file));
    try {
      const data = await readFile(path);
      const type = file.endsWith('png') ? 'image/png' : file.endsWith('jpg') ? 'image/jpeg' : file.endsWith('webp') ? 'image/webp' : 'image/gif';
      return reply.header('content-type', type).header('cache-control', 'public, max-age=31536000, immutable').header('x-content-type-options', 'nosniff').send(data);
    } catch { return fail(reply, 404, 'not_found', 'Arquivo inexistente.'); }
  });
}
