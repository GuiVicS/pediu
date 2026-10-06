// Publica um build do app web como uma VERSÃO (imutável) no armazenamento que o edge lê.
//   npm run release:web -- 1.4.0
// Depois registre a versão no super admin (Versões por loja → Nova versão) e faça o rollout ou fixe em lojas específicas.
// Destino: pasta local (RELEASES_DIR, para testar) ou bucket PÚBLICO do Supabase Storage (SUPABASE_URL + SUPABASE_SERVICE_KEY + RELEASES_BUCKET).
import { execSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) { console.error('Uso: npm run release:web -- 1.4.0'); process.exit(1); }
const dist = join(process.cwd(), 'apps/web/dist');
if (!process.argv.includes('--no-build')) execSync('npm run build -w @pediu/web', { stdio: 'inherit' });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain' };
async function* walk(dir) { for (const e of await readdir(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) yield* walk(p); else yield p; } }

if (process.env.RELEASES_DIR) {
  const target = join(process.env.RELEASES_DIR, 'web', version);
  if (await stat(target).then(() => true, () => false)) { console.error(`A versão ${version} já existe em ${target}. Versões são imutáveis: use um número novo.`); process.exit(1); }
  await mkdir(target, { recursive: true }); await cp(dist, target, { recursive: true });
  console.log(`Versão ${version} copiada para ${target}`);
} else {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_KEY: key, RELEASES_BUCKET: bucket = 'pediu-releases' } = process.env;
  if (!url || !key) { console.error('Defina RELEASES_DIR (pasta) ou SUPABASE_URL + SUPABASE_SERVICE_KEY (+ RELEASES_BUCKET).'); process.exit(1); }
  let n = 0;
  for await (const file of walk(dist)) {
    const path = `web/${version}/${relative(dist, file).split('\\').join('/')}`;
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, { method: 'POST', headers: { authorization: `Bearer ${key}`, apikey: key, 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'x-upsert': 'false', 'cache-control': 'max-age=31536000' }, body: await readFile(file) });
    if (!res.ok) { console.error(`Falhou em ${path}: ${res.status} ${await res.text()}\n(Se a versão já existe, use um número novo: versões são imutáveis.)`); process.exit(1); }
    n++;
  }
  console.log(`Versão ${version}: ${n} arquivos enviados para ${bucket}/web/${version}/. Base para o edge: ${url}/storage/v1/object/public/${bucket}`);
}
console.log('Próximo passo: registrar a versão no super admin (Versões por loja → Nova versão).');
