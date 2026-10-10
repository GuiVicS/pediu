import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { client, seedStore, setup, staffLogin, type Env, type Seeded } from './helpers.js';

let env: Env; let seed: Seeded;
before(async () => { env = await setup(); seed = await seedStore(env, 'agente-link'); process.env.AGENT_EXE_URL = 'http://127.0.0.1:1/nada.exe'; });   // nenhum teste fala com a internet
after(() => env.close());

test('download do agente: lista, entrega o bundle e os scripts de início; sem compilar, avisa', async () => {
  const c = client(env);
  process.env.AGENT_DIST_DIR = join(await mkdtemp(join(tmpdir(), 'dist-')), 'nada');
  assert.equal((await c.get('/v1/downloads/agent.json')).body.available, false);
  assert.equal((await c.get('/v1/downloads/pediu-agent.mjs')).status, 404);
  const dir = await mkdtemp(join(tmpdir(), 'dist-')); await writeFile(join(dir, 'agent.mjs'), '#!/usr/bin/env node\nconsole.log("agente");\n');
  process.env.AGENT_DIST_DIR = dir;
  const info = (await c.get('/v1/downloads/agent.json')).body;
  assert.equal(info.available, true); assert.ok(info.sizeBytes > 10); assert.ok(info.files.includes('iniciar-agente-windows.bat'));
  const js = await env.app.inject({ method: 'GET', url: '/v1/downloads/pediu-agent.mjs' });
  assert.equal(js.statusCode, 200); assert.match(String(js.headers['content-disposition']), /attachment; filename="pediu-agent\.mjs"/); assert.ok(js.body.includes('console.log("agente")'));
  const bat = await env.app.inject({ method: 'GET', url: '/v1/downloads/iniciar-agente-windows.bat' });
  assert.ok(bat.body.includes('node pediu-agent.mjs ui') && bat.body.includes('\r\n'));
  assert.equal((await c.get('/v1/downloads/../../etc/passwd')).status, 404);
  assert.equal((await c.get('/v1/downloads/qualquer.exe')).status, 404);
  delete process.env.AGENT_DIST_DIR;
});

test('instalador .exe: arquivo local tem prioridade; senão redireciona para o endereço externo; sem nenhum, avisa', async () => {
  const c = client(env);
  const dir = await mkdtemp(join(tmpdir(), 'dist-')); await writeFile(join(dir, 'agent.mjs'), 'x'.repeat(20));
  process.env.AGENT_DIST_DIR = dir;
  assert.equal((await c.get('/v1/downloads/agent.json')).body.exe, false);                       // endereço externo fora do ar, sem arquivo
  assert.equal((await c.get('/v1/downloads/pediu-agente.exe')).status, 404);

  const ext = createServer((req, res) => { res.writeHead(req.url === '/ok.exe' ? 200 : 404); res.end(); });
  await new Promise<void>((r) => ext.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(ext.address() as { port: number }).port}`;
  try {
    process.env.AGENT_EXE_URL = `${base}/ok.exe`;
    assert.equal((await c.get('/v1/downloads/agent.json')).body.exe, true);
    const red = await env.app.inject({ method: 'GET', url: '/v1/downloads/pediu-agente.exe' });
    assert.equal(red.statusCode, 302); assert.equal(red.headers.location, `${base}/ok.exe`);
    await writeFile(join(dir, 'pediu-agente.exe'), Buffer.from('MZ-fake-exe'));                  // arquivo local vence
    const f = await env.app.inject({ method: 'GET', url: '/v1/downloads/pediu-agente.exe' });
    assert.equal(f.statusCode, 200); assert.equal(f.body, 'MZ-fake-exe'); assert.match(String(f.headers['content-disposition']), /pediu-agente\.exe/);
  } finally { ext.close(); process.env.AGENT_EXE_URL = 'http://127.0.0.1:1/nada.exe'; delete process.env.AGENT_DIST_DIR; }
});

test('"Puxar impressoras": o painel pede, o agente responde pelo WebSocket e a lista volta na hora', async () => {
  const admin = client(env); await staffLogin(env, admin, seed, 'admin');
  const { code } = (await admin.post('/v1/staff/print/pairing')).body;
  const paired = await client(env).post('/v1/agent/pair', { code, name: 'Caixa', platform: 'win32', version: '1.0.0' });
  assert.equal(paired.status, 201);
  const agentId: string = paired.body.agentId;

  // agente offline: 409 com instrução; agente de outra loja ou inexistente: 404
  const off = await admin.post(`/v1/staff/print/agents/${agentId}/discover`);
  assert.equal(off.status, 409); assert.equal(off.body.error.code, 'agent_offline');
  assert.equal((await admin.post('/v1/staff/print/agents/00000000-0000-4000-8000-000000000000/discover')).status, 404);
  assert.equal((await client(env).post(`/v1/staff/print/agents/${agentId}/discover`)).status, 401);

  await env.app.listen({ port: 0, host: '127.0.0.1' });
  const port = (env.app.server.address() as { port: number }).port;
  const got: any[] = [];
  const connect = () => new Promise<WebSocket>((resolve, reject) => { const w = new WebSocket(`ws://127.0.0.1:${port}/v1/agent/ws`, { headers: { authorization: `Bearer ${paired.body.token}` } }); w.on('message', (d) => got.push(JSON.parse(d.toString()))); w.once('open', () => resolve(w)); w.once('error', reject); });
  const ws = await connect();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(got[0]?.type, 'welcome');
  ws.on('message', (d) => { if (JSON.parse(d.toString()).type === 'discover') ws.send(JSON.stringify({ type: 'printers', printers: [{ name: 'Cozinha', kind: 'windows', detail: 'compartilhada como "Cozinha"' }, { name: 'Bar', kind: 'windows' }] })); });
  const r = await admin.post(`/v1/staff/print/agents/${agentId}/discover`);
  assert.equal(r.status, 200); assert.deepEqual(r.body.printers.map((p: { name: string }) => p.name), ['Cozinha', 'Bar']);
  const ov = (await admin.get('/v1/staff/print/overview')).body;
  assert.deepEqual(ov.agents[0].discovered.map((p: { name: string }) => p.name), ['Cozinha', 'Bar']);   // ficou salvo para a tela

  // agente que não responde (versão antiga): 504 sem travar
  const quiet = await connect();   // substitui a conexão anterior e não responde ao "discover"
  await new Promise((r) => setTimeout(r, 150));
  const t0 = Date.now();
  const slow = await admin.post(`/v1/staff/print/agents/${agentId}/discover`);
  assert.equal(slow.status, 504); assert.ok(Date.now() - t0 < 12_000);
  ws.close(); quiet.close();
});
