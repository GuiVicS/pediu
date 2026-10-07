# Lista de testes a rodar sob comando

Nada abaixo foi executado durante o desenvolvimento desta fase (a pedido: construir primeiro, testar depois).
Cada bloco diz **o que testar**, **como** e **o que esperar**. Marque conforme for rodando.
Convenção: `[auto]` = vira teste automatizado (ainda a escrever) · `[manual]` = você ou eu rodamos à mão · `[real]` = exige conta/hardware de verdade.

## 0. Base (já existia antes desta fase) — ATENÇÃO: a suíte NÃO foi rodada depois das mudanças
A fase de telas/impressão/pagamentos/iFood/versões alterou código usado pelos testes antigos (status `aguardando`, `insertOrder`, rotas de pedido, schemas). Rode a suíte inteira primeiro e corrija o que quebrar antes de seguir.

- [ ] [auto] `npm test` — 24 + 53 + 14 testes e os 2 testes SQL continuam passando depois das mudanças desta fase.
- [ ] [auto] `node packages/db/scripts/run-sql-tests.mjs` — aplica as 5 migrations (a 0005 é nova) e roda os testes de isolamento.

## 1. Banco (migration 0005)
- [ ] [auto] Aplicar `20261009000001_ops_print_pay_ifood.sql` sobre as anteriores (a compilação foi conferida; falta rodar os testes).
- [ ] [auto] Ampliar `rls_orders.sql`: `printers`, `print_jobs`, `store_gateways`, `order_payments`, `ifood_*` isolados por conta; MCP e anon sem acesso.
- [ ] [auto] `store_gateways`: a API de loja **não** consegue ler `credentials_enc` (só id/status/meta).
- [ ] [auto] `orders.status = 'aguardando'` aceito; índice único `external_ref` impede pedido iFood duplicado.
- [ ] [auto] `app.agent_pair`: código só vale uma vez e antes de expirar; `app.agent_auth` recusa agente revogado.

## 2. Impressão por zonas (apps/api/src/printing.ts, packages/escpos, apps/print-agent)
- [ ] [auto] **Cupom**: acentos em CP860/CP850/CP437 (ação, coração, pão, Ç/Ã/Õ); caractere sem equivalente vira `?`; `—` e aspas viram ASCII.
- [ ] [auto] **Cupom**: quebra de linha sem partir palavras nas colunas 32/42/48; `row()` alinha o preço à direita; nome grande demais quebra; QR code gera os comandos `GS ( k`.
- [ ] [auto] **Cupom por zona**: cozinha vê só os itens da própria zona e **sem preços**; zona com `showPrices` (caixa/expedição) vê o pedido inteiro com total, troco e QR do Pix; cancelado vem em destaque com o motivo.
- [ ] [auto] **Jobs**: pedido novo gera 1 job por zona com impressora; zona sem impressora não gera job e registra aviso; item de categoria sem zona vai para a zona padrão; sem zona padrão avisa no log.
- [ ] [auto] **Dedupe**: criar o pedido já em "preparo" (PDV com `receiveNow`) **não imprime duas vezes**; reenviar o mesmo evento não duplica; `items_added` só imprime os itens novos.
- [ ] [auto] **Cópias**: `copies` da impressora repete o cupom no mesmo job.
- [ ] [auto] **Agente**: parear com código (uso único, expira em 10 min); WebSocket recusa token inválido/revogado; revogar derruba a conexão na hora.
- [ ] [auto] **Entrega/confirmação**: job enviado → `enviado`; ack ok → `impresso`; ack com erro → volta a `pendente` e conta tentativa.
- [ ] [auto] **Sem confirmação em 15 s** reenvia; **3 falhas** na principal → troca para a impressora reserva (e avisa na tela e no log); sem reserva → `falhou` + log de erro (vira alerta).
- [ ] [auto] **Agente offline**: job espera 45 s, tenta a reserva, e desiste em 3 min com aviso.
- [ ] [auto] **Fila local do agente**: job já impresso (ack perdido) só é confirmado de novo, nunca impresso em dobro.
- [ ] [auto] **Reimprimir** (todas as zonas ou uma) e **imprimir teste** funcionam; só perfis autorizados.
- [ ] [auto] **Isolamento**: agente da loja A não recebe job da loja B; impressora de outra loja é recusada.
- [ ] [real] **Impressora física** Elgin i9 / Epson TM-T20 / Bematech MP-4200 em rede (9100) e via compartilhamento do Windows: acentos, corte, gaveta, QR, 58 e 80 mm.
- [ ] [real] **Queda de internet** de 2 min no meio de uma rajada de 200 pedidos em 3 zonas: nada perdido nem duplicado.
- [ ] [manual] Instalar o agente no Windows (`pediu-agent pair/run`), iniciar com o Windows e reconectar sozinho.

