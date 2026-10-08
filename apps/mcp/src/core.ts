import type { Pools, Q } from '@pediu/db';

/** O MCP só enxerga o pool do role mcp_agent. */
export type Db = Pick<Pools, 'mcp'>;
import { mcpCanRead, mcpCanWrite, type StoreStatus } from '@pediu/shared';
import { McpError, notFound } from './errors.js';

/** allowProduction: o super admin liberou este token para alterar lojas em produção. */
export interface Token { id: string; storeLimit: string[] | null; allowProduction?: boolean }
export interface StoreRef { id: string; tenant_id: string; slug: string; name: string; status: StoreStatus }

export const actorOf = (t: Token) => `mcp:${t.id}`;

/** Monta uma consulta com colunas dinâmicas. Os nomes de coluna vêm SEMPRE de mapas fixos no código, nunca da entrada do agente. */
export function raw(q: Q, sql: string, values: unknown[] = []) {
  const parts = sql.split('?');
  if (parts.length !== values.length + 1) throw new Error('raw(): número de ? diferente do número de valores');
  return q(Object.assign([...parts], { raw: [...parts] }) as unknown as TemplateStringsArray, ...values);
}

export function assertAccess(t: Token, storeId: string) {
  if (t.storeLimit && !t.storeLimit.includes(storeId)) throw new McpError('Este token não tem acesso a esta loja.');
}

/**
 * Executa `fn` numa transação com a loja travada (FOR UPDATE). Para escrita, confere o status DENTRO da transação:
 * assim uma publicação simultânea não deixa a escrita passar. Se ainda assim algo escapasse, a RLS do banco bloqueia.
 */
export function inStore<T>(pools: Db, t: Token, storeId: string, mode: 'read' | 'write', fn: (q: Q, s: StoreRef) => Promise<T>): Promise<T> {
  assertAccess(t, storeId);
  return pools.mcp.begin(async (q) => {
    const blocked = (s: StoreRef) => new McpError(s.status === 'producao'
      ? `A loja "${s.name}" está em produção e este token não tem permissão para alterar lojas no ar. Um administrador pode ligar "Pode alterar lojas em produção" no token (super admin → Tokens do MCP).`
      : `A loja "${s.name}" está ${s.status}: o MCP não altera lojas neste status.`);
    const [peek] = (await q`select id, tenant_id, slug, name, status from stores where id = ${storeId}`) as unknown as StoreRef[];
    if (!peek || !mcpCanRead(peek.status)) throw notFound('Loja');
    if (mode === 'read') return fn(q, peek);
    const prod = !!t.allowProduction;
    if (!mcpCanWrite(peek.status, prod)) throw blocked(peek);
    // libera a RLS de produção só nesta transação (a política confere este ajuste; ver migration mcp_producao_previa)
    if (prod) await q`select set_config('pediu.mcp_producao', 'on', true)`;
    // trava a linha e confere de novo: se o status mudou entre as duas leituras, a política RLS esconde a linha e caímos aqui
    const [s] = (await q`select id, tenant_id, slug, name, status from stores where id = ${storeId} for update`) as unknown as StoreRef[];
    if (!s) throw blocked({ ...peek, status: 'producao' });
    if (!mcpCanWrite(s.status, prod)) throw blocked(s);
    return fn(q, s);
  });
}

const j = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

/** Registra a revisão (permite desfazer) e a auditoria de toda alteração feita pelo MCP. */
export async function record(q: Q, t: Token, s: StoreRef, entity: string, entityId: string | null, op: 'create' | 'update' | 'delete', before: unknown, after: unknown) {
  await q`insert into store_config_revisions (store_id, actor, entity, entity_id, op, before, after)
          values (${s.id}, ${actorOf(t)}, ${entity}, ${entityId}, ${op}, ${j(before)}::jsonb, ${j(after)}::jsonb)`;
  await q`insert into audit_logs (actor_kind, actor_id, tenant_id, store_id, action, before, after, meta)
          values ('mcp', ${t.id}, ${s.tenant_id}, ${s.id}, ${`mcp.${entity}.${op}`}, ${j(before)}::jsonb, ${j(after)}::jsonb, ${j({ entityId })}::jsonb)`;
}
