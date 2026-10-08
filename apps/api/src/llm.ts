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

// ================= provedores de texto (agente de atendimento) =================
export type LlmProviderId = 'anthropic' | 'openai' | 'groq' | 'gemini' | 'mistral' | 'deepseek' | 'xai' | 'openrouter' | 'together' | 'ollama' | 'custom';
export interface LlmPreset {
  id: LlmProviderId; label: string;
  /** anthropic = API nativa da Anthropic; openai = protocolo "OpenAI-compatível" (/chat/completions), usado pelos demais. */
  kind: 'anthropic' | 'openai';
  baseUrl: string; defaultModel: string; keyEnv: string; needsKey: boolean; keysUrl: string; note: string;
  /** A OpenAI nova (GPT-5+ e raciocínio) recusa max_tokens e exige max_completion_tokens. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
}

export const LLM_PRESETS: LlmPreset[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-haiku-4-5-20251001', keyEnv: 'ANTHROPIC_API_KEY', needsKey: true, keysUrl: 'https://console.anthropic.com/settings/keys', note: 'Ótimo em seguir instruções e usar ferramentas.' },
  { id: 'openai', label: 'OpenAI (GPT)', kind: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', keyEnv: 'OPENAI_API_KEY', needsKey: true, keysUrl: 'https://platform.openai.com/api-keys', note: 'Troque o modelo pelo mais barato/atual da sua conta.', maxTokensField: 'max_completion_tokens' },
  { id: 'groq', label: 'Groq (rápido e barato)', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile', keyEnv: 'GROQ_API_KEY', needsKey: true, keysUrl: 'https://console.groq.com/keys', note: 'Resposta muito rápida; tem plano gratuito limitado. Também transcreve áudio (Whisper).' },
  { id: 'gemini', label: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.5-flash', keyEnv: 'GEMINI_API_KEY', needsKey: true, keysUrl: 'https://aistudio.google.com/apikey', note: 'Bom custo; entende imagens.' },
  { id: 'mistral', label: 'Mistral AI', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-small-latest', keyEnv: 'MISTRAL_API_KEY', needsKey: true, keysUrl: 'https://console.mistral.ai/api-keys', note: 'Provedor europeu.' },
  { id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', keyEnv: 'DEEPSEEK_API_KEY', needsKey: true, keysUrl: 'https://platform.deepseek.com/api_keys', note: 'Muito barato; só texto (não analisa imagens).' },
  { id: 'xai', label: 'xAI (Grok)', kind: 'openai', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-3-mini', keyEnv: 'XAI_API_KEY', needsKey: true, keysUrl: 'https://console.x.ai', note: 'Confira o nome do modelo no console da xAI.' },
  { id: 'openrouter', label: 'OpenRouter (vários modelos)', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini', keyEnv: 'OPENROUTER_API_KEY', needsKey: true, keysUrl: 'https://openrouter.ai/keys', note: 'Uma chave para centenas de modelos; o modelo leva o prefixo do fabricante (ex.: anthropic/…).' },
  { id: 'together', label: 'Together AI', kind: 'openai', baseUrl: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', keyEnv: 'TOGETHER_API_KEY', needsKey: true, keysUrl: 'https://api.together.ai/settings/api-keys', note: 'Modelos abertos (Llama, Qwen…).' },
  { id: 'ollama', label: 'Ollama (servidor próprio, sem chave)', kind: 'openai', baseUrl: 'http://host.docker.internal:11434/v1', defaultModel: 'llama3.1', keyEnv: '', needsKey: false, keysUrl: 'https://ollama.com', note: 'Modelo rodando na sua máquina/servidor. Precisa suportar ferramentas (tools).' },
  { id: 'custom', label: 'Outro (compatível com OpenAI)', kind: 'openai', baseUrl: '', defaultModel: '', keyEnv: 'LLM_API_KEY', needsKey: false, keysUrl: '', note: 'Qualquer servidor com /chat/completions (vLLM, LM Studio, LiteLLM…). Informe o endereço e o modelo.' },
];
export const llmPreset = (id: string) => LLM_PRESETS.find((p) => p.id === id);

export interface LlmConfig { provider: LlmProviderId; baseUrl: string; apiKey?: string; model: string }

/** Monta a configuração a partir das variáveis de ambiente. LLM_PROVIDER escolhe o provedor; sem ele vale a primeira chave encontrada. */
export function llmConfigFromEnv(env: Record<string, string | undefined>): LlmConfig | undefined {
  const pick = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  const explicit = pick(env.LLM_PROVIDER)?.toLowerCase();
  const preset = explicit ? llmPreset(explicit) : LLM_PRESETS.find((p) => p.needsKey && pick(env[p.keyEnv]));
  if (!preset) return undefined;
  const apiKey = pick(env.LLM_API_KEY) ?? (preset.keyEnv ? pick(env[preset.keyEnv]) : undefined);
  if (preset.needsKey && !apiKey) return undefined;
  const baseUrl = pick(env.LLM_BASE_URL) ?? preset.baseUrl;
  const model = pick(env.AGENT_MODEL) ?? pick(env.LLM_MODEL) ?? preset.defaultModel;
  if (!baseUrl || !model) return undefined;
  return { provider: preset.id, baseUrl, apiKey, model };
}

export function createLlm(c: LlmConfig, f?: typeof fetch): Llm {
  const p = llmPreset(c.provider);
  return p?.kind === 'anthropic' ? anthropicLlm({ apiKey: c.apiKey ?? '', model: c.model, baseUrl: c.baseUrl, fetch: f })
    : openAiCompatLlm({ apiKey: c.apiKey, model: c.model, baseUrl: c.baseUrl, maxTokensField: p?.maxTokensField ?? 'max_tokens', fetch: f });
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
const trimUrl = (u: string) => u.replace(/\/+$/, '');
const fail = async (label: string, r: Response) => new Error(`${label} ${r.status}: ${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240)}`);

/** Claude pela API da Anthropic. */
export function anthropicLlm(o: { apiKey: string; model: string; baseUrl?: string; fetch?: typeof fetch }): Llm {
  const f = o.fetch ?? fetch;
  const wire = (b: Block) => b.type === 'text' ? b
    : b.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.data } }
    : b.type === 'tool_use' ? b : { type: 'tool_result', tool_use_id: b.toolUseId, content: b.content };
  return {
    async complete({ system, messages, tools }) {
      const r = await f(`${trimUrl(o.baseUrl ?? 'https://api.anthropic.com')}/v1/messages`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': o.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: o.model, max_tokens: 1024, system, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })),
          messages: messages.map((m) => ({ role: m.role, content: m.content.map(wire) })) }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!r.ok) throw await fail('LLM', r);
      const j = (await r.json()) as { content: any[]; stop_reason: string };
      const blocks: Block[] = j.content.flatMap((c): Block[] => c.type === 'text' ? [{ type: 'text', text: c.text }] : c.type === 'tool_use' ? [{ type: 'tool_use', id: c.id, name: c.name, input: c.input }] : []);
      return { blocks, toolUse: j.stop_reason === 'tool_use' };
    },
  };
}

