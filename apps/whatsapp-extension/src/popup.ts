import { checkLink, normalizeBase, pair, type Link } from './api.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const KEY = 'link';

async function load(): Promise<Link | null> { return ((await chrome.storage.local.get(KEY))[KEY] as Link | undefined) ?? null; }
function show(state: 'pair' | 'linked', text = '') {
  $('pair').hidden = state !== 'pair'; $('linked').hidden = state !== 'linked'; $('msg').textContent = text;
}

async function render() {
  const link = await load();
  if (!link) return show('pair');
  const c = await checkLink(fetch, link);
  if (c.state === 'revoked') { await chrome.storage.local.remove(KEY); return show('pair', 'A conexão foi encerrada. Gere um novo código no painel.'); }
  $('store').textContent = link.storeName;
  show('linked', c.state === 'offline' ? 'Sem conexão com o Pediu no momento.' : '');
}

$('connect').addEventListener('click', async () => {
  const base = normalizeBase($<HTMLInputElement>('api').value);
  if (!base) return show('pair', 'Informe o endereço do Pediu (https://...).');
  try {
    // a permissão do endereço é pedida só aqui, por gesto do usuário
    if (!(await chrome.permissions.request({ origins: [`${base}/*`] }))) return show('pair', 'Permissão negada.');
    const link = await pair(fetch, base, $<HTMLInputElement>('code').value, 'Chrome');
    await chrome.storage.local.set({ [KEY]: link });
    $<HTMLInputElement>('code').value = '';
    await render();
  } catch (e) { show('pair', (e as Error).message); }
});

$('disconnect').addEventListener('click', async () => { await chrome.storage.local.remove(KEY); await render(); });
void render();
