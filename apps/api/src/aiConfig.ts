import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withPlatform } from '@pediu/db';
import { decryptSecret, encryptSecret } from '@pediu/shared';
import type { Ctx } from './context.js';
import { audit, fail, parse } from './http.js';
import {
  createLlm, createTranscriber, LLM_PRESETS, llmConfigFromEnv, llmPreset, STT_PRESETS, sttConfigFromEnv, sttPreset,
  type Llm, type LlmConfig, type SttConfig, type Transcriber,
} from './llm.js';
import { guard } from './session.js';

/**
 * Configuração da IA do atendimento (agente e transcrição). Prioridade: o que o super admin salvou na tela (cifrado no banco) e,
 * se não houver, as variáveis de ambiente do servidor. Os testes injetam ctx.llm / ctx.transcriber e ignoram tudo isso.
 */
export interface AiRuntime {
  llm(): Promise<Llm | undefined>;
  stt(): Promise<Transcriber | undefined>;
  /** Descreve a configuração em uso (sem a chave). */
  describe(): Promise<{ llm: Active | null; stt: Active | null; savedLlm: Saved | null; savedStt: Saved | null }>;
  /** Chaves em uso, só para esconder em mensagens de erro. */
  secrets(): Promise<string[]>;
  invalidate(): void;
}
interface Active { provider: string; model: string; baseUrl: string; source: 'painel' | 'ambiente' }
interface Saved { provider: string; model: string; baseUrl: string; hasKey: boolean }
type Kind = 'llm' | 'stt';
interface Stored { provider: string; apiKey?: string; model?: string; baseUrl?: string }

const KEY = (k: Kind) => `ai.${k}`;
const TTL_MS = 30_000;

export const getLlm = async (ctx: Ctx) => ctx.llm ?? (await ctx.ai?.llm());
export const getTranscriber = async (ctx: Ctx) => ctx.transcriber ?? (await ctx.ai?.stt());

export function createAiRuntime(ctx: Ctx, env: Record<string, string | undefined>): AiRuntime {
  let cache: { at: number; llm: Stored | null; stt: Stored | null } | null = null;
  const load = async () => {
    if (cache && Date.now() - cache.at < TTL_MS) return cache;
    const rows = await withPlatform(ctx.pools, (q) => q`select key, value_enc from platform_settings where key in ('ai.llm', 'ai.stt')`);
    const read = (k: Kind): Stored | null => { const r = rows.find((x) => x.key === KEY(k)); try { return r ? JSON.parse(decryptSecret(r.value_enc, ctx.ring)) as Stored : null; } catch { return null; } };
    cache = { at: Date.now(), llm: read('llm'), stt: read('stt') };
    return cache;
  };

  const llmCfg = async (): Promise<{ cfg: LlmConfig; source: 'painel' | 'ambiente' } | null> => {
    const s = (await load()).llm;
    if (s) {
      const p = llmPreset(s.provider);
      if (p) {
        const apiKey = s.apiKey ?? (p.keyEnv ? env[p.keyEnv] : undefined);
        const baseUrl = s.baseUrl || p.baseUrl, model = s.model || p.defaultModel;
        if ((!p.needsKey || apiKey) && baseUrl && model) return { cfg: { provider: p.id, baseUrl, apiKey, model }, source: 'painel' };
      }
    }
    const e = llmConfigFromEnv(env);
    return e ? { cfg: e, source: 'ambiente' } : null;
  };
  const sttCfg = async (): Promise<{ cfg: SttConfig; source: 'painel' | 'ambiente' } | null> => {
    const s = (await load()).stt;
    if (s) {
      const p = sttPreset(s.provider);
      if (p) {
        const apiKey = s.apiKey ?? (p.id !== 'custom' ? env[p.keyEnv] : undefined);
        const url = s.baseUrl || (p.id === 'internal' ? env.INTERNAL_WHISPER_URL : undefined) || p.url, model = s.model || p.defaultModel;
        if ((!p.needsKey || apiKey) && url && model) return { cfg: { provider: p.id, url, apiKey, model }, source: 'painel' };
      }
    }
    const e = sttConfigFromEnv(env);
    return e ? { cfg: e, source: 'ambiente' } : null;
  };

  return {
    llm: async () => { const c = await llmCfg(); return c ? createLlm(c.cfg) : undefined; },
    stt: async () => { const c = await sttCfg(); return c ? createTranscriber(c.cfg) : undefined; },
    invalidate: () => { cache = null; },
    secrets: async () => [(await llmCfg())?.cfg.apiKey, (await sttCfg())?.cfg.apiKey].filter((k): k is string => !!k),
    describe: async () => {
      const [l, s, c] = [await llmCfg(), await sttCfg(), await load()];
      const saved = (st: Stored | null, def: (id: string) => { baseUrl?: string; url?: string; defaultModel: string } | undefined): Saved | null => {
        const p = st ? def(st.provider) : undefined;
        return st && p ? { provider: st.provider, model: st.model || p.defaultModel, baseUrl: st.baseUrl || p.baseUrl || p.url || '', hasKey: !!st.apiKey } : null;
      };
      return {
        llm: l ? { provider: l.cfg.provider, model: l.cfg.model, baseUrl: l.cfg.baseUrl, source: l.source } : null,
        stt: s ? { provider: s.cfg.provider, model: s.cfg.model, baseUrl: s.cfg.url, source: s.source } : null,
        savedLlm: saved(c.llm, llmPreset), savedStt: saved(c.stt, sttPreset),
      };
    },
  };
}

