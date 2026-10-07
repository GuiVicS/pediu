// Content script isolado: valida eventos do MAIN e os repassa ao service worker,
// reconectando a porta quando o worker é encerrado pelo Chrome.
import { parseEnvelope } from './protocol.js';

let port: chrome.runtime.Port | null = null;

function connect() {
  port = chrome.runtime.connect({ name: 'wa-bridge' });
  port.onDisconnect.addListener(() => {
    port = null;
  });
}

function send(event: unknown) {
  if (!port) connect();
  try {
    port!.postMessage(event);
  } catch {
    port = null;
    connect();
    port!.postMessage(event);
  }
}

window.addEventListener('message', (ev) => {
  if (ev.source !== window || ev.origin !== window.location.origin) return;
  const event = parseEnvelope(ev.data);
  if (event) send(event);
});
