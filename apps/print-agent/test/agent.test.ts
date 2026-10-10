import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { request } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent, type ConnStatus } from '../src/agent.js';
import { autostart, autostartContent, autostartFile } from '../src/autostart.js';
import { PrintedLog } from '../src/config.js';
import { Controller, createUiServer } from '../src/ui.js';
import { PAGE } from '../src/uiPage.js';
import { runInNewContext } from 'node:vm';

class FakeWs extends EventEmitter {
  readyState = 1; sent: any[] = [];
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close(code = 1000) { this.readyState = 3; this.emit('close', code); }
}
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test('agente responde "discover" com a lista de impressoras e informa o estado da conexão', async () => {
  const ws = new FakeWs(); const status: ConnStatus[] = []; const ac = new AbortController();
  const printed = await new PrintedLog(join(await mkdtemp(join(tmpdir(), 'pa-')), 'p.json')).load();
  const run = runAgent({ cfg: { apiUrl: 'https://loja.test', token: 'pag_x', agentId: 'a', name: 'Caixa' }, version: '9.9.9', printed, signal: ac.signal, log: () => undefined, onStatus: (s) => status.push(s), wsFactory: () => ws as never });
  await wait(); ws.emit('open'); await wait(50);
  assert.equal(ws.sent[0].type, 'hello'); assert.equal(ws.sent[0].version, '9.9.9');
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'discover' }))); await wait(50);
  const reply = ws.sent.find((m) => m.type === 'printers');
  assert.ok(reply && Array.isArray(reply.printers), 'respondeu com { type: printers }');
  ws.emit('close', 4001); await run;                                  // removido no painel: o agente para e avisa
  assert.deepEqual(status, ['conectando', 'conectado', 'removido']);
});

test('token recusado marca "recusado" e não fica tentando para sempre', async () => {
  const ws = new FakeWs(); const status: ConnStatus[] = [];
  const printed = await new PrintedLog(join(await mkdtemp(join(tmpdir(), 'pa-')), 'p.json')).load();
  const run = runAgent({ cfg: { apiUrl: 'https://loja.test', token: 't', agentId: 'a', name: 'C' }, version: '1', printed, log: () => undefined, onStatus: (s) => status.push(s), wsFactory: () => ws as never });
  await wait(); ws.emit('close', 4401); await run;
  assert.equal(status.at(-1), 'recusado');
});

test('início automático: caminho e conteúdo por sistema, instalar/remover/status', async () => {
  assert.match(autostartFile('win32', 'C:\\Users\\a', 'C:\\Users\\a\\AppData\\Roaming'), /Startup[\\/]PediuAgente\.vbs$/);
  assert.match(autostartFile('linux', '/home/a'), /\.config\/autostart\/pediu-agent\.desktop$/);
  assert.match(autostartFile('darwin', '/Users/a'), /LaunchAgents\/com\.pediulanchou\.agent\.plist$/);
  const w = autostartContent('win32', 'C:\\Program Files\\nodejs\\node.exe', 'C:\\Pediu\\pediu-agent.mjs');
  assert.ok(w.includes('"C:\\Program Files\\nodejs\\node.exe"') && w.includes('ui --no-open') && w.includes('Run'));
  assert.ok(autostartContent('linux', '/usr/bin/node', '/opt/pediu-agent.mjs').includes('Exec="/usr/bin/node" "/opt/pediu-agent.mjs" ui --no-open'));
  // executável único (.exe): sem script separado, o próprio executável é o comando
  assert.ok(autostartContent('win32', 'C:\\Pediu\\PediuAgente.exe', null).includes('Run """C:\\Pediu\\PediuAgente.exe"" ui --no-open"'));
  assert.ok(autostartContent('linux', '/opt/pediu', null).includes('Exec="/opt/pediu" ui --no-open'));
  assert.ok(autostartContent('darwin', '/opt/pediu', null).includes('<string>/opt/pediu</string><string>ui</string><string>--no-open</string>'));
  const file = join(await mkdtemp(join(tmpdir(), 'pa-')), 'sub', 'pediu.desktop');
  assert.match(await autostart('status', file), /desligado/);
  await autostart('install', file, '/usr/bin/node', '/x/agent.mjs');
  assert.ok((await stat(file)).isFile()); assert.ok((await readFile(file, 'utf8')).includes('/x/agent.mjs'));
  assert.match(await autostart('status', file), /LIGADO/);
  await autostart('remove', file); assert.match(await autostart('status', file), /desligado/);
});

