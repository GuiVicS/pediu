// Utilitários do atendimento por WhatsApp: variáveis das respostas rápidas e telefone.

export const REPLY_VARS = ['loja', 'horario', 'status', 'pedido_minimo', 'taxas_entrega', 'pagamentos', 'link_loja', 'cliente'] as const;
export type ReplyVar = (typeof REPLY_VARS)[number];

/** Troca {{variavel}} pelo valor; variável desconhecida ou sem valor some, nunca vaza o marcador. */
export function renderTemplate(body: string, vars: Partial<Record<string, string>>): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, k: string) => vars[k.toLowerCase()] ?? '').replace(/[ \t]+\n/g, '\n').trim();
}

/** Só dígitos; assume Brasil (55) quando vier com 10 ou 11 dígitos. Vazio se não parecer telefone. */
export function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if (d.length >= 12 && d.length <= 15) return d;
  return '';
}

/** Compara dois telefones pelos últimos 8 dígitos (tolera 9º dígito e DDI). */
export const samePhone = (a: string, b: string) => {
  const x = a.replace(/\D/g, ''), y = b.replace(/\D/g, '');
  return x.length >= 8 && y.length >= 8 && x.slice(-8) === y.slice(-8);
};
