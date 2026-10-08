import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Imagens enviadas (API e MCP): tipos aceitos, limite e gravação no Supabase Storage ou no disco. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  'image/gif': { ext: 'gif', magic: (b) => b.subarray(0, 4).toString() === 'GIF8' },
};

/** Descobre o tipo pelo conteúdo do arquivo (não confia no nome nem no Content-Type de quem envia). */
export function detectImageType(bytes: Buffer): string | null {
  return Object.entries(IMAGE_TYPES).find(([, t]) => t.magic(bytes))?.[0] ?? null;
}

/**
 * `publicBase` vazio (padrão) grava a URL relativa (/uploads/...): a imagem abre por qualquer domínio da loja (o edge
 * repassa /uploads para a API) e no super admin. Só defina UPLOADS_PUBLIC_BASE se precisar de URL absoluta.
 */
export interface StorageConfig { supabaseUrl?: string; serviceKey?: string; bucket: string; dir: string; publicBase: string }
export const storageFromEnv = (env = process.env): StorageConfig => ({
  supabaseUrl: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY, bucket: env.SUPABASE_BUCKET ?? 'pediu-public', dir: env.UPLOADS_DIR ?? './data/uploads', publicBase: env.UPLOADS_PUBLIC_BASE ?? '',
});

/** Envia a imagem para o Supabase Storage (se configurado) ou para o disco; devolve a URL pública. */
export async function storeImage(cfg: StorageConfig, storeId: string, bytes: Buffer, ext: string, contentType: string): Promise<string> {
  const path = `${storeId}/${randomUUID()}.${ext}`;
  if (cfg.supabaseUrl && cfg.serviceKey) {
    const res = await fetch(`${cfg.supabaseUrl}/storage/v1/object/${cfg.bucket}/${path}`, { method: 'POST', headers: { authorization: `Bearer ${cfg.serviceKey}`, apikey: cfg.serviceKey, 'content-type': contentType, 'x-upsert': 'false' }, body: bytes });
    if (!res.ok) throw new Error(`Storage respondeu ${res.status}`);
    return `${cfg.supabaseUrl}/storage/v1/object/public/${cfg.bucket}/${path}`;
  }
  await mkdir(join(cfg.dir, storeId), { recursive: true });
  await writeFile(join(cfg.dir, path), bytes);
  return `${cfg.publicBase}/uploads/${path}`;
}
