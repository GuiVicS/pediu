# Plano do checkout — loja online PediuLanchou

> **Status: implementado** (branch `fix/relatorio-testes-1`). Rota `/finalizar` (`apps/web/src/store/checkout/`), Resend em **Super admin › E-mail (Resend)**, endpoints `customer/exists`, `customer/link-orders` e `customer/addresses`, migration `20261017000002_checkout.sql`. Decisões tomadas: conta obrigatória no checkout; CPF só quando o gateway exige (Sicoob); retirada também pede identificação; sem SMTP/Resend o "esqueci a senha" mostra o erro do servidor. O que sobrou: ver "Pendências" no fim.

Base: 4 telas de referência do checkout da Yampi (desktop em 3 colunas; mobile em 3 telas separadas). Cobre os itens 1.1 a 1.4, 2.1, 2.2 e 2.3 do relatório de testes.

## 1. Como está hoje (`apps/web/src/store/CheckoutModal.tsx`)

- Um modal único com tudo empilhado: tipo (entrega/retirada), nome, telefone, região, endereço em **um campo de texto**, forma de pagamento em `<select>`, cupom, observação.
- Pagamento online: depois de criar o pedido abre `PixModal` (QR + polling) ou `CardModal` (Brick do Mercado Pago). Isso funciona e **não muda**.
- Conta do cliente existe (`apps/api/src/customers.ts`): registro e login por e-mail+senha, código por e-mail (`/code`, `/verify`) para "esqueci a senha", sessão em cookie. O checkout só **aproveita** a conta se o cliente já estiver logado.
- E-mail sai por SMTP (`apps/api/src/mailer.ts`, `ctx.mailer`); sem `SMTP_HOST` o código por e-mail responde 503.
- O pedido **não guarda e-mail**, só `customer_id`. É por isso que o pedido 1005 da pizzaria-do-gaucho não apareceu na conta criada depois (item 2.3).

## 2. O que a referência traz (e o que NÃO usamos)

| Referência | Decisão |
|---|---|
| Desktop: 3 cartões lado a lado (Identificação · Entrega · Pagamento) + **Resumo** à direita; etapa futura fica esmaecida | Aplicar. Etapa concluída vira resumo editável; etapa futura fica bloqueada. |
| Mobile: **stepper** no topo (1-2-3) e uma etapa por tela; resumo recolhível ("Resumo (8) R$ …") | Aplicar. |
| Selo "Pagamento 100% seguro" com cadeado no topo e no rodapé | Aplicar. |
| Pessoa física / jurídica | **Não** (só pessoa física). |
| Boleto e "5% de desconto no boleto" | **Não**. Só as formas de pagamento cadastradas em Pagamentos. |
| Frete Sedex/PAC | **Não**. A etapa Entrega só **coleta informações** (ver 3.2). |
| Cupom e observação no resumo | Já existem; passam para o painel de resumo. |
| Rodapé com dados da empresa | Usar dados da loja (nome, telefone, endereço) quando houver. |

## 3. Telas e comportamento

### 3.1 Etapa 1 — Identificação
- Campos: nome completo, e-mail, CPF (obrigatório só quando o gateway exige: hoje Sicoob), celular/WhatsApp com +55.
- **Cliente já logado:** campos preenchidos, etapa vira "Olá, Fulano" com link "não sou eu".
- **Não logado:** ao sair do campo de e-mail, o app consulta `POST /customer/exists` (item 2.2) e mostra um de dois caminhos:
  - **E-mail já tem conta:** aparece o campo **Senha** ("Entrar e continuar"). Se esqueceu, "Receber código por e-mail".
  - **E-mail novo:** aparece **Crie uma senha** (mín. 8). "Criar conta e continuar" cria a conta e já deixa logado (reaproveita `/register`, que já abre sessão).
- Sem opção de comprar como visitante: conta é necessária para acompanhar o pedido (decisão do relatório). Se quiser liberar visitante depois, é só um botão a mais.
- Botão: **Ir para Entrega**.

### 3.2 Etapa 2 — Entrega (só coleta informações)
- Escolha **Entrega** ou **Retirar na loja** (retirada pula o endereço).
- **CEP** com máscara; ao completar 8 dígitos consulta o ViaCEP e preenche rua, bairro, cidade e UF. Cliente informa número e complemento. Se o CEP falhar, os campos ficam editáveis (digitação manual).
- **Região de entrega** (`menu.zones`) continua sendo a que define a taxa. Mostrar como lista de cartões (nome, taxa, prazo), igual ao seletor de frete da referência, mas vinda da loja. Sem cálculo de frete externo.
- **Endereços salvos** da conta: lista com selecionar/editar/excluir e "+ Novo endereço" (como no mobile da referência).
- Botão: **Ir para Pagamento**.

### 3.3 Etapa 3 — Pagamento
- Cartões de seleção (radio) com as formas de `menu.payments`: Pix online, cartão online (Mercado Pago), dinheiro (com troco), maquininha na entrega, etc. Cada um com ícone e uma linha de explicação.
- Painel expandido da opção escolhida (como "Valor no Pix: R$ …" na referência) e **Finalizar compra**.
- Pix/cartão online seguem o fluxo atual (`PixModal`/`CardModal`), agora dentro da mesma página, com o selo "Processado por Mercado Pago".

