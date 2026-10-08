import { randomBytes } from 'node:crypto';
import { detectImageType, IMAGE_TYPES, MAX_IMAGE_BYTES, storageFromEnv, storeImage, type StorageConfig } from '@pediu/shared';
import { McpError } from './errors.js';
import { inStore, type Db, type Token } from './core.js';

/**
 * Imagens pelo MCP, de dois jeitos:
 * - base64 dentro da chamada (imagens pequenas, geradas na hora);
 * - link de upload de uso único: o agente envia o arquivo do computador com curl (fotos grandes).
 * As duas exigem que o token possa alterar a loja e devolvem a URL relativa (/uploads/...) para usar em imageUrl, logoUrl etc.
 */
const LINK_TTL_MS = 15 * 60_000;
const MAX_PENDING_PER_TOKEN = 50;

interface Pending { storeId: string; tokenId: string; expires: number }
const pending = new Map<string, Pending>();

const sweep = (now: number) => { for (const [k, v] of pending) if (v.expires <= now) pending.delete(k); };

/** Valida e grava os bytes; devolve a URL relativa e a absoluta (pelo domínio da loja, para conferir no navegador). */
async function save(cfg: StorageConfig, storeId: string, bytes: Buffer, storeOrigin: string) {
  if (!bytes.length) throw new McpError('Arquivo vazio.');
  if (bytes.length > MAX_IMAGE_BYTES) throw new McpError('A imagem passa de 5 MB.');
  const type = detectImageType(bytes);
  if (!type) throw new McpError('O arquivo não é PNG, JPEG, WebP ou GIF.');
  const url = await storeImage(cfg, storeId, bytes, IMAGE_TYPES[type]!.ext, type);
  return { url, urlCompleta: url.startsWith('/') ? `${storeOrigin}${url}` : url, tipo: type, bytes: bytes.length };
}

export interface UploadOpts { storeOrigin: (slug: string) => string; mcpPublicUrl: string; storage?: StorageConfig; now?: () => number }

export function uploadImageBase64(pools: Db, t: Token, storeId: string, data: string, o: UploadOpts) {
  // aceita também "data:image/png;base64,...."
  const b64 = data.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) throw new McpError('base64 inválido.');
  return inStore(pools, t, storeId, 'write', (_q, s) => save(o.storage ?? storageFromEnv(), s.id, Buffer.from(b64, 'base64'), o.storeOrigin(s.slug)));
}

export function createUploadLink(pools: Db, t: Token, storeId: string, o: UploadOpts) {
  return inStore(pools, t, storeId, 'write', async (_q, s) => {
    const now = (o.now ?? Date.now)();
    sweep(now);
    if ([...pending.values()].filter((p) => p.tokenId === t.id).length >= MAX_PENDING_PER_TOKEN) throw new McpError('Muitos links de upload abertos. Use os que já existem ou aguarde 15 minutos.');
    const code = randomBytes(24).toString('base64url');
    pending.set(code, { storeId: s.id, tokenId: t.id, expires: now + LINK_TTL_MS });
    const link = `${o.mcpPublicUrl}/upload/${code}`;
    return {
      link, expiraEm: new Date(now + LINK_TTL_MS).toISOString(),
      comando: `curl -sS --fail-with-body -X PUT --data-binary @"CAMINHO/DA/IMAGEM.jpg" ${link}`,
      instrucoes: 'Rode o comando trocando o caminho do arquivo. A resposta traz "url": use esse valor em imageUrl/logoUrl. O link vale 15 minutos e uma única imagem (PNG, JPEG, WebP ou GIF, até 5 MB).',
    };
  });
}

/** Recebe o arquivo enviado ao link (rota HTTP do servidor, sem token: o próprio link é a credencial, de uso único). */
export async function receiveUpload(code: string, bytes: Buffer, o: UploadOpts & { slugOf: (storeId: string) => Promise<string | null> }) {
  const now = (o.now ?? Date.now)();
  sweep(now);
  const p = pending.get(code);
  if (!p) throw new McpError('Link de upload inválido, já usado ou vencido. Peça outro com criar_link_upload.');
  const slug = await o.slugOf(p.storeId);
  if (!slug) throw new McpError('Loja não encontrada.');
  const out = await save(o.storage ?? storageFromEnv(), p.storeId, bytes, o.storeOrigin(slug));
  pending.delete(code);   // só gasta o link quando a imagem foi aceita (arquivo errado pode ser reenviado)
  return out;
}
