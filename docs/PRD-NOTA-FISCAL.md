# PRD — Emissão de nota fiscal (NFC-e) na PediuLanchou

| | |
|---|---|
| **Status** | Rascunho para decisão do dono. **Nada deste PRD está implementado.** |
| **Data** | 2026-10-07 |
| **Autor** | Pesquisa e redação assistidas (Claude), a partir de fontes públicas e do código atual |
| **Decisão do dono (2026-10-07)** | A emissão será **opcional, com chave liga/desliga**, e deve usar a **melhor API do mercado** |
| **Aviso** | Este documento **não é aconselhamento fiscal ou contábil**. Toda regra marcada como *[a confirmar]* deve ser validada com um contador e com a SEFAZ do estado piloto antes de ir para produção. |

Legenda de confiança usada no texto: **[V]** = encontrado em fonte pública consultada nesta pesquisa (lista no fim); **[C]** = a confirmar com contador/provedor; **[S]** = suposição de produto.

---

## 1. Resumo executivo

O mercado de delivery e restaurante no Brasil trata a nota fiscal de consumidor (**NFC-e, modelo 65**) como parte do fluxo de pagamento: o sistema **emite sozinho quando o pagamento é registrado**, pede o **CPF na nota** de forma opcional e mantém o lojista longe de XML, certificado e SEFAZ. Quase ninguém emite a nota "por dentro" do próprio sistema: usa-se uma **API fiscal de terceiros** (Focus NFe, Nuvem Fiscal, TecnoSpeed/PlugNotas, NFe.io, Notaas etc.) que assina, transmite, trata contingência e acompanha as mudanças de layout.

Recomendação deste PRD:

1. Construir a emissão como **módulo opcional**, **desligado por padrão**, controlado em dois níveis (super admin libera a loja; lojista liga e configura).
2. Integrar por um **adaptador de provedor** (interface única, provedor trocável, falso nos testes), no mesmo padrão já usado para gateways e IA.
3. Começar o provedor pela **Focus NFe** (preços públicos, planos específicos de NFC-e, modelo de revenda) **condicionado a uma prova de conceito de 2 semanas em homologação** que a compare com **Nuvem Fiscal** e **Notaas** nos critérios da seção 6. A escolha final é do dono.
4. Entregar em fases: **Fase 0** prova de conceito, **Fase 1** MVP (NFC-e, Simples Nacional/regime normal, PDV e loja online, um estado piloto), **Fase 2** ampliação (outros estados, NF-e, relatórios fiscais, cancelamento guiado).
5. **Nunca bloquear a venda**: se a nota falhar, o pedido segue e a nota entra em fila de reprocesso.

Pontos que mais pesam na decisão e que mudam com o tempo (todos **[V]**, mas precisam de reconferência na data do desenvolvimento): a **Reforma Tributária (IBS/CBS)** já exige campos novos para o regime normal desde **03/08/2026** e para Simples/MEI a partir de **04/01/2027**; **delivery** com NFC-e exige **identificação do destinatário e endereço completo** (desde 03/08/2026); **Pix e cartão** têm regras estaduais de integração do pagamento ao documento fiscal.

---

## 2. Contexto e problema

Hoje o app **não emite nenhuma nota** (confirmado no código: sem NFC-e, NF-e, CNPJ, NCM, CFOP ou provedor fiscal). O cupom impresso do PDV e o comprovante são **operacionais, sem valor fiscal**. Lojas com CNPJ que vendem a consumidor final têm, em geral, obrigação de emitir NFC-e; hoje isso é feito fora do sistema (emissor do estado, outro programa, ou nada), o que:

- duplica digitação e gera erro (CPF, valores, forma de pagamento);
- impede conciliar nota × pedido × pagamento × turno de caixa;
- é um item de decisão de compra de quem já usa Saipos, Consumer, Goomer etc., que oferecem emissão integrada.

**Já existe no produto o que a nota vai reaproveitar:** `paid_type` (pix, cash, credit, debit, voucher), `payment_mode` (tela/externo), `payment_ref` (autorização/NSU da maquininha), `cash_received_cents`/`change_cents`, turno de caixa (`cash_sessions`), cupom/desconto por pedido, cliente com conta, endereço e região de entrega, funcionalidades por loja (`store_features`), cofre cifrado de configuração (`platform_settings`), padrão de adaptadores com falso nos testes.

