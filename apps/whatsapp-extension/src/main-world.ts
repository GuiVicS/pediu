// Roda no contexto MAIN, depois do WA-JS. Só emite eventos de leitura.
import { CHANNEL, normalizeMessage, type BridgeEvent } from './protocol.js';

declare const WPP: any;

function emit(event: BridgeEvent) {
  window.postMessage({ channel: CHANNEL, event }, window.location.origin);
}

function start() {
  const wpp = (globalThis as any).WPP;
  if (!wpp) return setTimeout(start, 500);
  const announce = () => emit({ type: 'ready', wajsVersion: wpp.version ?? null });
  if (wpp.isReady) announce();
  wpp.webpack?.onReady?.(announce);
  wpp.on?.('conn.logout', () => emit({ type: 'disconnected' }));
  wpp.on?.('chat.new_message', (raw: unknown) => {
    const message = normalizeMessage(raw);
    if (message) emit({ type: 'message', message });
  });
}
start();