/** Qualquer provedor que fale o protocolo da OpenAI (/chat/completions): OpenAI, Groq, Gemini, Mistral, DeepSeek, xAI, OpenRouter, Together, Ollama, vLLM… */
export function openAiCompatLlm(o: { apiKey?: string; model: string; baseUrl: string; maxTokensField?: 'max_tokens' | 'max_completion_tokens'; fetch?: typeof fetch }): Llm {
  const f = o.fetch ?? fetch;
  /** Converte as mensagens internas (estilo Anthropic) para o formato de chat da OpenAI. Resultados de ferramenta viram mensagens `tool`. */
  const wire = (system: string, messages: LlmMessage[]) => {
    const out: Record<string, unknown>[] = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'assistant') {
        const text = m.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');
        const calls = m.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
          .map((b) => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
        out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
        continue;
      }
      for (const b of m.content) if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.content });   // resultados primeiro: devem seguir o assistant com tool_calls
      const parts = m.content.flatMap((b): Part[] => b.type === 'text' ? [{ type: 'text', text: b.text }] : b.type === 'image' ? [{ type: 'image_url', image_url: { url: `data:${b.mediaType};base64,${b.data}` } }] : []);
      const only = parts[0];
      if (parts.length) out.push({ role: 'user', content: parts.length === 1 && only?.type === 'text' ? only.text : parts });
    }
    return out;
  };
  return {
    async complete({ system, messages, tools }) {
      const body: Record<string, unknown> = { model: o.model, [o.maxTokensField ?? 'max_tokens']: 1024, messages: wire(system, messages) };
      if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
      const r = await f(`${trimUrl(o.baseUrl)}/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}) },
        body: JSON.stringify(body), signal: AbortSignal.timeout(45_000),
      });
      if (!r.ok) throw await fail('LLM', r);
      const j = (await r.json()) as { choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments?: string } }[] }; finish_reason?: string }[] };
      const msg = j.choices?.[0]?.message;
      if (!msg) throw new Error('LLM resposta vazia');
      const blocks: Block[] = [];
      if (msg.content && msg.content.trim()) blocks.push({ type: 'text', text: msg.content });
      for (const c of msg.tool_calls ?? []) {
        let input: Record<string, unknown> = {};
        try { const v = JSON.parse(c.function.arguments || '{}'); if (v && typeof v === 'object' && !Array.isArray(v)) input = v; } catch { /* argumentos inválidos: a ferramenta recebe vazio e responde com o erro de validação */ }
        blocks.push({ type: 'tool_use', id: c.id, name: c.function.name, input });
      }
      return { blocks, toolUse: blocks.some((b) => b.type === 'tool_use') };
    },
  };
}

// ================= transcrição de áudio =================
export type SttProviderId = 'internal' | 'openai' | 'groq' | 'custom';
export interface SttPreset { id: SttProviderId; label: string; url: string; defaultModel: string; keyEnv: string; needsKey: boolean; note: string }
export const STT_PRESETS: SttPreset[] = [
  { id: 'internal', label: 'Whisper interno (servidor da plataforma)', url: 'http://whisper:8000/v1/audio/transcriptions', defaultModel: 'whisper-1', keyEnv: 'INTERNAL_WHISPER_KEY', needsKey: false, note: 'Roda dentro da sua stack (serviço whisper): o áudio não sai para terceiros. O modelo é definido no serviço (WHISPER_MODEL).' },
  { id: 'openai', label: 'OpenAI (Whisper)', url: 'https://api.openai.com/v1/audio/transcriptions', defaultModel: 'whisper-1', keyEnv: 'OPENAI_API_KEY', needsKey: true, note: 'Whisper hospedado pela OpenAI.' },
  { id: 'groq', label: 'Groq (Whisper rápido)', url: 'https://api.groq.com/openai/v1/audio/transcriptions', defaultModel: 'whisper-large-v3-turbo', keyEnv: 'GROQ_API_KEY', needsKey: true, note: 'Whisper muito rápido e barato.' },
  { id: 'custom', label: 'Servidor próprio (faster-whisper, whisper.cpp…)', url: '', defaultModel: 'whisper-1', keyEnv: 'TRANSCRIBE_API_KEY', needsKey: false, note: 'Qualquer servidor com /audio/transcriptions. Informe o endereço completo.' },
];
export const sttPreset = (id: string) => STT_PRESETS.find((p) => p.id === id);
export interface SttConfig { provider: SttProviderId; url: string; apiKey?: string; model: string }

/** Variáveis: TRANSCRIBE_URL (servidor próprio) ou TRANSCRIBE_PROVIDER=internal|openai|groq; INTERNAL_WHISPER_URL liga o Whisper interno da stack; a chave vem de TRANSCRIBE_API_KEY ou da chave do provedor (OPENAI_API_KEY / GROQ_API_KEY / INTERNAL_WHISPER_KEY). */
export function sttConfigFromEnv(env: Record<string, string | undefined>): SttConfig | undefined {
  const pick = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  const url = pick(env.TRANSCRIBE_URL);
  const explicit = pick(env.TRANSCRIBE_PROVIDER)?.toLowerCase();
  // ordem: endereço próprio > provedor escolhido > Whisper interno da stack (INTERNAL_WHISPER_URL) > chaves de provedores na nuvem
  const preset = url ? sttPreset('custom')! : explicit ? sttPreset(explicit) : pick(env.INTERNAL_WHISPER_URL) ? sttPreset('internal') : (pick(env.TRANSCRIBE_API_KEY) || pick(env.OPENAI_API_KEY)) ? sttPreset('openai') : pick(env.GROQ_API_KEY) ? sttPreset('groq') : undefined;
  if (!preset) return undefined;
  const apiKey = pick(env.TRANSCRIBE_API_KEY) ?? (preset.id === 'custom' ? undefined : pick(env[preset.keyEnv]));
  if (preset.needsKey && !apiKey) return undefined;
  const target = url ?? (preset.id === 'internal' ? pick(env.INTERNAL_WHISPER_URL) : undefined) ?? preset.url;
  if (!target) return undefined;
  return { provider: preset.id, url: target, apiKey, model: pick(env.TRANSCRIBE_MODEL) ?? preset.defaultModel };
}

export const createTranscriber = (c: SttConfig, f?: typeof fetch) => openAiTranscriber({ url: c.url, apiKey: c.apiKey, model: c.model, fetch: f });

/** Transcrição Whisper por endpoint compatível com /audio/transcriptions (OpenAI, Groq, faster-whisper/whisper.cpp em servidor próprio). */
export function openAiTranscriber(o: { url: string; apiKey?: string; model: string; fetch?: typeof fetch }): Transcriber {
  const f = o.fetch ?? fetch;
  return {
    async transcribe({ mimetype, data }) {
      const form = new FormData();
      form.set('model', o.model); form.set('language', 'pt');
      form.set('file', new Blob([new Uint8Array(data)], { type: mimetype }), `audio.${/wav/.test(mimetype) ? 'wav' : /mpeg|mp3/.test(mimetype) ? 'mp3' : /mp4|m4a|aac/.test(mimetype) ? 'm4a' : /webm/.test(mimetype) ? 'webm' : 'ogg'}`);   // alguns provedores validam pela extensão
      const r = await f(o.url, { method: 'POST', headers: o.apiKey ? { authorization: `Bearer ${o.apiKey}` } : {}, body: form, signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw await fail('STT', r);
      return String(((await r.json()) as { text?: string }).text ?? '').trim();
    },
  };
}