## 3. Objetivos e não objetivos

**Objetivos**
- O lojista liga a nota, preenche um assistente fiscal uma vez, e as vendas passam a gerar NFC-e sem digitação extra.
- A nota **acompanha o pedido**: status visível no PDV e no histórico, reimpressão/segunda via, e-mail ao cliente, cancelamento guiado.
- Operar **sem risco para a venda**: falha fiscal nunca derruba checkout nem PDV.
- Custo por nota previsível e **repassável** (módulo pago ou incluído em plano).
- Auditável: quem emitiu/cancelou, quando, com qual provedor.

**Não objetivos (por ora)**
- Emitir direto na SEFAZ sem provedor (certificado A1, XML, contingência próprios).
- NFS-e (serviços), CT-e, MDF-e.
- Apuração de impostos, contabilidade, SPED, guia de pagamento.
- Substituir o contador: a configuração tributária é do contador/lojista; o produto só a guarda e valida o que for validável.

## 4. Como o mercado faz (pesquisa)

### 4.1 Padrões de produto observados

| Prática | Evidência |
|---|---|
| **Emissão automática no momento do pagamento**; em alguns sistemas só para pedido pago dentro do sistema (online, Pix/cartão por maquininha integrada) | Saipos e Teknisa descrevem NFC-e automática ao registrar o pagamento, e a limitam a pedidos pagos no sistema **[V]** |
| **CPF na nota capturado no fechamento**, preenchido da base de clientes quando possível, para evitar digitação errada | Guia de restaurante (Food Sistemas) **[V]** |
| **Contingência offline** (emitir sem autorização e transmitir depois) tratada pelo sistema/provedor | NFC-e em contingência `tpEmis=9`, transmissão em até 24 h na maioria dos estados **[V]**; Focus NFe detecta indisponibilidade da SEFAZ e entra em contingência sozinha **[V]** |
| **Cadastro fiscal por produto** (NCM, CFOP, CST/CSOSN, alíquota) como principal causa de rejeição; sistemas trazem NCM pré-cadastrado | Guia de restaurante; erros comuns: certificado vencido, cadastro incompleto, CPF errado, queda sem sincronização **[V]** |
| **Certificado digital** (e-CNPJ A1/A3) instalado/armazenado pelo sistema ou pelo provedor; vencimento é um dos erros mais comuns | Idem **[V]** |
| **Provedor fiscal terceirizado** como regra: o software não monta XML nem fala com a SEFAZ | Comparativos 2026 de Notaas/Focus/TecnoSpeed/Nuvem Fiscal **[V]** |

### 4.2 Provedores de API fiscal

Preços abaixo são de **páginas dos próprios fornecedores ou de comparativos de terceiros**; devem ser **reconferidos na contratação**.

| Provedor | O que foi verificado | Observações |
|---|---|---|
| **Focus NFe** | Planos públicos (página de preços): **Solo R$ 94,90/mês** (1 CNPJ, 100 docs, R$ 0,11/adicional); **Start R$ 119,90** (3 CNPJs); **Growth R$ 572,00** (CNPJs ilimitados, 4.000 docs, R$ 0,125/adic.); **Retail (NFC-e) R$ 62,90/mês** (1 CNPJ, 500 NFC-e + 100 NF-e, R$ 0,055/NFC-e adicional); **Retail+ R$ 657,90/mês** (CNPJs ilimitados, 9.000 NFC-e + 1.000 NF-e, R$ 0,065/NFC-e adicional); Enterprise sob consulta. Sem taxa de adesão nem fidelidade, teste de 30 dias, armazenamento de notas. NFC-e com contingência automática, controle de numeração e fila. Existe **plano de revenda** em que as empresas ficam como clientes exclusivas do revendedor **[V]** | Preços variam entre páginas/versões (outra página listou valores um pouco menores): **conferir na contratação** |
| **Notaas** | Plano de entrada R$ 49/mês, 50 notas/mês gratuitas, webhooks assinados (HMAC-SHA256), multi-tenant via API de organizações, sandbox rápido; afirma compatibilidade com a NT 2025.002 (reforma) e diz que os concorrentes estão "em homologação" **[V como alegação do próprio fornecedor; fonte interessada]** | Fornecedor mais novo; **verificar maturidade, SLA e referências** antes de depender dele |
| **Nuvem Fiscal** | Citada em todos os comparativos 2026; indicação de plano a partir de **R$ 69/mês**, cobrança por sub-conta **[V via terceiro]** | Site oficial **não foi acessível** nesta pesquisa: **preços e recursos por verificar** |
| **TecnoSpeed / PlugNotas** | API para NF-e, NFC-e, NFS-e etc.; **4.100+ software houses**, 20 anos de mercado; preço **sob consulta** **[V]** | Referência de maturidade; custo/contrato menos transparente |
| **NFe.io, eNotas, Webmania** | Citadas como opções; NFe.io tem documentação de NFC-e e de reforma tributária **[V parcial]** | **Não comparadas por falta de dados confiáveis**; incluir na prova de conceito se o dono quiser |

