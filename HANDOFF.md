# Handoff de continuidade — Pediu

Atualizado em 2026-10-07, após recuperar a sessão Claude `ef411d89-dcec-46eb-8ae2-c9e532876881`. Este arquivo é o ponto de entrada para continuar em outra ferramenta. O código em andamento acompanha este handoff no mesmo push; não depende do acesso ao histórico do Claude.

## Comece aqui

1. Leia este arquivo e `README.md`. O repositório é `https://github.com/GuiVicS/pediu`, branch `main`.
2. Confira `git status` e os commits recentes. A compilação foi conferida nesta passagem; veja a seção de validação.
3. O pedido mais recente é **planejar a extensão Chrome/WhatsApp**. Ainda não existe planejamento concluído nem implementação. Preserve também os pedidos de clientes, cupons, login por telefone e PWA.
4. Há uma implementação inicial de clientes por **e-mail**, não por telefone. Não a apresente como conclusão do pedido original.
5. Antes de publicar novos builds, confirme a migration de clientes no banco alvo e configure SMTP. O código no Git e a imagem Docker atualmente em execução podem estar em versões diferentes.

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
- `deploy/docker-compose.portainer.yml` ainda não repassa as variáveis SMTP; adicioná-las ao ambiente do serviço API antes de usar login de clientes nesse deploy.
- Confirmar aplicação da nova migration no banco local e no de produção; esta passagem não alterou bancos nem reiniciou a stack.
- Validar entrega real de e-mail e navegação visual no navegador, incluindo identidade da loja, logo, rodapé e responsividade.

## Extensão Chrome/WhatsApp — próximo trabalho

Estado: pedido recuperado do histórico, **planejamento e implementação pendentes**. Nenhum código da Orbita foi copiado para este repositório.

Referência local existente: `C:\Users\thnkad\Documents\extensão\Orbita-Extensao`. Contém `manifest.json`, pastas `js`, `css`, `fonts`, `icons`, `mcp`, `tools`, e páginas `popup.html`, `options.html`, `quick-replies.html`, `conversas.html`, `dashboard.html`, `offscreen.html`. Apenas a existência/listagem foi conferida; os mecanismos internos ainda precisam ser analisados. Essa referência não acompanha o Git, portanto outra máquina precisará ter acesso a ela para reproduzir o estudo.

Sequência proposta para elaborar o planejamento:

1. Inspecionar manifesto, scripts, comunicação com WhatsApp Web, filas e armazenamento da Orbita; documentar o mecanismo observado e as limitações.
2. Consultar documentação oficial atual do WA-JS antes de definir métodos de envio/eventos e compatibilidade com Chrome Manifest V3.
3. Mapear autenticação do lojista em `apps/web/src/lib/session.tsx` e API de equipe. Definir vínculo explícito extensão–usuário–loja, permissões e revogação. A sessão do WhatsApp Web e a sessão do Pediu são sessões distintas.
4. Descrever experiência de conexão, status do WhatsApp, respostas rápidas (horário, cardápio, entrega, pagamento, pedido em preparo/saiu), variáveis e edição pelo lojista.
5. Descrever disparos: seleção de destinatários autorizados, prévia, fila, pausa/cancelamento, tratamento de falhas e deduplicação. Não executar envios durante o estudo.
6. Descrever IA por conversa: contexto autorizado de loja/pedido, configuração pelo lojista, modo assistido/automático, transferência para humano e controle por conversa. Não colocar chaves de IA no pacote da extensão; definir backend e limites de acesso.
7. Entregar documento técnico com arquitetura, modelo de dados, contratos API, etapas, riscos concretos e critérios de validação. Identificar o que é proposta versus requisito já solicitado.

## PWA e preview de loja

- `apps/web/src/lib/pwa.ts` já registra `/sw.js` em produção e oferece instalação/ajuda iOS. Conferir como o edge fornece manifesto, service worker e identidade por loja.
- Validar instalação da vitrine e do painel, escopo de navegação, atualização e comportamento de sessão. O pedido “admin também” deve ser esclarecido a partir da arquitetura existente (painel do lojista e super admin são apps diferentes).
- Preview continua pendente: `apps/api/src/orders.ts` só permite vitrine pública e checkout em `producao`; a área do cliente segue a mesma regra.
- Proposta anterior registrada: preview autenticado ou token assinado e temporário, faixa “MODO DESENVOLVIMENTO — loja não publicada”, botão “Ver loja”; manter pedidos reais bloqueados fora de produção ou definir pedidos de teste explicitamente.

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

1. Elaborar o planejamento da extensão solicitado, estudando Orbita e WA-JS.
2. Resolver diferença entre login por telefone solicitado e código por e-mail implementado; planejar/implementar cupons.
3. Preparar migration, SMTP e deploy do código de clientes; validar conta, pedidos e isolamento de ponta a ponta.
4. Conferir PWA da loja/painel e super admin conforme o pedido.
5. Implementar preview autenticado e botão “Ver loja”.
6. Seguir `docs/PORTAINER-DEPLOY.md`, ajustando para seis migrations e SMTP, e validar deploy num ambiente dedicado ao Pediu.

Atualize este handoff após cada etapa com mudanças, testes efetivamente executados e pendências concretas. Evite marcar uma proposta como funcionalidade pronta.

## Atualização final — plano do agente delivery (2026-10-07)

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
