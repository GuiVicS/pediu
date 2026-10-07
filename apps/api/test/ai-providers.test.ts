import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createAdmin, client, fullLogin, setup, stepUp, type Env } from './helpers.js';
import { createAiRuntime } from '../src/aiConfig.js';
import { createLlm, createTranscriber, llmConfigFromEnv, openAiCompatLlm, sttConfigFromEnv, type Block, type ToolDef } from '../src/llm.js';

// ---------- resolução por variáveis de ambiente ----------
test('LLM por ambiente: provedor explícito, primeira chave encontrada, padrões e sobrescritas', () => {
  assert.equal(llmConfigFromEnv({}), undefined);
  // compatibilidade: só ANTHROPIC_API_KEY (como antes) continua funcionando
  assert.deepEqual(llmConfigFromEnv({ ANTHROPIC_API_KEY: 'sk-a' }), { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-a', model: 'claude-haiku-4-5-20251001' });
  const groq = llmConfigFromEnv({ GROQ_API_KEY: 'gsk-1' })!;
  assert.deepEqual([groq.provider, groq.baseUrl, groq.model], ['groq', 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile']);
  // LLM_PROVIDER manda, mesmo havendo outras chaves
  assert.equal(llmConfigFromEnv({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' })!.provider, 'gemini');
  // AGENT_MODEL e LLM_BASE_URL sobrescrevem; LLM_API_KEY vale para qualquer provedor
  const o = llmConfigFromEnv({ LLM_PROVIDER: 'openai', LLM_API_KEY: 'k', AGENT_MODEL: 'gpt-x', LLM_BASE_URL: 'https://proxy.test/v1' })!;
  assert.deepEqual([o.provider, o.apiKey, o.model, o.baseUrl], ['openai', 'k', 'gpt-x', 'https://proxy.test/v1']);
  // provedor que exige chave, sem chave: indisponível
  assert.equal(llmConfigFromEnv({ LLM_PROVIDER: 'openai' }), undefined);
  // Ollama não precisa de chave; "custom" exige endereço e modelo
  assert.equal(llmConfigFromEnv({ LLM_PROVIDER: 'ollama' })!.apiKey, undefined);
  assert.equal(llmConfigFromEnv({ LLM_PROVIDER: 'custom' }), undefined);
  assert.equal(llmConfigFromEnv({ LLM_PROVIDER: 'custom', LLM_BASE_URL: 'http://x/v1', AGENT_MODEL: 'm' })!.model, 'm');
  assert.equal(llmConfigFromEnv({ LLM_PROVIDER: 'inexistente', OPENAI_API_KEY: 'x' }), undefined);
});

test('transcrição por ambiente: OpenAI, Groq e servidor próprio', () => {
  assert.equal(sttConfigFromEnv({}), undefined);
  assert.deepEqual(sttConfigFromEnv({ TRANSCRIBE_API_KEY: 'k' }), { provider: 'openai', url: 'https://api.openai.com/v1/audio/transcriptions', apiKey: 'k', model: 'whisper-1' });   // como antes
  const g = sttConfigFromEnv({ GROQ_API_KEY: 'gk' })!;
  assert.deepEqual([g.provider, g.url, g.model], ['groq', 'https://api.groq.com/openai/v1/audio/transcriptions', 'whisper-large-v3-turbo']);
  assert.equal(sttConfigFromEnv({ TRANSCRIBE_PROVIDER: 'groq', GROQ_API_KEY: 'gk' })!.provider, 'groq');
  const c = sttConfigFromEnv({ TRANSCRIBE_URL: 'http://whisper:8000/v1/audio/transcriptions' })!;
  assert.deepEqual([c.provider, c.apiKey], ['custom', undefined]);
});

// ---------- adaptador OpenAI-compatível ----------
const tools: ToolDef[] = [{ name: 'buscar', description: 'busca', schema: { type: 'object', properties: { q: { type: 'string' } } } }];
const fakeFetch = (reply: unknown, status = 200) => {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const f = (async (url: string, init: any) => { calls.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } }); }) as unknown as typeof fetch;
  return { f, calls };
};

test('OpenAI-compatível: converte mensagens, ferramentas e imagens; lê texto e chamadas de ferramenta', async () => {
  const { f, calls } = fakeFetch({ choices: [{ finish_reason: 'tool_calls', message: { content: 'vou buscar', tool_calls: [{ id: 'c1', function: { name: 'buscar', arguments: '{"q":"pizza"}' } }] } }] });
  const llm = openAiCompatLlm({ apiKey: 'sk-x', model: 'm1', baseUrl: 'https://api.test/v1/', fetch: f });
  const history: { role: 'user' | 'assistant'; content: Block[] }[] = [
    { role: 'user', content: [{ type: 'image', mediaType: 'image/jpeg', data: 'QUJD' }, { type: 'text', text: 'o que é isso?' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'deixa ver' }, { type: 'tool_use', id: 'c0', name: 'buscar', input: { q: 'x' } }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c0', content: '{"ok":1}' }, { type: 'text', text: 'e agora?' }] },
  ];
  const r = await llm.complete({ system: 'SYS', messages: history, tools });
  assert.equal(r.toolUse, true);
  assert.deepEqual(r.blocks, [{ type: 'text', text: 'vou buscar' }, { type: 'tool_use', id: 'c1', name: 'buscar', input: { q: 'pizza' } }]);

  const c = calls[0]!;
  assert.equal(c.url, 'https://api.test/v1/chat/completions');            // barra final do endereço não duplica
  assert.equal(c.headers.authorization, 'Bearer sk-x');
  assert.equal(c.body.model, 'm1'); assert.equal(c.body.max_tokens, 1024);
  assert.deepEqual(c.body.tools, [{ type: 'function', function: { name: 'buscar', description: 'busca', parameters: tools[0]!.schema } }]);
  const [sys, u1, a1, tool, u2] = c.body.messages;
  assert.deepEqual(sys, { role: 'system', content: 'SYS' });
  assert.deepEqual(u1.content, [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } }, { type: 'text', text: 'o que é isso?' }]);
  assert.equal(a1.content, 'deixa ver'); assert.deepEqual(a1.tool_calls, [{ id: 'c0', type: 'function', function: { name: 'buscar', arguments: '{"q":"x"}' } }]);
  assert.deepEqual(tool, { role: 'tool', tool_call_id: 'c0', content: '{"ok":1}' });   // o resultado vem logo depois do assistant, antes do texto novo
  assert.deepEqual(u2, { role: 'user', content: 'e agora?' });
});

test('OpenAI-compatível: resposta só com texto, argumentos inválidos, erro com a mensagem do provedor e max_completion_tokens', async () => {
  const text = fakeFetch({ choices: [{ finish_reason: 'stop', message: { content: 'olá!' } }] });
  const a = await openAiCompatLlm({ model: 'm', baseUrl: 'http://ollama:11434/v1', fetch: text.f }).complete({ system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'oi' }] }], tools: [] });
  assert.deepEqual(a, { blocks: [{ type: 'text', text: 'olá!' }], toolUse: false });
  assert.equal(text.calls[0]!.headers.authorization, undefined);     // sem chave (Ollama): nenhum cabeçalho de autorização
  assert.equal(text.calls[0]!.body.tools, undefined);                // sem ferramentas: não envia o campo

  const bad = fakeFetch({ choices: [{ message: { content: null, tool_calls: [{ id: 't', function: { name: 'buscar', arguments: '{quebrado' } }] } }] });
  const b = await openAiCompatLlm({ model: 'm', baseUrl: 'https://x/v1', fetch: bad.f }).complete({ system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'oi' }] }], tools });
  assert.deepEqual(b.blocks, [{ type: 'tool_use', id: 't', name: 'buscar', input: {} }]); assert.equal(b.toolUse, true);

  const err = fakeFetch({ error: { message: 'Incorrect API key' } }, 401);
  await assert.rejects(openAiCompatLlm({ model: 'm', baseUrl: 'https://x/v1', fetch: err.f }).complete({ system: 's', messages: [], tools: [] }), /LLM 401: .*Incorrect API key/);

  // OpenAI usa max_completion_tokens (pelo preset); os demais, max_tokens
  const o = fakeFetch({ choices: [{ message: { content: 'ok' } }] });
  await createLlm({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'gpt' }, o.f).complete({ system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }], tools: [] });
  assert.equal(o.calls[0]!.body.max_completion_tokens, 1024); assert.equal(o.calls[0]!.body.max_tokens, undefined);
});

