# Atualização do servidor PediuLanchou — instruções para o Claude do servidor

> **Para quem é este arquivo:** você é o Claude que está dentro do servidor onde roda o PediuLanchou (Portainer + Docker). O dono do sistema vai te passar este documento. Sua missão: **atualizar o sistema com todas as mudanças da branch `fix/relatorio-testes-1`**, conferir que tudo subiu e relatar o resultado. Leia o documento inteiro antes de executar qualquer comando.
>
> Repositório: `https://github.com/GuiVicS/pediu` · Branch com as mudanças: `fix/relatorio-testes-1` (último commit conhecido: `d552876`).
> Idioma: responda ao dono sempre em **português do Brasil**, de forma simples (ele não é técnico em infraestrutura).

---

## 0. Regras de segurança (valem o tempo todo)

1. **Nunca** apague, recrie ou "limpe" volumes (`uploads`, `caddy_data`, `whisper_models`), bancos ou imagens que não sejam as do PediuLanchou. Proibido: `docker system prune`, `docker volume rm`, `DROP`, `TRUNCATE`, `DELETE` sem `WHERE`.
2. **Segredos:** nunca imprima no chat `SECRETS_KEYS`, `*_DATABASE_URL`, `EDGE_SECRET`, `SUPABASE_SERVICE_KEY`, chaves de API ou senhas. Se precisar confirmar que existem, mostre só o **nome** da variável e "definida / vazia".
3. **Faça backup antes** de qualquer mudança no banco (Passo 2) e **anote o estado atual** antes de trocar o código (Passo 1). Sem isso, não siga.
4. **Pare e avise o dono** (não improvise) se: um passo falhar; uma consulta de verificação trouxer algo inesperado; o build quebrar; ou for preciso mudar variável de ambiente sensível.
5. As migrations **não são idempotentes** (rodar duas vezes dá erro). Só aplique o que a verificação do Passo 3 mostrar que falta, **na ordem**, e cada arquivo **uma vez**.
6. Esta atualização é **aditiva** (só acrescenta tabelas/colunas/permissões). Por isso o **rollback do código é seguro sem reverter o banco** (Seção 12).
7. Não rode comandos em produção "para testar" que criem pedidos, cobrem pagamentos ou enviem e-mails a clientes reais.

---

## 1. Entenda o ambiente (confirme antes de agir)

O sistema roda como uma **stack do Portainer do tipo "Repository"**, usando o arquivo `deploy/docker-compose.portainer.yml` do repositório. Serviços:

| Serviço | Imagem | O que faz |
|---|---|---|
| `api` | `pediu-api` (target `api` do `Dockerfile`) | API + super admin embutido (`/app/platform-ui`). Porta 3000. Healthcheck `GET /health`. |
| `edge` | `pediu-edge` (target `edge`) | Serve a **loja de cada domínio**. Embute o app web como versão `builtin` e baixa versões publicadas. Porta 3200. |
| `mcp` | `pediu-mcp` (target `mcp`) | MCP **da plataforma** (criar/editar lojas; tokens do super admin). Porta 3100. *Não confundir com o novo "MCP da loja", que roda dentro da `api`.* |
| `whisper` | `pediu-whisper` | Transcrição de áudio interna. |
| `caddy` | `caddy:2` | HTTPS automático e roteamento por domínio. |

Banco de dados: **PostgreSQL do Supabase** (3 conexões por papel: `APP_DATABASE_URL`, `PLATFORM_DATABASE_URL`, `MCP_DATABASE_URL`).

**Confirme e anote para o relatório:**
- Como a stack está configurada no Portainer: URL do repositório, **branch/referência atual**, caminho do compose.
- O **commit atualmente em produção** (Portainer mostra o hash da stack; ou `docker inspect` na imagem, ou o último deploy).
- As imagens atuais: `docker images | grep pediu`.
- Se o servidor tem acesso ao `psql` e à `PLATFORM_DATABASE_URL` (usada nos passos de banco). Se **não** tiver, os passos de banco ficam com o dono (SQL Editor do Supabase) e você só orienta e confere pelo que for possível.