**Leitura:** para um SaaS multi-loja, o modelo "uma conta, vários CNPJs" (revenda/sub-contas/organizações) é o requisito estrutural. Focus NFe tem **planos de NFC-e dedicados com custo por nota baixo** (R$ 0,055 a R$ 0,065 além do pacote) e é a opção mais transparente em preço; Notaas e Nuvem Fiscal parecem competitivas e mais "developer-first", mas com **menos evidência independente**.

### 4.3 Regras fiscais que moldam o produto

| Tema | Regra / situação | Confiança |
|---|---|---|
| **NFC-e é a nota do varejo ao consumidor final**; contribuinte emite com certificado digital, cadastro na SEFAZ e CSC | Geral | **[V]** |
| **Delivery com NFC-e**: indicador de presença deve ser `1` (presencial) ou `4` (NFC-e com entrega a domicílio); outro valor gera **rejeição 717**. Com `indPres=4` é obrigatório identificar o destinatário (**rejeição 787** sem identificação). Desde **03/08/2026**, o **endereço completo do destinatário** passa a ser obrigatório na NFC-e de operação não presencial (Ajuste SINIEF 9/2026) | **[V]** (confirmar redação final e estados) |
| **NFC-e para destinatário CNPJ**: a proibição (Ajuste SINIEF 11/2025) foi **revogada em abril de 2026** (Ajuste SINIEF 12/2026) — NFC-e com CNPJ **continua permitida** | **[V]** |
| **Reforma Tributária (IBS/CBS/IS)**: NT 2025.002 altera o layout da NF-e/NFC-e; campos **CST-IBS/CBS** e **cClassTrib** obrigatórios. **Regime normal** (lucro presumido/real): homologação desde 01/07/2026 e **produção obrigatória desde 03/08/2026**, com **rejeição** se faltarem os grupos. **Simples Nacional e MEI: obrigatório a partir de 04/01/2027** | **[V]** (datas podem mudar por nota técnica; reconferir) |
| **Pix e cartão na NFC-e**: formas de pagamento mapeiam para `tPag` (cartão crédito 03, débito 04, **Pix 17**, dinheiro 01…); com **pagamento integrado** (`tpIntegra=1`) informam-se **CNPJ da credenciadora/instituição, `cAut` (autorização ou `endToEndId` do Pix), CNPJ do recebedor e terminal**; `tpIntegra=2` para não integrado. Alguns estados **obrigam a integração do Pix à NFC-e** (RS: Decreto 56.670/2023; MT: Decreto 599/2023) | **[V]** (estado piloto define o que é obrigatório) |
| **Lei 12.741/2012**: informar o valor aproximado dos tributos no documento ao consumidor | **[V]** |
| **Contingência offline**: `tpEmis=9`; transmitir em até 24 h (na maioria dos estados) | **[V]** |
| **MEI**: em regra **dispensado de emitir nota para pessoa física**; deve emitir para pessoa jurídica. Detalhes e a possibilidade de NFC-e variam por estado | **[V]** parcial → **[C]** com contador |
| **Cancelamento** de NFC-e tem **prazo e regras do estado**; não é irrestrito | **[C]** |
| **São Paulo**: o sistema **SAT** foi o modelo paulista (não é NFC-e); confirmar se a loja piloto está em estado de NFC-e | **[V]** parcial → **[C]** |

**Consequência para o produto:** o módulo precisa de **perfil fiscal por loja** (regime, CRT, estado, ambiente), **perfil tributário por produto** (inclusive os campos novos da reforma), **dados de pagamento ricos** (já temos a base) e, para delivery, **CPF e endereço completo** do cliente.

