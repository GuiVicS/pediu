import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { client, createAdmin, currentCode, fullLogin, PASSWORD, setup, stepUp, type Env } from './helpers.js';

let env: Env;
before(async () => { env = await setup(); });
after(() => env.close());

test('login: senha errada e e-mail inexistente respondem igual', async () => {
  await createAdmin(env, 'a@teste.com');
  const c = client(env);
  const wrong = await c.post('/v1/platform/auth/login', { email: 'a@teste.com', password: 'errada-errada' });
  const unknown = await c.post('/v1/platform/auth/login', { email: 'nao@existe.com', password: 'errada-errada' });
  assert.equal(wrong.status, 401); assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
});

test('bloqueio: 5 erros travam a conta por 15 min, mesmo com a senha certa', async () => {
  await createAdmin(env, 'lock@teste.com');
  const c = client(env);
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/v1/platform/auth/login', { email: 'lock@teste.com', password: 'x'.repeat(12) })).status, 401);
  assert.equal((await c.post('/v1/platform/auth/login', { email: 'lock@teste.com', password: PASSWORD })).status, 423);
  env.clock.advance(16 * 60_000);
  assert.equal((await c.post('/v1/platform/auth/login', { email: 'lock@teste.com', password: PASSWORD })).status, 200);
});

test('1º acesso: só com a senha a sessão não abre nada; o autenticador libera', async () => {
  await createAdmin(env, 'first@teste.com');
  const c = client(env);
  const l = await c.post('/v1/platform/auth/login', { email: 'first@teste.com', password: PASSWORD });
  assert.equal(l.body.next, 'enroll');
  assert.match(l.headers['set-cookie'] as string, /HttpOnly/i);
  assert.match(l.headers['set-cookie'] as string, /SameSite=Strict/i);
  const blocked = await c.get('/v1/platform/stores');
  assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, 'totp_required');
  // depois de cadastrar o autenticador, a mesma sessão passa a valer
  const en = await c.post('/v1/platform/auth/totp/enroll');
  assert.match(en.body.otpauthUrl, /^otpauth:\/\/totp\//);
  const wrongCode = await c.post('/v1/platform/auth/totp/confirm', { code: '000000' });
  assert.equal(wrongCode.status, 401);
});

test('fluxo completo: cadastrar autenticador, recuperação de uso único, anti-replay e logout', async () => {
  await createAdmin(env, 'flow@teste.com');
  const c = client(env);
  const codes = await fullLogin(env, c, 'flow@teste.com');
  assert.equal(codes.length, 10);
  assert.equal((await c.get('/v1/platform/stores')).status, 200);
  assert.equal((await c.get('/v1/platform/auth/me')).body.totpEnabled, true);

  // nova sessão: login + código
  const c2 = client(env);
  assert.equal((await c2.post('/v1/platform/auth/login', { email: 'flow@teste.com', password: PASSWORD })).body.next, 'totp');
  const code = await currentCode(env, 'flow@teste.com');
  assert.equal((await c2.post('/v1/platform/auth/totp/verify', { code: 'abcde-12345' })).status, 401);
  assert.equal((await c2.post('/v1/platform/auth/totp/verify', { code })).status, 200);
  // o mesmo código não vale duas vezes
  const c3 = client(env);
  await c3.post('/v1/platform/auth/login', { email: 'flow@teste.com', password: PASSWORD });
  assert.equal((await c3.post('/v1/platform/auth/totp/verify', { code })).status, 401);

  // código de recuperação funciona uma vez só
  assert.equal((await c3.post('/v1/platform/auth/totp/verify', { code: codes[0] })).status, 200);
  const c4 = client(env);
  await c4.post('/v1/platform/auth/login', { email: 'flow@teste.com', password: PASSWORD });
  assert.equal((await c4.post('/v1/platform/auth/totp/verify', { code: codes[0] })).status, 401);

  await c.post('/v1/platform/auth/logout');
  assert.equal((await c.get('/v1/platform/stores')).status, 401);
});

test('sessão expira por inatividade (30 min)', async () => {
  await createAdmin(env, 'idle@teste.com');
  const c = client(env);
  await fullLogin(env, c, 'idle@teste.com');
  assert.equal((await c.get('/v1/platform/stores')).status, 200);
  env.clock.advance(31 * 60_000);
  assert.equal((await c.get('/v1/platform/stores')).status, 401);
});

test('step-up: ação sensível pede o código de novo e a janela dura 5 minutos', async () => {
  await createAdmin(env, 'step@teste.com');
  const c = client(env);
  await fullLogin(env, c, 'step@teste.com');
  const body = { name: 'token de teste' };
  const no = await c.post('/v1/platform/mcp-tokens', body);
  assert.equal(no.status, 403); assert.equal(no.body.error.code, 'stepup_required');
  assert.equal((await c.post('/v1/platform/auth/stepup', { code: '000000' })).status, 401);
  assert.equal((await stepUp(env, c, 'step@teste.com')).status, 200);
  assert.equal((await c.post('/v1/platform/mcp-tokens', body)).status, 201);
  env.clock.advance(6 * 60_000);
  assert.equal((await c.post('/v1/platform/mcp-tokens', body)).status, 403);
});

test('API só aceita JSON nas rotas da plataforma (defesa extra contra CSRF)', async () => {
  const res = await env.app.inject({ method: 'POST', url: '/v1/platform/auth/login', payload: 'email=a&password=b', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.statusCode, 415);
});
