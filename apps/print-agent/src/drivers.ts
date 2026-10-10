import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type Connection = 'rede' | 'windows' | 'cups';
export interface PrinterTarget { name: string; connection: Connection; address: string }
export interface Drivers {
  rede(host: string, port: number, data: Buffer, timeoutMs?: number): Promise<void>;
  windows(share: string, data: Buffer): Promise<void>;
  cups(queue: string, data: Buffer): Promise<void>;
}

/** Envia os bytes ESC/POS direto para o socket da impressora (porta 9100). */
export function sendTcp(host: string, port: number, data: Buffer, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host, port });
    const fail = (e: Error) => { s.destroy(); reject(e); };
    s.setTimeout(timeoutMs, () => fail(new Error(`Timeout ao falar com ${host}:${port}`)));
    s.once('error', fail);
    s.once('connect', () => s.end(data, () => { /* dados entregues ao SO */ }));
    s.once('close', (hadError) => { if (!hadError) resolve(); });
  });
}

async function withTempFile<T>(data: Buffer, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'pediu-'));
  const file = join(dir, 'job.bin');
  try { await writeFile(file, data); return await fn(file); } finally { await rm(dir, { recursive: true, force: true }); }
}

export const defaultDrivers: Drivers = {
  rede: sendTcp,
  // Windows: a impressora precisa estar COMPARTILHADA (nome do compartilhamento). `copy /b` envia os bytes crus pelo spooler, sem driver gráfico.
  windows: (share, data) => withTenantSafe(share, () => withTempFile(data, async (file) => { await run('cmd.exe', ['/c', 'copy', '/b', file, `\\\\localhost\\${share}`], { windowsHide: true, timeout: 15_000 }); })),
  // Linux/Mac: fila do CUPS em modo raw.
  cups: (queue, data) => withTenantSafe(queue, () => withTempFile(data, async (file) => { await run('lp', ['-d', queue, '-o', 'raw', file], { timeout: 15_000 }); })),
};

/** Nome de compartilhamento/fila vem do painel: só letras, números, espaço e _.-  (evita injeção de argumento). */
async function withTenantSafe<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!/^[\p{L}\p{N} _.\-]{1,80}$/u.test(name)) throw new Error(`Nome de impressora inválido: ${name}`);
  return fn();
}

export function parseHostPort(address: string): { host: string; port: number } {
  const m = /^([A-Za-z0-9.-]+)(?::(\d{2,5}))?$/.exec(address.trim());
  if (!m) throw new Error(`Endereço inválido: ${address}`);
  return { host: m[1]!, port: m[2] ? Number(m[2]) : 9100 };
}

export async function printTo(target: PrinterTarget, data: Buffer, drivers: Drivers = defaultDrivers): Promise<void> {
  if (target.connection === 'rede') { const { host, port } = parseHostPort(target.address); return drivers.rede(host, port, data); }
  if (target.connection === 'windows') return drivers.windows(target.address, data);
  if (target.connection === 'cups') return drivers.cups(target.address, data);
  throw new Error(`Conexão desconhecida: ${(target as { connection: string }).connection}`);
}

/** Impressoras que o sistema operacional conhece (aparecem no painel para escolher). */
export async function discoverPrinters(platform = process.platform): Promise<{ name: string; kind: string; detail?: string }[]> {
  try {
    if (platform === 'win32') {
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command', 'Get-Printer | Select-Object Name,ShareName,PortName,DriverName | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 15_000 });
      const raw = JSON.parse(stdout || '[]'); const list = Array.isArray(raw) ? raw : [raw];
      return list.map((p: { Name: string; ShareName?: string; PortName?: string; DriverName?: string }) => ({ name: p.Name, kind: 'windows', detail: `${p.ShareName ? `compartilhada como "${p.ShareName}"` : 'NÃO compartilhada'} · ${p.PortName ?? ''}` }));
    }
    const { stdout } = await run('lpstat', ['-e'], { timeout: 10_000 });
    return stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((name) => ({ name, kind: 'cups' }));
  } catch { return []; }
}

/** Cupom de teste (ESC/POS): acentos em CP860, corte no fim. Usado pelo comando `test` e pela tela do agente. */
export const testTicket = () => Buffer.from([0x1b, 0x40, 0x1b, 0x74, 0x03, ...Buffer.from('TESTE DE IMPRESSAO\nPediu Agente de Impressao\nAcentos: acao, coracao, pao\n\n\n\n'), 0x1d, 0x56, 0x42, 0x03]);
