// Service worker: guarda a ponte com o WhatsApp Web, roda o fluxo do agente e os disparos.
// O Chrome pode encerrá-lo a qualquer momento: todo estado vive em chrome.storage (session/local); a ponte reconecta sozinha.
import { checkLink, client, type Link } from './api.js';
import { BridgeError, tickBroadcast } from './broadcast.js';
import { onMessage, sendManual, type ChatState, type Deps, type Suggestion } from './flow.js';
import { CHAT_ID, parseEnvelope, parseReply, type Command } from './protocol.js';

const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const ports = new Set<chrome.runtime.Port>();
let seq = 0;

void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });   // credencial só para contextos confiáveis
void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

async function link(): Promise<Link | null> { return ((await chrome.storage.local.get('link')).link as Link | undefined) ?? null; }
async function features(): Promise<Set<string>> { return new Set(((await chrome.storage.session.get('features')).features as string[] | undefined) ?? []); }

async function refreshFeatures(): Promise<void> {
  const l = await link(); if (!l) return;
  const c = await checkLink(fetch, l);
  if (c.state === 'ok') await chrome.storage.session.set({ features: c.features });
  else if (c.state === 'revoked') { await chrome.storage.local.remove('link'); await chrome.storage.session.set({ features: [] }); }
}

/** Comando para o WhatsApp Web pela aba aberta. Sem resposta no prazo = resultado desconhecido (uncertain). */
function callBridge<T>(command: Command): Promise<T> {
  const port = [...ports].at(-1);
  if (!port) return Promise.reject(new BridgeError('WhatsApp Web não está aberto', false));
  const id = `c${Date.now().toString(36)}${seq++}`;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new BridgeError('sem resposta do WhatsApp Web', true)); }, 30_000);
    pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    try { port.postMessage({ kind: 'command', id, command }); } catch { clearTimeout(t); pending.delete(id); reject(new BridgeError('ponte indisponível', false)); }
  });
}

const chatKey = (c: string) => `chat:${c}`;
const sugKey = (c: string) => `sug:${c}`;
const store: Deps['state'] = {
  async load(c) { return ((await chrome.storage.session.get(chatKey(c)))[chatKey(c)] as ChatState | undefined) ?? { messages: [], name: '', agentSent: [] }; },
  async save(c, s) { await chrome.storage.session.set({ [chatKey(c)]: s }); },
  async setSuggestion(c, s) { if (s) await chrome.storage.session.set({ [sugKey(c)]: s }); else await chrome.storage.session.remove(sugKey(c)); },
};

async function deps(): Promise<Deps | null> {
  const l = await link(); if (!l) return null;
  const f = await features();
  return {
    features: () => f, api: client(fetch, l), state: store, now: () => Date.now(),
    bridge: {
      async send(chatId, text) { return (await callBridge<{ messageId: string }>({ type: 'send', chatId, text })).messageId; },
      media: (messageId) => callBridge({ type: 'media', messageId }),
    },
    notify: (_c, text) => { void chrome.action.setBadgeText({ text: '!' }); void chrome.action.setTitle({ title: `Pediu — ${text}` }); },
  };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'wa-bridge' || port.sender?.id !== chrome.runtime.id) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener(async (raw) => {
    if (raw?.kind === 'ping') return;
    if (raw?.kind === 'reply') {
      const r = parseReply(raw.reply); const p = r && pending.get(r.id);
      if (r && p) { pending.delete(r.id); r.ok ? p.resolve(r.data) : p.reject(new BridgeError(r.error ?? 'erro', false)); }
      return;
    }
    const event = parseEnvelope({ channel: 'pediu-wa-bridge/v1', event: raw?.event });
    if (!event) return;
    if (event.type === 'ready') { await refreshFeatures(); return; }
    if (event.type === 'message') { const d = await deps(); if (d) await onMessage(d, event.message).catch(() => {}); }
  });
});

// ---- painel dentro do WhatsApp Web (content script) ----
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (sender.id !== chrome.runtime.id || typeof m?.type !== 'string' || !m.type.startsWith('panel.')) return;
  (async () => {
    const l = await link(); const f = await features();
    if (!l) return { linked: false };
    const chatId = typeof m.chatId === 'string' && CHAT_ID.test(m.chatId) ? m.chatId : null;
    const api = client(fetch, l);
    const d = await deps();
    switch (m.type) {
      case 'panel.state': {
        if (!chatId) return { linked: true, storeName: l.storeName, features: [...f] };
        const st = await store.load(chatId);
        const [conversation, replies] = await Promise.all([
          f.has('ai_agent') ? api.getConversation(chatId).catch(() => null) : null,
          f.has('quick_replies') ? api.quickReplies(st.name).then((r) => r.replies).catch(() => []) : [],
        ]);
        const suggestion = ((await chrome.storage.session.get(sugKey(chatId)))[sugKey(chatId)] as Suggestion | undefined) ?? null;
        void chrome.action.setBadgeText({ text: '' });
        return { linked: true, storeName: l.storeName, features: [...f], conversation, replies, suggestion };
      }
      case 'panel.conversation': if (chatId && d) { await api.setConversation(chatId, { mode: m.mode, humanPaused: m.humanPaused }); } return { ok: true };
      case 'panel.send': if (chatId && d && typeof m.text === 'string' && m.text.trim()) { await sendManual(d, chatId, m.text); } return { ok: true };
      case 'panel.discard': if (chatId) await store.setSuggestion(chatId, null); return { ok: true };
    }
    return { ok: false };
  })().then(respond, (e) => respond({ error: String(e?.message ?? e) }));
  return true;
});

// ---- disparos: um ciclo a cada 30 s enquanto o navegador estiver aberto ----
chrome.alarms.create('broadcast', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'broadcast') return;
  const l = await link(); if (!l) return;
  const f = await features();   // o servidor confere a liberação a cada chamada; aqui só evita pedir sem necessidade
  await tickBroadcast({
    features: () => f,
    api: client(fetch, l),
    send: async (chatId, text, newChat) => (await callBridge<{ messageId: string }>({ type: 'send', chatId, text, newChat })).messageId,
  }).catch(() => {});
});