---

## 2. O que muda nesta atualização (resumo)

Tudo está em `origin/fix/relatorio-testes-1` (16 commits sobre a `main`; 80 arquivos). Testes automáticos: todos passam (API 153, shared 32, web 7, agente 4 e testes de isolamento SQL).

| Área | O que o dono verá |
|---|---|
| **Checkout da loja** | Nova página `/finalizar` em 3 etapas (Identificação, Entrega, Pagamento) no estilo Yampi; CEP preenche a rua; endereços salvos; cliente cria conta com senha ou entra; pedidos feitos antes de ter conta são vinculados. |
| **E-mail (Resend)** | Super admin › *E-mail (Resend)*: chave e remetente configurados na tela (cifrados no banco). Se não configurar, continua usando o SMTP das variáveis de ambiente. |
| **Impressão** | Painel › Impressão com passo a passo, botão **Puxar impressoras**, **zona de download** do agente (`.exe` e scripts). O agente ganhou tela própria (`127.0.0.1:4710`) e início automático. |
| **PDV** | Cards de produto não encolhem mais; **Pix na tela** habilita com qualquer gateway conectado (Mercado Pago/Sicoob). |
| **Mesas/Garçom** | **Histórico da comanda** (quem abriu, quem adicionou, conta, transferência), também no PDV. |
| **Entregador** | **Montador de rotas**: seleciona várias entregas, ordem sugerida, rota salva, link do Google Maps. |
| **Domínios** | Corrige o "Erro interno" ao adicionar domínio (faltava permissão no banco). Super admin agora gerencia domínios por loja (adicionar/verificar/remover). |
| **Alertas (super admin)** | Cada alerta com explicação em português, detalhes e **logs relacionados** (botão *Entender*). |
| **MCP da loja** | Painel da loja › *Loja e entrega* › **Avançado** › *MCP da loja*: o lojista gera um token para um assistente de IA **gerenciar e criar pedidos** (e só isso). Endpoint `POST /v1/store-mcp` na API. |

Novas migrations (em `packages/db/supabase/migrations/`), **nesta ordem**:

1. `20261017000001_domains_write.sql` — permissão de escrita em `store_domains` para o lojista (corrige o "Erro interno").
2. `20261017000002_checkout.sql` — coluna `orders.customer_email` e tabela `customer_addresses`.
3. `20261018000001_delivery_routes.sql` — colunas `orders.route_id` e `orders.route_stop`.
4. `20261019000001_store_mcp.sql` — tabela `store_mcp_tokens` e função `app.store_mcp_authenticate`.

> Atenção: se o banco de produção ainda estiver **atrás de outras migrations anteriores** (por exemplo `20261014…` a `20261016…`), elas também precisam estar aplicadas. A verificação do Passo 3 cobre **todas**.

---

## 3. Passo 1 — Registrar o estado atual (antes de mexer)

```bash
# no servidor (ajuste se o repositório estiver em outro caminho)
docker images | grep -E "pediu-(api|edge|mcp|whisper)"
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' | grep -i pediu
# guarde as imagens atuais com outra etiqueta, para poder voltar rápido:
D=$(date +%Y%m%d-%H%M)
for s in api edge mcp; do docker tag pediu-$s:latest pediu-$s:antes-$D 2>/dev/null; done
docker images | grep antes-$D
```

Anote: commit/branch atual da stack, as etiquetas `antes-…` criadas e a data/hora. Esses dados vão no relatório final e servem para o rollback.

---

## 4. Passo 2 — Backup do banco (obrigatório antes do Passo 3)

