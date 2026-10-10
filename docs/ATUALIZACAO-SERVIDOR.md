# Atualização do servidor PediuLanchou — instruções para o Claude do servidor

> **Para quem é este arquivo:** você é o Claude que está dentro do servidor onde roda o PediuLanchou (Portainer + Docker). O dono do sistema vai te passar este documento. Sua missão: **atualizar o sistema com todas as mudanças da branch `fix/relatorio-testes-1`** (Pull Request já aberto: https://github.com/GuiVicS/pediu/pull/4), conferir que tudo subiu e relatar o resultado. Leia o documento inteiro antes de executar qualquer comando.
>
> **Este arquivo é autossuficiente.** Ele contém tudo o que é preciso para atualizar: o SQL das migrations (Anexo A), a consulta de verificação (Passo 3), os comandos de implantação, o release do instalador `.exe` (Anexo B), como compilar o `.exe` (Anexo C) e os checklists. **Nenhum outro documento é necessário.** O único item que vem de fora é o código da aplicação (baixado pelo git/Portainer).
>
> Repositório: `https://github.com/GuiVicS/pediu` · Branch: `fix/relatorio-testes-1` (commit mais novo na hora da escrita: `639da95`; use sempre o mais novo da branch).
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

Tudo está em `origin/fix/relatorio-testes-1` (cerca de 18 commits sobre a `main`). Testes automáticos: todos passam (API 153, shared 32, web 7, agente 4 e testes de isolamento SQL).

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
| **MCP da loja** | Painel da loja › *Loja e entrega* › **Avançado** › *MCP da loja*: o lojista gera um token para um assistente de IA. O assistente **só lê o cardápio** (coleções e produtos) e **só escreve em pedidos** (criar com **nome e telefone do cliente obrigatórios**, avançar status, cancelar); não lê pedidos nem dados de clientes e não imprime. Endpoint `POST /v1/store-mcp` na API. |

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

O dono informou que **ele mesmo aplicará os SQLs** (o SQL completo está no **Anexo A**). Então:
1. Rode a verificação **antes** para saber o estado e **depois** que o dono disser que aplicou.
2. Se ainda sobrar linha na verificação, **não aplique por conta própria sem o dono confirmar**; diga exatamente qual migration falta (use a tabela acima). Se ele autorizar, aplique cada uma que falta, **uma vez, na ordem**, em transação única: salve o bloco SQL do Anexo A num arquivo e rode
   ```bash
   psql "$PLATFORM_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f /root/mig-20261017000001.sql
   ```
   (`-1` = tudo ou nada; use o mesmo comando, trocando o arquivo, para as demais). Se der erro "already exists", **pare**: aquela migration já estava aplicada (ou aplicada pela metade) — avise o dono, não repita.
3. Rode a verificação de novo. Só siga quando voltar **vazia**.

> As migrations rodam com o papel dono do schema (a conexão da plataforma). Não use `APP_DATABASE_URL` nem `MCP_DATABASE_URL` para aplicá-las.

---

## 6. Passo 4 — Código novo

### 6.1 Escolha o caminho com o dono

- **Caminho A (recomendado): fazer merge na `main`.** O Pull Request **já está aberto**: https://github.com/GuiVicS/pediu/pull/4 (`fix/relatorio-testes-1` → `main`). O dono revisa e clica em **Merge pull request** (ou autoriza você a fazer: `gh pr merge 4 --repo GuiVicS/pediu --merge`). Depois do merge, a stack do Portainer (que aponta para `main`) já enxerga o código novo.
- **Caminho B: apontar a stack para a branch.** No Portainer, em *Stacks › (stack do Pediu) › Editor/Git configuration*, troque a *Repository reference* para `refs/heads/fix/relatorio-testes-1`. Depois, quando fizer merge, volte para `main`.

### 6.2 Conferir o código que será implantado

```bash
git ls-remote https://github.com/GuiVicS/pediu fix/relatorio-testes-1   # deve começar com 639da95 (ou mais novo)
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
2. **Instalador do agente (`.exe`):** para o botão "Baixar para Windows" aparecer no painel de Impressão, o arquivo precisa estar publicado. Passo a passo e comandos no **Anexo B**. O repositório é **público**: publique **somente com autorização expressa do dono**.
3. **Reinstalar os PWAs** do Garçom e do PDV nos celulares (desinstalar o antigo e instalar de novo), para virarem apps separados.
4. **Teste no computador da loja (Windows):** agente + impressora térmica real (a impressora precisa estar **compartilhada** no Windows), checkout no celular com Pix/cartão reais, e rota do entregador.
5. **Pedido sem conta vinculada (caso de teste do dono):** o pedido de número 1005 de uma loja de teste foi feito com um e-mail digitado sem `@`, então não vincula sozinho. Se o dono passar o e-mail correto, vincule pontualmente (UPDATE por número do pedido e loja, **só com autorização expressa** e mostrando antes o `SELECT` do que será alterado).
6. **Gerar uma versão nova do `.exe`** (quando o agente mudar): Anexo C.

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

## Anexo A — SQL das migrations (copie daqui)

Aplique **na ordem A.1 → A.4**, cada uma **uma vez**, **somente** as que a verificação do Passo 3 indicar que faltam. São aditivas (só criam colunas, tabelas, permissões e uma função); não alteram nem apagam dados. Se o conteúdo de algum arquivo em `packages/db/supabase/migrations/` do repositório for **diferente** do bloco abaixo (confira o sha256 com `sha256sum arquivo.sql | cut -c1-16`), avise o dono antes de aplicar: vale a versão do repositório.

### A.1 — `20261017000001_domains_write.sql`

Libera ao lojista escrever em `store_domains` (corrige o "Erro interno" ao adicionar domínio). (sha256 do arquivo no repositório: `550f134056abcee5…`)

```sql
-- Lojista adicionando domínio próprio dava "Erro interno": app_api só tinha SELECT em store_domains,
-- então o INSERT (e depois verificar/remover) falhava com "permission denied".
-- Escrita só em domínios próprios (kind = 'custom') do próprio tenant; o subdomínio padrão continua só da plataforma.
grant insert, update, delete on public.store_domains to app_api;
create policy tenant_custom_ins on public.store_domains for insert to app_api
  with check (tenant_id = app.current_tenant() and kind = 'custom');
create policy tenant_custom_upd on public.store_domains for update to app_api
  using (tenant_id = app.current_tenant() and kind = 'custom') with check (tenant_id = app.current_tenant() and kind = 'custom');
create policy tenant_custom_del on public.store_domains for delete to app_api
  using (tenant_id = app.current_tenant() and kind = 'custom');
```

### A.2 — `20261017000002_checkout.sql`

E-mail no pedido (`orders.customer_email`) e endereços salvos (`customer_addresses`). (sha256 do arquivo no repositório: `081d5a487d8c019c…`)

```sql
-- Novo checkout: e-mail do pedido (para vincular pedidos feitos antes de existir conta) e endereços salvos do cliente.

-- ---- e-mail informado no pedido (minúsculo). Pedidos antigos ficam sem e-mail e não são vinculados automaticamente ----
alter table public.orders add column customer_email text check (customer_email is null or (customer_email = lower(customer_email) and length(customer_email) between 5 and 160));
create index orders_customer_email_idx on public.orders(store_id, customer_email) where customer_id is null and customer_email is not null;

-- ---- endereços salvos (um cliente tem vários; o checkout reaproveita) ----
create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null, customer_id uuid not null,
  label text not null default '' check (length(label) <= 40),
  cep text not null default '' check (cep ~ '^\d{0,8}$'),
  street text not null check (length(street) between 2 and 120),
  number text not null default '' check (length(number) <= 20),
  complement text not null default '' check (length(complement) <= 80),
  district text not null default '' check (length(district) <= 80),
  city text not null default '' check (length(city) <= 80),
  uf text not null default '' check (length(uf) <= 2),
  zone_id uuid,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (customer_id, store_id) references public.store_customers(id, store_id) on delete cascade,
  foreign key (zone_id, store_id) references public.delivery_zones(id, store_id) on delete set null (zone_id),
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create index customer_addresses_customer_idx on public.customer_addresses(customer_id, created_at);
create unique index customer_addresses_default_idx on public.customer_addresses(customer_id) where is_default;

alter table public.customer_addresses enable row level security;
create policy platform_all on public.customer_addresses for all to platform_api using (true) with check (true);
grant select, insert, update, delete on public.customer_addresses to platform_api;
create policy tenant_own on public.customer_addresses for all to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant());
grant select, insert, update, delete on public.customer_addresses to app_api;
```

### A.3 — `20261018000001_delivery_routes.sql`

Colunas da rota do entregador (`orders.route_id`, `orders.route_stop`). (sha256 do arquivo no repositório: `cf7145caf15b72fc…`)

```sql
-- Rotas do entregador: várias entregas assumidas de uma vez, em ordem de parada.
-- route_id liga as entregas da mesma saída; route_stop é a posição da parada (1, 2, 3…).
alter table public.orders add column route_id uuid, add column route_stop smallint check (route_stop is null or route_stop between 1 and 50);
create index orders_route_idx on public.orders(store_id, courier_id, route_id) where route_id is not null;
```

### A.4 — `20261019000001_store_mcp.sql`

Tokens do MCP da loja (`store_mcp_tokens`) e a função `app.store_mcp_authenticate`. (sha256 do arquivo no repositório: `c72a98d99fe85cf3…`)

```sql
-- MCP da loja: o lojista gera um token (em Loja › Avançado) para um assistente de IA GERENCIAR PEDIDOS da própria loja.
-- Escopo único por enquanto: 'orders' (listar, ver, mudar status, cancelar, reimprimir). Nada de cardápio, pagamentos ou equipe.
create table public.store_mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null, tenant_id uuid not null,
  name text not null check (length(name) between 1 and 60),
  token_hash text not null unique,
  scopes text[] not null default array['orders']::text[] check (scopes <@ array['orders']::text[]),
  created_by uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz, last_ip inet,
  revoked_at timestamptz, expires_at timestamptz,
  foreign key (store_id, tenant_id) references public.stores(id, tenant_id) on delete cascade
);
create index store_mcp_tokens_store_idx on public.store_mcp_tokens(store_id, created_at desc);

