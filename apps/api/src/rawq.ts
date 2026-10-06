import type { Q } from '@pediu/db';

/**
 * Consulta com colunas montadas dinamicamente. Os NOMES de tabela/coluna vêm sempre de mapas fixos no código,
 * nunca da entrada do usuário; os VALORES vão como parâmetros (`?`).
 */
export function rawq(q: Q, sql: string, values: unknown[] = []) {
  const parts = sql.split('?');
  if (parts.length !== values.length + 1) throw new Error('rawq(): número de ? diferente do número de valores');
  return q(Object.assign([...parts], { raw: [...parts] }) as unknown as TemplateStringsArray, ...values);
}
