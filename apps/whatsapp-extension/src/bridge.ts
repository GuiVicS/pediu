// Content script isolado: valida eventos do MAIN, repassa ao service worker (reconectando se ele for encerrado),
// executa comandos do worker no MAIN e mostra o painel de atendimento dentro do WhatsApp Web.
import { CHAT_ID, CMD_CHANNEL, parseEnvelope, parseReply, type Command } from './protocol.js';

let port: chrome.runtime.Port | null = null;
const origin = window.location.origin;

function connect() {
  port = chrome.runtime.connect({ name: 'wa-bridge' });
  port.onMessage.addListener((m) => {
    if (m?.kind === 'command') window.postMessage({ channel: CMD_CHANNEL, id: m.id, command: m.command as Command }, origin);
  });
  port.onDisconnect.addListener(() => { port = null; setTimeout(() => { if (!port) connect(); }, 1000); });
}
function send(msg: unknown) {
  if (!port) connect();
  try { port!.postMessage(msg); } catch { port = null; connect(); port!.postMessage(msg); }
}
connect();
setInterval(() => send({ kind: 'ping' }), 20_000);     // mantém o worker acordado enquanto o WhatsApp Web está aberto

window.addEventListener('message', (ev) => {
  if (ev.source !== window || ev.origin !== origin) return;
  const reply = parseReply(ev.data);
  if (reply) return send({ kind: 'reply', reply });
  const event = parseEnvelope(ev.data);
  if (event) send({ kind: 'event', event });
});

// ---- painel ----
let activeChat: string | null = null;
function ask<T>(command: Command): Promise<T> {
  const id = `p${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { window.removeEventListener('message', on); reject(new Error('timeout')); }, 10_000);
    const on = (ev: MessageEvent) => {
      const r = ev.source === window ? parseReply(ev.data) : null;
      if (!r || r.id !== id) return;
      clearTimeout(t); window.removeEventListener('message', on);
      r.ok ? resolve(r.data as T) : reject(new Error(r.error));
    };
    window.addEventListener('message', on);
    window.postMessage({ channel: CMD_CHANNEL, id, command }, origin);
  });
}
const rpc = (m: Record<string, unknown>) => chrome.runtime.sendMessage(m).catch(() => null);

const host = document.createElement('div');
host.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;font:13px system-ui;';
const root = host.attachShadow({ mode: 'closed' });
root.innerHTML = '<style>.b{display:flex;align-items:center;gap:6px;background:linear-gradient(90deg,#0072c6,#00b4f0);color:#fff;border:0;border-radius:22px;padding:6px 14px 6px 8px;cursor:pointer;font-weight:600}.b img{width:22px;height:22px;border-radius:6px}.hd{display:flex;align-items:center;gap:6px;color:#0072c6;font-weight:700}.hd img{width:20px;height:20px;border-radius:5px}button.s{background:#0a84e0;color:#fff;border:0;border-radius:6px}.p{width:320px;max-height:70vh;overflow:auto;background:#fff;color:#111;border:1px solid #ccc;border-radius:10px;padding:10px;margin-bottom:8px;box-shadow:0 4px 16px #0003}.p[hidden]{display:none}h4{margin:8px 0 4px}button.s{margin:2px 4px 2px 0;padding:4px 10px;cursor:pointer}pre{white-space:pre-wrap;margin:2px 0;font:inherit;background:#f4f4f4;padding:6px;border-radius:6px}.w{color:#b45309}</style><div class="p" id="p" hidden></div><button class="b" id="t"><img alt="">PediuLanchou</button>';
(root.querySelector('#t img') as HTMLImageElement).src = chrome.runtime.getURL('icons/icon-48.png');
const panel = root.getElementById('p') as HTMLElement;
root.getElementById('t')!.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) void render(); });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; }
function btn(label: string, fn: () => void) { const b = el('button', label, 's'); b.addEventListener('click', fn); return b; }

async function render() {
  const s: any = await rpc({ type: 'panel.state', chatId: activeChat });
  panel.replaceChildren();
  if (!s || s.error) return void panel.append(el('div', 'Extensão indisponível. Recarregue a página.', 'w'));
  if (!s.linked) return void panel.append(el('div', 'Não conectado. Clique no ícone da extensão e informe o código gerado no painel da loja.', 'w'));
  const hd = el('div', '', 'hd'); const ic = document.createElement('img'); ic.src = chrome.runtime.getURL('icons/icon-48.png'); hd.append(ic, el('span', `PediuLanchou · ${s.storeName}`)); panel.append(hd);
  if (!activeChat) return void panel.append(el('div', 'Abra uma conversa individual para usar o atendimento.'));
  const send1 = (text: string) => rpc({ type: 'panel.send', chatId: activeChat, text }).then(render);
  if (s.conversation) {
    panel.append(el('h4', 'Agente nesta conversa'));
    const sel = el('select'); for (const [v, l] of [['off', 'Desligado'], ['assisted', 'Assistido (você aprova)'], ...(s.features.includes('auto_reply') ? [['auto', 'Automático']] : [])]) { const o = el('option', l!); o.value = v!; sel.append(o); }
    sel.value = s.conversation.mode; sel.addEventListener('change', () => rpc({ type: 'panel.conversation', chatId: activeChat, mode: sel.value }).then(render));
    panel.append(sel, btn(s.conversation.humanPaused ? 'Devolver ao agente' : 'Assumir conversa', () => rpc({ type: 'panel.conversation', chatId: activeChat, humanPaused: !s.conversation.humanPaused }).then(render)));
    if (s.conversation.humanPaused) panel.append(el('div', 'Agente pausado: um atendente assumiu.', 'w'));
  }
  if (s.suggestion) {
    const g = s.suggestion;
    panel.append(el('h4', g.handoff ? 'Atendimento humano necessário' : 'Sugestão do agente'));
    if (g.handoffReason) panel.append(el('div', g.handoffReason, 'w'));
    if (g.autoFailed) panel.append(el('div', `Envio automático não ocorreu (${g.autoFailed}).`, 'w'));
    if (g.text) { panel.append(el('pre', g.text)); if (g.draftLink) panel.append(el('div', `Link do pedido: ${g.draftLink}`)); panel.append(btn('Enviar', () => send1(g.draftLink ? `${g.text}\n${g.draftLink}` : g.text)), btn('Copiar', () => navigator.clipboard.writeText(g.text)), btn('Descartar', () => rpc({ type: 'panel.discard', chatId: activeChat }).then(render))); }
  }
  if (s.replies?.length) {
    panel.append(el('h4', 'Respostas rápidas'));
    for (const r of s.replies) { panel.append(el('div', r.title), btn('Enviar', () => send1(r.text)), btn('Copiar', () => navigator.clipboard.writeText(r.text))); }
  }
}

async function poll() {
  try { const r = await ask<{ chatId: string | null }>({ type: 'active' }); const next = r.chatId && CHAT_ID.test(r.chatId) ? r.chatId : null; if (next !== activeChat) { activeChat = next; if (!panel.hidden) void render(); } } catch { /* WhatsApp ainda carregando */ }
}
setInterval(poll, 1500);
const attach = () => (document.body ? document.body.append(host) : setTimeout(attach, 200));
attach();
