/**
 * Ciclo de vida da loja. Só `desenvolvimento` aceita escrita do MCP; em `producao` o MCP só lê.
 * A regra vale em três camadas: lista de ferramentas, serviço e política RLS do banco (ver migrations).
 */
export const STORE_STATUS = ['desenvolvimento', 'producao', 'suspensa', 'arquivada'] as const;
export type StoreStatus = (typeof STORE_STATUS)[number];

export const mcpCanWrite = (s: StoreStatus) => s === 'desenvolvimento';
export const mcpCanRead = (s: StoreStatus) => s !== 'arquivada';

export type Actor =
  | { kind: 'mcp' }
  | { kind: 'billing' }
  | { kind: 'superadmin'; stepUp: boolean };

export interface TransitionContext {
  actor: Actor;
  hasActiveSubscription?: boolean;
  /** Cortesia/parceiro: libera produção sem assinatura, com motivo registrado. */
  waiverReason?: string;
  /** Obrigatório para voltar de produção para desenvolvimento. */
  reason?: string;
}

export type TransitionResult = { ok: true } | { ok: false; error: string };

export function checkTransition(from: StoreStatus, to: StoreStatus, ctx: TransitionContext): TransitionResult {
  if (from === to) return { ok: false, error: 'A loja já está neste status.' };
  const { actor } = ctx;
  if (actor.kind === 'mcp') return { ok: false, error: 'O MCP não muda o status da loja. Use solicitar_publicacao e aguarde a aprovação no super admin.' };

  if (actor.kind === 'billing') {
    if ((from === 'producao' && to === 'suspensa') || (from === 'suspensa' && to === 'producao')) return { ok: true };
    return { ok: false, error: 'A cobrança só alterna entre produção e suspensa.' };
  }

  if (!actor.stepUp) return { ok: false, error: 'Confirme com o código do autenticador para mudar o status.' };
  if (from === 'arquivada') return { ok: false, error: 'Loja arquivada não muda de status.' };
  if (to === 'producao') {
    if (from === 'desenvolvimento' && !ctx.hasActiveSubscription && !ctx.waiverReason?.trim()) {
      return { ok: false, error: 'Publicar exige assinatura ativa ou em trial, ou um motivo de cortesia.' };
    }
    return { ok: true };
  }
  if (to === 'desenvolvimento' && from === 'producao' && !ctx.reason?.trim()) {
    return { ok: false, error: 'Voltar uma loja no ar para desenvolvimento exige justificativa.' };
  }
  return { ok: true };
}
