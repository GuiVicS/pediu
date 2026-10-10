import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { fail } from './http.js';

/** Onde está o agente compilado (`npm run agent:build`). Na imagem Docker é AGENT_DIST_DIR; em desenvolvimento, a pasta do próprio app. */
const distDir = () => process.env.AGENT_DIST_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'print-agent', 'dist');
const BUNDLE = 'agent.mjs';
const EXE = 'pediu-agente.exe';
/** O .exe (~90 MB) não vai no Git: ou está na pasta do agente (AGENT_DIST_DIR) ou é um endereço externo (AGENT_EXE_URL, padrão: release do GitHub). */
const EXE_URL_DEFAULT = 'https://github.com/GuiVicS/pediu/releases/download/agente-v0.1.0/pediu-agente.exe';
const exeUrl = () => process.env.AGENT_EXE_URL ?? EXE_URL_DEFAULT;
let urlCheck: { url: string; ok: boolean; at: number } | null = null;
/** O endereço do .exe responde? (consulta no máximo a cada 10 min; o painel só oferece o botão se existir) */
async function exeUrlOk(): Promise<boolean> {
  const url = exeUrl();
  if (!/^https:\/\//i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(url)) return false;
  if (urlCheck && urlCheck.url === url && Date.now() - urlCheck.at < 600_000) return urlCheck.ok;
  let ok = false;
  try { ok = (await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) })).ok; } catch { ok = false; }
  urlCheck = { url, ok, at: Date.now() };
  return ok;
}
const exeFile = async () => { try { const f = join(distDir(), EXE); return (await stat(f)).isFile() ? f : null; } catch { return null; } };

const WIN = `@echo off\r
chcp 65001 >nul\r
cd /d "%~dp0"\r
where node >nul 2>nul\r
if errorlevel 1 (\r
  echo O Node.js nao foi encontrado. Instale a versao LTS em https://nodejs.org e abra este arquivo de novo.\r
  pause\r
  exit /b 1\r
)\r
node pediu-agent.mjs ui\r
`;
const UNIX = `#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "O Node.js nao foi encontrado. Instale a versao LTS em https://nodejs.org e rode de novo."
  exit 1
fi
exec node pediu-agent.mjs ui
`;

/** Arquivos públicos do agente de impressão (não têm segredo nenhum: o pareamento é feito com o código do painel). */
export function downloadRoutes(app: FastifyInstance) {
  const FILES: Record<string, { type: string; body?: string }> = {
    'pediu-agent.mjs': { type: 'text/javascript; charset=utf-8' },
    'iniciar-agente-windows.bat': { type: 'application/octet-stream', body: WIN },
    'iniciar-agente-linux-mac.sh': { type: 'application/octet-stream', body: UNIX },
  };

  app.get('/v1/downloads/agent.json', async () => {
    const exe = !!(await exeFile()) || (await exeUrlOk());
    try { const s = await stat(join(distDir(), BUNDLE)); return { available: true, sizeBytes: s.size, updatedAt: s.mtime.toISOString(), files: Object.keys(FILES), exe }; }
    catch { return { available: false, sizeBytes: 0, updatedAt: null, files: [] as string[], exe }; }
  });

  // instalador do Windows: arquivo local, se houver; senão redireciona para o endereço externo
  app.get(`/v1/downloads/${EXE}`, async (_req, reply) => {
    const f = await exeFile();
    if (f) return reply.header('content-type', 'application/octet-stream').header('content-disposition', `attachment; filename="${EXE}"`).header('content-length', (await stat(f)).size).header('x-content-type-options', 'nosniff').send(createReadStream(f));
    if (await exeUrlOk()) return reply.redirect(exeUrl(), 302);
    return fail(reply, 404, 'not_built', 'O instalador do Windows ainda não está disponível neste servidor.');
  });

  app.get('/v1/downloads/:file', async (req, reply) => {
    const name = (req.params as { file: string }).file;
    const f = FILES[name];
    if (!f) return fail(reply, 404, 'not_found', 'Arquivo não encontrado.');
    let body: string | Buffer;
    try { body = f.body ?? await readFile(join(distDir(), BUNDLE)); }
    catch { return fail(reply, 404, 'not_built', 'O agente ainda não foi compilado neste servidor (npm run agent:build).'); }
    return reply.header('content-type', f.type).header('content-disposition', `attachment; filename="${name}"`).header('cache-control', 'no-cache').header('x-content-type-options', 'nosniff').send(body);
  });
}