### 3.4 Resumo (coluna direita no desktop, recolhível no mobile)
- Itens com +/−, cupom, observação (300 caracteres), subtotal, taxa de entrega, desconto, total.

### 3.5 Layout
- **Desktop (≥1024 px):** página inteira, não modal. Grade `[etapa 1][etapa 2][etapa 3]` + resumo. Cabeçalho com logo da loja e "Pagamento 100% seguro".
- **Mobile:** stepper no topo, uma etapa por tela, botão fixo embaixo, resumo recolhível. Voltar mantém os dados.
- Usa as variáveis de tema da loja (`t-*`), então cada loja mantém as próprias cores.
- Rota nova `/finalizar` (o modal atual abre essa rota; o carrinho continua igual).

## 4. Backend

| Mudança | Detalhe |
|---|---|
| `POST /v1/store/:slug/customer/exists` | Recebe e-mail, responde `{ exists, hasPassword }`. Rate limit forte e resposta sem dados pessoais (evita enumeração em massa; é o mesmo risco que o `/register` já aceita ao responder 409). |
| Migration: `orders.customer_email` | Guarda o e-mail (minúsculo) que o cliente informou. Índice `(store_id, customer_email)`. |
| **Vincular pedidos antigos (2.3)** | Ao registrar ou entrar (senha ou código), `update orders set customer_id = … where store_id = … and customer_email = <e-mail> and customer_id is null`. Só depois de o e-mail ser **provado**: senha correta, código recebido, ou conta criada pelo próprio cliente. Pedidos antigos sem e-mail (como o 1005) **não têm como ser vinculados automaticamente**: ver pendência 1. |
| Endereços salvos | Tabela `customer_addresses` (cep, rua, número, complemento, bairro, cidade, uf, zona preferida) com RLS igual a `store_customers`. Rotas CRUD em `/customer/addresses`. |
| Pedido recebe endereço estruturado | `address` continua texto (impressão e entregador não mudam); o front monta "Rua X, 123 - Bairro, Cidade-UF, CEP". |
| ViaCEP | Chamado **do navegador** (sem custo no servidor). Se a loja usar CSP restrita, liberar `viacep.com.br`. |

### Resend (item 2.1)
- Novo `resendMailer` implementando a mesma interface `Mailer` (HTTP `POST https://api.resend.com/emails`).
- `env`: `RESEND_API_KEY` e `MAIL_FROM`. Se `RESEND_API_KEY` existir, usa Resend; senão cai no SMTP atual; senão 503 como hoje.
- Precisa de domínio verificado no Resend (SPF/DKIM) para sair de um endereço da plataforma. **Isso é configuração sua, fora do código.**
- Usos: código de "esqueci a senha" (já existe o template `loginCodeEmail`), boas-vindas e recuperação de conta.

## 5. Ordem de execução (cada passo é um commit/entrega testável)

1. **Resend** + variável de ambiente (item 2.1). Pequeno e destrava a recuperação de senha.
2. **E-mail no pedido + vínculo** (2.3) e `customer/exists` (2.2), com testes de API: pedido sem conta → cria conta → pedido aparece; e-mail de outra pessoa não rouba pedidos.
3. **Endereços salvos** (migration + rotas + teste de isolamento por RLS).
4. **Nova página `/finalizar`**: esqueleto das 3 etapas, stepper e resumo, ainda com os mesmos campos (sem mudar regra).
5. **Etapa 1** com senha/criar conta/entrar (3.1).
6. **Etapa 2** com CEP, endereços salvos e zonas (3.2).
7. **Etapa 3** com cartões de pagamento e integração com Pix/cartão (3.3).
8. Polimento: selos de segurança, rodapé, acessibilidade (foco, teclado, leitor de tela), teste no celular real.

Estimativa: passos 1–3 são curtos; 4–7 são o grosso e podem ser entregues um por vez, mantendo o modal atual funcionando até o passo 7 trocar o botão "Finalizar" do carrinho.

## 6. Testes
- API: exists, registro vincula pedidos do mesmo e-mail, não vincula de outro e-mail, não vincula pedido já com dono, rate limit.
- SQL: RLS de `customer_addresses` (cliente A não lê endereço do B; loja A não lê da loja B).
- Front: percurso completo no navegador em 390 px e 1280 px (conta nova, conta existente, retirada, Pix, cartão, dinheiro com troco).

## 7. Pendências e decisões

0. **Aplicar a migration no banco de produção** (`20261017000001_domains_write.sql` e `20261017000002_checkout.sql`) **antes** de publicar a versão nova do web.
1. **Pedido 1005 (pizzaria-do-gaucho):** o e-mail de teste na nota está `gv671930gmail.com` (sem `@`). Se foi assim que foi digitado, o pedido nunca teve e-mail válido. Dá para vincular **manualmente** uma vez (script/SQL por número do pedido) como correção pontual.
2. **Visitante:** manter obrigatório criar conta (como pediu) ou permitir "continuar sem conta" com e-mail? O plano segue obrigatório.
3. **Retirada na loja:** pedir senha também? Plano: sim, é a mesma identificação.
4. **Sem SMTP/Resend configurado:** "esqueci a senha" não funciona. Plano: mostrar aviso claro no checkout em vez de erro.
5. **CPF:** pedir sempre (como a referência) ou só quando o gateway exigir? Plano: só quando exigir, para não aumentar abandono.
6. **Domínio de e-mail do Resend** precisa ser verificado por você (DNS).