## 5. Princípios de produto

1. **Opcional e desligado por padrão.** Sem a funcionalidade liberada e ligada, o app se comporta exatamente como hoje.
2. **Nunca bloquear a venda.** Emissão é assíncrona; falha vai para fila com tentativas e alerta, não para o cliente.
3. **O provedor é detalhe de implementação.** Interface única; trocar de provedor não muda telas nem dados.
4. **Dados fiscais sob controle do lojista**, com assistente guiado e validações; o produto não "adivinha" tributos.
5. **Segurança de certificado e CPF:** certificado e chaves cifrados; mínimo de dados pessoais, retenção definida.
6. **Transparência de custo:** o lojista vê quantas notas emitiu e o que isso custa/consome do plano.

## 6. Escolha do provedor: critérios e prova de conceito

**Prova de conceito (Fase 0, ~2 semanas, em homologação)** com 2–3 provedores (sugestão: Focus NFe, Nuvem Fiscal, Notaas; TecnoSpeed/PlugNotas se o dono aceitar contrato sob consulta). Cada um emite as mesmas notas de teste.

| Critério | Peso | Como medir |
|---|---|---|
| NFC-e completa: autorização, **cancelamento, inutilização, contingência**, reenvio, DANFE/XML | Alto | Roteiro de testes por estado piloto |
| **Reforma Tributária**: aceita CST-IBS/CBS e cClassTrib; datas e comportamento já em produção | Alto | Emitir nota com os campos novos; pedir declaração por escrito |
| **Delivery**: `indPres=4`, destinatário com CPF e **endereço completo** | Alto | Emitir nota de entrega a domicílio |
| **Pagamento**: `tPag` 01/03/04/17, grupo de cartão/Pix (`tpIntegra`, `cAut`, `CNPJReceb`) | Alto | Emitir com Pix (endToEndId) e cartão (NSU) |
| **Multi-empresa/SaaS**: sub-contas ou revenda, onboarding de CNPJ e **upload de certificado por API** | Alto | Criar 2 empresas por API sem painel manual |
| **Webhooks assinados** para status final (autorizada/rejeitada/cancelada) + consulta de reconciliação | Alto | Receber e validar assinatura; reprocessar |
| **Idempotência** (mesma referência não gera duas notas) | Alto | Reenviar a mesma chave |
| Sandbox/homologação estável, SLA, suporte, documentação, SDK Node | Médio | Experiência da PoC |
| **Preço** por nota e mensalidade por CNPJ no volume esperado (seção 11) | Médio | Planilha de custo |
| Maturidade/solidez do fornecedor e referências | Médio | Clientes de porte similar |
| Portabilidade (exportar XML e dados ao sair) | Médio | Contrato/API |

Resultado esperado: tabela preenchida e recomendação final ao dono. **Se Focus NFe passar nos critérios altos, usá-la como provedor inicial** (preços e planos de NFC-e mais transparentes).

## 7. Personas e jornadas

- **Lojista (admin/gerente):** quer ligar a nota, configurar uma vez e esquecer. Precisa ver rejeições em português e saber o que fazer.
- **Operador de caixa (balcão):** não quer atrasar a fila. Pergunta "CPF na nota?" opcional; vê status da nota; reimprime.
- **Cliente final:** recebe a nota por e-mail/QR; em delivery informa CPF e endereço (já coletado).
- **Contador do lojista:** precisa do XML do mês e de um relatório fiscal.
- **Super admin (PediuLanchou):** libera a funcionalidade por loja, acompanha custo/consumo, resolve incidentes.

**Jornada de ativação (lojista):** super admin libera → lojista abre "Nota fiscal" → assistente (empresa → certificado → numeração/ambiente → produtos → pagamentos → teste em homologação) → "Ligar emissão" → vendas passam a emitir.

## 8. Requisitos funcionais

Prioridade: **P0** = MVP (Fase 1), **P1** = Fase 2, **P2** = depois.

### 8.1 Controle liga/desliga e liberação
- **F1 (P0)** Nova funcionalidade `fiscal_invoice` no checklist por loja (super admin), **desligada por padrão**; só ativa se disponível.
- **F2 (P0)** Tela "Nota fiscal" no painel do lojista (visível só com a funcionalidade liberada) com a chave **Emitir nota fiscal** (liga/desliga). Desligar não apaga nada: apenas para de emitir.
- **F3 (P0)** Ligar só é permitido com o **assistente concluído e um teste em homologação aprovado**.

