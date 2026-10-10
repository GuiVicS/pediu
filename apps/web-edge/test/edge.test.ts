import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appForPath, buildEdge, manifestFor, PWA_APPS, type Resolved } from '../src/edge.js';

const store: Resolved = { storeId: 's1', slug: 'burger-lab', name: 'Burger Lab', status: 'producao', version: null, source: 'builtin', supportEnded: false, themeColor: '#c0392b', iconUrl: null, description: null, title: null };

function app(s: Resolved = store) {
  const dir = mkdtempSync(join(tmpdir(), 'edge-'));
  mkdirSync(join(dir, 'web', 'builtin'), { recursive: true });
  writeFileSync(join(dir, 'web', 'builtin', 'index.html'), '<!doctype html><html><head><!--pediu-head--></head><body></body></html>');
  const fetchImpl = (async () => new Response(JSON.stringify(s), { status: 200 })) as typeof fetch;
  return buildEdge({ apiUrl: 'http://api.test', edgeSecret: 's', builtinDir: dir, cacheDir: join(dir, 'cache'), fetchImpl } as never);
}
const get = (a: ReturnType<typeof app>, url: string) => a.inject({ method: 'GET', url, headers: { host: 'burger-lab.pediu.test' } });

test('appForPath reconhece só as telas de operação', () => {
  assert.equal(appForPath('/garcom'), 'garcom'); assert.equal(appForPath('/painel/pedidos'), 'painel');
  assert.equal(appForPath('/pdv'), 'pdv'); assert.equal(appForPath('/entregador'), 'entregador');
  assert.equal(appForPath('/'), null); assert.equal(appForPath('/categoria/1'), null); assert.equal(appForPath('/garcomx'), null);
});

test('manifesto da loja abre na vitrine; o de cada app abre direto na tela dele, com instalação própria', () => {
  const m = manifestFor(store);
  assert.equal(m.start_url, '/?source=pwa'); assert.equal(m.id, '/'); assert.equal(m.name, 'Burger Lab');
  const g = manifestFor(store, 'garcom');
  assert.equal(g.start_url, '/garcom?source=pwa'); assert.equal(g.id, '/garcom'); assert.equal(g.name, 'Burger Lab · Garçom'); assert.equal(g.scope, '/garcom');
  assert.equal(m.scope, '/');   // a loja fica com a raiz; cada app de operação, com o próprio escopo
  assert.equal(new Set(Object.keys(PWA_APPS).map((k) => manifestFor(store, k).icons[0]!.src)).size, 5);   // um ícone por app
  assert.deepEqual(new Set(Object.keys(PWA_APPS).map((k) => manifestFor(store, k).id)).size, 5);
  assert.equal(manifestFor(store, 'inexistente').id, '/');
  // instalável: sempre há ícone de 192 px ou mais; app de operação usa a marca da plataforma, a loja usa o próprio ícone quando tem
  assert.ok(m.icons.some((i) => i.sizes === '192x192'));
  assert.equal(manifestFor({ ...store, iconUrl: '/uploads/logo.png' }).icons[0]!.src, '/uploads/logo.png');
  assert.equal(manifestFor({ ...store, iconUrl: '/uploads/logo.png' }, 'pdv').icons[0]!.src, '/brand/apps/pdv-192.png');
  assert.ok(manifestFor(store, 'pdv').icons.some((i) => i.sizes === '192x192' && i.purpose === 'maskable'));
});

test('o edge serve o manifesto certo e injeta o link no HTML de cada rota', async () => {
  const a = app();
  const man = await get(a, '/manifest.webmanifest?app=entregador');
  assert.equal(man.statusCode, 200); assert.equal(man.json().start_url, '/entregador?source=pwa');
  assert.equal((await get(a, '/manifest.webmanifest?app=hack')).json().start_url, '/?source=pwa');
  assert.match((await get(a, '/garcom')).body, /<link rel="manifest" href="\/manifest\.webmanifest\?app=garcom">/);
  assert.match((await get(a, '/painel/produtos')).body, /manifest\.webmanifest\?app=painel/);
  const home = (await get(a, '/')).body;
  assert.match(home, /<link rel="manifest" href="\/manifest\.webmanifest">/); assert.doesNotMatch(home, /\?app=/);
});

