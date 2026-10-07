// Etapa 1: apenas registra o estado e as últimas mensagens para validação.
// O worker pode ser encerrado a qualquer momento; tudo vive em chrome.storage.session.
import { parseEnvelope, CHANNEL, type BridgeEvent } from './protocol.js';

const KEEP = 50;

async function record(event: BridgeEvent) {
  const s = await chrome.storage.session.get({ status: 'disconnected', recent: [] });
  if (event.type === 'ready') s.status = 'ready';
  else if (event.type === 'disconnected') s.status = 'disconnected';
  else s.recent = [...s.recent, event.message].slice(-KEEP);
  await chrome.storage.session.set(s);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'wa-bridge' || port.sender?.id !== chrome.runtime.id) return;
  port.onMessage.addListener((raw) => {
    const event = parseEnvelope({ channel: CHANNEL, event: raw });
    if (event) void record(event);
  });
});