alter table public.store_mcp_tokens enable row level security;
create policy platform_all on public.store_mcp_tokens for all to platform_api using (true) with check (true);
grant select, insert, update, delete on public.store_mcp_tokens to platform_api;
-- o lojista (app_api) vê, cria e revoga só os tokens da própria conta; o hash nunca é lido pela tela (a API não o devolve)
create policy tenant_own on public.store_mcp_tokens for all to app_api using (tenant_id = app.current_tenant()) with check (tenant_id = app.current_tenant());
grant select, insert, update on public.store_mcp_tokens to app_api;

-- Autenticação: a API ainda não sabe de qual loja é o token, então valida pelo hash numa função que ignora o RLS (e só devolve o necessário).
create or replace function app.store_mcp_authenticate(p_hash text, p_ip text)
returns table (id uuid, store_id uuid, tenant_id uuid, name text, scopes text[]) language sql security definer set search_path = public as
$$ update public.store_mcp_tokens set last_used_at = now(), last_ip = nullif(p_ip, '')::inet
   where token_hash = p_hash and revoked_at is null and (expires_at is null or expires_at > now())
   returning store_mcp_tokens.id, store_mcp_tokens.store_id, store_mcp_tokens.tenant_id, store_mcp_tokens.name, store_mcp_tokens.scopes $$;
