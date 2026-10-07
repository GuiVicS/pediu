// Orquestração do atendimento: recebe mensagens, transcreve áudio, analisa imagem, pede a resposta ao backend e decide enviar ou só sugerir.
// Tudo que fala com o mundo (API, WhatsApp, armazenamento) entra por `Deps`, para testar sem navegador.
import type { AgentMessage, AgentReply, Conversation } from './api.js';
import type { IncomingMessage } from './protocol.js';

export interface Suggestion { chatId: string; messageId: string; text: string; handoff: boolean; handoffReason?: string; draftLink?: string; autoFailed?: string; at: number }
export interface ChatState { messages: AgentMessage[]; name: string; agentSent: string[]; sendingUntil?: number }

export interface Deps {
  features: () => Set<string>;
  api: {
    agentReply(chatId: string, name: string, m: AgentMessage[]): Promise<AgentReply>;
    sendCheck(chatId: string, messageId: string): Promise<{ allowed: boolean; reason?: string }>;
    transcribe(mimetype: string, data: string): Promise<{ text: string }>;
    setConversation(chatId: string, patch: Partial<Conversation>): Promise<unknown>;
  };
  bridge: { send(chatId: string, text: string): Promise<string>; media(messageId: string): Promise<{ mimetype: string; data: string }> };
  state: { load(chatId: string): Promise<ChatState>; save(chatId: string, s: ChatState): Promise<void>; setSuggestion(chatId: string, s: Suggestion | null): Promise<void> };
  notify(chatId: string, text: string): void;
  now(): number;
}

const KEEP = 20;
const isPrivate = (chatId: string) => /@(c\.us|lid)$/.test(chatId);

export async function onMessage(d: Deps, msg: IncomingMessage): Promise<void> {
  if (!isPrivate(msg.chatId) || msg.kind === 'other' && !msg.text) return;
  const f = d.features();
  if (!f.has('ai_agent')) return;
  const st = await d.state.load(msg.chatId);
  if (st.messages.some((m) => m.id === msg.id)) return;          // evento repetido
  if (msg.name) st.name = msg.name;

  if (msg.fromMe) {
    st.messages = [...st.messages, { id: msg.id, fromMe: true, kind: msg.kind, text: msg.text }].slice(-KEEP);
    // o eco pode chegar antes do id ser registrado: durante o envio do agente, mensagens próprias contam como dele
    const own = st.agentSent.includes(msg.id) || (st.sendingUntil ?? 0) > d.now();
    await d.state.save(msg.chatId, st);
    // atendente humano escreveu na conversa: o agente para de responder (sem laço com as mensagens do próprio agente)
    if (!own) { await d.api.setConversation(msg.chatId, { humanPaused: true }).catch(() => {}); await d.state.setSuggestion(msg.chatId, null); }
    return;
  }

  let text = msg.text; let image: AgentMessage['image'];
  try {
    if (msg.kind === 'audio' && f.has('audio_transcription')) { const m = await d.bridge.media(msg.id); text = (await d.api.transcribe(m.mimetype, m.data)).text; }
    if (msg.kind === 'image' && f.has('image_analysis')) { const m = await d.bridge.media(msg.id); image = { mimetype: m.mimetype.split(';')[0]!, data: m.data }; }
  } catch { /* sem transcrição/imagem: o agente trata como áudio/imagem não interpretado e tende a chamar um humano */ }

  const entry: AgentMessage = { id: msg.id, fromMe: false, kind: msg.kind, text };
  st.messages = [...st.messages, entry].slice(-KEEP);
  await d.state.save(msg.chatId, st);

  let r: AgentReply;
  try { r = await d.api.agentReply(msg.chatId, st.name, image ? [...st.messages.slice(0, -1), { ...entry, image }] : st.messages); }
  catch (e) { await d.state.setSuggestion(msg.chatId, { chatId: msg.chatId, messageId: msg.id, text: '', handoff: true, handoffReason: `agente indisponível: ${(e as Error).message}`, at: d.now() }); d.notify(msg.chatId, 'Agente indisponível — responda manualmente.'); return; }
  if (r.skipped || (!r.text && !r.handoff)) return;

  const sug: Suggestion = { chatId: msg.chatId, messageId: r.messageId ?? msg.id, text: r.text ?? '', handoff: !!r.handoff, handoffReason: r.handoffReason, draftLink: r.draftLink, at: d.now() };
  if (r.handoff) { await d.state.setSuggestion(msg.chatId, sug); d.notify(msg.chatId, `Atendimento humano: ${r.handoffReason ?? 'conversa passada ao atendente'}`); return; }

  if (r.autoAllowed && f.has('auto_reply') && sug.text) {
    // revalida logo antes de enviar: modo, pausa humana e mensagem mais recente
    const chk = await d.api.sendCheck(msg.chatId, sug.messageId).catch(() => ({ allowed: false, reason: 'check_failed' }));
    if (chk.allowed) {
      try { await sendAndTrack(d, msg.chatId, sug.text); await d.state.setSuggestion(msg.chatId, null); return; }
      catch (e) { sug.autoFailed = (e as Error).message; }
    } else if (chk.reason === 'stale') return;      // chegou mensagem nova; a resposta dela substitui esta
    else sug.autoFailed = chk.reason;
  }
  await d.state.setSuggestion(msg.chatId, sug);
  d.notify(msg.chatId, 'Nova sugestão do agente.');
}

/** Envia e registra o id para que o eco da própria mensagem não seja confundido com um atendente humano. */
export async function sendAndTrack(d: Deps, chatId: string, text: string): Promise<void> {
  const before = await d.state.load(chatId);
  await d.state.save(chatId, { ...before, sendingUntil: d.now() + 10_000 });
  const id = await d.bridge.send(chatId, text);
  const st = await d.state.load(chatId);
  if (id) st.agentSent = [...st.agentSent, id].slice(-KEEP);
  await d.state.save(chatId, { ...st, sendingUntil: 0 });
}

/** Operador clicou em enviar (sugestão ou resposta rápida). */
export async function sendManual(d: Deps, chatId: string, text: string): Promise<void> {
  await sendAndTrack(d, chatId, text);
  await d.state.setSuggestion(chatId, null);
}