## 3. Pagamentos
- [ ] [auto] **Mercado Pago Pix**: cria cobrança com `external_reference` = id do pagamento; confirma só se o valor bate; webhook com assinatura inválida é recusado; evento repetido não confirma duas vezes.
- [ ] [auto] **Webhook não confia no corpo**: sempre reconsulta o provedor com a credencial da loja; pagamento de outra loja é ignorado.
- [ ] [auto] **Pedido online**: nasce `aguardando` (cozinha não vê, não imprime); ao confirmar vira `novo` e imprime; recusado/expirado cancela sozinho.
- [ ] [auto] **Pagamento aprovado depois de cancelado**: não reativa o pedido e gera log de erro "ESTORNAR".
- [ ] [auto] **Conciliação** (a cada 30 s) confirma o que o webhook perdeu e expira os vencidos.
- [ ] [auto] **Sicoob**: token mTLS + cobrança `PUT /cob`; webhook reconfirma com `GET /cob`; só `CONCLUIDA` confirma.
- [ ] [auto] **Credenciais**: validadas antes de gravar, guardadas cifradas, nunca devolvidas; apagar o gateway desliga as formas online dele.
- [ ] [auto] **PDV**: cobrar pedido por Pix mostra o QR; estornar (Mercado Pago) exige a permissão certa.
- [ ] [real] **Mercado Pago**: usuários de teste; Pix de R$ 1 em produção confirma sozinho e imprime; cartão (Checkout Pro) aprova e volta.
- [ ] [real] **Sicoob**: Pix de produção de R$ 1 (o sandbox não confirma pagamento); registrar o webhook.

## 4. iFood
- [ ] [auto] **Polling** a cada 30 s com ack só depois de tratar; evento repetido não cria pedido duplicado (`external_ref` único).
- [ ] [auto] **Pedido PLC → pedido interno** com itens mapeados por `externalCode` (zona de impressão vem do produto mapeado); item sem mapeamento avisa no log e vai para a zona padrão.
- [ ] [auto] **Total do iFood manda**: diferença vira taxa ou desconto; pago online entra como `paid`.
- [ ] [auto] **Cancelamento pelo iFood (CAN)** cancela o pedido interno e imprime "CANCELADO".
- [ ] [auto] **Ações de volta**: aceitar → confirm + startPreparation; pronto (retirada) → readyToPickup; saiu → dispatch; cancelar → motivos + requestCancellation; falha do iFood não desfaz a mudança local e devolve aviso.
- [ ] [auto] Evento de loja não vinculada é confirmado e ignorado; falha por 10 min é confirmada para não travar a fila.
- [ ] [real] **Homologação oficial do iFood** com a loja de teste (polling 30 s, ack, confirmar, cancelar, endereço, código de coleta).

## 5. Versão por loja, domínio e web-edge
- [ ] [auto] `resolveVersion`: pin vence canal; sem pin usa a mais nova do canal (beta vê beta e estável; estável só estável); pin para versão inexistente cai no canal; `1.10.0 > 1.9.0` e `1.0.0-beta < 1.0.0`.
- [ ] [auto] **Duas lojas, duas versões** (1.0.0 e 1.10.0) servidas ao mesmo tempo pelo edge, cada uma com o seu `index.html` e assets.
- [ ] [auto] **Rollout** por percentual é estável (mesma loja, mesmo balde), não rebaixa loja que já está em versão mais nova, `dryRun` não grava; **rollback** = fixar a versão antiga.
- [ ] [auto] **Edge**: domínio desconhecido → 404 amigável; API fora do ar → usa o último valor conhecido por 10 min, depois 503; caminho com `..` recusado; cache imutável só em `assets/`; `/v1/platform`, `/v1/edge` e `/v1/webhooks` **não passam** pelo domínio da loja.
- [ ] [auto] **Domínio próprio**: TXT `_pediu-verify.<domínio>` correto verifica; errado/ausente recusa com a explicação; domínio da plataforma é reservado; limite de 5; duplicado recusado; `tls-check` só aprova domínio verificado.
- [ ] [real] Apontar um domínio de verdade (CNAME + TXT), ver o HTTPS emitir sozinho (Caddy on-demand TLS) e a loja abrir.

## 6. Catálogo, uploads e tempo real
- [ ] [auto] Coleções do painel: criar/editar parcial/apagar para as 9; referência de outra loja recusada (422); `groupIds` do produto; zona de impressão padrão é uma só por loja.
- [ ] [auto] Permissões: garçom/entregador não editam cardápio; `admin.loja` vs `admin.cardapio`.
- [ ] [auto] **Upload**: PNG/JPEG/WebP/GIF; recusa tipo errado, > 5 MB e arquivo cujo conteúdo não bate com o tipo; só admin/gerente.
- [ ] [auto] **SSE** (`/v1/staff/stream`): evento de pedido chega só para a equipe da própria loja; sem dados pessoais no evento; heartbeat.
- [ ] [auto] Nada de super admin / webhook acessível pelo domínio da loja.