### 8.2 Configuração fiscal da loja
- **F4 (P0)** Dados da empresa: CNPJ, razão social, inscrição estadual, endereço fiscal, **regime tributário (CRT)**, ambiente (homologação/produção), série e numeração gerenciadas pelo provedor.
- **F5 (P0)** **Certificado digital A1**: envio seguro (preferir enviar direto ao provedor pela API; **não guardar o arquivo em claro**), validade visível e **alerta de vencimento** (30/15/7 dias).
- **F6 (P0)** NFC-e: **CSC e ID do CSC** quando exigido pelo estado/provedor.
- **F7 (P1)** Dados de **meios de pagamento integrados**: CNPJ da credenciadora (maquininha), bandeira padrão, CNPJ do recebedor — para o grupo de cartão/Pix.

### 8.3 Cadastro fiscal dos produtos
- **F8 (P0)** Perfil tributário por produto: **NCM, CFOP, origem, CSOSN/CST ICMS, PIS/COFINS**, e os campos da **reforma (CST-IBS/CBS, cClassTrib)**; unidade comercial.
- **F9 (P0)** **Perfis prontos** (ex.: "Refeição preparada – Simples Nacional") aplicáveis a várias categorias de uma vez; **herança** categoria → produto.
- **F10 (P0)** Validação: produto sem perfil válido **bloqueia só a emissão daquele pedido** (com aviso claro), nunca a venda.
- **F11 (P1)** Busca/sugestão de NCM e importação em lote.

### 8.4 Quando e como emitir
- **F12 (P0)** Gatilhos configuráveis: **ao receber o pagamento** (padrão), ao concluir o pedido, ou **manual** (botão "Emitir nota").
- **F13 (P0)** Fontes de pedido: **PDV** (dinheiro, maquininha, Pix na tela), **loja online** (Pix/cartão online aprovado) e pedido a receber depois (emite ao receber).
- **F14 (P0)** **CPF/CNPJ na nota**: PDV pergunta de forma opcional; loja online coleta; **delivery exige identificação e endereço completo** conforme a regra vigente; valida dígitos.
- **F15 (P0)** Mapeamento de **forma de pagamento → `tPag`** a partir de `paid_type`; `payment_ref` → `cAut`; Pix na tela → `endToEndId` do gateway; indicar `tpIntegra` 1/2 conforme integração.
- **F16 (P0)** Itens, desconto (cupom rateado entre os itens), taxa de entrega e troco tratados conforme a regra fiscal; valor total sempre igual ao do pedido.
- **F17 (P0)** **Idempotência**: no máximo uma nota ativa por pedido; reenvio seguro.
- **F18 (P0)** **Contingência** delegada ao provedor; o sistema mostra "emitida em contingência" e acompanha a regularização.

### 8.5 Ciclo de vida e operação
- **F19 (P0)** Estados: `pendente → processando → autorizada | rejeitada | contingência → cancelada` (+ `erro_provedor`). Webhook do provedor + **consulta de reconciliação** periódica.
- **F20 (P0)** **Rejeição legível**: traduzir códigos comuns (ex.: 717, 787, NCM inválido, certificado vencido) em instrução; botão **Corrigir e reemitir**.
- **F21 (P0)** **Segunda via**: imprimir DANFE-NFC-e (térmica) e link/QR; **enviar por e-mail** ao cliente.
- **F22 (P1)** **Cancelamento guiado**: respeita o prazo do estado; vinculado ao cancelamento do pedido; pede motivo; registra evento.
- **F23 (P1)** **Inutilização** de numeração quando necessário (via provedor).
- **F24 (P1)** **Relatório fiscal** por período (notas emitidas, canceladas, rejeitadas, valores) e **exportação de XMLs** (ZIP) para o contador.
- **F25 (P2)** NF-e (modelo 55) para cliente CNPJ que exija.

