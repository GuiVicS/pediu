// Catálogo de funcionalidades liberáveis por loja (checklist do super admin).
// Fonte única de verdade para estas funcionalidades: a tabela store_features;
// os `modules` dos planos não as controlam, para não haver duas fontes contraditórias.

export interface FeatureDef {
  key: string;
  label: string;
  description: string;
  /** false enquanto a funcionalidade não está implementada: aparece, mas não pode ser ativada. */
  available: boolean;
  /** só pode ficar ativa se estas também estiverem ativas */
  requires: readonly string[];
}

export const FEATURES = [
  { key: 'whatsapp_support', label: 'Atendimento WhatsApp', description: 'Conecta a extensão ao WhatsApp Web do lojista.', available: true, requires: [] },
  { key: 'quick_replies', label: 'Respostas rápidas', description: 'Modelos de resposta para horário, cardápio, entrega, pagamento e andamento do pedido.', available: true, requires: ['whatsapp_support'] },
  { key: 'ai_agent', label: 'Agente de IA', description: 'Sugere respostas usando cardápio e pedidos reais da loja.', available: true, requires: ['whatsapp_support'] },
  { key: 'auto_reply', label: 'Respostas automáticas', description: 'O agente envia a resposta sem revisão do operador.', available: true, requires: ['ai_agent'] },
  { key: 'audio_transcription', label: 'Transcrição de áudio', description: 'Transcreve áudios dos clientes para o agente.', available: true, requires: ['ai_agent'] },
  { key: 'image_analysis', label: 'Análise de imagens', description: 'Interpreta fotos, prints e comprovantes enviados pelo cliente.', available: true, requires: ['ai_agent'] },
  { key: 'order_draft', label: 'Montagem de pedido', description: 'Monta rascunho e link de checkout a partir da conversa.', available: true, requires: ['ai_agent'] },
  { key: 'table_totem', label: 'Totem de mesa', description: 'Tablet na mesa para o cliente pedir sozinho: cardápio com fotos, envio para a comanda da mesa, chamar garçom e pedir a conta.', available: true, requires: [] },
  { key: 'broadcasts', label: 'Disparos', description: 'Envio de mensagens para clientes autorizados (fase posterior).', available: true, requires: ['whatsapp_support'] },
] as const satisfies readonly FeatureDef[];

export type FeatureKey = (typeof FEATURES)[number]['key'];
export const FEATURE_KEYS = FEATURES.map((f) => f.key) as [FeatureKey, ...FeatureKey[]];

/**
 * Aplica as mudanças pedidas ao estado atual e devolve o estado final.
 * Ativar exige função disponível e dependências ativas; desativar derruba quem depende dela.
 */
export function applyFeatureChanges(
  current: Record<string, boolean>,
  changes: Record<string, boolean>,
): { ok: true; state: Record<string, boolean> } | { ok: false; error: string } {
  const state: Record<string, boolean> = Object.fromEntries(FEATURES.map((f) => [f.key, current[f.key] === true]));
  for (const [key, on] of Object.entries(changes)) {
    const def = FEATURES.find((f) => f.key === key);
    if (!def) return { ok: false, error: `Funcionalidade desconhecida: ${key}.` };
    if (on && !def.available) return { ok: false, error: `“${def.label}” ainda não está disponível.` };
    state[key] = on;
  }
  for (let moved = true; moved; ) {
    moved = false;
    for (const f of FEATURES) {
      if (state[f.key] && f.requires.some((r) => !state[r])) {
        if (changes[f.key] === true) {
          const miss = f.requires.find((r) => !state[r])!;
          return { ok: false, error: `“${f.label}” exige “${FEATURES.find((x) => x.key === miss)!.label}” ativa.` };
        }
        state[f.key] = false; moved = true;
      }
    }
  }
  return { ok: true, state };
}