## 7. Telas (rodar no navegador)
- [ ] [manual] **Super admin**: login com autenticador, step-up, lojas, publicar, tokens do MCP, assinaturas, alertas, logs, desempenho, versões.
- [ ] [manual] **Painel do lojista**: todos os menus; salvar tema aparece na loja; upload de imagem; zonas de impressão e impressoras; pagamentos online; iFood; domínios; equipe.
- [ ] [manual] **Loja**: cardápio, adicionais, carrinho, checkout dinheiro / Pix online / cartão, acompanhamento em tempo real, loja fechada.
- [ ] [manual] **PDV, garçom e entregador**: fluxo completo de um turno; pedido novo toca e aparece sem recarregar.
- [ ] [manual] Celular: loja, garçom e entregador usáveis (toque, teclado, PWA instalável).

## 8. Compilação e build (já conferidos — repetir depois de qualquer mudança)
- [x] `npm run check` (tipos de todos os pacotes) passou ao fim da fase.
- [x] `npm run build -w @pediu/web` e `npm run build -w @pediu/platform` geram o bundle.
- [ ] `docker build --target api|edge|mcp .` (nunca executado).
- [ ] `npm run release:web -- 0.0.1` com `RELEASES_DIR=/tmp/r` copia o build e recusa repetir a versão.

## 9. Riscos que eu mais suspeito (começar por aqui)
1. **Edge → API**: `API_URL`/`EDGE_SECRET`, cabeçalho `x-forwarded-host`, cookie de login do domínio da loja, SSE e WebSocket passando pelo `@fastify/http-proxy`.
2. **Migration 0005 num Supabase real** e `grant … to postgres` / login de roles pelo pooler.
3. **Webhooks**: formato real do `x-signature` do Mercado Pago e do corpo do webhook Pix do Sicoob.
4. **iFood**: campos reais de `payments.methods`, `delivery.deliveredBy` e valores (`total.benefits`) — escrevi pelo que a documentação indica.
5. **Agente no Windows**: `copy /b arquivo \\localhost\COMPARTILHAMENTO` envia bytes crus? (depende do driver/spooler; se não, usar porta de rede 9100 ou RAW via `print /d:`).
6. **Cupom**: `GS ( k` (QR) e `GS V 66 3` (corte) em modelos específicos; `ESC B` (beep) só em quem tem buzzer.


## 10. Atendimento WhatsApp, preview e PWA (adicionado em 2026-10-07)
Legenda como acima. Os `[auto]` já existem e passam (`apps/api/test/whatsapp.test.ts`, `extension.test.ts`, `staff-orders.test.ts`, `apps/whatsapp-extension/test`, `apps/web-edge/test`, `packages/db/supabase/tests/rls_whatsapp.sql`). Os itens abaixo são o que **ainda falta validar no mundo real**.

- [ ] [real] **WhatsApp Web real** com conta de teste: a extensão carrega, o painel azul aparece, `chat.new_message` entrega texto/áudio/imagem, ids `@lid`, baixar áudio e imagem, enviar texto. Anotar a versão do WhatsApp Web e confirmar a compatibilidade com o WA-JS 4.6.1.
- [ ] [real] **Reconexão**: fechar/reabrir o WhatsApp Web, dormir/acordar o computador, o service worker encerrado: a ponte volta sozinha e nada é enviado em dobro.
- [ ] [real] **Claude (agente)**: chave real; respostas de qualidade para pedido, taxa, horário, reclamação; tentativas de injeção ("ignore as regras...") não funcionam; comprovante de pagamento chama humano; custo por conversa.
- [ ] [real] **Whisper**: áudio OGG/Opus do WhatsApp (curto, longo, com ruído, silêncio); limite de ~5 MB; português.
- [ ] [real] **Modo automático**: só depois de dias em modo assistido; mensagem nova durante o processamento descarta a resposta antiga; atendente escrevendo pausa o agente.
- [ ] [real] **Disparos**: poucos contatos de teste que aceitaram; ritmo de 1 a cada ~20 s; fechar o Chrome no meio e conferir que nada é reenviado (ficam "incertos"); observar sinais de limitação do número.
- [ ] [manual] **Rascunho de pedido**: abrir o link `?rascunho=` no celular: itens e adicionais corretos no carrinho, preço final recalculado no checkout; link vencido (24 h) abre a loja normalmente.
- [ ] [manual] **Preview**: com a loja em `desenvolvimento`, entrar como equipe e abrir a vitrine (faixa amarela, checkout desativado); sem login e com a equipe de outra loja deve dar "não encontrada"; depois de publicar, a faixa some.
- [ ] [real] **PWA** em Android (Chrome) e iPhone (Safari): instalar a vitrine, o painel, `/garcom`, `/entregador`, `/pdv` e o super admin; cada um abre direto na própria tela, em tela cheia; ícone da marca; reinstalar depois de atualizar; sessão vencida volta ao login.
- [ ] [manual] **Responsividade e modo escuro** dos guias (`docs/GUIA-DIDATICO.html` e `docs/index.html`) em Safari/iPhone e em telas pequenas.
