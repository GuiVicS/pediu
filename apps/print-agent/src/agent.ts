import WebSocket from 'ws';
import type { AgentConfig } from './config.js';
import { PrintedLog } from './config.js';
import { discoverPrinters, printTo, type Drivers, type PrinterTarget } from './drivers.js';
import { defaultDrivers } from './drivers.js';

export interface JobMessage { type: 'job'; id: string; kind: string; printer: PrinterTarget; data: string }
export type Log = (level: 'info' | 'warn' | 'error', msg: string) => void;

/** Executa um job e devolve a mensagem de confirmação. Job já impresso antes (ack perdido) só é confirmado de novo. */
export async function handleJob(job: JobMessage, printed: PrintedLog, drivers: Drivers, log: Log): Promise<{ type: 'ack'; id: string; ok: boolean; error?: string }> {
  if (printed.has(job.id)) { log('info', `Job ${job.id.slice(0, 8)} já impresso antes: confirmando de novo, sem imprimir.`); return { type: 'ack', id: job.id, ok: true }; }
  try {
    await printTo(job.printer, Buffer.from(job.data, 'base64'), drivers);
    await printed.add(job.id);
    log('info', `Impresso: ${job.kind} em "${job.printer.name}" (${job.id.slice(0, 8)})`);
    return { type: 'ack', id: job.id, ok: true };
  } catch (e) {
    const error = String((e as Error).message ?? e).slice(0, 300);
    log('error', `Falha ao imprimir em "${job.printer.name}": ${error}`);
    return { type: 'ack', id: job.id, ok: false, error };
  }
}

export interface RunOptions { cfg: AgentConfig; version: string; drivers?: Drivers; log?: Log; printed?: PrintedLog; signal?: AbortSignal; wsFactory?: (url: string, headers: Record<string, string>) => WebSocket }

/** Mantém a conexão com o servidor, reconectando com espera crescente (1 s → 30 s). Só termina quando `signal` é abortado. */
export async function runAgent(o: RunOptions): Promise<void> {
  const log = o.log ?? ((l, m) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${l.toUpperCase()} ${m}`));
  const drivers = o.drivers ?? defaultDrivers;
  const printed = o.printed ?? (await new PrintedLog().load());
  const url = o.cfg.apiUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/v1/agent/ws';
  let attempt = 0;
  while (!o.signal?.aborted) {
    const reason = await new Promise<string>((resolve) => {
      const ws = (o.wsFactory ?? ((u, headers) => new WebSocket(u, { headers })))(url, { authorization: `Bearer ${o.cfg.token}` });
      const stop = () => { try { ws.close(); } catch { /* já fechado */ } };
      o.signal?.addEventListener('abort', stop, { once: true });
      const queue: Promise<void> = Promise.resolve();
      let chain = queue;
      ws.on('open', async () => {
        attempt = 0; log('info', `Conectado a ${url}`);
        ws.send(JSON.stringify({ type: 'hello', version: o.version, platform: process.platform, printers: await discoverPrinters() }));
      });
      ws.on('message', (raw) => {
        let m: { type?: string }; try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.type === 'job') chain = chain.then(async () => { const ack = await handleJob(m as JobMessage, printed, drivers, log); if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ack)); });   // um job por vez: a ordem do papel importa
        else if (m.type === 'welcome') log('info', 'Autenticado. Aguardando pedidos.');
      });
      ws.on('close', (code) => resolve(code === 4401 ? 'unauthorized' : code === 4001 ? 'revoked' : 'closed'));
      ws.on('error', (e) => log('warn', `Conexão: ${e.message}`));
    });
    if (reason === 'unauthorized' || reason === 'revoked') { log('error', reason === 'revoked' ? 'Este agente foi removido no painel. Pareie de novo.' : 'Token recusado. Pareie de novo (pediu-agent pair).'); return; }
    if (o.signal?.aborted) return;
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5));
    log('warn', `Desconectado. Tentando de novo em ${Math.round(wait / 1000)} s…`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

export async function pair(apiUrl: string, code: string, name: string, version: string, f: typeof fetch = fetch): Promise<AgentConfig> {
  const res = await f(`${apiUrl.replace(/\/$/, '')}/v1/agent/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name, platform: process.platform, version }) });
  const d: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(d?.error?.message ?? `O servidor respondeu ${res.status}`);
  return { apiUrl: apiUrl.replace(/\/$/, ''), token: d.token, agentId: d.agentId, name };
}