### 8.6 PDV e telas
- **F26 (P0)** No pagamento do PDV: campo **CPF na nota (opcional)** e, na tela de pedido finalizado, um bloco **Nota fiscal** com status, DANFE e e-mail.
- **F27 (P0)** No histórico de pedidos: coluna/etiqueta de status da nota e ação "Emitir/Reemitir/Imprimir nota".
- **F28 (P0)** Painel: aba "Notas" com fila, rejeitadas em destaque e contador de pendências; alerta no sino quando houver rejeição.
- **F29 (P1)** Super admin: visão de **consumo e custo** por loja, lojas com certificado a vencer e notas com erro.

### 8.7 Auditoria e permissões
- **F30 (P0)** Permissão própria (`fiscal`) para configurar/ligar/cancelar; operador de caixa só emite/consulta.
- **F31 (P0)** Toda ação fiscal vai para a auditoria (quem, quando, pedido, provedor, resultado).

## 9. Requisitos não funcionais

- **Disponibilidade:** emissão assíncrona com fila e **retentativas com recuo**; venda nunca depende da resposta do provedor. Meta: ≥ 99% das NFC-e autorizadas em até 30 s em condições normais **[S]**.
- **Segurança:** credenciais do provedor e dados sensíveis em cofre cifrado (`platform_settings`/por loja, com a chave de `SECRETS_KEYS`); webhook **com assinatura validada**; certificado nunca em log.
- **LGPD:** CPF mínimo necessário, mascarado em telas e logs; base legal e retenção definidas; exclusão/anonimização do que não for obrigação fiscal.
- **Retenção fiscal:** guardar XML/PDF por **5 anos** (provedor + cópia nossa) **[C]**.
- **Observabilidade:** métricas por loja (taxa de autorização, tempo de emissão, rejeições por código), logs estruturados, alertas (certificado vencendo, fila parada, provedor fora).
- **Custo:** limitar reemissões automáticas para não gerar custo por nota rejeitada em laço.
- **Compatibilidade de layout:** mudanças de nota técnica ficam com o provedor; o produto só muda campos novos do perfil tributário.

## 10. Arquitetura proposta (alinhada ao código atual)

```
PDV / Loja online ──(pedido pago)──► fila fiscal (fiscal_jobs, como print_jobs)
                                        │
                                  worker fiscal ──► FiscalProvider (adaptador)
                                        │                 ├─ FocusNfeProvider
                                        │                 ├─ NuvemFiscalProvider / NotaasProvider (se aprovados)
                                        │                 └─ FakeProvider (testes)
                         webhook /v1/webhooks/fiscal/:provider  (assinatura validada)
                                        ▼
                            fiscal_documents (status, chave, XML/PDF, protocolo)
```

**Interface do adaptador** (esboço): `emitirNfce(loja, pedido) → {ref}`, `consultar(ref)`, `cancelar(ref, motivo)`, `inutilizar(faixa)`, `reenviarEmail(ref, email)`, `cadastrarEmpresa(dados)`, `enviarCertificado(empresa, arquivo, senha)`, `statusEmpresa()`.

**Dados novos (esboço de tabelas, todas com `tenant_id`/`store_id` e RLS como as demais):**
- `store_fiscal_settings` — CNPJ, IE, CRT, UF, ambiente, CSC/ID, gatilho, ligado, provedor, referência da empresa no provedor, validade do certificado, concluiu assistente/homologação.
- `product_fiscal_profiles` (+ vínculo categoria/produto) — NCM, CFOP, origem, CST/CSOSN, PIS/COFINS, CST-IBS/CBS, cClassTrib, unidade.
- `fiscal_documents` — pedido, modelo, status, série/número, chave de acesso, protocolo, XML/PDF (URL ou blob), motivo de rejeição, `idempotency_key`, tentativas, custo estimado.
- `fiscal_events` — histórico (emitida, rejeitada, cancelada, e-mail enviado) para auditoria.
- `orders` — apontar `fiscal_document_id`; guardar `customer_document` (CPF/CNPJ) com mascaramento.

**Aproveita o que existe:** `paid_type`/`payment_ref`/`payment_mode` (pagamento), `store_features` (liga/desliga), `cash_sessions` (conciliação), padrão de adaptadores (`llm.ts`, `gateways.ts`), fila e reprocesso (`print_jobs`), webhooks de pagamento (`payments.ts`), e-mail (`mailer.ts`), telemetria e alertas.

## 11. Custos, planos e precificação

