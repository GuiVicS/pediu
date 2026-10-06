/** Erro com mensagem segura para devolver ao agente. Qualquer outro erro vira texto genérico. */
export class McpError extends Error {}
export const notFound = (what: string) => new McpError(`${what} não encontrado(a).`);
