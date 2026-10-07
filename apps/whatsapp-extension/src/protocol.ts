// Contrato entre o contexto MAIN (WA-JS) e o content script isolado.
// A ponte aceita apenas eventos de leitura nesta etapa; nenhum comando de envio
// existe e nenhuma credencial Pediu cruza esta fronteira (MAIN não é confiável).

export const CHANNEL = 'pediu-wa-bridge/v1';
export const MAX_TEXT = 4096;

export type MediaKind = 'text' | 'audio' | 'image' | 'other';

export interface IncomingMessage {
  id: string;
  /** nome de exibição do contato, quando o WhatsApp informa */
  name: string;
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
    name: String(r.notifyName ?? r.sender?.pushname ?? r.sender?.name ?? '').slice(0, 80),
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
        name: typeof m.name === 'string' ? m.name.slice(0, 80) : '',
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

// ---- comandos (extensão -> WhatsApp Web). Lista fechada: enviar texto, baixar mídia de uma mensagem e ler a conversa aberta ----
export const CMD_CHANNEL = 'pediu-wa-cmd/v1';
export const REPLY_CHANNEL = 'pediu-wa-reply/v1';
/** conversas individuais apenas (grupos e status nunca são atendidos nem recebem envio) */
export const CHAT_ID = /^[0-9]{5,20}@(c\.us|lid)$/;
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

export type Command =
  | { type: 'send'; chatId: string; text: string; newChat?: boolean }
  | { type: 'media'; messageId: string }
  | { type: 'active' };
export interface CommandEnvelope { channel: typeof CMD_CHANNEL; id: string; command: Command }
export interface ReplyEnvelope { channel: typeof REPLY_CHANNEL; id: string; ok: boolean; data?: unknown; error?: string }

export function parseCommand(data: unknown): { id: string; command: Command } | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, any>;
  if (d.channel !== CMD_CHANNEL || typeof d.id !== 'string' || d.id.length > 64 || !d.command || typeof d.command !== 'object') return null;
  const c = d.command as Record<string, any>;
  if (c.type === 'send' && typeof c.chatId === 'string' && CHAT_ID.test(c.chatId) && typeof c.text === 'string' && c.text.trim() && c.text.length <= MAX_TEXT) return { id: d.id, command: { type: 'send', chatId: c.chatId, text: c.text, newChat: c.newChat === true } };
  if (c.type === 'media' && typeof c.messageId === 'string' && c.messageId.length <= 200) return { id: d.id, command: { type: 'media', messageId: c.messageId } };
  if (c.type === 'active') return { id: d.id, command: { type: 'active' } };
  return null;
}

export function parseReply(data: unknown): ReplyEnvelope | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, any>;
  if (d.channel !== REPLY_CHANNEL || typeof d.id !== 'string' || typeof d.ok !== 'boolean') return null;
  return { channel: REPLY_CHANNEL, id: d.id, ok: d.ok, data: d.data, error: typeof d.error === 'string' ? d.error.slice(0, 200) : undefined };
}
