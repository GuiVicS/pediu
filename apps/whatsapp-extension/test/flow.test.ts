import test from 'node:test';
import assert from 'node:assert/strict';
import { onMessage, sendManual, type ChatState, type Deps, type Suggestion } from '../src/flow.js';
import type { AgentReply } from '../src/api.js';
import type { IncomingMessage } from '../src/protocol.js';

const CHAT = '5516999990000@c.us';
function make(over: { features?: string[]; reply?: AgentReply | Error; check?: { allowed: boolean; reason?: string } } = {}) {
  const log = { sent: [] as string[], conv: [] as object[], notes: [] as string[], replyArgs: [] as any[], transcribed: 0, mediaCalls: 0 };
  const states = new Map<string, ChatState>(); const sug = new Map<string, Suggestion | null>();
  let t = 1000;
  const d: Deps = {
    features: () => new Set(over.features ?? ['ai_agent']),
    api: {
      async agentReply(_c, name, m) { log.replyArgs.push({ name, m }); if (over.reply instanceof Error) throw over.reply; return over.reply ?? { text: 'olá!', messageId: m.at(-1)!.id }; },
      async sendCheck() { return over.check ?? { allowed: true }; },
      async transcribe() { log.transcribed++; return { text: 'quero uma pizza' }; },
      async setConversation(_c, p) { log.conv.push(p); },
    },
    bridge: { async send(_c, text) { log.sent.push(text); return `out-${log.sent.length}`; }, async media() { log.mediaCalls++; return { mimetype: 'audio/ogg; codecs=opus', data: 'AAAA' }; } },
    state: { async load(c) { return structuredClone(states.get(c) ?? { messages: [], name: '', agentSent: [] }); }, async save(c, s) { states.set(c, structuredClone(s)); }, async setSuggestion(c, s) { sug.set(c, s); } },
    notify: (_c, x) => log.notes.push(x), now: () => (t += 1),
  };
  return { d, log, states, sug };
}
const msg = (o: Partial<IncomingMessage> = {}): IncomingMessage => ({ id: 'm1', name: 'Ana', chatId: CHAT, fromMe: false, kind: 'text', text: 'oi', mimetype: null, timestamp: 1, ...o });

test('assistido: guarda a sugestão e não envia', async () => {
  const { d, log, sug } = make();
  await onMessage(d, msg());
  assert.equal(log.sent.length, 0); assert.equal(sug.get(CHAT)?.text, 'olá!'); assert.equal(log.replyArgs[0].name, 'Ana');
});

test('automático: confere antes de enviar e registra o envio; descarta se ficou obsoleta', async () => {
  const ok = make({ reply: { text: 'resp', messageId: 'm1', autoAllowed: true }, features: ['ai_agent', 'auto_reply'] });
  await onMessage(ok.d, msg());
  assert.deepEqual(ok.log.sent, ['resp']); assert.equal(ok.sug.get(CHAT), null);
  // o eco da mensagem enviada não pausa o agente
  await onMessage(ok.d, msg({ id: 'out-1', fromMe: true, text: 'resp' }));
  assert.equal(ok.log.conv.length, 0);

  const stale = make({ reply: { text: 'resp', messageId: 'm1', autoAllowed: true }, check: { allowed: false, reason: 'stale' }, features: ['ai_agent', 'auto_reply'] });
  await onMessage(stale.d, msg());
  assert.equal(stale.log.sent.length, 0); assert.equal(stale.sug.get(CHAT), undefined);

  const human = make({ reply: { text: 'resp', messageId: 'm1', autoAllowed: true }, check: { allowed: false, reason: 'human' }, features: ['ai_agent', 'auto_reply'] });
  await onMessage(human.d, msg());
  assert.equal(human.log.sent.length, 0); assert.equal(human.sug.get(CHAT)?.autoFailed, 'human');   // vira sugestão para o atendente
});

test('sem auto_reply liberada o servidor pode até dizer autoAllowed e mesmo assim nada é enviado', async () => {
  const { d, log } = make({ reply: { text: 'resp', messageId: 'm1', autoAllowed: true } });
  await onMessage(d, msg());
  assert.equal(log.sent.length, 0);
});

test('atendente humano escreveu: pausa o agente e limpa a sugestão', async () => {
  const { d, log, sug } = make();
  await onMessage(d, msg());
  await onMessage(d, msg({ id: 'h1', fromMe: true, text: 'já vou resolver' }));
  assert.deepEqual(log.conv, [{ humanPaused: true }]); assert.equal(sug.get(CHAT), null);
});

test('áudio é transcrito e imagem vai junto só com a funcionalidade liberada', async () => {
  const a = make({ features: ['ai_agent', 'audio_transcription'] });
  await onMessage(a.d, msg({ kind: 'audio', text: '', mimetype: 'audio/ogg' }));
  assert.equal(a.log.transcribed, 1); assert.equal(a.log.replyArgs[0].m.at(-1).text, 'quero uma pizza');
  const semAudio = make();
  await onMessage(semAudio.d, msg({ kind: 'audio', text: '' }));
  assert.equal(semAudio.log.mediaCalls, 0);

  const i = make({ features: ['ai_agent', 'image_analysis'] });
  await onMessage(i.d, msg({ kind: 'image', text: 'olha', mimetype: 'image/jpeg' }));
  assert.equal(i.log.replyArgs[0].m.at(-1).image.mimetype, 'audio/ogg');   // o fake devolve sempre o mesmo tipo; importa que a mídia foi anexada
  const semImg = make();
  await onMessage(semImg.d, msg({ kind: 'image', text: 'olha' }));
  assert.equal(semImg.log.replyArgs[0].m.at(-1).image, undefined);
});

test('handoff e falha do agente avisam o atendente; grupos e repetidos são ignorados', async () => {
  const h = make({ reply: { handoff: true, handoffReason: 'reclamação', messageId: 'm1' } });
  await onMessage(h.d, msg());
  assert.equal(h.sug.get(CHAT)?.handoff, true); assert.match(h.log.notes[0]!, /reclamação/);
  const f = make({ reply: new Error('boom') });
  await onMessage(f.d, msg());
  assert.match(f.log.notes[0]!, /indisponível/);
  const g = make();
  await onMessage(g.d, msg({ chatId: '120363@g.us' })); await onMessage(g.d, msg()); await onMessage(g.d, msg());
  assert.equal(g.log.replyArgs.length, 1);
  const off = make({ features: [] });
  await onMessage(off.d, msg());
  assert.equal(off.log.replyArgs.length, 0);
});

test('envio manual limpa a sugestão e não é visto como atendente', async () => {
  const { d, log, sug } = make();
  await onMessage(d, msg());
  await sendManual(d, CHAT, 'texto do operador');
  await onMessage(d, msg({ id: 'out-1', fromMe: true, text: 'texto do operador' }));
  assert.deepEqual(log.sent, ['texto do operador']); assert.equal(sug.get(CHAT), null); assert.equal(log.conv.length, 0);
});