**Modelo de custo (exemplo ilustrativo, com os preços públicos da Focus NFe — reconferir):**

| Cenário | Cálculo | Custo/mês |
|---|---|---|
| 1 loja, 600 pedidos/mês, plano **Retail** (1 CNPJ, 500 NFC-e incluídas) | R$ 62,90 + 100 × R$ 0,055 | **≈ R$ 68,40** |
| 20 lojas × 450 NFC-e = 9.000, plano **Retail+** (CNPJs ilimitados, 9.000 incl.) | R$ 657,90 / 20 lojas | **≈ R$ 32,90 por loja** |
| 20 lojas × 600 NFC-e = 12.000, **Retail+** | R$ 657,90 + 3.000 × R$ 0,065 = R$ 852,90 | **≈ R$ 42,65 por loja** |

Observação: o custo cresce com o **volume** de notas; só emite nota quem tem CNPJ obrigado a emitir, então o custo recai sobre as lojas que ligarem o módulo.

**Opções de preço ao lojista** (decisão do dono):
1. **Módulo pago separado** (mensalidade fixa por loja + pacote de notas), margem sobre o custo do provedor.
2. **Incluído em plano superior**, com limite de notas e excedente por nota.
3. **Repasse do custo** por nota + taxa de serviço.
Recomendação **[S]**: opção 1 ou 2, com o liga/desliga por loja controlando o consumo.

## 12. Plano de entrega

| Fase | Entregas | Aceite |
|---|---|---|
| **0 — Descoberta (≈ 2 semanas)** | Prova de conceito em homologação (seção 6); definir estado piloto e regimes; planilha de custo; decisão do provedor | Tabela de critérios preenchida e decisão do dono |
| **1 — MVP (NFC-e)** | F1–F6, F8–F10, F12–F21, F26–F28, F30–F31; 1 estado piloto; Simples Nacional + regime normal; PDV e loja online; teste em homologação por estado | **Nota autorizada em homologação** para balcão, delivery, Pix na tela e maquininha; testes automáticos com provedor falso; piloto com 1–2 lojas reais com contador acompanhando |
| **2 — Ampliação** | F7, F11, F22–F24, F29; mais estados; relatórios e exportação de XML; cancelamento guiado | Cancelamento dentro do prazo; fechamento fiscal do mês exportado |
| **3 — Depois** | NF-e (F25), MEI conforme regra, integração real de maquininha (mesmos campos), pagamento por TEF | A definir |

**Dependências:** (a) **Agente de impressão Windows em `.exe`** para imprimir DANFE-NFC-e em térmica nas lojas — **hoje não existe instalador** (só o bundle Node); até lá, entregar DANFE por PDF/QR/e-mail e impressão pelo navegador; (b) decisão do provedor e contratação; (c) contador/lojista piloto.

## 13. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Regras mudam (reforma, delivery, estados) | Rejeições e retrabalho | Provedor assume layout; perfil tributário extensível; reconferir normas a cada fase |
| Cadastro tributário errado do lojista | Notas rejeitadas ou incorretas | Assistente, perfis prontos, validações, recomendar revisão com contador |
| Certificado vencido | Notas param | Alertas 30/15/7 dias; painel do super admin |
| Provedor fora do ar / mudança de preço | Sem emissão / custo | Fila + contingência; adaptador trocável; contrato com SLA |
| Custo por nota em laço de reemissão | Gasto inesperado | Limite de tentativas; reemissão manual após rejeição de dados |
| Dado pessoal (CPF) | LGPD | Mínimo necessário, máscara, retenção |
| Pix/cartão sem dado de integração exigido pelo estado | Rejeição ou multa | Guardar `endToEndId`/NSU; campos de credenciadora; estado piloto define |
| Lojista MEI ligando a nota sem necessidade | Custo à toa / confusão | Aviso de regra e confirmação; decisão com contador |
| Expectativa de "funciona em qualquer estado" | Frustração | Lançar por estado, com lista de estados homologados |

## 14. Métricas de sucesso

- % de lojas ativas que ligaram a nota; tempo de ativação (assistente → primeira nota).
- **Taxa de autorização na primeira tentativa** (meta ≥ 95 % após estabilização **[S]**), tempo médio de emissão, % em contingência.
- Rejeições por código (top 5) e tempo para resolver.
- Notas por loja/mês e custo médio por nota.
- Chamados de suporte fiscais por loja.

