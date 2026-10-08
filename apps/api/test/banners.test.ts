import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { client, createAdmin, fullLogin, setup, stepUp, type Client, type Env } from './helpers.js';

let env: Env; let dir: string; let sa: Client;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pediu-up-'));
  process.env.UPLOADS_DIR = dir; process.env.PUBLIC_API_URL = 'http://api.test';   // as imagens do teste vão para uma pasta temporária
  env = await setup();
  await createAdmin(env, 'banners@pediu.test'); sa = client(env); await fullLogin(env, sa, 'banners@pediu.test');
});
after(async () => { await env.close(); rmSync(dir, { recursive: true, force: true }); delete process.env.UPLOADS_DIR; delete process.env.PUBLIC_API_URL; });

const body = (o: object = {}) => ({ placement: 'login', title: 'Black Friday', imageUrl: 'https://cdn.test/a.png', linkUrl: 'https://pediulanchou.com.br/promo', active: true, sort: 0, ...o });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]).toString('base64');

test('banners: só o super admin cadastra (com step-up) e valida links e datas', async () => {
  assert.equal((await client(env).get('/v1/platform/banners')).status, 401);
  assert.equal((await sa.post('/v1/platform/banners', body())).status, 403);        // sem step-up
  await stepUp(env, sa, 'banners@pediu.test');
  assert.equal((await sa.post('/v1/platform/banners', body({ linkUrl: 'javascript:alert(1)' }))).status, 400);
  assert.equal((await sa.post('/v1/platform/banners', body({ imageUrl: 'data:image/png;base64,AAAA' }))).status, 400);
  assert.equal((await sa.post('/v1/platform/banners', body({ placement: 'rodape' }))).status, 400);
  assert.equal((await sa.post('/v1/platform/banners', body({ startsAt: '2030-01-02T00:00:00Z', endsAt: '2030-01-01T00:00:00Z' }))).status, 400);
  const ok = await sa.post('/v1/platform/banners', body({ linkUrl: '/painel/cupons', title: 'Cupons novos', sort: 2 }));   // caminho do painel também vale
  assert.equal(ok.status, 201); assert.equal(ok.body.linkUrl, '/painel/cupons');
  assert.equal((await sa.post('/v1/platform/banners', body({ imageUrl: '/uploads/00000000-0000-0000-0000-0000000000ba/a.png' }))).status, 201);   // upload relativo
  assert.equal((await sa.post('/v1/platform/banners', body({ imageUrl: '/etc/passwd' }))).status, 400);                                                // só /uploads/…
});

test('o público vê só os ativos e dentro da validade, na ordem, por área; editar e apagar', async () => {
  await stepUp(env, sa, 'banners@pediu.test');
  const a = (await sa.post('/v1/platform/banners', body({ title: 'B-login-1', sort: 1 }))).body;
  await sa.post('/v1/platform/banners', body({ title: 'A-login-0', sort: 0 }));
  await sa.post('/v1/platform/banners', body({ title: 'inativo', active: false }));
  await sa.post('/v1/platform/banners', body({ title: 'vencido', endsAt: '2020-01-01T00:00:00Z' }));
  await sa.post('/v1/platform/banners', body({ title: 'futuro', startsAt: '2099-01-01T00:00:00Z' }));
  await sa.post('/v1/platform/banners', body({ placement: 'dashboard', title: 'D-faixa', imageUrl: 'https://cdn.test/d.png' }));

  const login = await client(env).get('/v1/banners?placement=login');     // sem sessão: é a tela de login
  assert.equal(login.status, 200);
  const titles = login.body.banners.map((x: { title: string }) => x.title);
  assert.deepEqual(titles.filter((t: string) => ['A-login-0', 'B-login-1', 'inativo', 'vencido', 'futuro'].includes(t)), ['A-login-0', 'B-login-1']);
  assert.ok(!titles.includes('D-faixa'));
  assert.deepEqual(Object.keys(login.body.banners[0]).sort(), ['id', 'imageUrl', 'linkUrl', 'placement', 'title']);   // nada de datas, criador ou status
  assert.deepEqual((await client(env).get('/v1/banners?placement=dashboard')).body.banners.map((x: { title: string }) => x.title), ['D-faixa']);
  assert.equal((await client(env).get('/v1/banners?placement=outro')).status, 400);

  await stepUp(env, sa, 'banners@pediu.test');
  assert.equal((await sa.put(`/v1/platform/banners/${a.id}`, body({ title: 'B editado', active: false }))).status, 200);
  assert.ok(!(await client(env).get('/v1/banners?placement=login')).body.banners.some((x: { title: string }) => x.title === 'B editado'));
  await stepUp(env, sa, 'banners@pediu.test');
  assert.equal((await sa.del(`/v1/platform/banners/${a.id}`)).status, 200);
  assert.equal((await sa.del(`/v1/platform/banners/${a.id}`)).status, 404);
  const [row] = await env.pools.platform.begin((q) => q`select count(*)::int as n from audit_logs where action like 'platform.banner_%'`);
  assert.ok(row!.n >= 7);                                                // criar, editar e apagar ficam na auditoria
});

test('envio da imagem: confere o conteúdo e devolve a URL pública', async () => {
  assert.equal((await client(env).post('/v1/platform/uploads', { contentType: 'image/png', dataBase64: PNG })).status, 401);
  assert.equal((await sa.post('/v1/platform/uploads', { contentType: 'application/pdf', dataBase64: PNG })).status, 415);
  assert.equal((await sa.post('/v1/platform/uploads', { contentType: 'image/png', dataBase64: Buffer.from('isto nao e uma imagem de verdade').toString('base64') })).status, 422);
  const ok = await sa.post('/v1/platform/uploads', { contentType: 'image/png', dataBase64: PNG });
  assert.equal(ok.status, 200);
  assert.match(ok.body.url, /^http:\/\/api\.test\/uploads\/00000000-0000-0000-0000-0000000000ba\/[0-9a-f-]{36}\.png$/);
  const file = join(dir, ok.body.url.split('/uploads/')[1]);
  assert.ok(existsSync(file));
});