- **Supabase:** o dono pode confirmar que há backup recente (Dashboard › Database › Backups) **ou** você faz um dump lógico, se tiver `pg_dump` e a conexão:
  ```bash
  pg_dump "$PLATFORM_DATABASE_URL" --schema=public --no-owner -Fc -f /root/backup-pediu-$(date +%Y%m%d-%H%M).dump
  ```
  (use o `PLATFORM_DATABASE_URL` da stack **sem imprimi-lo**; se for pooler em modo transação e o `pg_dump` não funcionar, peça ao dono a conexão direta ou a confirmação do backup do Supabase.)
- Se não houver como garantir um backup, **pare e avise o dono** antes de seguir.

---

## 5. Passo 3 — Banco de dados (migrations)

### 5.1 Verifique o que já está aplicado

Rode a consulta abaixo (SQL Editor do Supabase **ou** `psql "$PLATFORM_DATABASE_URL" -f arquivo.sql`). **Resultado vazio = tudo aplicado.** Cada linha devolvida é algo que falta.

```sql
select 'tabela' as tipo, t as objeto from unnest(array[
  'tenants','products','orders','alerts','print_agents','store_customers','store_features','extension_pairings','broadcast_campaigns',
  'coupons','cash_sessions','platform_banners','store_apps','store_totems','customer_addresses','store_mcp_tokens']) t
  where to_regclass('public.' || t) is null
union all
select 'coluna', c from unnest(array[
  'mcp_tokens.allow_production','stores.preview_token','customer_sessions.via','orders.customer_email','orders.route_id','orders.route_stop']) c
  where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = split_part(c, '.', 1) and column_name = split_part(c, '.', 2))
union all
select 'permissão', 'app_api precisa de INSERT em store_domains' where not has_table_privilege('app_api', 'public.store_domains', 'INSERT')
union all
select 'função', 'app.store_mcp_authenticate(text, text)' where to_regprocedure('app.store_mcp_authenticate(text, text)') is null
order by 1, 2;
```

Como ler o resultado (qual migration corrige cada linha):

| Linha que apareceu | Migration que resolve |
|---|---|
| `permissão … store_domains` | `20261017000001_domains_write.sql` |
| `tabela customer_addresses` ou `coluna orders.customer_email` | `20261017000002_checkout.sql` |
| `coluna orders.route_id` / `orders.route_stop` | `20261018000001_delivery_routes.sql` |
| `tabela store_mcp_tokens` ou `função app.store_mcp_authenticate` | `20261019000001_store_mcp.sql` |
| `store_totems` / `store_apps` / `customer_sessions.via` | migrations `20261015…` e `20261016…` (anteriores) |
| `mcp_tokens.allow_production` / `stores.preview_token` | `20261014000001_mcp_producao_previa.sql` |
| outras tabelas antigas | a migration de mesmo tema em `packages/db/supabase/migrations/` (ordem alfabética = ordem de aplicação) |

### 5.2 Aplique só o que falta, na ordem

O dono informou que **ele mesmo aplicará os SQLs**. Então:
1. Rode a verificação **antes** para saber o estado e **depois** que o dono disser que aplicou.
2. Se ainda sobrar linha na verificação, **não aplique por conta própria sem o dono confirmar**; diga exatamente qual arquivo falta. Se ele autorizar, aplique cada arquivo faltante, **uma vez, na ordem**, em transação única:
   ```bash
   psql "$PLATFORM_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f packages/db/supabase/migrations/20261017000001_domains_write.sql
   ```
   (`-1` = tudo ou nada). Se der erro "already exists", **pare**: aquele arquivo já estava aplicado (ou aplicado pela metade) — avise o dono, não repita.
3. Rode a verificação de novo. Só siga quando voltar **vazia**.

> As migrations rodam com o papel dono do schema (a conexão da plataforma). Não use `APP_DATABASE_URL` nem `MCP_DATABASE_URL` para aplicá-las.

---

## 6. Passo 4 — Código novo

### 6.1 Escolha o caminho com o dono

