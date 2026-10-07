# Plano do PDV — frente de caixa PediuLanchou

Base: as 8 telas de referência em `G:\Meu Drive\pdlc\pdlc-operacao-equipe\Assets\PDV` (01 tela inicial, 02 novo pedido, 03 seleção de pagamento, 04 dinheiro e troco, 05 pedido finalizado e cupom, 06 pedidos do dia, 07 abertura de caixa, 08 fechamento de caixa) e o PDV que já existia (`apps/web/src/apps/PdvApp.tsx`).

## 1. O que o PDV já fazia (preservar)

- Venda no balcão e entrega, com adicionais, observação por item e cálculo de preço no servidor.
- Receber agora ou lançar para receber depois; dinheiro com troco calculado na tela; Pix por QR (Mercado Pago / Sicoob) com confirmação automática.
- Lista de pedidos (a receber, em andamento, hoje), avançar status, cancelar com motivo, reimprimir cupom.
- Resumo simples "Caixa de hoje" por forma de pagamento.

## 2. O que as telas de referência trazem de bom (absorver)

| Tela | Ideia aproveitada | Situação |
|---|---|---|
| 01 / 02 | Cabeçalho azul com busca; categorias como botões grandes; **cards de produto com foto**, preço e botão "+"; ticket lateral "Itens do pedido" com foto, − / + e lixeira; modos **Balcão · Retirada · Delivery**; cliente no pedido; **cupom**; "Continuar para pagamento" | Aplicar |
| 03 | Escolha de pagamento em **3 cartões grandes** (Pix, Cartão, Dinheiro) com resumo do pedido ao lado e "Cancelar pagamento" | Aplicar, com a regra do usuário (abaixo) |
| 04 | Dinheiro com **teclado numérico**, valor total, valor recebido e **troco** em destaque | Aplicar |
| 05 | Tela de sucesso, **cupom enviado por setor** (cozinha, bar, caixa) com status, atalhos: novo pedido, reimprimir, ver pedido | Aplicar (e-mail/PDF ficam para depois) |
| 06 | Histórico do dia com **busca, filtro por tipo e por status**, coluna de pagamento (Pago/Pendente) e **painel de detalhe** do pedido | Aplicar |
| 07 | **Abertura de caixa**: valor inicial, teclado, **detalhamento por cédulas e moedas**, status e dados do turno | Aplicar |
| 08 | **Fechamento**: total de vendas, ticket médio, itens, clientes, **resumo por forma de pagamento**, **conferência do dinheiro** (esperado × contado × diferença), imprimir relatório | Aplicar |

Não aproveitar agora (fora do escopo do PDV desta etapa): taxa de serviço de 10 % (não existe no modelo), "Restaurantes/Franca, SP" (multi-loja no PDV), envio do cupom por e-mail e PDF, foto do operador.

## 3. Regra de pagamento definida pelo usuário

O PDV oferece **duas famílias** de pagamento:

1. **Pagar na tela** — o cliente paga pelo QR Code do Pix mostrado no PDV (gateway Mercado Pago ou Sicoob). Confirmação automática; o pedido só fica "pago" quando o gateway aprova.
2. **Pagamento externo** — o dinheiro não passa pelo sistema, o operador só **registra**:
   - **Maquininha** (cartão de crédito ou débito). **Ainda não integrada**: o operador passa o cartão na maquininha, confirma "aprovado" e pode anotar o nº da autorização/NSU. O sistema grava o tipo (crédito/débito), a referência e quem confirmou.
   - **Dinheiro**: teclado numérico, valor recebido, troco; o troco fica registrado e entra na conferência do caixa.
   - Outras formas cadastradas pela loja (Pix manual por chave, vale-refeição) aparecem como pagamento externo.

Também existe "**Pagar depois**" (lança o pedido como a receber), como já era.

