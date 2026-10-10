// Gera dist/agent.mjs: um arquivo só, com tudo dentro (inclusive o `ws`, que é CommonJS e precisa do `require` no ESM).
import { build } from 'esbuild';
await build({
  entryPoints: ['src/cli.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: 'dist/agent.mjs',
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __pediuCreateRequire } from 'node:module';\nconst require = __pediuCreateRequire(import.meta.url);" },
  logLevel: 'info',
});
