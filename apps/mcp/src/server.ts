import { createServer, type IncomingMessage } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createRolePool } from '@pediu/db';
import { authenticate, rateLimiter } from './auth.js';
import { createMcpServer } from './tools.js';

const url = process.env.MCP_DATABASE_URL;           // conexão do role mcp_agent (nunca a da plataforma)
if (!url) { console.error('Defina MCP_DATABASE_URL (role mcp_agent).'); process.exit(1); }
const baseDomain = process.env.BASE_DOMAIN ?? 'pediulanchou.com.br';
const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const trustProxy = process.env.TRUST_PROXY !== 'false';
const MAX_BODY = 5_000_000;

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

const server = createServer(async (req, res) => {
  try {
    if (req.url === '/health') { res.writeHead(200).end('ok'); return; }
    if (req.url !== '/mcp') return send(res, 404, 'Rota inexistente. Use POST /mcp.');
    if (req.method !== 'POST') return send(res, 405, 'Use POST (MCP Streamable HTTP sem estado).', { allow: 'POST' });
    // clientes MCP não enviam Origin; navegadores só entram com origem liberada (proteção contra DNS rebinding)
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) return send(res, 403, 'Origem não permitida.');

    const token = await authenticate(db, req.headers.authorization, clientIp(req));
    if (!token) return send(res, 401, 'Token ausente, inválido, revogado ou vencido. Gere um no super admin.', { 'www-authenticate': 'Bearer' });
    if (!allow(token.id)) return send(res, 429, 'Muitas requisições. Aguarde um minuto.', { 'retry-after': '60' });

    const body = await readBody(req).catch((e: Error) => (e.message === 'too_large' ? 'too_large' : 'bad_json'));
    if (body === 'too_large') return send(res, 413, 'Corpo grande demais (máx. 5 MB).');
    if (body === 'bad_json') return send(res, 400, 'JSON inválido.');

    // sem estado: servidor e transporte novos por requisição, autenticados como o dono do token
    const mcp = createMcpServer(db, token, { baseDomain });
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
