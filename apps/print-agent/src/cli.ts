import { readFileSync } from 'node:fs';
import { pair, runAgent } from './agent.js';
import { configPath, loadConfig, saveConfig } from './config.js';
import { autostart } from './autostart.js';
import { defaultDrivers, discoverPrinters, printTo, testTicket, type Connection } from './drivers.js';
import { startUi } from './ui.js';

declare const __AGENT_VERSION__: string | undefined;   // injetado pelo build (build.mjs)
const VERSION = typeof __AGENT_VERSION__ !== 'undefined' ? __AGENT_VERSION__ : (() => { try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string; } catch { return '0.1.0'; } })();
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const cmd = process.argv[2];

const HELP = `Pediu Agente de Impressão ${VERSION}

  pediu-agent            (ou:  pediu-agent ui)
      Abre a tela do agente no navegador: parear, ver as impressoras, imprimir teste. É o jeito mais fácil.
  pediu-agent autostart install|remove|status
      Liga/desliga o início automático junto com o computador.

  pediu-agent pair --url https://sualoja.com.br --code 123456 [--name "Caixa"]
      Pareia este computador com a loja. O código de 6 dígitos é gerado no painel (Impressão → Parear agente).
  pediu-agent run
      Conecta e imprime os pedidos. Deixe rodando (veja README para iniciar com o Windows).
  pediu-agent printers
      Lista as impressoras que este computador enxerga.
  pediu-agent test --connection rede|windows|cups --address 192.168.0.50:9100
      Imprime um cupom de teste direto, sem passar pelo servidor.
`;

async function main() {
  if (cmd === 'pair') {
    const url = arg('url'), code = arg('code');
    if (!url || !code) { console.error('Informe --url e --code.\n' + HELP); process.exit(1); }
    const cfg = await pair(url, code, arg('name') ?? process.env.COMPUTERNAME ?? 'Computador', VERSION);
    await saveConfig(cfg);
    console.log(`Pareado! Configuração salva em ${configPath()}. Agora rode:  pediu-agent run`);
  } else if (cmd === 'run') {
    const cfg = await loadConfig();
    if (!cfg) { console.error('Este computador ainda não foi pareado. Rode: pediu-agent pair --url … --code …'); process.exit(1); }
    const ac = new AbortController();
    process.on('SIGINT', () => ac.abort()); process.on('SIGTERM', () => ac.abort());
    await runAgent({ cfg, version: VERSION, signal: ac.signal });
  } else if (cmd === 'printers') {
    const list = await discoverPrinters();
    console.log(list.length ? list.map((p) => `- ${p.name} [${p.kind}] ${p.detail ?? ''}`).join('\n') : 'Nenhuma impressora encontrada (ou sem permissão para listar).');
  } else if (cmd === 'test') {
    const connection = arg('connection') as Connection | undefined, address = arg('address');
    if (!connection || !address) { console.error('Informe --connection e --address.\n' + HELP); process.exit(1); }
    await printTo({ name: address, connection, address }, testTicket(), defaultDrivers);
    console.log('Enviado. Se nada saiu, confira o endereço, o compartilhamento (Windows) ou a fila (CUPS).');
  } else if (cmd === 'autostart') {
    const r = await autostart(process.argv[3] as 'install' | 'remove' | 'status' | undefined);
    console.log(r);
  } else if (!cmd || cmd === 'ui') {
    await startUi({ version: VERSION, open: !process.argv.includes('--no-open'), port: Number(arg('port')) || undefined });
  } else console.log(HELP);
}
main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