- **Caminho A (recomendado): fazer merge na `main`.** O dono (ou você, se ele autorizar) abre/aceita o Pull Request `fix/relatorio-testes-1` → `main` no GitHub. A stack do Portainer continua apontando para `main`.
  ```bash
  gh pr create --base main --head fix/relatorio-testes-1 --title "Relatório de testes: checkout, impressão, rotas, MCP da loja e mais" --body "Veja docs/ATUALIZACAO-SERVIDOR.md"
  ```
- **Caminho B: apontar a stack para a branch.** No Portainer, em *Stacks › (stack do Pediu) › Editor/Git configuration*, troque a *Repository reference* para `refs/heads/fix/relatorio-testes-1`. Depois, quando fizer merge, volte para `main`.

### 6.2 Conferir o código que será implantado

```bash
git ls-remote https://github.com/GuiVicS/pediu fix/relatorio-testes-1   # deve começar com d552876 (ou mais novo)
```

---

## 7. Passo 5 — Variáveis de ambiente

**Nenhuma variável nova é obrigatória.** Confira que as existentes continuam definidas (só os nomes!): `APP_DATABASE_URL`, `PLATFORM_DATABASE_URL`, `MCP_DATABASE_URL`, `SECRETS_KEYS`, `EDGE_SECRET`, `BASE_DOMAIN`, `API_HOST`, `MCP_HOST`, `ACME_EMAIL`.

Opcionais novas (só se o dono pedir):

| Variável | Para quê |
|---|---|
| `AGENT_EXE_URL` | Endereço do instalador `pediu-agente.exe`. Padrão: `https://github.com/GuiVicS/pediu/releases/download/agente-v0.1.0/pediu-agente.exe`. O botão "Baixar para Windows" só aparece se o endereço responder. |
| `AGENT_DIST_DIR` | Já vem definida na imagem da API (`/app/agent-dist`). Não mude. |

**E-mail:** não precisa de variável. O Resend é configurado **pelo super admin** (Seção 11). `SMTP_*` e `MAIL_FROM` continuam como alternativa.

---

## 8. Passo 6 — Rebuild e redeploy

1. No Portainer, na stack do Pediu: **Pull and redeploy** (ou *Update the stack* com **"Re-pull image and redeploy"** / **"Build"** habilitado). Os serviços `api`, `edge` e `mcp` **precisam ser reconstruídos** (usam `build:` a partir do `Dockerfile`). `whisper` e `caddy` não mudam.
2. Acompanhe o build. Pontos de atenção:
   - **Primeira coisa a verificar se o build falhar:** o estágio `api` do `Dockerfile` agora compila o agente de impressão (`RUN npm run agent:build && mkdir -p /app/agent-dist && cp apps/print-agent/dist/agent.mjs /app/agent-dist/`). **Isso não foi testado dentro do Docker** (o autor só testou fora). Se *só* essa linha falhar, **avise o dono** antes de qualquer coisa: o sistema funciona sem ela (a zona de download no painel apenas mostrará "o agente ainda não foi preparado"); remover a linha é um ajuste simples, mas peça autorização.
   - Falta de memória no build do Vite: o build das telas (`ui`) é pesado; se o servidor for pequeno, tente de novo com o servidor mais livre.
3. Depois do deploy:
   ```bash
   docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' | grep -i pediu     # api, edge, mcp, whisper, caddy "Up"; api/edge/mcp "healthy"
   docker logs --tail 80 $(docker ps -qf name=api)     # sem stack trace; "listening" ou similar
   docker logs --tail 40 $(docker ps -qf name=edge)
   ```

---

## 9. Passo 7 — Versão do app web que as lojas usam (IMPORTANTE)

O app da loja (checkout novo, PDV, garçom, entregador, painel) **é servido pelo `edge`** e cada loja usa uma **versão**: a mais nova do canal dela, uma versão **fixada (pin)**, ou — se não houver nenhuma versão publicada — a `builtin` embutida na imagem do `edge`.