revoke all on function app.store_mcp_authenticate(text, text) from public;
grant execute on function app.store_mcp_authenticate(text, text) to app_api;
```

---

## Anexo B — Publicar o instalador do agente (`pediu-agente.exe`)

Fatos: arquivo de ~88 MB, versão do agente `0.1.0`, sha256 completo `c79ee7ae88aaa3087ed2d4c73c276c7ea4ad0d70090aae12e7f496a1a8ff09a9`. Está guardado, de forma **privada**, no Google Drive do dono: pasta **"PediuLanchou - Agente de Impressão (compilar)"** › `pediu-agente.exe`.

A API oferece o arquivo em `/v1/downloads/pediu-agente.exe`:
- se existir o arquivo `pediu-agente.exe` dentro da pasta do agente na API (`/app/agent-dist`), ela serve esse arquivo; **senão**
- redireciona para `AGENT_EXE_URL` (padrão: `https://github.com/GuiVicS/pediu/releases/download/agente-v0.1.0/pediu-agente.exe`).
O painel só mostra o botão "Baixar para Windows" se esse endereço responder (a checagem fica em cache até 10 min).

**Publicar como release do GitHub (caminho padrão; torna o arquivo PÚBLICO — só com autorização do dono):**
```bash
# 1) tenha o arquivo no servidor (baixe do Drive do dono) e confira o hash
sha256sum pediu-agente.exe        # deve ser c79ee7ae88aaa3087ed2d4c73c276c7ea4ad0d70090aae12e7f496a1a8ff09a9
# 2) publique (precisa do gh logado na conta dona do repositório)
gh release create agente-v0.1.0 pediu-agente.exe --repo GuiVicS/pediu \
  --title "Pediu Agente de Impressão 0.1.0 (Windows)" \
  --notes "Instalador do agente de impressão para Windows. Já inclui o Node.js. Dois cliques abrem a tela do agente. O Windows pode avisar 'protegeu o computador' porque o arquivo não é assinado: Mais informações > Executar assim mesmo."
# 3) confira
curl -sIL https://github.com/GuiVicS/pediu/releases/download/agente-v0.1.0/pediu-agente.exe | grep -i "^HTTP" | tail -1     # 200
curl -s https://LOJA/v1/downloads/agent.json                                                                                 # "exe":true (até 10 min por causa do cache)
```
Sem o `gh`: no navegador, GitHub › repositório › *Releases* › *Draft a new release* › tag `agente-v0.1.0` › anexar o `pediu-agente.exe` › *Publish release*.

