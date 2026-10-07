// Adaptadores de IA. A chave fica só no servidor; os testes injetam falsos em ctx.llm / ctx.transcriber.
export type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string };
export interface LlmMessage { role: 'user' | 'assistant'; content: Block[] }
export interface ToolDef { name: string; description: string; schema: Record<string, unknown> }
export interface Llm { complete(req: { system: string; messages: LlmMessage[]; tools: ToolDef[] }): Promise<{ blocks: Block[]; toolUse: boolean }> }
export interface Transcriber { transcribe(a: { mimetype: string; data: Buffer }): Promise<string> }

/** Claude pela API da Anthropic. */
export function anthropicLlm(o: { apiKey: string; model: string; fetch?: typeof fetch }): Llm {
  const f = o.fetch ?? fetch;
  const wire = (b: Block) => b.type === 'text' ? b
    : b.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.data } }
    : b.type === 'tool_use' ? b : { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content };
  return {
    async complete({ system, messages, tools }) {
      const r = await f('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': o.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: o.model, max_tokens: 1024, system, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })),
          messages: messages.map((m) => ({ role: m.role, content: m.content.map(wire) })) }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!r.ok) throw new Error(`LLM ${r.status}`);
      const j = (await r.json()) as { content: any[]; stop_reason: string };
      const blocks: Block[] = j.content.flatMap((c): Block[] => c.type === 'text' ? [{ type: 'text', text: c.text }] : c.type === 'tool_use' ? [{ type: 'tool_use', id: c.id, name: c.name, input: c.input }] : []);
      return { blocks, toolUse: j.stop_reason === 'tool_use' };
    },
  };
}

/** Transcrição Whisper por endpoint compatível com /audio/transcriptions (OpenAI, Groq, faster-whisper/whisper.cpp em servidor próprio). */
export function openAiTranscriber(o: { url: string; apiKey?: string; model: string; fetch?: typeof fetch }): Transcriber {
  const f = o.fetch ?? fetch;
  return {
    async transcribe({ mimetype, data }) {
      const form = new FormData();
      form.set('model', o.model); form.set('language', 'pt');
      form.set('file', new Blob([new Uint8Array(data)], { type: mimetype }), mimetype.includes('ogg') ? 'audio.ogg' : 'audio.bin');
      const r = await f(o.url, { method: 'POST', headers: o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}, body: form, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`STT ${r.status}`);
      return String(((await r.json()) as { text?: string }).text ?? '').trim();
    },
  };
}
