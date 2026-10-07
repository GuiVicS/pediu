# Planos futuros (em standby)

Itens decididos como **não implementados por enquanto**. Nada aqui existe como código; o objetivo é não perder o raciocínio quando for retomado.

## 1. Emissão de nota fiscal (NFC-e / NF-e) — standby

**Situação:** não há nada de emissão fiscal no app. O cupom impresso e o comprovante do PDV são operacionais, sem valor fiscal. A decisão do dono (2026-10-07) é adicionar a emissão **depois**, e ela deve ser **opcional, com chave liga/desliga**.

### Desenho proposto (para quando retomar)

1. **Liga/desliga em dois níveis**
   - *Super admin (por loja):* nova funcionalidade `fiscal_invoice` no checklist de funcionalidades (`packages/shared/src/features.ts`, tabela `store_features`), **desligada por padrão**. Enquanto não for liberada, o painel da loja nem mostra a área fiscal.
   - *Lojista:* tela "Nota fiscal" no painel, com chave **Emitir nota fiscal** (liga/desliga) e a configuração fiscal. Desligada = o PDV e a loja online funcionam exatamente como hoje.
2. **Emissão por provedor externo de API fiscal** (ex.: Focus NFe, eNotas, PlugNotas, Tecnospeed), e não por código próprio. Emitir NFC-e direto na SEFAZ exige certificado A1, XML assinado, contingência e regras que variam por estado. A escolha do provedor (e do plano/custo) é decisão do dono. O adaptador seguiria o padrão de `llm.ts`/`gateways.ts`: interface única, provedor trocável, falso nos testes. As credenciais ficam cifradas em `platform_settings` ou por loja.
3. **Quando emitir:** configurável por loja: ao receber o pagamento no PDV (padrão), ao fechar o pedido, ou só sob demanda (botão "Emitir nota" no pedido). Pedido pago na loja online/Pix: emitir na aprovação do pagamento.
4. **Ciclo da nota por pedido:** `pendente → autorizada | rejeitada → cancelada`, com reemissão, motivo de rejeição legível, link/PDF/XML (DANFE) e envio ao cliente por e-mail. Pedido cancelado com nota autorizada pede cancelamento fiscal (prazo legal).

### Dados fiscais que passam a ser necessários

- **Loja:** CNPJ, inscrição estadual, razão social, endereço fiscal, regime tributário (Simples Nacional, MEI, presumido, real), ambiente (homologação/produção), série e numeração, CSC e ID do CSC (NFC-e), certificado digital A1 (ou o que o provedor exigir).
- **Produto:** NCM, CFOP, origem, CEST (quando houver), CSOSN/CST e alíquotas (ICMS, PIS, COFINS) ou perfil tributário; unidade comercial.
- **Pedido:** itens com valores, desconto/cupom rateado, taxa de entrega (tratamento fiscal próprio), forma de pagamento (`paid_type` já é gravado), CPF/CNPJ do cliente na nota (opcional).
- **PDV:** pergunta "CPF na nota?" opcional; já existem `paid_type`, `payment_mode`, `payment_ref` e o turno de caixa, que ajudam na conciliação.

### Cuidados

- Validação real só com **homologação do provedor**; nenhuma nota deve ser anunciada como funcionando sem teste de emissão em homologação por estado.
- Guarda de XML por 5 anos, LGPD (CPF), auditoria de quem emitiu/cancelou, e idempotência (nunca emitir duas notas para o mesmo pedido).
- Plano/assinatura: considerar se a nota é módulo pago (já existe a estrutura de planos e de funcionalidades por loja).

### Perguntas em aberto

Qual provedor? Só NFC-e (varejo) ou também NF-e? Quais regimes tributários atender no início (provavelmente Simples/MEI)? Emissão automática por padrão ou sob demanda? Quem cadastra NCM/CFOP dos produtos (lojista ou importação)?

## 2. Outros itens em standby

| Item | Observação |
|---|---|
| Login do cliente por telefone (SMS/WhatsApp) | Hoje é só e-mail (código). Reabrir se pedirem; exige provedor de envio. |
| Integração da maquininha no PDV | Hoje a maquininha é **externa** (o operador só registra). A integração entraria como mais uma opção de "Pagar na tela", usando os mesmos campos (`paid_type`, `payment_mode`, `payment_ref`). |
| Sangria e suprimento no turno de caixa | Entradas/saídas de dinheiro durante o turno, no esperado do fechamento. |
| Taxa de serviço (ex.: 10 % na mesa) | Não existe no modelo de pedido. |
| Cupom do PDV por e-mail e PDF | Hoje só impressão e "Reimprimir". |
| Relatório de fechamento em PDF | Hoje abre a janela de impressão do navegador. |
| Vários operadores no mesmo turno | Hoje um caixa aberto por operador. |
| Seletor de período no painel | A data do topo do dashboard é só "Hoje". |
| Agente de impressão Windows (`.exe`), download da extensão WhatsApp e PWAs por área | Ver o final do `HANDOFF.md`. |
