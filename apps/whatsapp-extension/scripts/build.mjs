import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { 'main-world': 'src/main-world.ts', bridge: 'src/bridge.ts', 'service-worker': 'src/service-worker.ts', popup: 'src/popup.ts' },
  outdir: out, bundle: true, format: 'esm', target: 'chrome120', absWorkingDir: root,
});
// content scripts clássicos não aceitam import; os bundles acima não têm imports restantes.
// hoisting do workspace coloca a dependência na raiz do monorepo
const wajs = ['node_modules', '../../node_modules'].map((d) => join(root, d, '@wppconnect/wa-js/dist/wppconnect-wa.js')).find((f) => existsSync(f));
if (!wajs) throw new Error('@wppconnect/wa-js não instalado');
cpSync(wajs, join(out, 'wppconnect-wa.js'));
for (const d of ['icons', 'assets']) cpSync(join(root, d), join(out, d), { recursive: true });
cpSync(join(root, 'popup.html'), join(out, 'popup.html'));
cpSync(join(root, 'manifest.json'), join(out, 'manifest.json'));
console.log('extensão em', out);