Descubra qual é o caso (consulta somente leitura):
```sql
select app, version, channel, created_at from releases order by created_at desc limit 10;
select s.slug, p.version, p.channel from store_release_pins p join stores s on s.id = p.store_id order by s.slug;
```

- **Caso 1 — `releases` está vazia e não há pins:** todas as lojas usam a `builtin`. Ao reconstruir o `edge` (Passo 6) elas **já recebem o app novo**. Nada mais a fazer.
- **Caso 2 — existem versões publicadas ou lojas fixadas:** as lojas **continuarão no app antigo** até você publicar uma versão nova. Faça (com o dono ciente):
  1. Escolha um número novo maior que o último (semver, ex.: se a última é `1.4.0`, use `1.5.0`; versões são **imutáveis**).
  2. Publique (precisa de `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` e, se não for o padrão, `RELEASES_BUCKET` no ambiente do comando; **não imprima os valores**):
     ```bash
     cd <pasta do repositório na branch/commit implantado>
     npm ci --include=dev
     npm run release:web -- 1.5.0
     ```
  3. No **super admin › Versões por loja › Nova versão**, registre `1.5.0` (canal `beta` primeiro). Faça o *rollout* gradual ou fixe numa loja de teste antes de liberar para todas. Esse passo exige o código do autenticador do dono.
  4. Acompanhe os alertas (super admin › Alertas) por alguns minutos depois de cada etapa do rollout.
- O **super admin** (painel da plataforma) e a **API** não dependem desse passo: vêm na imagem da `api`.

---

## 10. Passo 8 — Verificação

### 10.1 Testes de fumaça (você consegue rodar)

Substitua `API_HOST` e `LOJA` (um domínio de loja de verdade) pelos valores reais.

```bash
# saúde
curl -fsS https://API_HOST/health                                   # deve responder ok
# zona de download do agente (rota pública)
curl -fsS https://LOJA/v1/downloads/agent.json                      # {"available":true,...} se o agente foi compilado na imagem
# MCP da loja: sem token deve recusar
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://LOJA/v1/store-mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'   # 401
curl -s -o /dev/null -w "%{http_code}\n" https://LOJA/v1/store-mcp                                                                                          # 405 (GET não é permitido)
# página nova do checkout abre (HTML da loja)
curl -s -o /dev/null -w "%{http_code}\n" https://LOJA/finalizar     # 200
```

Verifique também nos logs da `api` que não há erro de SQL do tipo `permission denied`, `column ... does not exist` ou `relation ... does not exist` (indicam migration faltando):
```bash
docker logs --since 10m $(docker ps -qf name=api) 2>&1 | grep -iE "permission denied|does not exist|42501|42703|42P01" | head
```

### 10.2 Conferência visual (peça ao dono ou use o navegador, se tiver)

| Onde | O que conferir |
|---|---|
| Loja do cliente | Adicionar item → *Finalizar* abre `/finalizar` com 3 etapas; digitar CEP preenche a rua; criar conta com senha e seguir. |
| Painel do lojista › *Domínios* | Adicionar um domínio de teste **não** dá "Erro interno" (depois remova). |
| Painel › *Impressão* | Passo a passo aparece; (com agente) "Puxar impressoras" lista as impressoras. |
| Painel › *Loja e entrega* › **Avançado** | Seção *MCP da loja* abre; gerar um token de teste e revogar. |
| PDV | Categoria com muitos produtos rola normalmente. |
| Garçom | Abrir uma mesa de teste → *Histórico da comanda*. |
| Super admin › *Alertas* | Botão **Entender** mostra explicação e logs. |
| Super admin › *Lojas › (uma loja)* | Seção **Domínios**. |
| Super admin › *E-mail (Resend)* | Tela abre (estado "Nenhum" ou "SMTP" até configurar). |

> Não crie pedidos reais para testar. Se precisar, use uma loja de demonstração.

---

## 11. Passo 9 — O que depende do dono (avise e oriente; não faça sozinho)

