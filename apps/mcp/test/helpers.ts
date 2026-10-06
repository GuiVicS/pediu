import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createTestPools } from '@pediu/db/testing';
import { createMcpServer } from '../src/tools.js';
import type { Token } from '../src/core.js';

export async function setup() {
  const pools = await createTestPools();
  // espelha o ambiente real: o MCP só recebe o pool do role mcp_agent
  const db = { mcp: pools.mcp };
  const plat = <T,>(fn: (q: Parameters<Parameters<typeof pools.platform.begin>[0]>[0]) => Promise<T>) => pools.platform.begin(fn);

  const [t] = await plat((q) => q`insert into tenants (name) values ('Conta Base') returning id`);
  const tenantId = t!.id as string;

  async function connect(token: Token) {
    const server = createMcpServer(db, token, { baseDomain: 'pediu.test' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'teste', version: '1.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r: any = await client.callTool({ name, arguments: args });
      const text = r.content?.[0]?.text as string;
      let data: any = text; try { data = JSON.parse(text); } catch { /* texto de erro */ }
      return { isError: !!r.isError, data, text };
    };
    return { client, call, close: async () => { await client.close(); await server.close(); } };
  }
  const anyToken: Token = { id: '11111111-1111-1111-1111-111111111111', storeLimit: null };
  return { pools, db, plat, tenantId, connect, anyToken, close: () => pools.close() };
}
export type Env = Awaited<ReturnType<typeof setup>>;
