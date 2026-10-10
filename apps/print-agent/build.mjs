// Gera os pacotes do agente em dist/:
//   node build.mjs        -> dist/agent.mjs  (um arquivo ESM; roda com `node pediu-agent.mjs`; é o que o painel oferece para baixar)
//   node build.mjs --sea  -> dist/agent.cjs  (CommonJS: entrada do executável único .exe, ver compilar-exe-windows.bat)
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const sea = process.argv.includes('--sea');
const define = { __AGENT_VERSION__: JSON.stringify(version) };
await build(sea
  ? { entryPoints: ['src/cli.ts'], bundle: true, platform: 'node', target: 'node20', logLevel: 'info', format: 'cjs', outfile: 'dist/agent.cjs',
      define: { ...define, 'import.meta.url': '__importMetaUrl' }, banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" } }
  // ESM + `ws` (CommonJS) precisa do require
  : { entryPoints: ['src/cli.ts'], bundle: true, platform: 'node', target: 'node20', logLevel: 'info', format: 'esm', outfile: 'dist/agent.mjs', define,
      banner: { js: "#!/usr/bin/env node\nimport { createRequire as __pediuCreateRequire } from 'node:module';\nconst require = __pediuCreateRequire(import.meta.url);" } });
