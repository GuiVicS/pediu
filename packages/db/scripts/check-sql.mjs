// Confere a sintaxe de todas as migrations e testes SQL com o parser real do Postgres (sem precisar de servidor).
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'libpg-query';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
let bad = 0, total = 0;
for (const dir of ['migrations', 'tests']) {
  for (const f of readdirSync(join(root, dir)).filter((x) => x.endsWith('.sql')).sort()) {
    total++;
    try { await parse(readFileSync(join(root, dir, f), 'utf8')); console.log(`ok   ${dir}/${f}`); }
    catch (e) { bad++; console.error(`ERRO ${dir}/${f}: ${e.message}`); }
  }
}
if (bad) { console.error(`${bad} de ${total} arquivos com erro de sintaxe`); process.exit(1); }
console.log(`${total} arquivos SQL válidos`);
