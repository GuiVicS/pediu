import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import { pair, runAgent, type ConnStatus } from './agent.js';
import { autostart, autostartStatus } from './autostart.js';
import { configPath, deleteConfig, loadConfig, saveConfig, type AgentConfig } from './config.js';
import { defaultDrivers, discoverPrinters, printTo, testTicket, type Connection } from './drivers.js';
import { PAGE } from './uiPage.js';

interface JobRow { kind: string; printer: string; ok: boolean; error?: string; at: number }

/** Mantém o agente rodando e guarda o que a tela precisa mostrar. */
export class Controller {
  cfg: AgentConfig | null = null;
  status: ConnStatus | 'sem-pareamento' = 'sem-pareamento';
  jobs: JobRow[] = []; logs: string[] = [];
  private ac: AbortController | null = null;
  constructor(readonly version: string) {}

  private log = (level: string, msg: string) => { this.logs.push(`${new Date().toLocaleTimeString('pt-BR')} ${level.toUpperCase()} ${msg}`); if (this.logs.length > 80) this.logs.shift(); };

  start(cfg: AgentConfig) {
    this.stop(); this.cfg = cfg; this.status = 'conectando';
    const ac = this.ac = new AbortController();
    void runAgent({ cfg, version: this.version, signal: ac.signal, log: (l, m) => this.log(l, m), onStatus: (s) => { if (this.ac === ac) this.status = s; }, onJob: (j) => { this.jobs.unshift(j); this.jobs.length = Math.min(this.jobs.length, 15); } });
  }
  stop() { this.ac?.abort(); this.ac = null; }
  async unpair() { this.stop(); await deleteConfig(); this.cfg = null; this.status = 'sem-pareamento'; this.jobs = []; this.log('info', 'Pareamento removido deste computador.'); }
}

const json = (res: ServerResponse, code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = (req: IncomingMessage) => new Promise<any>((resolve) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 20_000) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); });

export function createUiServer(ctl: Controller, token: string, port: () => number) {
  return createServer(async (req, res) => {
    try {
      // a tela só fala com este computador: Host de loopback (contra DNS rebinding) e token da página (contra outras páginas abertas no navegador)
      const host = String(req.headers.host ?? '');
      if (!new RegExp(`^(127\\.0\\.0\\.1|localhost):${port()}$`).test(host)) return json(res, 403, { error: 'host inválido' });
      const url = new URL(req.url ?? '/', 'http://x');
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' }); return void res.end(PAGE.replace('__TOKEN__', token).replace('__VERSION__', ctl.version)); }
      if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'não encontrado' });
      if (req.headers['x-ui-token'] !== token) return json(res, 403, { error: 'token inválido' });

      if (req.method === 'GET' && url.pathname === '/api/status') {
        return json(res, 200, { version: ctl.version, paired: !!ctl.cfg, status: ctl.status, store: ctl.cfg ? { url: ctl.cfg.apiUrl, name: ctl.cfg.name } : null, jobs: ctl.jobs, logs: ctl.logs.slice(-25), autostart: await autostartStatus(), config: configPath(), defaultName: hostname() });
      }
      if (req.method === 'GET' && url.pathname === '/api/printers') return json(res, 200, { printers: await discoverPrinters() });
      if (req.method === 'POST' && url.pathname === '/api/pair') {
        const b = await readBody(req);
        const apiUrl = String(b.url ?? '').trim(), code = String(b.code ?? '').replace(/\D/g, ''), name = String(b.name ?? '').trim() || hostname();
        if (!/^https?:\/\/[^\s]+$/i.test(apiUrl)) return json(res, 400, { error: 'Informe o endereço da loja, ex.: https://minhaloja.com.br' });
        if (code.length !== 6) return json(res, 400, { error: 'O código tem 6 dígitos (gere em Impressão → Parear agente, no painel).' });
        try { const cfg = await pair(apiUrl, code, name, ctl.version); await saveConfig(cfg); ctl.start(cfg); return json(res, 200, { ok: true }); }
        catch (e) { return json(res, 400, { error: String((e as Error).message) }); }
      }
      if (req.method === 'POST' && url.pathname === '/api/unpair') { await ctl.unpair(); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && url.pathname === '/api/test') {
        const b = await readBody(req);
        const connection = String(b.connection ?? '') as Connection, address = String(b.address ?? '').trim();
        if (!['rede', 'windows', 'cups'].includes(connection) || !address) return json(res, 400, { error: 'Informe o tipo e o endereço da impressora.' });
        try { await printTo({ name: address, connection, address }, testTicket(), defaultDrivers); return json(res, 200, { ok: true }); }
        catch (e) { return json(res, 200, { ok: false, error: String((e as Error).message).slice(0, 300) }); }
      }
      if (req.method === 'POST' && url.pathname === '/api/autostart') {
        const b = await readBody(req); const msg = await autostart(b.on ? 'install' : 'remove');
        return json(res, 200, { ok: true, message: msg, autostart: await autostartStatus() });
      }
      return json(res, 404, { error: 'não encontrado' });
    } catch (e) { return json(res, 500, { error: String((e as Error).message) }); }
  });
}

const openBrowser = (url: string) => {
  const [cmd, args] = process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', url]] as const : process.platform === 'darwin' ? ['open', [url]] as const : ['xdg-open', [url]] as const;
  try { execFile(cmd, [...args], { windowsHide: true }, () => undefined).on('error', () => undefined); } catch { /* sem navegador: a URL fica no terminal */ }
};

/** Sobe a tela local (só em 127.0.0.1), religa o pareamento salvo e abre o navegador. */
export async function startUi(o: { version: string; open?: boolean; port?: number }): Promise<void> {
  const ctl = new Controller(o.version);
  const token = randomBytes(16).toString('hex');
  let port = o.port ?? 4710;
  const server = createUiServer(ctl, token, () => port);
  await new Promise<void>((resolve, reject) => {
    const tryListen = (left: number) => {
      server.once('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EADDRINUSE' && left > 0) { port++; tryListen(left - 1); } else reject(e); });
      server.listen(port, '127.0.0.1', () => resolve());
    };
    tryListen(10);
  });
  const cfg = await loadConfig();
  if (cfg) ctl.start(cfg);   // uma vez pareado, sempre pareado: liga sozinho a cada vez que o agente abre
  const url = `http://127.0.0.1:${port}`;
  console.log(`Pediu Agente de Impressão ${o.version}\nTela do agente: ${url}\n${cfg ? `Pareado com ${cfg.apiUrl}` : 'Ainda não pareado: abra a tela acima e informe o código do painel.'}\nDeixe esta janela aberta (ou use: pediu-agent autostart install).`);
  if (o.open !== false) openBrowser(url);
  const stop = () => { ctl.stop(); server.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
