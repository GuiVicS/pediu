# Hospedar o Pediu no Portainer — passo a passo

> Continuidade em 2026-10-07: consulte também [`../HANDOFF.md`](../HANDOFF.md). O guia abaixo foi recuperado do ambiente local e descreve a configuração anterior. Agora existem **dez migrations** (veja a lista na seção 3). O login de clientes por e-mail exige `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` e `MAIL_FROM`; o compose Portainer atual já repassa essas variáveis e as do agente de IA (`ANTHROPIC_API_KEY`, `TRANSCRIBE_*`). Sem SMTP, a solicitação de código retorna 503. As instruções de infraestrutura deste guia não foram revalidadas nesta passagem.

Guia para colocar a plataforma Pediu (`https://github.com/GuiVicS/pediu`) no ar em uma VPS, gerenciada pelo Portainer.
Baseado no que foi validado localmente (stack `pediu-local`) e no compose/Caddyfile do repositório (`deploy/`).

> O repositório precisa estar na `main` com os dois ajustes já enviados: `db465a4` (Dockerfile copia `tsconfig.base.json`) e `88e0072` (JSON não é serializado duas vezes). Sem eles o build da UI falha e configurações/tema da loja ficam corrompidos.

---

## 0. Visão geral

```
Internet ──► Caddy (80/443, HTTPS automático)
              ├─ https://api.SEUDOMINIO     ─► api  :3000  (API + super admin)
              ├─ https://mcp.SEUDOMINIO     ─► mcp  :3100  (MCP para criar lojas)
              └─ https://<qualquer loja>    ─► edge :3200  (vitrine por domínio) ─► api
Banco: Supabase (Postgres externo) — as 3 conexões vêm de variáveis de ambiente
```

Serviços da Stack: `api`, `edge`, `mcp`, `caddy`. **O banco não está na Stack** (é o Supabase).
Para teste sem Supabase, use a variante com Postgres no final (seção 9).

## 1. Pré-requisitos

| Item | Detalhe |
|---|---|
| VPS | Linux, 2 vCPU / 4 GB RAM (mínimo confortável para o build), portas **80, 443** livres e **9443** (Portainer) |
| Docker + Compose v2 | Compose ≥ 2.23 (usamos `configs` com conteúdo inline) |
| Portainer CE | versão atual (LTS) já rodando na VPS |
| Domínio | ex.: `pediulanchou.com.br`, com acesso ao DNS |
| Supabase | um **projeto novo e dedicado ao Pediu** (não reutilizar projeto de outro sistema) |
| E-mail | para o Let's Encrypt (`ACME_EMAIL`) |

### Instalar o Portainer (se ainda não tiver)

```bash
docker volume create portainer_data
docker run -d --name portainer --restart=always \
  -p 9443:9443 -p 8000:8000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  portainer/portainer-ce:lts
```

Abra `https://IP_DA_VPS:9443` e crie o admin **em até 5 minutos**. As versões novas exibem um **setup token** nos logs (`docker logs portainer`); cole-o na tela de criação do admin. Se o prazo vencer: `docker restart portainer`.

## 2. DNS

Crie estes registros apontando para o IP da VPS:

| Tipo | Nome | Para quê |
|---|---|---|
| A | `api.SEUDOMINIO` | API e super admin |
| A | `mcp.SEUDOMINIO` | MCP |
| A | `*.SEUDOMINIO` (wildcard) | lojas em subdomínio (`slug.SEUDOMINIO`) |

Domínios próprios de cada loja (ex.: `www.minhaloja.com.br`) apontam com A/CNAME para a mesma VPS; o Caddy emite o certificado sob demanda **só** depois que a API confirmar que o domínio foi verificado (`/v1/edge/tls-check`).

## 3. Banco (Supabase)

1. Crie o projeto novo no Supabase. Anote o **project ref**.
2. Aplique **todas as migrations** da pasta, **em ordem** (hoje são 10; a lista completa e comentada está em [`GUIA-DIDATICO.md`](GUIA-DIDATICO.md), Parte 7.3). Use o SQL Editor do Supabase (ou `supabase db push` com a CLI). As cinco primeiras:
   ```
   packages/db/supabase/migrations/20261007000001_core.sql
   packages/db/supabase/migrations/20261007000002_catalog.sql
   packages/db/supabase/migrations/20261008000001_orders_staff.sql
   packages/db/supabase/migrations/20261008000002_observability.sql
   packages/db/supabase/migrations/20261009000001_ops_print_pay_ifood.sql
   # depois, em ordem:
   packages/db/supabase/migrations/20261010000001_customers.sql
   packages/db/supabase/migrations/20261011000001_store_features.sql
   packages/db/supabase/migrations/20261011000002_extension_pairing.sql
   packages/db/supabase/migrations/20261011000003_extension_features.sql
   packages/db/supabase/migrations/20261012000001_coupons.sql
   ```
   Elas criam os roles `app_api`, `platform_api` e `mcp_agent` **sem senha**.