/** 1 segundo de silêncio (WAV 16 kHz mono) para testar a transcrição sem áudio real. */
const silentWav = () => {
  const n = 16000, h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n * 2, 40);
  return Buffer.concat([h, Buffer.alloc(n * 2)]);
};

const url = z.string().trim().max(300).refine((u) => /^https?:\/\/[^\s]+$/i.test(u), 'Informe um endereço http(s) válido.');

export function aiSettingsRoutes(app: FastifyInstance, ctx: Ctx) {
  const P = '/v1/platform/ai-settings';
  const strip = (msg: string, secrets: string[]) => { let m = msg; for (const s of secrets) if (s) m = m.split(s).join('••••'); return m; };

  app.get(P, { preHandler: guard(ctx) }, async () => {
    const d = ctx.ai ? await ctx.ai.describe() : { llm: null, stt: null, savedLlm: null, savedStt: null };
    return {
      ...d,
      presets: {
        llm: LLM_PRESETS.map((p) => ({ id: p.id, label: p.label, baseUrl: p.baseUrl, defaultModel: p.defaultModel, needsKey: p.needsKey, keysUrl: p.keysUrl, note: p.note, envKey: p.keyEnv })),
        stt: STT_PRESETS.map((p) => ({ id: p.id, label: p.label, baseUrl: p.url, defaultModel: p.defaultModel, needsKey: p.needsKey, keysUrl: '', note: p.note, envKey: p.keyEnv })),
      },
    };
  });

  // a chave é gravada cifrada (cofre da plataforma) e nunca volta nas respostas; trocar a chave exige o autenticador reconfirmado
  app.put(P, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const b = parse(z.object({ kind: z.enum(['llm', 'stt']), provider: z.string().max(30), apiKey: z.string().trim().max(500).optional(), model: z.string().trim().max(120).optional(), baseUrl: url.optional().or(z.literal('')) }), req.body, reply); if (!b) return;
    const preset = b.kind === 'llm' ? llmPreset(b.provider) : sttPreset(b.provider);
    if (!preset) return fail(reply, 400, 'bad_provider', 'Provedor desconhecido.');
    const customUrl = b.baseUrl || undefined;
    const needsUrl = b.provider === 'custom';
    if (needsUrl && !customUrl) return fail(reply, 400, 'url_required', 'Informe o endereço do servidor.');
    if (b.provider === 'custom' && b.kind === 'llm' && !b.model) return fail(reply, 400, 'model_required', 'Informe o nome do modelo.');
    const out = await withPlatform(ctx.pools, async (q) => {
      const [cur] = await q`select value_enc from platform_settings where key = ${KEY(b.kind)}`;
      let prev: Stored | null = null; try { prev = cur ? JSON.parse(decryptSecret(cur.value_enc, ctx.ring)) as Stored : null; } catch { prev = null; }
      // sem chave nova: mantém a anterior se for do mesmo provedor
      const apiKey = b.apiKey || (prev?.provider === b.provider ? prev.apiKey : undefined);
      const fromEnv = !!(preset.keyEnv && process.env[preset.keyEnv]);
      if (preset.needsKey && !apiKey && !fromEnv) return { error: 'Informe a chave de API.' as const };
      const value: Stored = { provider: b.provider, ...(apiKey ? { apiKey } : {}), ...(b.model ? { model: b.model } : {}), ...(customUrl ? { baseUrl: customUrl } : {}) };
      await q`insert into platform_settings (key, value_enc, updated_by) values (${KEY(b.kind)}, ${encryptSecret(JSON.stringify(value), ctx.ring)}, ${req.session!.adminId})
              on conflict (key) do update set value_enc = excluded.value_enc, updated_by = excluded.updated_by, updated_at = now()`;
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'platform.ai_settings_updated', ip: req.ip, meta: { kind: b.kind, provider: b.provider, model: b.model ?? null, keyChanged: !!b.apiKey } });
      return { ok: true as const };
    });
    if ('error' in out) return fail(reply, 400, 'key_required', out.error ?? 'Informe a chave de API.');
    ctx.ai?.invalidate();
    return { ok: true };
  });

  app.delete(`${P}/:kind`, { preHandler: guard(ctx, { stepUp: true }) }, async (req, reply) => {
    const b = parse(z.object({ kind: z.enum(['llm', 'stt']) }), req.params, reply); if (!b) return;
    await withPlatform(ctx.pools, async (q) => {
      await q`delete from platform_settings where key = ${KEY(b.kind)}`;
      await audit(q, { actorKind: 'superadmin', actorId: req.session!.adminId, action: 'platform.ai_settings_removed', ip: req.ip, meta: { kind: b.kind } });
    });
    ctx.ai?.invalidate();
    return { ok: true };
  });

  // teste de conexão: gasta alguns centavos de token; mostra o erro do provedor (sem a chave) para facilitar o diagnóstico
  app.post(`${P}/test`, { preHandler: guard(ctx), config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }, async (req, reply) => {
    const b = parse(z.object({ kind: z.enum(['llm', 'stt']) }), req.body, reply); if (!b) return;
    const t0 = Date.now();
    try {
      if (b.kind === 'llm') {
        const llm = await getLlm(ctx);
        if (!llm) return { ok: false, error: 'Nenhum provedor de IA configurado.' };
        const r = await llm.complete({ system: 'Responda apenas com a palavra OK.', messages: [{ role: 'user', content: [{ type: 'text', text: 'Teste de conexão.' }] }], tools: [] });
        const text = r.blocks.filter((x) => x.type === 'text').map((x) => (x as { text: string }).text).join(' ').trim().slice(0, 80);
        return { ok: true, ms: Date.now() - t0, reply: text };
      }
      const stt = await getTranscriber(ctx);
      if (!stt) return { ok: false, error: 'Nenhum provedor de transcrição configurado.' };
      await stt.transcribe({ mimetype: 'audio/wav', data: silentWav() });
      return { ok: true, ms: Date.now() - t0 };
    } catch (e) {
      const keys = ctx.ai ? await ctx.ai.secrets() : [];
      return { ok: false, error: strip(String((e as Error).message), keys).slice(0, 300) };
    }
  });
}