1. **Resend (e-mail):** criar conta em resend.com, **verificar o domínio** (registros SPF/DKIM no DNS), gerar a *API Key* e colar em **Super admin › E-mail (Resend)** com o remetente `PediuLanchou <nao-responda@pediulanchou.com.br>`. Depois clicar em *Testar envio*. (Sem isso, "esqueci minha senha" só funciona se o SMTP das variáveis estiver configurado.)
2. **Instalador do agente (`.exe`):** o arquivo (88 MB, sha256 `c79ee7ae88aaa3087ed2d4c73c276c7ea4ad0d70090aae12e7f496a1a8ff09a9`) precisa estar publicado como release `agente-v0.1.0` no GitHub (ou em `AGENT_EXE_URL`) para o botão "Baixar para Windows" aparecer. O dono decide se publica (repositório público) — ver nota dele.
3. **Reinstalar os PWAs** do Garçom e do PDV nos celulares (desinstalar o antigo e instalar de novo), para virarem apps separados.
4. **Teste no computador da loja (Windows):** agente + impressora térmica real (a impressora precisa estar **compartilhada** no Windows), checkout no celular com Pix/cartão reais, e rota do entregador.
5. **Pedido 1005 da pizzaria-do-gaucho:** o e-mail anotado estava sem `@`; se o dono passar o e-mail correto, vincular o pedido à conta do cliente (UPDATE pontual por número do pedido — **só com autorização expressa**).

---

## 12. Rollback (se algo der errado)

O banco **não precisa voltar atrás**: todas as migrations só acrescentam colunas/tabelas/permissões, e o código antigo as ignora.

**Voltar o código (rápido):**
1. No Portainer, volte a *Repository reference* para a referência anotada no Passo 1 (ou o commit anterior) e faça **Pull and redeploy**; **ou**
2. Reaproveite as imagens guardadas: `docker tag pediu-api:antes-<data> pediu-api:latest` (idem `edge` e `mcp`) e recrie os serviços **sem rebuild** (no Portainer, *Recreate* sem "build/pull").
3. Se você publicou uma versão do app web (Passo 7, caso 2): no super admin, **fixe as lojas na versão anterior** (Versões por loja › Versão) — não é preciso apagar a nova.

**Voltar só o MCP da loja ou outro recurso isolado:** não há necessidade de rollback de banco; revogue tokens em *Loja › Avançado* ou desative o uso.

---

## 13. Relatório final (formato que o dono espera)

Ao terminar, responda em português com:

1. ✅/❌ de cada passo (1 a 9) em uma lista curta.
2. Estado do banco: resultado da consulta de verificação (vazia?).
3. Imagens/serviços: quais foram reconstruídos e se estão `healthy`.
4. Caso do Passo 7 (1 ou 2) e se publicou versão nova do app web.
5. Resultado dos testes de fumaça (códigos HTTP).
6. Erros ou avisos encontrados nos logs (resumidos, sem segredos).
7. **Pendências para o dono** (Seção 11) e qualquer decisão que você deixou de tomar por segurança.
8. Como voltar atrás (etiquetas `antes-…` e commit anterior).

---

### Anexo — mapa rápido do repositório

- `apps/api` API (Fastify) e super admin servido por ela · `apps/web` loja, painel, PDV, garçom, entregador · `apps/platform` super admin (build embutido na API) · `apps/web-edge` serve cada domínio · `apps/mcp` MCP da plataforma · `apps/print-agent` agente de impressão · `packages/db` migrations e testes SQL · `packages/shared` regras comuns.
- Docs úteis: `docs/PORTAINER-DEPLOY.md` (hospedagem), `docs/GUIA-DIDATICO.md`, `docs/PLANO-CHECKOUT.md`, `apps/print-agent/README.md`.
- Testes (se precisar rodar no servidor, fora de produção): `npm ci --include=dev && npm run check && npm test` (não precisam de banco real nem internet).
