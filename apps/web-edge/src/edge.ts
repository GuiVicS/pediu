import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import httpProxy from '@fastify/http-proxy';

export interface Resolved { storeId: string; slug: string; name: string; status: string; version: string | null; source: string; supportEnded: boolean; themeColor: string | null; iconUrl: string | null; description: string | null; title: string | null }
export interface EdgeConfig {
  apiUrl: string; edgeSecret: string;
  // pasta com os bundles publicados, no formato: RELEASES_DIR/web/VERSAO/arquivos
  releasesDir?: string;
  // ou uma URL base (Supabase Storage/CDN) de onde o edge baixa e guarda em cache: BASE/web/VERSAO/arquivos
  releasesBaseUrl?: string;
  // bundle embutido na imagem, usado quando a loja ainda não tem versão publicada
  builtinDir: string;
  cacheDir: string; fetchImpl?: typeof fetch; now?: () => number;
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** Caminho relativo seguro dentro da pasta da versão; recusa `..`, bytes nulos e caminhos absolutos. */
export function safeRel(urlPath: string): string | null {
  let p: string; try { p = decodeURIComponent(urlPath.split('?')[0]!); } catch { return null; }
  if (p.includes('\0') || p.includes('\\')) return null;
  const n = normalize('/' + p).replace(/^\/+/, '');
  if (n.split(sep).includes('..') || n.startsWith('..')) return null;
  return n;
}
const VERSION_RE = /^[0-9A-Za-z.\-]{1,40}$/;

export class Resolver {
  private cache = new Map<string, { v: Resolved | null; at: number; err?: boolean }>();
  constructor(private cfg: EdgeConfig, private ttlMs = 30_000, private negTtlMs = 10_000, private staleMs = 10 * 60_000) {}
  private now() { return (this.cfg.now ?? Date.now)(); }
  async resolve(host: string): Promise<Resolved | null> {
    const key = host.toLowerCase(); const hit = this.cache.get(key); const t = this.now();
    if (hit && t - hit.at < (hit.v ? this.ttlMs : this.negTtlMs)) return hit.v;
    try {
      const res = await (this.cfg.fetchImpl ?? fetch)(`${this.cfg.apiUrl}/v1/edge/resolve?host=${encodeURIComponent(key)}`, { headers: { 'x-edge-secret': this.cfg.edgeSecret }, signal: AbortSignal.timeout(5000) });
      if (res.status === 404) { this.cache.set(key, { v: null, at: t }); return null; }
      if (!res.ok) throw new Error(`API respondeu ${res.status}`);
      const v = (await res.json()) as Resolved; this.cache.set(key, { v, at: t }); return v;
    } catch (e) {
      if (hit?.v && t - hit.at < this.staleMs) return hit.v;     // API fora do ar: mantém a loja no ar com a última resposta conhecida
      throw e;
    }
  }
  clear() { this.cache.clear(); }
}

export class Bundles {
  constructor(private cfg: EdgeConfig) {}
  /** Lê um arquivo da versão pedida (disco, ou baixa e guarda em cache); sem versão ou sem arquivo cai no bundle embutido só para o index. */
  async read(version: string | null, rel: string): Promise<Buffer | null> {
    if (version && VERSION_RE.test(version)) {
      const f = await this.fromRelease(version, rel); if (f) return f;
      return null;
    }
    return this.fromDir(join(this.cfg.builtinDir, 'web', 'builtin'), rel);
  }
  async builtin(rel: string) { return this.fromDir(join(this.cfg.builtinDir, 'web', 'builtin'), rel); }
  private async fromDir(root: string, rel: string): Promise<Buffer | null> {
    const full = normalize(join(root, rel));
    if (!full.startsWith(normalize(root) + sep)) return null;
    try { return await readFile(full); } catch { return null; }
  }
  private async fromRelease(version: string, rel: string): Promise<Buffer | null> {
    if (this.cfg.releasesDir) { const d = await this.fromDir(join(this.cfg.releasesDir, 'web', version), rel); if (d) return d; }
    if (this.cfg.releasesBaseUrl) {
      const root = join(this.cfg.cacheDir, 'web', version);
      const cached = await this.fromDir(root, rel); if (cached) return cached;
      try {
        const res = await (this.cfg.fetchImpl ?? fetch)(`${this.cfg.releasesBaseUrl.replace(/\/$/, '')}/web/${version}/${rel}`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        const full = normalize(join(root, rel));
        if (full.startsWith(normalize(root) + sep)) { await mkdir(dirname(full), { recursive: true }); await writeFile(full, buf); }
        return buf;
      } catch { return null; }
    }
    return null;
  }
}

/** HTML da loja: injeta título, descrição, cor e os dados que a tela precisa (slug, versão) no lugar de <!--pediu-head-->. */
/** Apps de operação instaláveis separadamente (cada um abre direto na própria tela). */
export const PWA_APPS: Record<string, { label: string; start: string; color: string }> = {
  painel: { label: 'Painel', start: '/painel', color: '#0091FF' }, pdv: { label: 'PDV', start: '/pdv', color: '#16A34A' }, garcom: { label: 'Garçom', start: '/garcom', color: '#F59E0B' }, entregador: { label: 'Entregador', start: '/entregador', color: '#7C3AED' },
};
export function appForPath(path: string): string | null {
  const seg = path.split('/')[1] ?? '';
  return seg in PWA_APPS ? seg : null;
}

export function renderIndex(html: string, s: Resolved, app: string | null = null): string {
  const title = s.title || s.name;
  const head = [`<title>${esc(title)}</title>`, s.description ? `<meta name="description" content="${esc(s.description)}">` : '', s.themeColor ? `<meta name="theme-color" content="${esc(s.themeColor)}">` : '',
    `<meta property="og:title" content="${esc(title)}">`, s.description ? `<meta property="og:description" content="${esc(s.description)}">` : '', s.iconUrl ? `<meta property="og:image" content="${esc(s.iconUrl)}"><link rel="icon" href="${esc(s.iconUrl)}">` : '',
    `<link rel="manifest" href="/manifest.webmanifest${app ? `?app=${app}` : ''}">`, `<script>window.__PEDIU__=${jsonForScript({ slug: s.slug, name: s.name, status: s.status, version: s.version ?? 'builtin' })}</script>`].filter(Boolean).join('\n    ');
  return html.includes('<!--pediu-head-->') ? html.replace('<!--pediu-head-->', head) : html.replace('</head>', `    ${head}\n  </head>`);
}

export function manifestFor(s: Resolved, app: string | null = null) {
  const a = app ? PWA_APPS[app] : undefined;
  // Chrome só oferece "instalar" com ícone de pelo menos 192 px: sem logo da loja (ou nos apps de operação) usamos a marca da plataforma
  const brand = [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/brand/mark-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }];
  // cada app de operação tem o próprio ícone (cor + símbolo), para não ficarem iguais na tela inicial do celular
  const appIcons = (k: string) => [192, 512].flatMap((n) => (['any', 'maskable'] as const).map((purpose) => ({ src: `/brand/apps/${k}-${n}.png`, sizes: `${n}x${n}`, type: 'image/png', purpose })));
  const icons = a ? appIcons(app!) : s.iconUrl ? [{ src: s.iconUrl, sizes: '512x512', purpose: 'any' }] : brand;
  // cada app de operação é uma instalação própria: id e escopo próprios (/pdv, /garcom…). A loja fica com "/", e o escopo mais
  // específico vence: um link do PDV abre no app do PDV, não no app da loja. O login de cada app fica dentro do escopo (/pdv/entrar).
  return { id: a ? a.start : '/', name: a ? `${s.name} · ${a.label}` : s.name, short_name: a ? a.label : s.name.slice(0, 14), start_url: a ? `${a.start}?source=pwa` : '/?source=pwa', scope: a ? a.start : '/', display: 'standalone', lang: 'pt-BR', background_color: '#ffffff', theme_color: a ? a.color : s.themeColor ?? '#0091FF', icons };
}

/** Mesmo nome do parâmetro e do cookie usados pela API (apps/api/src/orders.ts) e pelo @pediu/shared. */
const PREVIEW_PARAM = 'previa', PREVIEW_COOKIE = 'pediu_previa';

const NOT_FOUND_PAGE = (host: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loja não encontrada</title><body style="font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f8fb;color:#0f172a"><div style="text-align:center;padding:24px"><h1 style="margin:0 0 8px">Loja não encontrada</h1><p style="color:#64748b">O endereço <b>${esc(host)}</b> não está vinculado a nenhuma loja.</p></div>`;

export function buildEdge(cfg: EdgeConfig, opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  const resolver = new Resolver(cfg), bundles = new Bundles(cfg);
  const hostOf = (req: { headers: Record<string, unknown>; hostname?: string }) => String(req.headers['x-forwarded-host'] ?? req.headers.host ?? req.hostname ?? '').split(',')[0]!.split(':')[0]!.trim().toLowerCase();

  app.get('/health', async () => ({ ok: true }));
  // a API e os uploads passam pelo mesmo domínio da loja (cookie SameSite=Strict de login precisa de mesma origem)
  const blocked = async (_req: unknown, reply: { code(n: number): { send(b: unknown): unknown } }) => reply.code(404).send({ error: { code: 'not_found', message: 'Rota inexistente.' } });
  for (const prefix of ['/v1/platform', '/v1/edge', '/v1/webhooks']) app.all(`${prefix}/*`, blocked as never);
  app.register(httpProxy, { upstream: cfg.apiUrl, prefix: '/v1', rewritePrefix: '/v1', websocket: true, replyOptions: { rewriteRequestHeaders: (req, headers) => ({ ...headers, 'x-forwarded-host': String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '') }) } });
  app.register(httpProxy, { upstream: cfg.apiUrl, prefix: '/uploads', rewritePrefix: '/uploads' });

  app.get('/*', async (req, reply) => {
    const host = hostOf(req);
    let store: Resolved | null;
    try { store = await resolver.resolve(host); } catch { return reply.code(503).header('retry-after', '10').type('text/plain').send('Serviço indisponível. Tente novamente em instantes.'); }
    if (!store) return reply.code(404).type('text/html; charset=utf-8').send(NOT_FOUND_PAGE(host));

    const path = req.url.split('?')[0]!;
    reply.header('x-pediu-version', store.version ?? 'builtin').header('x-content-type-options', 'nosniff').header('referrer-policy', 'strict-origin-when-cross-origin');
    if (path === '/manifest.webmanifest') {
      const q = (req.query as { app?: string }).app;
      return reply.type(MIME['.webmanifest']!).header('cache-control', 'public, max-age=300').send(manifestFor(store, q && q in PWA_APPS ? q : null));
    }

    const rel = safeRel(path);
    if (rel === null) return reply.code(400).send('Caminho inválido.');
    const isAsset = rel !== '' && extname(rel) !== '';
    if (isAsset) {
      const file = (await bundles.read(store.version, rel)) ?? (store.version ? null : await bundles.builtin(rel));
      if (!file) return reply.code(404).type('text/plain').send('Arquivo não encontrado.');
      const immutable = rel.startsWith('assets/');
      return reply.type(MIME[extname(rel).toLowerCase()] ?? 'application/octet-stream').header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300').send(file);
    }
    // link de prévia (?previa=código): guarda o código em cookie (a API confere em cada leitura da vitrine) e tira da URL
    const previa = (req.query as Record<string, string | undefined>)[PREVIEW_PARAM];
    if (store.status === 'desenvolvimento' && previa !== undefined) {
      const params = new URLSearchParams(req.url.split('?')[1] ?? ''); params.delete(PREVIEW_PARAM);
      if (/^[A-Za-z0-9_-]{32,64}$/.test(previa)) reply.header('set-cookie', `${PREVIEW_COOKIE}=${previa}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`);
      return reply.redirect(`${path}${params.size ? `?${params}` : ''}`, 302);
    }
    if (store.status !== 'producao') reply.header('x-robots-tag', 'noindex');   // prévia não aparece em buscadores
    // rota da SPA: devolve o index.html da versão da loja (cai no embutido se a versão publicada sumiu)
    const indexBuf = (await bundles.read(store.version, 'index.html')) ?? (await bundles.builtin('index.html'));
    if (!indexBuf) return reply.code(503).type('text/plain').send('Esta loja ainda não tem uma versão publicada.');
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').header('x-frame-options', 'SAMEORIGIN').send(renderIndex(indexBuf.toString('utf8'), store, appForPath(path)));
  });
  return app;
}