Quando a maquininha for integrada, ela vira uma terceira opção em "Pagar na tela" sem mudar o restante (mesmos campos `paid_type`, `payment_mode`, `payment_ref`).

## 4. Dados e API (o que falta no servidor)

Nova migration `20261013000001_pdv_cash.sql`:

- `cash_sessions` (turno de caixa): operador, abertura (valor e cédulas/moedas), fechamento (valor contado, esperado, diferença, observação e resumo congelado). Um caixa aberto por operador e loja.
- `orders`: `paid_type` (pix, cash, credit, debit, voucher), `payment_mode` (`tela` ou `externo`), `cash_received_cents`, `change_cents`, `payment_ref`, `paid_by`, `cash_session_id`.
- RLS por conta como nas demais tabelas; teste SQL de isolamento.

Rotas (perfil com permissão de PDV):

- `POST /v1/staff/cash/open`, `GET /v1/staff/cash/current` (turno + resumo ao vivo), `POST /v1/staff/cash/close`.
- `POST /v1/staff/orders/:id/pay` passa a aceitar `mode`, `receivedCents`, `reference`; o lançamento (`POST /v1/staff/orders`) aceita os mesmos campos junto de `receiveNow`, mais `couponCode` e `customerId`.
- `POST /v1/staff/coupons/check` (prévia do desconto, mesmas regras da vitrine).
- `GET /v1/staff/print/orders/:id/jobs` (status do cupom por setor para a tela de sucesso).
- Pagamentos aprovados pelo gateway passam a gravar `paid_type = pix` e `payment_mode = tela`.

Regras: troco só em dinheiro; valor recebido menor que o total é recusado; fechar caixa exige o valor contado; o esperado em dinheiro = abertura + vendas em dinheiro do turno (o troco já saiu do caixa); cancelamentos/estornos aparecem em linha própria e não entram nas vendas.

## 5. Telas (apps/web/src/apps/pdv)

`PdvApp` vira um conjunto de telas com cabeçalho azul próprio e navegação **Caixa · Pedidos · Turno**:

1. **Venda** — categorias, cards com foto, ticket com modo (Balcão/Retirada/Delivery), cliente, cupom, total e "Continuar para pagamento".
2. **Pagamento** — três cartões: *Pix na tela*, *Maquininha (externo)*, *Dinheiro (externo)*, resumo do pedido, "Pagar depois" e "Cancelar pagamento".
   - Dinheiro: teclado numérico, recebido, troco.
   - Maquininha: crédito/débito, referência opcional, "Maquininha aprovou".
   - Pix na tela: QR + copia-e-cola + contagem regressiva, confirmação automática.
3. **Sucesso** — pedido, forma de pagamento e detalhes, cupom por setor, ações.
4. **Pedidos** — busca, filtros (tipo e status), tabela e painel de detalhe com ações (imprimir, avançar, receber, cancelar).
5. **Turno** — abrir caixa (teclado + cédulas/moedas) e fechar caixa (resumo por forma, conferência, relatório).

Mantém: PWA, cores da plataforma, modo escuro, uso em tablet/celular (as colunas empilham).

## 6. Ordem de execução e aceite

1. Banco + API + testes (caixa, pagamento externo/na tela, cupom e cliente no PDV, jobs de impressão).
2. Componentes da venda e do pagamento; depois sucesso, pedidos e turno.
3. Verificação no navegador com a loja de demonstração e um fluxo completo: abrir caixa → vender → pagar (dinheiro, maquininha e Pix) → fechar caixa.

Aceite: cada forma de pagamento grava o tipo e o modo; o fechamento bate com as vendas do turno; nenhum fluxo antigo (receber depois, cancelar, reimprimir) deixa de funcionar; testes automáticos de API e SQL passando.

## 7. Fora do escopo desta etapa (próximos passos)

Integração real da maquininha; sangria e suprimento durante o turno; taxa de serviço; envio do cupom por e-mail/PDF; fechamento por vários operadores; relatório de turno em PDF.
