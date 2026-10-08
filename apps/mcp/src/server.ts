import { createServer, type IncomingMessage } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createRolePool } from '@pediu/db';
import { MAX_IMAGE_BYTES } from '@pediu/shared';
import { authenticate, rateLimiter } from './auth.js';
import { McpError } from './errors.js';
import { createMcpServer } from './tools.js';
import { receiveUpload } from './uploads.js';

const url = process.env.MCP_DATABASE_URL;           // conexão do role mcp_agent (nunca a da plataforma)
if (!url) { console.error('Defina MCP_DATABASE_URL (role mcp_agent).'); process.exit(1); }
const baseDomain = process.env.BASE_DOMAIN ?? 'pediulanchou.com.br';
const previewDomain = process.env.PREVIEW_DOMAIN || baseDomain;   // domínio das lojas nos links de prévia e de imagem
const mcpPublicUrl = (process.env.MCP_PUBLIC_URL ?? '').replace(/\/$/, '');   // endereço público do MCP (links de upload)
const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const trustProxy = process.env.TRUST_PROXY !== 'false';
const MAX_BODY = 8_000_000;   // cabe uma imagem de 5 MB em base64 (enviar_imagem)

const pool = createRolePool(url);
const db = { mcp: pool };
const allow = rateLimiter(120, 60_000);

const send = (res: import('node:http').ServerResponse, status: number, message: string, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
};
const clientIp = (req: IncomingMessage) => (trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim() : '') || req.socket.remoteAddress || '';
const readBody = (req: IncomingMessage) => new Promise<unknown>((resolve, reject) => {
  let size = 0; const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || 'null')); } catch { reject(new Error('bad_json')); } });
  req.on('error', reject);
});

const readRaw = (req: IncomingMessage, max: number) => new Promise<Buffer>((resolve, reject) => {
  let size = 0; const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => { size += c.length; if (size > max) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const sendJson = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body));
};
const uploadLimit = rateLimiter(60, 60_000);

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/health') { res.writeHead(200).end('ok'); return; }
    // link de upload de uso único (criar_link_upload): o código no caminho é a credencial
    const up = req.url?.match(/^\/upload\/([A-Za-z0-9_-]{32})$/);
    if (up) {
      if (req.method !== 'PUT' && req.method !== 'POST') return sendJson(res, 405, { erro: 'Use PUT (curl -X PUT --data-binary @arquivo).' });
      if (!uploadLimit(clientIp(req))) return sendJson(res, 429, { erro: 'Muitos envios. Aguarde um minuto.' });
      const bytes = await readRaw(req, MAX_IMAGE_BYTES).catch(() => null);
      if (!bytes) return sendJson(res, 413, { erro: 'A imagem passa de 5 MB.' });
      try {
        const out = await receiveUpload(up[1]!, bytes, { storeOrigin: (slug) => `https://${slug}.${previewDomain}`, mcpPublicUrl,
          slugOf: async (id) => ((await pool.begin((q) => q`select slug from stores where id = ${id}`))[0]?.slug as string | undefined) ?? null });
        return sendJson(res, 201, out);
      } catch (e) {
        if (e instanceof McpError) return sendJson(res, 400, { erro: e.message });
        throw e;
      }
    }
    if (req.url !== '/mcp') return send(res, 404, 'Rota inexistente. Use POST /mcp.');
    if (req.method !== 'POST') return send(res, 405, 'Use POST (MCP Streamable HTTP sem estado).', { allow: 'POST' });
    // clientes MCP não enviam Origin; navegadores só entram com origem liberada (proteção contra DNS rebinding)
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) return send(res, 403, 'Origem não permitida.');

    const token = await authenticate(db, req.headers.authorization, clientIp(req));
    if (!token) return send(res, 401, 'Token ausente, inválido, revogado ou vencido. Gere um no super admin.', { 'www-authenticate': 'Bearer' });
    if (!allow(token.id)) return send(res, 429, 'Muitas requisições. Aguarde um minuto.', { 'retry-after': '60' });

    const body = await readBody(req).catch((e: Error) => (e.message === 'too_large' ? 'too_large' : 'bad_json'));
    if (body === 'too_large') return send(res, 413, 'Corpo grande demais (máx. 8 MB).');
    if (body === 'bad_json') return send(res, 400, 'JSON inválido.');

    // sem estado: servidor e transporte novos por requisição, autenticados como o dono do token
    // sem MCP_PUBLIC_URL, os links de upload usam o endereço pelo qual o agente chegou (atrás do proxy com HTTPS)
    const publicUrl = mcpPublicUrl || `https://${String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0]!.trim()}`;
    const mcp = createMcpServer(db, token, { baseDomain, previewDomain, mcpPublicUrl: publicUrl });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); mcp.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    console.error('[mcp] falha', e);
    if (!res.headersSent) send(res, 500, 'Erro interno.');
  }
});

const port = Number(process.env.PORT ?? 3100);
server.listen(port, '0.0.0.0', () => console.log(`MCP em http://0.0.0.0:${port}/mcp`));
const stop = async () => { server.close(); await pool.close(); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