test('tela local: só responde a Host de loopback e exige o token da página', async () => {
  const ctl = new Controller('1.2.3'); const token = 'tok123';
  const server = createUiServer(ctl, token, () => port);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  // http cru: o fetch não deixa trocar o cabeçalho Host, e é justamente isso que o teste de DNS rebinding precisa
  const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}, host = `127.0.0.1:${port}`) => new Promise<{ status: number; text(): Promise<string>; json(): Promise<unknown> }>((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, path, method: init.method ?? 'GET', headers: { ...init.headers, host } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode ?? 0, text: async () => b, json: async () => JSON.parse(b) }));
    });
    r.on('error', reject); r.end(init.body);
  });
  try {
    const page = await call('/'); assert.equal(page.status, 200);
    const html = await page.text(); assert.ok(html.includes(token) && html.includes('1.2.3') && !html.includes('__TOKEN__'));
    assert.equal((await call('/api/status')).status, 403);                                           // sem token
    assert.equal((await call('/api/status', { headers: { 'x-ui-token': 'errado' } })).status, 403);
    assert.equal((await call('/api/status', { headers: { 'x-ui-token': token } }, 'evil.com')).status, 403);   // DNS rebinding
    const st = await (await call('/api/status', { headers: { 'x-ui-token': token } })).json() as any;
    assert.equal(st.paired, false); assert.equal(st.status, 'sem-pareamento');
    const H = { 'x-ui-token': token, 'content-type': 'application/json' };
    assert.equal((await call('/api/pair', { method: 'POST', headers: H, body: JSON.stringify({ url: 'javascript:alert(1)', code: '123456' }) })).status, 400);
    assert.equal((await call('/api/pair', { method: 'POST', headers: H, body: JSON.stringify({ url: 'https://x.test', code: '12' }) })).status, 400);
    assert.equal((await call('/api/test', { method: 'POST', headers: H, body: JSON.stringify({ connection: 'rm -rf', address: 'x' }) })).status, 400);
  } finally { server.close(); }
});

/** Roda o JS da tela do agente num DOM de mentira: cada id vira um objeto simples; `fetch` é o que o teste responder. */
function fakePage(hash: string, status: Record<string, unknown>, onCall: (path: string, body: any) => unknown = () => ({})) {
  const els: Record<string, any> = {}; const calls: { method: string; path: string; body: any }[] = [];
  const el = (id: string) => els[id] ??= { className: '', textContent: '', innerHTML: '', value: '', dataset: {}, disabled: false, lastChild: { textContent: '' }, querySelectorAll: () => [] };
  const location = { hash, pathname: '/' };
  const fetch = async (path: string, init: { method: string; body?: string }) => {
    const body = init.body ? JSON.parse(init.body) : undefined; calls.push({ method: init.method, path, body });
    const out: any = path === '/api/status' ? status : path === '/api/printers' ? { printers: [] } : onCall(path, body);
    const failed = out && typeof out.error === 'string';
    return { ok: !failed, status: failed ? 400 : 200, json: async () => out };
  };
  runInNewContext(/<script>([\s\S]*)<\/script>/.exec(PAGE)![1]!, { document: { getElementById: el }, location, history: { replaceState: () => { location.hash = ''; } }, fetch, setInterval: () => 0, URLSearchParams, confirm: () => true, Date });
  return { el, calls, location };
}
const STATUS = { version: '0.2.0', paired: false, status: 'sem-pareamento', store: null, jobs: [], logs: [], autostart: false, defaultName: 'CAIXA-PC' };

test('tela local: o painel abre #conectar?… e um clique em "Conectar" pareia, sem digitar nada', async () => {
  const q = new URLSearchParams({ url: 'https://pizzaria.test', code: '123456', loja: 'Pizzaria do Gaúcho' });
  const st: any = { ...STATUS };
  const p = fakePage(`#conectar?${q}`, st, (path) => { if (path === '/api/pair') { st.paired = true; st.status = 'conectado'; st.store = { url: 'https://pizzaria.test', name: 'CAIXA-PC' }; } return { ok: true }; });
  await wait();
  assert.equal(p.location.hash, '', 'o código sai da barra de endereço');
  assert.equal(p.el('oneCard').className, 'card big'); assert.equal(p.el('pairCard').className, 'card hide');
  assert.equal(p.el('oneTitle').textContent, 'Conectar à loja Pizzaria do Gaúcho?'); assert.ok(p.el('oneInfo').textContent.startsWith('https://pizzaria.test'));
  assert.ok(!p.calls.some((c) => c.path === '/api/pair'), 'não pareia sozinho: espera o clique');
  p.el('oneBtn').onclick(); await wait(50);
  assert.deepEqual(p.calls.find((c) => c.path === '/api/pair')!.body, { url: 'https://pizzaria.test', code: '123456', name: '' });
  assert.deepEqual(p.calls.find((c) => c.path === '/api/autostart')!.body, { on: true });
  assert.equal(p.el('oneCard').className, 'card big done'); assert.equal(p.el('oneTitle').textContent, 'Pronto! Computador conectado');
});

test('tela local: link de conexão inválido é ignorado e código vencido mostra o erro com "Tentar de novo"', async () => {
  for (const bad of ['#conectar?url=javascript:alert(1)&code=123456', '#conectar?url=https://x.test/caminho&code=123456', '#conectar?url=https://x.test&code=12', '#outra-coisa']) {
    const p = fakePage(bad, { ...STATUS }); await wait();
    assert.notEqual(p.el('oneCard').className, 'card big', bad); assert.equal(p.el('pairCard').className, 'card', bad);
  }
  const p = fakePage('#conectar?url=https://x.test&code=123456', { ...STATUS }, () => ({ error: 'Código inválido ou vencido.' })); await wait();
  assert.equal(p.el('oneTitle').textContent, 'Conectar este computador à loja?');
  p.el('oneBtn').onclick(); await wait(50);
  assert.equal(p.el('oneBtn').textContent, 'Tentar de novo'); assert.ok(p.el('autoMsgPair').innerHTML.includes('Código inválido ou vencido.'));
  assert.equal(p.el('oneCard').className, 'card big');
});