3. Defina uma senha forte para cada role (SQL Editor):
   ```sql
   alter role app_api      password 'SENHA_FORTE_1';
   alter role platform_api password 'SENHA_FORTE_2';
   alter role mcp_agent    password 'SENHA_FORTE_3';
   ```
4. Monte as 3 URLs com o **pooler em modo transação (porta 6543)**. O usuário é `role.PROJECT_REF`:
   ```
   APP_DATABASE_URL=postgresql://app_api.PROJECT_REF:SENHA_FORTE_1@aws-0-REGIAO.pooler.supabase.com:6543/postgres
   PLATFORM_DATABASE_URL=postgresql://platform_api.PROJECT_REF:SENHA_FORTE_2@aws-0-REGIAO.pooler.supabase.com:6543/postgres
   MCP_DATABASE_URL=postgresql://mcp_agent.PROJECT_REF:SENHA_FORTE_3@aws-0-REGIAO.pooler.supabase.com:6543/postgres
   ```
   O host exato aparece em *Project Settings → Database → Connection pooling*. Se a senha tiver caracteres especiais, faça URL-encode.

> O MCP recebe **apenas** a `MCP_DATABASE_URL`. Nunca dê a ele as outras conexões.

## 4. Segredos

Gere na VPS (ou na sua máquina):

```bash
# cofre de credenciais (AES-256-GCM): formato id:base64(32 bytes)
node -e "console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))"
# segredo compartilhado API <-> edge
openssl rand -hex 32
```

Guarde `SECRETS_KEYS` com cuidado: **perder essa chave = perder as credenciais cifradas** (gateways de pagamento etc.). Para rotacionar, acrescente chaves (`k2:...`); a primeira cifra, as demais só decifram.

## 5. Arquivo da Stack

O `deploy/docker-compose.example.yml` do repositório usa `env_file: ../.env` e um `Caddyfile` em arquivo local, o que não combina com uma Stack do Portainer. Use este arquivo (sugestão: commitar no repo como `deploy/docker-compose.portainer.yml`):

```yaml
name: pediu
services:
  api:
    build: { context: ., target: api }
    image: pediu-api:latest
    environment:
      PORT: "3000"
      APP_DATABASE_URL: ${APP_DATABASE_URL}
      PLATFORM_DATABASE_URL: ${PLATFORM_DATABASE_URL}
      MCP_DATABASE_URL: ${MCP_DATABASE_URL}
      SECRETS_KEYS: ${SECRETS_KEYS}
      EDGE_SECRET: ${EDGE_SECRET}
      BASE_DOMAIN: ${BASE_DOMAIN}
      PUBLIC_API_URL: https://${API_HOST}
      COOKIE_SECURE: "true"
      TRUST_PROXY: "true"
      ALERT_WEBHOOK_URL: ${ALERT_WEBHOOK_URL:-}
      SUPABASE_URL: ${SUPABASE_URL:-}
      SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY:-}
      SUPABASE_BUCKET: ${SUPABASE_BUCKET:-pediu-public}
    volumes: ["uploads:/data/uploads"]   # usado só se NÃO houver Supabase Storage
    restart: unless-stopped

  edge:
    build: { context: ., target: edge }
    image: pediu-edge:latest
    environment:
      PORT: "3200"
      API_URL: http://api:3000
      EDGE_SECRET: ${EDGE_SECRET}
      RELEASES_BASE_URL: ${RELEASES_BASE_URL:-}
    depends_on: [api]
    restart: unless-stopped

  mcp:
    build: { context: ., target: mcp }
    image: pediu-mcp:latest
    environment:
      PORT: "3100"
      MCP_DATABASE_URL: ${MCP_DATABASE_URL}
      BASE_DOMAIN: ${BASE_DOMAIN}
    restart: unless-stopped

  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    environment:
      ACME_EMAIL: ${ACME_EMAIL}
      API_HOST: ${API_HOST}
      MCP_HOST: ${MCP_HOST}
    configs:
      - source: caddyfile
        target: /etc/caddy/Caddyfile
    volumes: ["caddy_data:/data"]
    depends_on: [api, edge, mcp]
    restart: unless-stopped

configs:
  caddyfile:
    content: |
      {
        email {$ACME_EMAIL}
        on_demand_tls {
          ask http://api:3000/v1/edge/tls-check
        }
      }
      https:// {
        tls { on_demand }
        encode zstd gzip
        reverse_proxy edge:3200 {
          flush_interval -1
          header_up X-Forwarded-Host {host}
        }
      }
      {$API_HOST} {
        encode zstd gzip
        reverse_proxy api:3000 { flush_interval -1 }
      }
      {$MCP_HOST} {
        reverse_proxy mcp:3100
      }

volumes: { uploads: {}, caddy_data: {} }
```

