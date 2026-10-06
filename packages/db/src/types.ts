/** Consulta com template tag: sql`select * from t where id = ${id}`. Devolve as linhas. */
export type Q = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, any>[]>;
/** Só existe `begin`: todo acesso é transacional, para o role e o tenant valerem sempre. */
export interface Pool { begin<T>(fn: (q: Q) => Promise<T>): Promise<T> }
export interface Pools { app: Pool; platform: Pool; mcp: Pool; close(): Promise<void> }
