import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from './context.js';
import { fail, parse } from './http.js';
import { staffGuard } from './staff.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX = MAX_IMAGE_BYTES;
export const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'image/gif': { ext: 'gif', magic: (b) => b.subarray(0, 4).toString() === 'GIF8' },
};
const TYPES = IMAGE_TYPES;

export interface StorageConfig { supabaseUrl?: string; serviceKey?: string; bucket: string; dir: string; publicBase: string }
export const storageFromEnv = (env = process.env): StorageConfig => ({
  supabaseUrl: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY, bucket: env.SUPABASE_BUCKET ?? 'pediu-public', dir: env.UPLOADS_DIR ?? './data/uploads', publicBase: env.PUBLIC_API_URL ?? '',
});

/** Envia a imagem para o Supabase Storage (se configurado) ou para o disco; devolve a URL pública. */
export async function storeImage(cfg: StorageConfig, storeId: string, bytes: Buffer, ext: string, contentType: string): Promise<string> {
  const path = `${storeId}/${randomUUID()}.${ext}`;
  if (cfg.supabaseUrl && cfg.serviceKey) {
    const res = await fetch(`${cfg.supabaseUrl}/storage/v1/object/${cfg.bucket}/${path}`, { method: 'POST', headers: { authorization: `Bearer ${cfg.serviceKey}`, apikey: cfg.serviceKey, 'content-type': contentType, 'x-upsert': 'false' }, body: bytes });
    if (!res.ok) throw new Error(`Storage respondeu ${res.status}`);
    return `${cfg.supabaseUrl}/storage/v1/object/public/${cfg.bucket}/${path}`;
  }
  const full = join(cfg.dir, path);
  await mkdir(join(cfg.dir, storeId), { recursive: true });
  await writeFile(full, bytes);
  return `${cfg.publicBase}/uploads/${path}`;
}

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