Notas:
- `build: { context: . }` pressupõe que a Stack usa o **repositório Git** como fonte (passo 6, opção A), pois o `Dockerfile` está na raiz.
- Se a sua versão do Compose for < 2.23 (sem `configs.content`), mantenha o `Caddyfile` no repositório e monte-o por volume com caminho absoluto no host, ou use o seu proxy atual (Traefik/Nginx Proxy Manager) apontando para `api:3000`, `edge:3200` e `mcp:3100`.
- Se já existir outro proxy ocupando 80/443 na VPS, remova o serviço `caddy` e publique o proxy existente na rede da Stack.

## 6. Criar a Stack no Portainer

1. Portainer → ambiente **local** → **Stacks → Add stack**.
2. Nome: `pediu`.
3. **Build method**, uma das opções:
   - **A) Repository (recomendada):** URL `https://github.com/GuiVicS/pediu`, referência `refs/heads/main`, *Compose path* `deploy/docker-compose.portainer.yml` (depois de commitar o arquivo da seção 5). Repositório privado → marque *Authentication* e use um token do GitHub com leitura. Ative **Re-pull image and redeploy** / *GitOps updates* se quiser atualizar por webhook.
   - **B) Web editor:** cole o compose da seção 5. Como não há contexto de build, **antes** construa as imagens na VPS (`git clone` + `docker build --target api -t pediu-api:latest .`, idem `edge` e `mcp`) e troque os `build:` por `image:` já existentes.
4. Em **Environment variables**, adicione (modo *Advanced* aceita colar `.env`):

   | Variável | Valor |
   |---|---|
   | `APP_DATABASE_URL` / `PLATFORM_DATABASE_URL` / `MCP_DATABASE_URL` | as 3 URLs da seção 3 |
   | `SECRETS_KEYS` | `k1:...` (seção 4) |
   | `EDGE_SECRET` | hex de 64 caracteres (seção 4) |
   | `BASE_DOMAIN` | `pediulanchou.com.br` |
   | `API_HOST` | `api.pediulanchou.com.br` |
   | `MCP_HOST` | `mcp.pediulanchou.com.br` |
   | `ACME_EMAIL` | seu e-mail |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` | opcionais: uploads de imagem no Supabase Storage (sem eles, vão para o volume `uploads`) |
   | `RELEASES_BASE_URL` | opcional: onde o edge baixa versões publicadas por loja |
   | `ALERT_WEBHOOK_URL` | opcional: Slack/Discord/n8n para alertas |

5. **Deploy the stack.** O primeiro build leva alguns minutos (compila as telas web e do super admin).

## 7. Verificar

No Portainer → **Containers**: `pediu-api-1`, `pediu-edge-1`, `pediu-mcp-1` devem ficar `healthy` (healthcheck em `/health`), e `pediu-caddy-1` `running`.

```bash
curl https://api.SEUDOMINIO/health      # {"ok":true}
curl https://mcp.SEUDOMINIO/health      # ok
```

Em caso de erro, abra o container → **Logs**. Causas comuns: senha/URL do banco errada, role sem senha, DNS ainda não propagado (Caddy não emite certificado), porta 80/443 ocupada.

## 8. Primeiro acesso

**8.1 Criar o super admin** (não existe cadastro público). Portainer → container `pediu-api-1` → **Console** (`sh`), ou na VPS:

```bash
docker exec -w /app -e ADMIN_PASSWORD='uma-senha-longa-12+' pediu-api-1 \
  npx tsx apps/api/scripts/create-admin.ts voce@empresa.com "Seu Nome"
```
Rodar de novo com o mesmo e-mail redefine a senha.

**8.2 Entrar:** `https://api.SEUDOMINIO` → e-mail e senha. No primeiro login a tela pede para **cadastrar o app autenticador** (QR Code) e mostra **10 códigos de recuperação uma única vez**: guarde fora do computador. Ações sensíveis pedem o código de novo (step-up).

**8.3 Criar uma loja** (super admin, ou pelo MCP — seção 10). A loja nasce em `desenvolvimento` com o subdomínio `slug.BASE_DOMAIN`.