**Alternativa privada:** colocar o `pediu-agente.exe` em `/app/agent-dist/` dentro do container da API (precisa de um volume para sobreviver a rebuilds; exige editar o compose, então só com autorização do dono).

---

## Anexo C — Gerar uma versão nova do `.exe` (Windows)

Quando o agente mudar (pasta `apps/print-agent/`), é preciso recompilar o `.exe` **num Windows** (não dá para gerar `.exe` num servidor Linux). Passo a passo para o dono:

1. Instalar o **Node.js LTS (20 ou mais novo)**: https://nodejs.org
2. Copiar a pasta `apps/print-agent/` do repositório (ou baixar o `pediu-agente-fonte.zip` do Drive, pasta "PediuLanchou - Agente de Impressão (compilar)") para um **disco local** (ex.: `C:\pediu-agente`). **Não rodar dentro do Google Drive/OneDrive**: o `npm install` falha ali (erros de gravação/EPERM).
3. Dar dois cliques em `compilar-exe-windows.bat`. Precisa de internet (leva 1 a 3 min).
4. O arquivo sai em `dist\pediu-agente.exe`. Observações conhecidas: o aviso "The signature seems corrupted" é normal; o passo do ícone (`rcedit`) pode falhar e o `.exe` fica com o ícone padrão do Node — funciona igual; o Windows pode mostrar o aviso do SmartScreen (arquivo não assinado).
5. Para publicar a versão nova: aumente `version` em `apps/print-agent/package.json`, crie um release novo com a etiqueta correspondente (ex.: `agente-v0.2.0`) conforme o Anexo B e aponte `AGENT_EXE_URL` para ele.

---

## Anexo D — Referências rápidas

- **Mapa do repositório:** `apps/api` API (Fastify) e super admin servido por ela · `apps/web` loja, painel, PDV, garçom, entregador · `apps/platform` super admin (build embutido na API) · `apps/web-edge` serve cada domínio · `apps/mcp` MCP da plataforma · `apps/print-agent` agente de impressão · `packages/db` migrations e testes SQL · `packages/shared` regras comuns.
- **Testes** (só se precisar rodar, fora de produção; não precisam de banco real nem de internet): `npm ci --include=dev && npm run check && npm test`.
- **Pull Request:** https://github.com/GuiVicS/pediu/pull/4 · **Hospedagem original:** `docs/PORTAINER-DEPLOY.md` (consulta opcional; não é necessária para esta atualização).