test('Anthropic: usa a API nativa e aceita endereço próprio', async () => {
  const { f, calls } = fakeFetch({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'oi' }] });
  const r = await createLlm({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-a', model: 'claude-x' }, f).complete({ system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }], tools: [] });
  assert.deepEqual(r, { blocks: [{ type: 'text', text: 'oi' }], toolUse: false });
  assert.equal(calls[0]!.url, 'https://api.anthropic.com/v1/messages'); assert.equal(calls[0]!.headers['x-api-key'], 'sk-a');
});

test('transcrição: manda o modelo e o arquivo com extensão correta', async () => {
  let seen: { url: string; model: string; file: string; auth?: string } | undefined;
  const f = (async (url: string, init: any) => { const fd = init.body as FormData; seen = { url, model: String(fd.get('model')), file: (fd.get('file') as File).name, auth: init.headers.authorization }; return new Response(JSON.stringify({ text: ' quero duas ' }), { status: 200 }); }) as unknown as typeof fetch;
  const t = createTranscriber({ provider: 'groq', url: 'https://api.groq.com/openai/v1/audio/transcriptions', apiKey: 'gk', model: 'whisper-large-v3-turbo' }, f);
  assert.equal(await t.transcribe({ mimetype: 'audio/ogg; codecs=opus', data: Buffer.from('x') }), 'quero duas');
  assert.deepEqual(seen, { url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo', file: 'audio.ogg', auth: 'Bearer gk' });
  await t.transcribe({ mimetype: 'audio/wav', data: Buffer.from('x') });
  assert.equal(seen!.file, 'audio.wav');
});

// ---------- tela do super admin: salvar chave cifrada, usar no runtime, testar, remover ----------
let env: Env;
before(async () => { env = await setup(); });
after(() => env.close());

test('super admin: escolhe o provedor e salva a chave cifrada (step-up); o agente passa a usá-la; a chave nunca volta', async () => {
  await createAdmin(env, 'ia@pediu.test');
  const sa = client(env); await fullLogin(env, sa, 'ia@pediu.test');
  const calls: { url: string; auth?: string; model: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => { calls.push({ url, auth: init.headers?.authorization, model: JSON.parse(init.body).model }); return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 }); }) as unknown as typeof fetch;
  try {
    env.ctx.ai = createAiRuntime(env.ctx, {});          // nenhuma variável de ambiente: tudo vem da tela
    const first = await sa.get('/v1/platform/ai-settings');
    assert.equal(first.status, 200); assert.equal(first.body.llm, null);
    assert.ok(first.body.presets.llm.some((p: { id: string }) => p.id === 'groq')); assert.ok(first.body.presets.stt.some((p: { id: string }) => p.id === 'groq'));
    assert.equal((await sa.post('/v1/platform/ai-settings/test', { kind: 'llm' })).body.ok, false);   // ainda sem provedor

    // sem step-up não salva; provedor inválido e chave ausente são recusados
    const body = { kind: 'llm', provider: 'groq', apiKey: 'gsk-segredo-123', model: 'llama-3.3-70b-versatile' };
    assert.equal((await sa.put('/v1/platform/ai-settings', body)).status, 403);
    await stepUp(env, sa, 'ia@pediu.test');
    assert.equal((await sa.put('/v1/platform/ai-settings', { ...body, provider: 'nao-existe' })).status, 400);
    assert.equal((await sa.put('/v1/platform/ai-settings', { kind: 'llm', provider: 'openai' })).status, 400);        // exige chave
    assert.equal((await sa.put('/v1/platform/ai-settings', { kind: 'llm', provider: 'custom', apiKey: 'k' })).status, 400);   // exige endereço
    assert.equal((await sa.put('/v1/platform/ai-settings', body)).status, 200);

    // a chave está cifrada no banco e não aparece nas respostas
    const [row] = await env.pools.platform.begin((q) => q`select value_enc from platform_settings where key = 'ai.llm'`);
    assert.equal(String(row!.value_enc).includes('gsk-segredo-123'), false);
    const after1 = await sa.get('/v1/platform/ai-settings');
    assert.deepEqual([after1.body.llm.provider, after1.body.llm.source, after1.body.savedLlm.hasKey], ['groq', 'painel', true]);
    assert.equal(JSON.stringify(after1.body).includes('gsk-segredo-123'), false);

    // o teste de conexão usa o provedor salvo
    const t = await sa.post('/v1/platform/ai-settings/test', { kind: 'llm' });
    assert.equal(t.body.ok, true); assert.equal(t.body.reply, 'OK');
    assert.deepEqual(calls.at(-1), { url: 'https://api.groq.com/openai/v1/chat/completions', auth: 'Bearer gsk-segredo-123', model: 'llama-3.3-70b-versatile' });

    // trocar só o modelo mantém a chave; trocar de provedor sem chave nova é recusado
    await stepUp(env, sa, 'ia@pediu.test');
    assert.equal((await sa.put('/v1/platform/ai-settings', { kind: 'llm', provider: 'groq', model: 'llama-3.1-8b-instant' })).status, 200);
    await sa.post('/v1/platform/ai-settings/test', { kind: 'llm' });
    assert.deepEqual([calls.at(-1)!.model, calls.at(-1)!.auth], ['llama-3.1-8b-instant', 'Bearer gsk-segredo-123']);
    assert.equal((await sa.put('/v1/platform/ai-settings', { kind: 'llm', provider: 'openai' })).status, 400);

    // erro do provedor aparece sem vazar a chave
    globalThis.fetch = (async () => new Response('Invalid key gsk-segredo-123 rejected', { status: 401 })) as unknown as typeof fetch;
    const bad = await sa.post('/v1/platform/ai-settings/test', { kind: 'llm' });
    assert.equal(bad.body.ok, false); assert.match(bad.body.error, /401/); assert.equal(bad.body.error.includes('gsk-segredo-123'), false);

    // remover volta ao ambiente (vazio)
    await stepUp(env, sa, 'ia@pediu.test');
    assert.equal((await sa.del('/v1/platform/ai-settings/llm')).status, 200);
    assert.equal((await sa.get('/v1/platform/ai-settings')).body.llm, null);
    assert.equal((await client(env).get('/v1/platform/ai-settings')).status, 401);
  } finally { globalThis.fetch = realFetch; }
});