**8.4 Administrador da loja:** crie o primeiro usuário (exige step-up):
```
POST /v1/platform/stores/ID_DA_LOJA/admin-user
{"name":"Dona da Loja","email":"dona@loja.com","password":"senha-inicial-segura"}
```
Ele entra em `https://slug.SEUDOMINIO/entrar` e usa `/painel`, `/pdv`, `/garcom`, `/entregador`.

**8.5 Publicar:** lojas em `desenvolvimento` não aparecem na vitrine pública. O MCP só *solicita* a publicação; um super admin aprova (com autenticador). Publicar exige assinatura ativa/trial ou justificativa de cortesia.

## 9. Variante de teste: Postgres dentro da Stack (sem Supabase)

Útil para homologação. Acrescente à Stack um serviço `db` (Postgres 16) e um script de init que aplica as migrations e define as senhas — exatamente o que foi usado no ambiente local:

```yaml
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: pediu
      APP_ROLE_PASSWORD: ${APP_ROLE_PASSWORD}
      PLATFORM_ROLE_PASSWORD: ${PLATFORM_ROLE_PASSWORD}
      MCP_ROLE_PASSWORD: ${MCP_ROLE_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
      - /opt/pediu/initdb:/docker-entrypoint-initdb.d:ro            # 00-roles-and-passwords.sh
      - /opt/pediu/migrations:/migrations:ro                         # cópia de packages/db/supabase/migrations
    healthcheck: { test: ["CMD-SHELL","pg_isready -U postgres -d pediu"], interval: 5s, timeout: 3s, retries: 20 }
    restart: unless-stopped
```

`00-roles-and-passwords.sh` (precisa criar `anon` e `authenticated`, que no Supabase já existem):

```sh
#!/bin/sh
set -e
psql -v ON_ERROR_STOP=1 -U postgres -d pediu -c "create role anon nologin; create role authenticated nologin;"
for f in /migrations/*.sql; do psql -v ON_ERROR_STOP=1 -U postgres -d pediu -f "$f"; done
psql -v ON_ERROR_STOP=1 -U postgres -d pediu <<SQL
alter role app_api      password '$APP_ROLE_PASSWORD';
alter role platform_api password '$PLATFORM_ROLE_PASSWORD';
alter role mcp_agent    password '$MCP_ROLE_PASSWORD';
SQL
```

URLs apontam para `db:5432` (ex.: `postgresql://app_api:SENHA@db:5432/pediu`). O init só roda **na primeira criação do volume**. Adicione `pgdata: {}` em `volumes` e `depends_on: { db: { condition: service_healthy } }` em `api` e `mcp`. Faça backup do volume `pgdata`.

## 10. Conectar o Claude Code (MCP) à plataforma

1. No super admin, faça o step-up e crie o token: `POST /v1/platform/mcp-tokens` com `{"name":"Claude Code","expiresInDays":90}`. O token (`pmcp_...`) aparece **uma vez**.
2. Conecte:
   ```bash
   claude mcp add --transport http pediu https://mcp.SEUDOMINIO/mcp \
     --header "Authorization: Bearer pmcp_SEU_TOKEN"
   ```
3. Limites: 120 req/min por token; só escreve em lojas em `desenvolvimento`; imagens entram **por URL** (o MCP não recebe arquivo).

Para o Portainer em si (gerenciar a Stack pelo Claude Code): crie um **Access token** em *My account → Access tokens* e use-o com o MCP/API do Portainer.

## 11. Operação

| Tarefa | Como |
|---|---|
| Atualizar versão | Stack → **Pull and redeploy** (opção A) ou novo build + **Update the stack** |
| Logs | Containers → serviço → **Logs** |
| Reiniciar | Containers → **Restart** |
| Backup | Banco: do Supabase (ou volume `pgdata`); volumes `uploads` e `caddy_data`; **guardar `SECRETS_KEYS` fora da VPS** |
| Parar sem perder dados | Stack → **Stop** (não use *remove with volumes*) |

## 12. Problemas conhecidos / lembretes

- Vitrine mostra **"Loja não encontrada"** para loja em `desenvolvimento` — é a regra atual (só `producao` é pública). Está nas pendências do `HANDOFF.md` (modo de pré-visualização).
- Cookies exigem HTTPS (`COOKIE_SECURE=true`); em teste local sem HTTPS use `false`.
- `TRUST_PROXY=true` só atrás de proxy confiável (Caddy/Traefik/Cloudflare).
- Webhooks de pagamento/iFood precisam de `PUBLIC_API_URL` público com HTTPS; sem isso o pagamento só é conciliado a cada 30 s.
- Nunca versionar `.env`, senhas dos roles, `SECRETS_KEYS` nem o token do MCP.
