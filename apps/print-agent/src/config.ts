import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface AgentConfig { apiUrl: string; token: string; agentId: string; name: string }

export const configPath = () => process.env.PEDIU_AGENT_CONFIG ?? join(process.env.APPDATA ?? join(homedir(), '.config'), 'pediu-agent', 'config.json');
export const statePath = () => join(dirname(configPath()), 'printed.json');

export async function loadConfig(path = configPath()): Promise<AgentConfig | null> {
  try { const c = JSON.parse(await readFile(path, 'utf8')); return c?.apiUrl && c?.token ? c : null; } catch { return null; }
}
export async function saveConfig(c: AgentConfig, path = configPath()) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(c, null, 2), { mode: 0o600 });    // o token vale como senha: só o dono do arquivo lê
}

/** Últimos jobs impressos. Se o servidor reenviar um job cuja confirmação se perdeu, só confirmamos de novo: nunca imprimimos em dobro. */
export class PrintedLog {
  private ids: string[] = [];
  constructor(private path = statePath(), private max = 500) {}
  async load() { try { this.ids = JSON.parse(await readFile(this.path, 'utf8')); } catch { this.ids = []; } return this; }
  has(id: string) { return this.ids.includes(id); }
  async add(id: string) {
    this.ids.push(id); if (this.ids.length > this.max) this.ids = this.ids.slice(-this.max);
    try { await mkdir(dirname(this.path), { recursive: true }); await writeFile(this.path, JSON.stringify(this.ids)); } catch { /* sem disco: segue em memória */ }
  }
}
