// Contrato entre o contexto MAIN (WA-JS) e o content script isolado.
// A ponte aceita apenas eventos de leitura nesta etapa; nenhum comando de envio
// existe e nenhuma credencial Pediu cruza esta fronteira (MAIN não é confiável).

export const CHANNEL = 'pediu-wa-bridge/v1';
export const MAX_TEXT = 4096;

export type MediaKind = 'text' | 'audio' | 'image' | 'other';

export interface IncomingMessage {
  id: string;
  chatId: string;
  fromMe: boolean;
  kind: MediaKind;
  text: string;
  mimetype: string | null;
  timestamp: number;
}

export type BridgeEvent =
  | { type: 'ready'; wajsVersion: string | null }
  | { type: 'disconnected' }
  | { type: 'message'; message: IncomingMessage };

export interface Envelope {
  channel: typeof CHANNEL;
  event: BridgeEvent;
}

export function kindOf(type: unknown, mimetype: unknown): MediaKind {
  const t = String(type ?? '');
  const m = String(mimetype ?? '');
  if (t === 'chat') return 'text';
  if (t === 'ptt' || t === 'audio' || m.startsWith('audio/')) return 'audio';
  if (t === 'image' || m.startsWith('image/')) return 'image';
  return 'other';
}

/** Converte o objeto bruto do WA-JS em mensagem mínima; null se inválido. */
export function normalizeMessage(raw: unknown): IncomingMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const id = typeof r.id === 'string' ? r.id : r.id?._serialized;
  const chatId = r.from?._serialized ?? r.chatId?._serialized ?? (typeof r.from === 'string' ? r.from : null);
  if (typeof id !== 'string' || typeof chatId !== 'string') return null;
  const kind = kindOf(r.type, r.mimetype);
  const body = kind === 'text' ? r.body : r.caption;
  return {
    id,
    chatId,
    fromMe: r.id?.fromMe === true || r.fromMe === true,
    kind,
    text: typeof body === 'string' ? body.slice(0, MAX_TEXT) : '',
    mimetype: typeof r.mimetype === 'string' ? r.mimetype : null,
    timestamp: Number.isFinite(r.t) ? Number(r.t) : 0,
  };
}

/** Valida o que chega por postMessage; descarta qualquer outra coisa. */
export function parseEnvelope(data: unknown): BridgeEvent | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, any>;
  if (d.channel !== CHANNEL || !d.event || typeof d.event !== 'object') return null;
  const e = d.event as Record<string, any>;
  if (e.type === 'ready') {
    return { type: 'ready', wajsVersion: typeof e.wajsVersion === 'string' ? e.wajsVersion : null };
  }
  if (e.type === 'disconnected') return { type: 'disconnected' };
  if (e.type === 'message') {
    const m = e.message;
    if (!m || typeof m.id !== 'string' || typeof m.chatId !== 'string') return null;
    if (!['text', 'audio', 'image', 'other'].includes(m.kind)) return null;
    return {
      type: 'message',
      message: {
        id: m.id,
        chatId: m.chatId,
        fromMe: m.fromMe === true,
        kind: m.kind,
        text: typeof m.text === 'string' ? m.text.slice(0, MAX_TEXT) : '',
        mimetype: typeof m.mimetype === 'string' ? m.mimetype : null,
        timestamp: Number.isFinite(m.timestamp) ? Number(m.timestamp) : 0,
      },
    };
  }
  return null;
}
