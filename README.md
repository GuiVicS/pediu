# Pediu — plataforma real (multi-loja)

Base de produção do Pediu Lanchou. A demo continua separada em `../pediu-mvp`.

**Comece pelo assistente passo a passo:** abra `docs/index.html` no navegador (arquivo único, funciona offline).

## O que há aqui

| Pasta | Conteúdo |
|---|---|
| `packages/shared` | perfis e permissões, regra de status das lojas, TOTP (RFC 6238), senha, cofre AES-256-GCM, schemas de personalização |
| `packages/db` | migrations do Supabase (RLS + roles `app_api`, `platform_api`, `mcp_agent`), teste SQL de isolamento, pools |
| `apps/api` | API: super admin (autenticador, step-up, lojas, publicação, tokens do MCP, Stripe, **desempenho, alertas e logs**) e **login da equipe + pedidos** (loja online, PDV, mesas, entregador) |
| `apps/mcp` | servidor MCP: cria e personaliza lojas em desenvolvimento; só leitura em produção |
| `apps/web` | loja online, painel do lojista, PDV, garçom e entregador (React/Vite) |
| `apps/platform` | tela do super admin (servida pela API) |
| `apps/web-edge` | serve cada domínio com a versão do app fixada para a loja |
| `apps/print-agent` | agente de impressão (Windows/Linux/Mac) |
| `packages/escpos` | gerador de cupom ESC/POS e prévia em texto |
| `deploy/` | Caddyfile (HTTPS automático) e compose de exemplo |
| `docs/index.html` | assistente de instalação e operação (30 passos) · `docs/TESTES.md` lista de testes a rodar |

## Rodar os testes (não precisam de banco nem de internet)

```bash
npm install --include=dev
npm run check   # tipos + sintaxe SQL
npm test        # shared (24), api (53), mcp (14) e 2 testes de isolamento SQL (Postgres em memória)
```

## Regras que não podem ser quebradas

- O MCP **nunca** muda o status de uma loja nem escreve em loja fora de `desenvolvimento` (serviço + RLS).
- O MCP usa **somente** `MCP_DATABASE_URL` (role `mcp_agent`).
- Ações sensíveis do super admin exigem o código do autenticador reconfirmado (step-up).
- Segredos (autenticador, chaves do Stripe) ficam cifrados; `SECRETS_KEYS` precisa de backup fora do computador.
- O preço do pedido é sempre calculado no servidor; o público só enxerga lojas em `producao`.
- Métricas e logs nunca derrubam uma requisição; campos sensíveis são mascarados antes de gravar.

Estado e roadmap: último passo do assistente.
