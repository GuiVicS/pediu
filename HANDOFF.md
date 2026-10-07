# Handoff de continuidade — PediuLanchou

Atualizado em 2026-10-07. Este arquivo é o ponto de entrada para continuar em outra ferramenta ou sessão. A plataforma se chama **PediuLanchou** (nome técnico `pediu` em pacotes, cookies e variáveis). Branch de trabalho atual: `claude/sync-guivics-pediu-diwhg5` (PR GuiVicS/pediu#1).

## Comece aqui

1. Leia este arquivo, `README.md` e o **guia didático** `docs/GUIA-DIDATICO.md` (versão em página única: `docs/GUIA-DIDATICO.html`).
2. Confira `git status`, `git log` e rode `npm run check` e os testes (comandos na seção “Validação e comandos”).
3. A seção **“Estado atual e pendências”** (logo abaixo) é a lista de verdade. As seções históricas mais adiante (“Atualização — …”) registram o que cada passagem fez e podem citar estados já superados; em caso de conflito vale esta seção.
4. O que existe como código mas **não foi validado no mundo real** está marcado como tal. Não apresente como pronto algo sem teste real.

## Estado atual e pendências (2026-10-07)

**Implementado e testado por testes automáticos** (API 82, extensão 18, shared 27, edge 3, SQL de isolamento incl. `rls_whatsapp.sql`):
clientes por e-mail e histórico; rodapé configurável; checklist de funcionalidades por loja (super admin); pareamento da extensão com a sessão do lojista; catálogo/orçamento/consulta de pedido para o agente; respostas rápidas; agente de IA (Claude) com ferramentas, áudio (Whisper) e imagem; rascunho de pedido com link; **cupons de desconto** (migration `20261012000001_coupons.sql`, `apps/api/src/coupons.ts`, `/painel/cupons`, campo no checkout, “Meus cupons” na conta); modo automático/assistido com pausa por humano; disparos com ritmo e envio incerto nunca repetido; pré-visualização da loja em desenvolvimento para a equipe; PWA por tela (vitrine, painel, PDV, garçom, entregador) e do super admin; guias HTML responsivos com modo escuro.

**Decisões do dono do produto (2026-10-07)**
- **Login do cliente:** manter **só e-mail**; telefone fica como contato do pedido (a conta pede o telefone). Reabrir só se pedirem SMS/WhatsApp.
- **Cupons:** implementar todas as regras, configuráveis por loja — **feito** (ver abaixo).

**Pendências que dependem de decisão/ação do dono**
1. Repositório separado do guia: a integração do GitHub destas sessões não cria repositórios (erro 403). O dono cria um repositório privado vazio e sobe a pasta `pediulanchou-guia` (ou o anexa à sessão).

**Pendências de validação real (exigem ambiente, conta ou hardware)** — lista detalhada em `docs/TESTES.md`, seção 10:
WhatsApp Web real + WA-JS 4.6.1 (o usuário relatou erro vindo de `wppconnect-wa.js`/`wrapModuleFunction`; faltou a mensagem do erro e a versão do WhatsApp Web); chamadas reais à Anthropic e ao Whisper; disparos reais; PWA em Android/iPhone; preview e telas no navegador; migrations (9) em banco real/Portainer; SMTP real; impressora física e agente de impressão no Windows (sem instalador nem início automático documentado/validado).

**Pendências de ambiente (fora do Git)**: stack local `C:\Users\thnkad\pediu-local`, super admin `claude@pediu.local` (remover se desnecessário), token MCP (30 dias), vincular categorias à zona Cozinha, criar administrador da loja demo. Não há `.mcp.json` no repositório (a associação `supabase-pediu` citada antes não existe aqui).

**Melhorias sugeridas**: lista completa na Parte 10 do guia didático.

## Objetivo e pedidos do usuário

- Plataforma delivery com vitrine por loja, painel do lojista, super admin, PDV, mesas/garçom, entregador e integração MCP.
- Cliente de cada lojista deve poder entrar, resgatar cupons, consultar pedidos anteriores e acompanhar pedidos em andamento; o lojista deve ver sua lista de clientes. O usuário pediu login com número de telefone.
- Cada loja deve ser PWA e o admin também. Existe infraestrutura de PWA no app web, mas o atendimento completo desse pedido não foi validado nesta passagem.
- Adicionar funcionalidade de disparo via extensão Chrome: estudar `C:\Users\thnkad\Documents\extensão\Orbita-Extensao`, usar `https://github.com/wppconnect-team/wa-js`, incluir respostas rápidas para delivery e possibilidade de agente de IA conversar individualmente com clientes, tudo conectado à sessão logada do admin. **O usuário pediu criar um planejamento para isso.**
- Permitir visualizar loja em desenvolvimento com uma faixa indicativa; adicionar botão de acesso rápido para visualizar a loja.
- Preparar hospedagem via Portainer. O compose para Repository já foi commitado; o guia local está agora em `docs/PORTAINER-DEPLOY.md`.

## Repositório e arquitetura

Clone de origem: `C:\Users\thnkad\pediu`. Monorepo npm, Node >=22, TypeScript.

| Área | Local | Função |
|---|---|---|
| API | `apps/api` | Fastify, sessões, pedidos, clientes, pagamentos, equipe, impressão |
| Super admin | `apps/platform` | React/Vite; UI servida pela API |
| Vitrine e painel da loja | `apps/web` | React/Vite; conta do cliente, painel, PDV, garçom, entregador |
| Edge | `apps/web-edge` | Resolve loja por domínio e serve versão do app |
| MCP | `apps/mcp` | Ferramentas para administrar lojas |
| Banco | `packages/db` | Pools, migrations, roles, RLS e testes SQL |
| Compartilhado | `packages/shared` | Permissões, criptografia, autenticação e utilitários |
| Impressão | `apps/print-agent`, `packages/escpos` | Agente local e cupom ESC/POS |
| Deploy | `deploy` e `Dockerfile` | Compose, Caddy, builds dos serviços |

Roles: `app_api`, `platform_api`, `mcp_agent`. O código depende de contexto de tenant; mantenha o isolamento entre contas e lojas nas novas funcionalidades.

## Commits anteriores relevantes

- `db465a4`: Dockerfile passa a copiar `tsconfig.base.json`, corrigindo build das telas.
- `88e0072`: `packages/db/src/pools.ts` evita serializar JSON duas vezes. Corrigiu configurações, tema, eventos de impressão e outros campos jsonb.
- `94b3fef`: compose para Stack do Portainer via Repository (`deploy/docker-compose.portainer.yml`). Era o HEAD antes deste handoff.
- Esta passagem versiona o trabalho que Claude deixou sem commit, junto com os documentos de continuidade. Consulte `git log` para o hash final.

## Trabalho recuperado e incluído no push

### Conta do cliente e histórico

- `apps/api/src/customers.ts`: solicitação/verificação de código por e-mail, consulta/alteração de perfil, logout, histórico de pedidos, listagem de clientes para equipe e configuração pública do rodapé.
- `apps/api/src/customerEmail.ts`: e-mail de acesso com marca/cores da loja e rodapé da plataforma.
- `apps/api/src/mailer.ts`: transporte SMTP com Nodemailer; dependências registradas em `apps/api/package.json` e `package-lock.json`.
- `apps/api/src/app.ts`, `context.ts`, `env.ts`, `server.ts`: registro das rotas e configuração do envio de e-mails.
- `apps/api/src/orders.ts`: associa pedidos novos à conta autenticada por `customer_id`; checkout anônimo continua permitido. Não associa retroativamente pedidos só por coincidência de telefone.
- `apps/web/src/lib/customer.tsx`: contexto da sessão do cliente.
- `apps/web/src/store/AccountPage.tsx`: conta em `/conta`, login sem senha por código de e-mail e edição de nome/telefone.
- `OrdersPage.tsx`: histórico da conta junto ao acompanhamento existente; `CheckoutModal.tsx` usa dados da conta.
- `apps/web/src/admin/CustomersAdmin.tsx`: lista em `/painel/clientes`, busca, contagem de pedidos, gasto e histórico por cliente. Permissão atual: `admin.pedidos`.
- Rotas e menus integrados em `App.tsx`, `AdminLayout.tsx`, `StoreLayout.tsx` e `StoreContext.tsx`.

Autenticação atual: código de 6 dígitos, validade de 10 minutos, até 5 erros por código e até 5 solicitações por e-mail/loja por hora. Cookie `pediu_cust`; banco armazena hash do token. Sessão com validade de 90 dias e limite de inatividade de 30 dias. Esses números descrevem o código atual, não decisões de produto confirmadas pelo usuário.

Rotas públicas, sob `/v1/store/:slug/customer`: `POST /code`, `POST /verify`, `GET /me`, `PUT /me`, `POST /logout`, `GET /orders`. A área do cliente exige loja em `producao`.

Rotas da equipe: `GET /v1/staff/customers`, `GET /v1/staff/customers/:id/orders`.

### Migration e rodapé

- Nova migration: `packages/db/supabase/migrations/20261010000001_customers.sql`, aplicada após as cinco anteriores.
- Cria `store_customers`, `customer_login_codes`, `customer_sessions`, `platform_public_settings`; adiciona `orders.customer_id`, índices, vínculos e políticas RLS.
- Testes: `apps/api/test/customers.test.ts` e `packages/db/supabase/tests/rls_customers.sql`.
- Rodapé da vitrine com “Desenvolvido com muita fome” e logo `apps/web/public/brand/logo-allblack.png`.
- Super admin: tela `StoreFooter` em `apps/platform/src/pages/Business.tsx`, integrada ao menu e rotas. API: `GET/PUT /v1/platform/public-settings`; escrita exige step-up TOTP.
- Configuração `landing_url`, valor inicial `https://pediulanchou.com.br`, usada na vitrine e no e-mail.
- Verificar a prévia da logo no super admin: o arquivo foi adicionado ao public do app web; confirmar se `/brand/logo-allblack.png` também é servido na origem da plataforma.

### Limites e próximas correções

- Login por telefone **não implementado**; telefone atual é apenas contato. Decidir canal de verificação e fluxo, preservando o requisito do usuário.
- Cupons/resgate **não implementados nesta entrega**. Definir validade, limites, aplicação de desconto, vínculo à conta e regras de uso.
- SMTP necessário: `SMTP_HOST`, `SMTP_PORT` (587 por padrão), `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. Sem SMTP, solicitação de código responde 503.
- `deploy/docker-compose.portainer.yml` já repassa as variáveis SMTP e as do agente (feito em 2026-10-07).
- Confirmar aplicação das **10 migrations** no banco local e no de produção; as passagens deste trabalho não alteraram bancos nem reiniciaram a stack.
- Validar entrega real de e-mail e navegação visual no navegador, incluindo identidade da loja, logo, rodapé e responsividade.

## Extensão Chrome/WhatsApp

Planejamento e implementação concluídos no código (etapas 1 a 7 do `docs/PLANO-EXTENSAO-WHATSAPP.md`). A referência local Orbita (`C:\Users\thnkad\Documents\extensão\Orbita-Extensao`) não acompanha o Git e não foi copiada. Detalhes das entregas e do que falta validar: seções “Atualização” mais abaixo e `docs/TESTES.md` seção 10.

## PWA e preview de loja

- **PWA (feito, falta validar em aparelhos reais):** o edge (`apps/web-edge/src/edge.ts`) serve um manifesto por loja e um por tela de operação (`/manifest.webmanifest?app=garcom|entregador|pdv|painel`, `id` e `start_url` próprios, ícone da loja ou da marca; o HTML de cada rota recebe o link certo). `AppShell` e o painel têm botão **Instalar** (iPhone mostra o passo a passo). O service worker é mínimo e **não guarda cache de propósito** (lojas em versões diferentes). O super admin é instalável (`apps/platform/public/manifest.webmanifest`, `sw.js`, ícones). Validar: instalação, atualização, escopo e sessão em Android/iPhone.
- **Preview (feito, falta validar no navegador):** `viewableStore` em `apps/api/src/orders.ts` libera `GET /v1/store/:slug` e `/menu` de loja em `desenvolvimento` **só para a equipe logada da própria loja**; a vitrine mostra a faixa “Modo desenvolvimento — loja não publicada” e desativa o checkout; `/v1/staff/me` devolve `store.status` e o botão “Ver loja” do painel marca “rascunho”. Pedidos e área do cliente continuam só em produção. Não existe link de prévia para quem não é da equipe (poderia ser um token assinado e temporário).

## Stack local e loja de exemplo

Pasta local fora do repo: `C:\Users\thnkad\pediu-local`. Contém compose, `.env`, `initdb`, scripts e logs em `work`. Esses arquivos de operação e volumes não são transferidos por um clone Git.

Estado consultado nesta passagem: `pediu-api-1`, `pediu-edge-1`, `pediu-mcp-1`, `pediu-db-1` em execução e healthy; `portainer` em execução. Isso confirma o estado dos containers, não testes funcionais nem que a imagem contém todo o código recém-versionado.

| Serviço | Endereço local |
|---|---|
| API / super admin | `http://localhost:3000` |
| Edge / lojas | `http://localhost:3200` |
| MCP | `http://localhost:3100/mcp` |
| Portainer | `https://localhost:9443` |
| Banco | Postgres 16, banco `pediu`, somente na rede Docker |

Histórico da configuração: Docker Desktop/WSL2, compose projeto `pediu`, cinco migrations originais aplicadas, uploads no volume local, `BASE_DOMAIN=localhost`, `COOKIE_SECURE=false`. Não há HTTPS/domínio público nem validação real de webhooks locais. A stack foi criada por Docker Compose, não como Stack gerenciada pelo Portainer.

Loja demo: `burger-lab`, id `2588a137-2e7e-4b64-9d6c-22ca1045f8c8`, conta “Burger Lab (teste)”. Vitrine `http://burger-lab.localhost:3200`, login de equipe `/entrar`, painel `/painel`. Publicada em `producao` com cortesia “loja de teste local”. Criados por MCP: 4 categorias, 9 produtos, 3 banners, tema vermelho/dourado, 2 zonas de entrega, Pix/dinheiro/cartão na entrega, zona de impressão Cozinha. Doze imagens geradas e convertidas para JPG foram servidas pela API. Imagens/volume não acompanham o clone.

Pendências históricas que precisam de confirmação no banco: criar administrador/equipe da loja para teste completo e vincular categorias à zona Cozinha. Não criar contas duplicadas sem consultar o estado.

## Acessos e dados fora do Git

- Segredos ficam em `C:\Users\thnkad\pediu-local\.env`; não versionar nem copiar para o handoff.
- Super admin do usuário: `admin@pediu.local`, senha na variável local `ADMIN_PASSWORD`. Primeiro login exige cadastrar TOTP, se ainda não feito.
- Super admin de automação criado anteriormente: `claude@pediu.local`, com TOTP; segredo local em `CLAUDE_ADMIN_TOTP_SECRET`, recovery codes em `work/recovery.json`. Confirmar necessidade dessa conta e remover quando apropriado.
- Token MCP em `PEDIU_MCP_TOKEN`, criado com duração de 30 dias; conferir validade. Script local `work/mcp.mjs` e gerador TOTP `work/totp.mjs` existem, mas não acompanham o repo.
- O Supabase `ossiuohajleirowsglea` pertence a **outro sistema** (orçador), não ao Pediu. Não aplicar migrations lá. O registro MCP `supabase-pediu` em `.mcp.json` foi apontado como indevido; confirmar e remover a associação se ainda existir.
- Para continuar em outra máquina, usar ambiente próprio, aplicar migrations em banco dedicado e criar credenciais; o Git não transporta sessões, tokens, Docker volumes, banco ou referência Orbita.

## Validação e comandos

- Log recuperado `C:\Users\thnkad\pediu-local\work\apitests.log`: suíte API anterior terminou com **60 testes, 60 aprovados, zero falhas, exit 0**. É evidência da execução do Claude, não uma execução nova desta passagem.
- Nesta passagem: `npm.cmd run check` **aprovado (exit 0)**, incluindo validação dos nove arquivos SQL (seis migrations e três testes SQL) e TypeScript de todos os workspaces. `git diff --check` também aprovado.
- Não foram repetidos testes de integração, testes com gateways reais, impressão física, instalação PWA ou testes visuais nesta passagem.
- `docs/TESTES.md` tem uma checklist antiga; não interpretar a introdução antiga como evidência de que nenhum teste foi executado desde então.

Comandos a partir da raiz do clone:

```powershell
npm.cmd ci
npm.cmd run check
node packages/db/scripts/run-sql-tests.mjs
npm.cmd run build:ui
node --import tsx --test --test-concurrency=1 apps/api/test/*.test.ts
```

No Windows, `npm.cmd` evita o bloqueio de `npm.ps1` pela política de execução. Os testes SQL/API usam infraestrutura de teste descrita em `packages/db/src/testing.ts` e scripts do banco; conferir antes de apontar qualquer teste para dados reais. O script raiz `typecheck` suprime falhas com `|| true`; para confirmação usar `npm.cmd run check`.

Operação do ambiente local (somente nessa máquina): entrar em `C:\Users\thnkad\pediu-local` e executar `docker compose up -d --build` para atualizar ou `docker compose logs -f api` para investigar. **Não usar `down -v`**, que remove volumes/dados.

## Ordem recomendada de continuidade

1. Decidir login por telefone e cupons (ver “Estado atual e pendências”) e implementar.
2. Mergear o PR, aplicar as **10 migrations** (lista na Parte 7.3 do guia) em banco dedicado, configurar SMTP e as chaves do agente/Whisper e atualizar a Stack (`docs/PORTAINER-DEPLOY.md`).
3. Rodar a validação real da lista de `docs/TESTES.md` seção 10, começando pelo WhatsApp Web com conta de teste (e investigar o erro do WA-JS com a mensagem completa).
4. Instalador do agente de impressão para Windows (início automático) e validação com impressora física.
5. Manter `docs/GUIA-DIDATICO.md` e o HTML atualizados.

Atualize este handoff após cada etapa com mudanças, testes efetivamente executados e pendências concretas. Evite marcar uma proposta como funcionalidade pronta.

## Atualização final — plano do agente delivery (2026-10-07)

> Histórico: a implementação pendente citada aqui já foi feita (ver as seções “Atualização” seguintes e “Estado atual e pendências”).

O planejamento está concluído em `docs/PLANO-EXTENSAO-WHATSAPP.md`; **a implementação permanece pendente**. Esta atualização substitui os trechos anteriores que dizem que o planejamento ainda não existe ou que a Orbita só foi listada.

Foi feita análise estática do manifesto, ponte, chat, respostas rápidas, transcrição e trechos do bundle de campanhas da Orbita, junto ao catálogo, pedidos, clientes e sessão do Pediu e documentação oficial WA-JS/Chrome. O histórico Claude não continha essa análise nem plano concluído.

Escopo final confirmado pelo usuário: **agente de atendimento delivery ligado à sessão do lojista**, com transcrição de áudio, análise de imagens, contexto comercial real e **checklist no super admin para habilitar funcionalidades por loja**. Disparos são complemento posterior; manter foco no atendimento. A checklist também faz parte do plano e ainda não está implementada.

Para continuar, leia o plano e comece pela etapa 1. Não retome a elaboração de uma arquitetura ampla de CRM/campanhas. Nenhum teste no WhatsApp real foi executado nesta passagem; alteração exclusivamente documental.

## Atualização — etapa 1 da extensão WhatsApp (2026-10-07, sessão de sincronização)

Sincronizado com `origin/main` (df9adec); HANDOFF.md e `docs/PLANO-EXTENSAO-WHATSAPP.md` relidos. Seguindo o plano, iniciada a **etapa 1** em `apps/whatsapp-extension` (workspace `@pediu/whatsapp-extension`).

Feito:
- Manifest V3 (`manifest.json`): WA-JS 4.6.1 fixado (`@wppconnect/wa-js`) no contexto MAIN, ponte isolada e service worker; só `web.whatsapp.com`, permissão `storage`.
- `src/protocol.ts`: contrato e validação de envelopes (texto/áudio/imagem/outro, truncamento, só eventos de leitura — **sem comando de envio**, nenhuma credencial Pediu cruza a fronteira MAIN).
- `src/main-world.ts`: emite `ready`, `disconnected` e `message` (de `chat.new_message`) via postMessage.
- `src/bridge.ts`: valida origem/canal, repassa por porta runtime e reconecta se o service worker for encerrado.
- `src/service-worker.ts`: apenas guarda estado e últimas 50 mensagens em `chrome.storage.session` (validação; sem backend ainda).
- `scripts/build.mjs`: esbuild + cópia do bundle WA-JS para `dist/` (carregar como extensão descompactada).

Validação executada nesta passagem: `tsc` da extensão sem erros, 5 testes unitários do protocolo aprovados, build gera `dist/`. **Não testado no WhatsApp Web real**: o payload de `chat.new_message`, `WPP.isReady`/`webpack.onReady` e o campo de versão em 4.6.1 vieram da Orbita/documentação e precisam ser confirmados com conta de teste. Não foi executado `npm run check` raiz completo nem a suíte da API.

Pendente da etapa 1 (critério: conta de teste recebe texto/áudio/imagem e reconecta): teste manual no Chrome, confirmar eventos, download de mídia por partes (`chat.downloadMedia`) e teste de reconexão. Depois, etapa 2 (pareamento com sessão + checklist no super admin). A Orbita não está acessível neste ambiente; o código acima não copia nada dela.

### Etapa 2 (parte 1) — checklist de funcionalidades por loja (implementado)

- `packages/shared/src/features.ts`: catálogo (atendimento WhatsApp, respostas rápidas, agente IA, respostas automáticas, transcrição, imagens, montagem de pedido, disparos), flag `available` e dependências; `applyFeatureChanges` impede ativar função indisponível/sem dependência e desativa dependentes em cascata. Hoje só `whatsapp_support` é ativável; mudar `available` conforme cada recurso for entregue.
- Migration `20261011000001_store_features.sql`: tabela `store_features` com RLS (plataforma escreve; loja só lê a própria).
- API: `GET/PUT /v1/platform/stores/:id/features` (PUT exige step-up e grava auditoria `store.feature`), `GET /v1/staff/features` (liberações da loja do lojista).
- Super admin: seção “Funcionalidades disponíveis” no detalhe da loja (`Stores.tsx`), com indisponíveis desabilitadas.
- Decisão: a checklist é a única fonte para estas funcionalidades; `plans.modules` não as controla (evita fontes contraditórias).
- Validado nesta passagem: `npm run check` (sem erros), SQL (migração + RLS existentes passam), `apps/api/test/stores.test.ts` 7/7, `packages/shared/test/features.test.ts` 3/3. Não rodei a suíte completa da API nem testei a tela no navegador. Não há teste SQL de RLS específico para `store_features` ainda.
- Pendente da etapa 2: pareamento extensão↔sessão do lojista (código de uso único, dispositivo, credencial restrita, revogação), e o backend deve checar `store_features` em cada uso.

### Etapa 2 (parte 2) — pareamento extensão ↔ sessão do lojista (implementado)

Fluxo: lojista logado (`admin.pedidos`) gera código de 8 caracteres em `/painel/whatsapp` (uso único, 5 min, um ativo por pessoa, exige `whatsapp_support` liberado) → extensão troca o código por credencial própria `pext_…` → a credencial é validada a cada chamada.
- Migration `20261011000002_extension_pairing.sql`: `extension_pairings`, `extension_devices` (só hashes; RLS por tenant), funções `app.extension_pair` (consome o código de forma atômica) e `app.extension_device` (exige dispositivo não revogado, sessão do lojista viva, usuário ativo e recurso ainda liberado), `app.feature_on`.
- API (`apps/api/src/extension.ts`): `POST /v1/staff/extension/pairing`, `POST /v1/extension/pair` (rate limit 10/min), `GET /v1/extension/me` (Bearer), `GET /v1/staff/extension/devices`, `DELETE /v1/staff/extension/devices/:id`; auditoria `extension.pairing_created/paired/device_revoked`. Guard reutilizável `extensionGuard` para as próximas rotas.
- Painel (`apps/web/src/admin/WhatsappAdmin.tsx`, menu Loja → “Atendimento WhatsApp”): gerar código, listar e desconectar dispositivos.
- Extensão: `src/api.ts` (cliente), `popup.html/popup.ts` (endereço + código; permissão do host pedida por gesto do usuário; credencial em `chrome.storage.local` com acesso só a contextos confiáveis; detecta conexão revogada).
- Decisão: a credencial dura enquanto a sessão do lojista (12 h, limite de inatividade 2 h do cookie não se aplica ao dispositivo) estiver válida; logout/expiração derrubam a extensão, conforme o plano. Se isso incomodar na operação, avaliar renovação explícita.
- Validado: `npm run check` limpo; suíte da API completa; `extension.test.ts` (5 casos: recurso desligado, replay, expiração, logout/revogação/desativação, isolamento entre lojas e permissão); testes da extensão 8/8; build gera `dist/`. **Não testado**: popup no Chrome real, tela `/painel/whatsapp` no navegador, migration em banco real/Portainer.
- Etapa 2 concluída no código. Próximo: etapa 3 (catálogo, respostas rápidas e pedidos autorizados via `extensionGuard`) e fechar a etapa 1 com teste manual no WhatsApp Web.

## Atualização — etapas 3 a 7 implementadas (2026-10-07)

Código novo (tudo na branch `claude/sync-guivics-pediu-diwhg5`, PR GuiVicS/pediu#1):
- Migration `20261011000003_extension_features.sql`: `quick_replies`, `agent_conversations`, `order_drafts`, `broadcast_campaigns/recipients`, `store_customers.marketing_opt_in`, função `app.order_draft`.
- API: `storeInfo.ts` (snapshot da loja, orçamento com as regras do checkout, consulta de pedido com número+telefone, busca no cardápio), `extensionStore.ts` (loja/cardápio/orçamento/pedido/rascunhos/respostas rápidas), `agent.ts` (laço de ferramentas, `agent/reply`, `send-check`, `conversations`, `transcribe`), `llm.ts` (adaptadores Anthropic e transcrição compatível OpenAI), `broadcasts.ts` (campanhas, fila com ritmo de 20 s, envio sem resultado vira “incerto” e não é repetido). Todas as funcionalidades do catálogo em `packages/shared/src/features.ts` agora são ativáveis (`available: true`).
- Painel da loja: `/painel/whatsapp` com conexão, respostas rápidas e disparos; Clientes ganhou o marcador de consentimento (“aceitou receber mensagens”). Vitrine: `DraftLoader` abre `?rascunho=token` no carrinho.
- Extensão: comandos fechados (enviar texto, baixar mídia, chat ativo), `flow.ts` (agente: transcrição/imagem, assistido/automático, pausa quando humano escreve, resposta obsoleta descartada), `broadcast.ts`, painel dentro do WhatsApp Web, service worker. WA-JS: readiness por `WPP.isFullReady`/`WPP.loader.onFullReady` e `WPP.chat.getActiveChat/sendTextMessage/downloadMedia` conferidos nas tipagens da 4.6.1.
- Compose do Portainer agora repassa SMTP e as variáveis do agente.

Validado nesta passagem: `npm run check` limpo; API 73/73 (inclui `whatsapp.test.ts`); extensão 18/18; shared; SQL (migrations + RLS). Teste de fumaça no Chromium com a extensão carregada e página falsa de `web.whatsapp.com` + API simulada: mensagem → sugestão → painel → envio; eco do agente não pausa e mensagem de atendente pausa.

NÃO validado (pendências reais): (1) WhatsApp Web real com conta de teste (payload de `chat.new_message`, ids LID, baixar áudio/imagem, enviar); (2) chamadas reais à Anthropic e à transcrição (chaves, formato OGG/Opus, custo, qualidade do prompt); (3) vitrine com `?rascunho=` no navegador; (4) telas `/painel/whatsapp` e super admin no navegador; (5) migrations em banco real/Portainer; (6) revisão jurídica/consentimento dos disparos e risco de bloqueio do número pelo WhatsApp (uso de WhatsApp Web automatizado não é canal oficial). Extensão empacotada para teste: `npm run build -w @pediu/whatsapp-extension` → carregar `apps/whatsapp-extension/dist` em chrome://extensions (modo desenvolvedor).

### Identidade visual da extensão (2026-10-07)
A plataforma se chama **PediuLanchou**. A extensão agora usa a marca: nome “PediuLanchou — Atendimento WhatsApp”, ícones 16/32/48/128 (a partir de `apps/web/public/brand/mark-512.png`), logo no popup, gradiente azul da marca no botão e no painel dentro do WhatsApp Web, rodapé “Desenvolvido com muita fome”. Arquivos: `apps/whatsapp-extension/icons`, `assets/logo.png`, `popup.html`, estilos em `src/bridge.ts`. Conferido por captura de tela no Chromium (popup e painel). Textos visíveis ao usuário usam “PediuLanchou”; o nome técnico `pediu` permanece em pacotes, cookies e variáveis.

### Transcrição com Whisper (2026-10-07)
Decisão do usuário: transcrição de áudio usa **Whisper**. O adaptador (`apps/api/src/llm.ts`) fala o protocolo `/audio/transcriptions` (idioma `pt`). Configuração: API da OpenAI → só `TRANSCRIBE_API_KEY` (modelo padrão `whisper-1`, ajustável em `TRANSCRIBE_MODEL`); servidor próprio ou Groq/faster-whisper/whisper.cpp → `TRANSCRIBE_URL` (chave opcional). Sem nenhum dos dois a transcrição responde 503. Não testado com Whisper real (só adaptador simulado); validar OGG/Opus do WhatsApp, tamanho (limite atual ~5 MB) e qualidade em português.

### Documentação didática (2026-10-07)
Criado `docs/GUIA-DIDATICO.md`: guia para quem entra na equipe sem conhecimento técnico (glossário, perfis, tecnologias, 6 fluxogramas Mermaid validados, uso das telas do super admin/painel/PDV/cliente/extensão, Portainer, as 9 migrations em ordem, variáveis de ambiente, criação do primeiro super admin por `npm run create-admin`, receita para novas funcionalidades, solução de problemas, melhorias e checklist de onboarding). README e `docs/PORTAINER-DEPLOY.md` apontam para ele e a lista de migrations foi atualizada para 9. Itens marcados ⚠️ no guia ainda não foram validados no mundo real. Manter o guia atualizado a cada mudança de tela/variável.

### Checklist de instalação de cliente (2026-10-07)
Adicionada a **Parte 12** em `docs/GUIA-DIDATICO.md`: ficha do cliente, plataforma, dados da loja, impressoras (hardware, agente, zonas, testes), celulares de garçom/entregador via PWA, PDV/cozinha, domínio/QR, pagamentos online, e-mail, iFood/WhatsApp, ensaio geral, go-live, pós-instalação e problemas. Pontos que dependem de decisão/trabalho: (1) o agente de impressão não tem instalador nem instrução oficial de início automático com o Windows (documentado como ⚠️ com sugestão de Agendador de Tarefas, não testada); (2) o PWA instalado abre na vitrine, não em `/garcom` (manifest por loja com `start_url` fixo em `/?source=pwa`); (3) sessão da equipe 12 h com inatividade de 2 h. Estes três estão listados como melhorias no guia. A checklist foi escrita a partir do código; nenhum passo foi executado com impressora ou celular reais.

### Guia em HTML e repositório separado (2026-10-07)
`docs/GUIA-DIDATICO.html` é o guia em página única (índice, fluxogramas em SVG, checklists clicáveis salvos no navegador, imprimir/PDF), gerado a partir do `.md`. Foi preparada uma pasta `pediulanchou-guia` (README, guia `.md` e `.html`, Portainer, domínios, plano do WhatsApp, assistente e `tools/build-html.mjs`) para ser um repositório próprio. **O repositório não foi criado**: a integração do GitHub desta sessão recusou a criação (403 “Resource not accessible by integration”). Pendente: o dono criar um repositório privado vazio (ex.: `pediulanchou-guia`) e subir a pasta, ou criá-lo e anexá-lo à sessão para o push.

### Guias responsivos com tema da plataforma e modo escuro (2026-10-07)
`docs/GUIA-DIDATICO.html` e o assistente `docs/index.html` agora usam as variáveis do tema da plataforma (`apps/platform/src/platform-theme.css`: azul primário, fonte Inter, raios grandes, sombras), com botão claro/escuro (chave `pediu-ui-theme`, a mesma do painel; sem preferência salva segue o sistema), layout responsivo (índice vira gaveta no celular, tabelas e fluxogramas rolam na horizontal, sem estouro de largura em 360 px), barra de progresso, voltar ao topo e impressão sempre em claro. Fluxogramas Mermaid são embutidos como SVG nos dois temas. O assistente teve o passo das migrations corrigido para as 9 atuais; o restante do texto do assistente continua o original (pode estar desatualizado em outras partes). Os HTML são **gerados** pelos scripts do repositório separado do guia (`tools/build-html.mjs`, `tools/patch-assistente.mjs`, `tools/tema.mjs`; ver a pasta `pediulanchou-guia`, ainda não publicada como repositório): ao mudar o `.md`, rode o build lá e copie o HTML para `docs/`. Verificado por capturas no Chromium (computador, tablet e celular; claro e escuro) e checagem de rolagem horizontal; não testado em Safari/iPhone reais.


### Cupons de desconto (2026-10-07)
Decisão do dono: todas as regras, customizáveis por loja. Implementado: tabelas `coupons`, `coupon_customers`, `coupon_redemptions` e `orders.coupon_code` (migration `20261012000001_coupons.sql`, **10ª migration**), gatilho que devolve o uso quando o pedido é cancelado; `apps/api/src/coupons.ts` (`evaluateCoupon`/`redeemCoupon`; a validação roda dentro da transação do pedido com `for update`, então limites não estouram com pedidos simultâneos); rotas `POST /v1/store/:slug/coupons/validate` (limite de 20/min), `GET /v1/store/:slug/customer/coupons`, `GET/POST/PUT/DELETE /v1/staff/coupons`, `GET/PUT /v1/staff/coupons/:id/customers` (perfil `admin.loja`); tela `apps/web/src/admin/CouponsAdmin.tsx`, campo “Cupom de desconto” no checkout e “Meus cupons” na conta. Regras: código por loja, porcentagem (com teto) ou valor fixo, pedido mínimo, janela de datas, limite total e por cliente (por conta e por telefone — últimos 8 dígitos), público geral ou clientes escolhidos (exige login). O desconto vale só sobre os itens (nunca a entrega) e nunca passa dos itens; cupom já usado não é apagado (desativar). Validado: `coupons.test.ts` 8 casos, `rls_coupons.sql`. **Não validado:** telas no navegador; se o cupom de impressora e as telas de pedido exibem o desconto; combinação com pagamento online real. Guia, Portainer e assistente já listam as **10** migrations.