test('link de prévia: em desenvolvimento grava o cookie e tira o código da URL; loja no ar ignora', async () => {
  const dev = app({ ...store, status: 'desenvolvimento' });
  const code = 'a'.repeat(32);
  const r = await get(dev, `/cardapio?x=1&previa=${code}`);
  assert.equal(r.statusCode, 302); assert.equal(r.headers.location, '/cardapio?x=1');
  assert.match(String(r.headers['set-cookie']), new RegExp(`^pediu_previa=${code}; Path=/; .*HttpOnly; Secure; SameSite=Lax`));
  // código malformado: só limpa a URL, sem cookie
  const ruim = await get(dev, '/?previa=<script>');
  assert.equal(ruim.statusCode, 302); assert.equal(ruim.headers.location, '/'); assert.equal(ruim.headers['set-cookie'], undefined);
  // prévia não vai para buscadores
  assert.equal((await get(dev, '/')).headers['x-robots-tag'], 'noindex');
  const prod = await get(app(), `/?previa=${code}`);
  assert.equal(prod.statusCode, 200); assert.equal(prod.headers['set-cookie'], undefined); assert.equal(prod.headers['x-robots-tag'], undefined);
});

test('endereço da plataforma (cadastrado no super admin) vai inteiro para a API ou o MCP; endereço de loja continua isolado', async () => {
  const { createServer } = await import('node:http');
  const upstream = (name: string) => new Promise<{ url: string; close(): void }>((resolve) => {
    const s = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ from: name, url: req.url, host: req.headers['x-forwarded-host'] })); });
    s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, close: () => s.close() }));
  });
  const api = await upstream('api'), mcp = await upstream('mcp');
  const dir = mkdtempSync(join(tmpdir(), 'edge-'));
  mkdirSync(join(dir, 'web', 'builtin'), { recursive: true });
  writeFileSync(join(dir, 'web', 'builtin', 'index.html'), '<!doctype html><html><head><!--pediu-head--></head><body></body></html>');
  let hosts = [{ hostname: 'delivery.serafim.test', role: 'admin' }, { hostname: 'ia.serafim.test', role: 'mcp' }];
  const fetchImpl = (async (u: string) => String(u).includes('/v1/edge/platform-hosts') ? new Response(JSON.stringify({ hosts }), { status: 200 }) : new Response(JSON.stringify(store), { status: 200 })) as typeof fetch;
  const a = buildEdge({ apiUrl: api.url, mcpUrl: mcp.url, edgeSecret: 's', builtinDir: dir, cacheDir: join(dir, 'cache'), fetchImpl } as never);
  try {
    await a.ready();
    const call = async (host: string, url: string, method: 'GET' | 'POST' = 'GET') => { const r = await a.inject({ method, url, headers: { host } }); return { status: r.statusCode, body: (() => { try { return r.json(); } catch { return r.body; } })() }; };
    // super admin: a tela (/) e as rotas /v1/platform chegam à API, com o endereço original
    assert.deepEqual((await call('delivery.serafim.test', '/')).body, { from: 'api', url: '/', host: 'delivery.serafim.test' });
    assert.deepEqual((await call('delivery.serafim.test', '/v1/platform/stores?x=1')).body, { from: 'api', url: '/v1/platform/stores?x=1', host: 'delivery.serafim.test' });
    assert.equal((await call('delivery.serafim.test', '/v1/webhooks/mercadopago', 'POST')).body.from, 'api');
    assert.deepEqual((await call('ia.serafim.test', '/mcp', 'POST')).body, { from: 'mcp', url: '/mcp', host: 'ia.serafim.test' });
    // loja: rotas da plataforma seguem bloqueadas, inclusive tentando o prefixo interno por fora
    assert.equal((await call('burger-lab.pediu.test', '/v1/platform/stores')).status, 404);
    assert.equal((await call('burger-lab.pediu.test', '/__plataforma/api/v1/platform/stores')).status, 404);
    assert.equal((await call('burger-lab.pediu.test', '/__plataforma/mcp/mcp', 'POST')).status, 404);
    assert.equal((await call('delivery.serafim.test', '/__plataforma/api/v1/platform/stores')).status, 404);
    assert.match(String((await call('burger-lab.pediu.test', '/')).body), /<!doctype html>/);
    // endereço removido no super admin deixa de ser plataforma na próxima consulta
    hosts = []; await (a as unknown as { refreshPlatformHosts(): Promise<void> }).refreshPlatformHosts();
    assert.match(String((await call('delivery.serafim.test', '/')).body), /<!doctype html>/);
  } finally { await a.close(); api.close(); mcp.close(); }
});
