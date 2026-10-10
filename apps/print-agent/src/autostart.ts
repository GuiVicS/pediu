import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Onde fica o "iniciar com o computador" em cada sistema (sem instalar serviço nem pedir administrador). */
export function autostartFile(platform = process.platform, home = homedir(), appData = process.env.APPDATA): string {
  if (platform === 'win32') return join(appData ?? join(home, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'PediuAgente.vbs');
  if (platform === 'darwin') return join(home, 'Library', 'LaunchAgents', 'com.pediulanchou.agent.plist');
  return join(home, '.config', 'autostart', 'pediu-agent.desktop');
}

/** Rodando como executável único (.exe feito com o Node SEA) não há script separado: o próprio executável é o agente. */
export const isSea = (): boolean => { try { return (process as unknown as { getBuiltinModule?: (n: string) => { isSea(): boolean } }).getBuiltinModule?.('node:sea').isSea() ?? false; } catch { return false; } };

/** Conteúdo do arquivo: roda `node <agente> ui --no-open` (ou o .exe direto, se `script` for null) escondido, sem janela de terminal. */
export function autostartContent(platform: NodeJS.Platform, node: string, script: string | null): string {
  if (platform === 'win32') {
    const q = (s: string) => s.replace(/"/g, '""');
    const cmd = script === null ? `""${q(node)}"" ui --no-open` : `""${q(node)}"" ""${q(script)}"" ui --no-open`;
    return `' Inicia o Pediu Agente de Impressão junto com o Windows (sem janela).\r\nCreateObject("WScript.Shell").Run "${cmd}", 0, False\r\n`;
  }
  if (platform === 'darwin') {
    const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const args = [node, ...(script === null ? [] : [script]), 'ui', '--no-open'].map((a) => `<string>${x(a)}</string>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>com.pediulanchou.agent</string>\n<key>ProgramArguments</key><array>${args}</array>\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>\n</dict></plist>\n`;
  }
  return `[Desktop Entry]\nType=Application\nName=Pediu Agente de Impressão\nExec="${node}" ${script === null ? '' : `"${script}" `}ui --no-open\nX-GNOME-Autostart-enabled=true\n`;
}

export async function autostartStatus(file = autostartFile()): Promise<boolean> { try { await stat(file); return true; } catch { return false; } }

export async function autostart(action: 'install' | 'remove' | 'status' | undefined, file = autostartFile(), node = process.execPath, script: string | null = isSea() ? null : process.argv[1] ?? ''): Promise<string> {
  if (action === 'install') {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, autostartContent(process.platform, node, script));
    return `Pronto: o agente vai abrir sozinho quando você entrar no computador.\n(${file})`;
  }
  if (action === 'remove') { await rm(file, { force: true }); return 'Início automático desligado.'; }
  if (action === 'status') return (await autostartStatus(file)) ? 'Início automático: LIGADO' : 'Início automático: desligado';
  return 'Use: pediu-agent autostart install | remove | status';
}