test('o painel tem prioridade sobre o ambiente e a transcrição (Groq) também vem da tela', async () => {
  const sa = client(env); await fullLogin(env, sa, 'ia@pediu.test');
  const rt = createAiRuntime(env.ctx, { OPENAI_API_KEY: 'env-key' });
  env.ctx.ai = rt;
  assert.equal((await rt.describe()).llm!.source, 'ambiente');
  assert.equal((await rt.describe()).llm!.provider, 'openai');
  await stepUp(env, sa, 'ia@pediu.test');
  assert.equal((await sa.put('/v1/platform/ai-settings', { kind: 'llm', provider: 'gemini', apiKey: 'g-key' })).status, 200);
  assert.deepEqual([(await rt.describe()).llm!.provider, (await rt.describe()).llm!.source], ['gemini', 'painel']);
  await stepUp(env, sa, 'ia@pediu.test');
  assert.equal((await sa.put('/v1/platform/ai-settings', { kind: 'stt', provider: 'groq', apiKey: 'gk' })).status, 200);
  const d = await rt.describe();
  assert.deepEqual([d.stt!.provider, d.stt!.model, d.stt!.baseUrl], ['groq', 'whisper-large-v3-turbo', 'https://api.groq.com/openai/v1/audio/transcriptions']);
  assert.ok(await rt.stt());
});