## 15. Perguntas em aberto (decisões do dono)

1. **Provedor:** aprovar a prova de conceito com Focus NFe + Nuvem Fiscal + Notaas (e TecnoSpeed?).
2. **Estado piloto** e quais lojas/contador acompanham.
3. **Regimes** a atender no MVP (Simples Nacional? lucro presumido?) e política para **MEI**.
4. **Emissão padrão:** automática ao pagamento ou manual por padrão?
5. **Modelo de cobrança** ao lojista (módulo pago, incluído em plano, repasse).
6. **Dados fiscais por produto:** o lojista/contador cadastra, ou entregamos perfis prontos e importação por planilha?
7. **Quem guarda o certificado:** só o provedor (preferível) ou também cópia cifrada nossa?
8. Pedidos do **iFood**: a nota é responsabilidade do lojista fora do app ou entra no escopo? *(a pesquisa não encontrou regra consolidada)*

## 16. Fontes e limites da pesquisa

**Consultadas (todas acessadas em 2026-10-07):**
- Focus NFe — página de preços: https://focusnfe.com.br/precos/ e NFC-e: https://focusnfe.com.br/produtos/nota-fiscal-consumidor-nfce/
- Comparativo de APIs fiscais (Notaas, **fonte interessada**): https://www.notaas.com.br/blog/post/comparativo-5-apis-para-emissao-de-nfe-nfse-e-nfce-2025
- NFC-e em restaurantes (Food Sistemas): https://foodsistemas.com.br/blog/como-emitir-nfc-e-no-restaurante-sem-dor-de-cabeca/
- Saipos — NFC-e: https://saipos.com/fiscal/nf/nfce ; Teknisa — NFC-e automático: https://ajuda.teknisa.com/eattake/eattake-pedidos/nfc-e-automatico
- Reforma Tributária na NF-e/NFC-e (NT 2025.002): https://blog.tecnospeed.com.br/nota-tecnica-reforma-tributaria-nfe-nfce/ ; cronograma: https://simplifique.contmatic.com.br/blogs/cronograma-notas-fiscais-reforma-tributaria-2026 ; https://sovos.com/pt-br/blog/tributos/nf-e-e-nfc-e-com-ibs-e-cbs-na-reforma-tributaria/
- NFC-e para CNPJ e endereço em delivery (Ajustes SINIEF 9/2026, 11/2025, 12/2026): https://blog.econeteditora.com.br/nfc-e-para-cnpj-volta-a-ser-permitida-o-que-muda-agora/
- Rejeições 717 e 787 (delivery): https://www.cigam.com.br/wiki/index.php/Como_Resolver_a_Rejei%C3%A7%C3%A3o_717_-_NFC-e_em_opera%C3%A7%C3%A3o_n%C3%A3o_presencial ; https://ajuda.alterdata.com.br/spicebase/rejeicao-787-nfc-e-de-entrega-a-domicilio-sem-a-identificacao-do-destinatario-260016134.html
- Pix e cartão na NFC-e por estado: https://blog.tecnospeed.com.br/?p=20440 ; Alterdata (MT, Decreto 599/2023): https://ajuda.alterdata.com.br/shopbase/integracao-de-meios-de-pagamento-com-nf-e-e-nfc-e-sefaz-mt-decreto-n-599-2023-261143586.html
- Contingência: https://www.sefaz.pe.gov.br/Servicos/Nota-Fiscal-de-Consumidor-Eletronica/Paginas/contingencia.aspx ; https://notagateway.com.br/?p=2157
- MEI e nota para pessoa física: https://ecommercenapratica.com/blog/nota-fiscal-mei/
- TecnoSpeed PlugNotas: https://tecnospeed.com.br/en/plugdfe/plugnotas/

**Limites (o que NÃO foi verificado):** preços e recursos **oficiais** da Nuvem Fiscal, PlugNotas, eNotas, NFe.io e Webmania (site inacessível ou preço sob consulta); se cada provedor já está **em produção** com os campos da reforma; regras de **cancelamento**, **MEI** e **iFood** por estado; redação oficial do Ajuste SINIEF 9/2026. Os números de preço mudam: **refazer a cotação no momento da contratação**. A prova de conceito da Fase 0 existe justamente para fechar essas lacunas com testes reais em homologação.
