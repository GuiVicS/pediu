// Roda no contexto MAIN, depois do WA-JS. Emite eventos de leitura e executa só os comandos da lista fechada de protocol.ts.
import { CHANNEL, MAX_MEDIA_BYTES, REPLY_CHANNEL, normalizeMessage, parseCommand, type BridgeEvent } from './protocol.js';

const origin = window.location.origin;
const emit = (event: BridgeEvent) => window.postMessage({ channel: CHANNEL, event }, origin);
const reply = (id: string, ok: boolean, data?: unknown, error?: string) => window.postMessage({ channel: REPLY_CHANNEL, id, ok, data, error }, origin);

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(new Error('leitura da mídia falhou'));
    r.readAsDataURL(blob);
  });
}

async function run(wpp: any, c: NonNullable<ReturnType<typeof parseCommand>>['command']) {
  if (c.type === 'send') {
    const r = await wpp.chat.sendTextMessage(c.chatId, c.text, { createChat: c.newChat === true });
    return { messageId: String(r?.id ?? '') };
  }
  if (c.type === 'media') {
    const blob: Blob = await wpp.chat.downloadMedia(c.messageId);
    if (blob.size > MAX_MEDIA_BYTES) throw new Error('mídia grande demais');
    return { mimetype: blob.type, data: await toBase64(blob) };
  }
  return { chatId: wpp.chat.getActiveChat()?.id?._serialized ?? null };
}

function start() {
  const wpp = (globalThis as any).WPP;
  if (!wpp) return setTimeout(start, 500);
  const announce = () => emit({ type: 'ready', wajsVersion: wpp.version ?? null });
  if (wpp.isFullReady) announce();
  wpp.loader?.onFullReady?.(announce);
  wpp.on?.('conn.logout', () => emit({ type: 'disconnected' }));
  wpp.on?.('chat.new_message', (raw: unknown) => {
    const message = normalizeMessage(raw);
    if (message) emit({ type: 'message', message });
  });
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.origin !== origin) return;
    const cmd = parseCommand(ev.data);
    if (!cmd) return;
    run(wpp, cmd.command).then((d) => reply(cmd.id, true, d), (e) => reply(cmd.id, false, undefined, String(e?.message ?? e)));
  });
}
start();
