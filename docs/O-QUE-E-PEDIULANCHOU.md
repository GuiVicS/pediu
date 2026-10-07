# O que é o PediuLanchou

O **PediuLanchou** é uma plataforma de **delivery para vários restaurantes ao mesmo tempo**. Cada restaurante (loja) ganha uma vitrine própria na internet, um painel para administrar o negócio e telas de operação para a equipe (caixa, salão, entregas). O cliente pede pelo celular, a cozinha recebe o pedido e imprime o cupom, o entregador leva e o cliente acompanha tudo.

> Pense num **shopping center**: o PediuLanchou é o shopping (quem administra a plataforma); cada restaurante é uma loja dentro dele, com endereço, cardápio, equipe e clientes próprios. **Um restaurante nunca enxerga os dados de outro.**

---

## Para quem é

| Quem | O que ganha |
|---|---|
| **Dono de restaurante / lanchonete / pizzaria** | Vitrine própria com a marca dele, pedidos organizados, cardápio fácil de manter, atendimento mais rápido e sem pagar comissão por pedido a um marketplace |
| **Equipe da loja** (caixa, gerente, garçom, entregador) | Telas simples para o que cada um faz, com acesso só ao que o perfil permite |
| **Cliente final** | Pede sem baixar aplicativo, acompanha o pedido, tem conta com histórico e cupons |
| **Nossa equipe** | Um painel único para criar, publicar e monitorar todas as lojas, cobrar assinaturas e cuidar da saúde da plataforma |

---

## O que a plataforma oferece

### Para o cliente
- **Vitrine da loja** no endereço da própria loja (ex.: `burger-lab.pediulanchou.com.br`, ou um domínio próprio), com a identidade visual do restaurante.
- Cardápio com fotos, adicionais (borda, ponto da carne etc.), destaques e banners.
- Carrinho, checkout com escolha de entrega ou retirada, região de entrega com taxa e forma de pagamento (Pix, dinheiro, cartão na entrega ou pagamento online).
- **Acompanhamento do pedido** em tempo real, por link, sem precisar de conta.
- **Conta opcional**: entra com um código enviado ao e-mail, vê o histórico de pedidos e os **cupons** exclusivos dele.
- **Cupons de desconto**: o cliente digita o código no checkout (porcentagem ou valor fixo, com regras de validade e limite).
- Instalável no celular como aplicativo (PWA).

### Para o lojista e a equipe
- **Painel** com pedidos, clientes, cardápio (categorias, produtos, adicionais, destaques), aparência, banners, pagamentos, entrega, impressão, domínios, cupons e equipe.
- **PDV** (caixa): lançar pedidos de balcão e receber o pagamento.
- **Garçom**: pedidos por mesa, direto do celular.
- **Entregador**: vê as entregas prontas e marca *saiu* e *entregue*.
- **Impressão automática de cupons** por setor (cozinha, bar, caixa), com impressora reserva e reimpressão.
- **Perfis de acesso**: administrador, gerente, suporte, balcão, garçom e entregador, cada um vendo só o que precisa.
- **Pagamentos online** (Pix e cartão) pelo Mercado Pago ou Sicoob, com confirmação automática do pedido.
- **iFood**: recebe os pedidos do iFood no mesmo fluxo.
- **Cupons de desconto**: criados pelo próprio lojista, com porcentagem ou valor fixo, validade, limites e cupons só para clientes escolhidos.
- **Atendimento pelo WhatsApp** (recurso liberado loja a loja): extensão para o Chrome que trabalha dentro do WhatsApp Web, com respostas rápidas, **agente de inteligência artificial** que responde com o cardápio e os pedidos reais da loja (entende texto, áudio e imagem), atendimento humano a qualquer momento e disparos de mensagens para clientes que aceitaram receber.

### Para a nossa equipe (super admin)
- Criar lojas, dar acesso ao dono e **publicar** (a loja só vai ao ar com assinatura ativa ou uma cortesia registrada).
- **Assinaturas** e cobrança (Stripe), com suspensão automática por atraso.
- **Monitoramento**: desempenho de cada loja, alertas, saúde da API, logs e auditoria de quem fez o quê.
- **Versões**: publicar versões do aplicativo e voltar atrás por loja, se algo der errado.
- **Funcionalidades por loja**: uma lista de marcação para liberar (ou não) o atendimento por WhatsApp, o agente de IA, o modo automático, a transcrição de áudio, a análise de imagens e os disparos.
- **MCP**: uma IA (como o Claude) pode montar a loja em rascunho a partir do cardápio do cliente. Ela **nunca publica** e nunca mexe em loja que já está no ar.

---

## Como funciona (resumo)

1. A nossa equipe **cria a loja** e dá acesso ao dono. A loja nasce em *desenvolvimento* (rascunho): só a equipe da loja vê, com uma faixa de aviso.
2. O dono monta o cardápio, define horários, entrega, pagamentos, impressão e equipe. Pode conferir tudo em **Ver loja**.
3. A plataforma **publica** a loja (assinatura ativa ou cortesia). Agora o cliente consegue pedir.
4. O pedido segue o fluxo: *aguardando pagamento* (só no pagamento online) → *novo* → *em preparo* → *pronto* → *saiu para entrega* → *entregue* (ou *cancelado*).
5. A cozinha recebe a tela e o **cupom impresso**; o entregador e o cliente acompanham.

O **preço é sempre calculado pelo servidor**: o celular do cliente só informa "qual produto e quantas unidades". Isso impede que alguém altere valores.

---

## O que nos diferencia

- **Multi-loja de verdade**: dados de cada restaurante isolados por regras no próprio banco de dados, não só no código.
- **Tudo em um lugar**: vitrine, PDV, salão, entrega, impressão, pagamento, iFood e WhatsApp.
- **Marca do restaurante**: cada loja tem sua cara, seu endereço e seu domínio.
- **Sem comissão por pedido de marketplace** nos pedidos feitos pela vitrine própria.
- **IA como apoio, com controle humano**: o agente de WhatsApp só diz preço e taxa que vêm do sistema, passa para um atendente em caso de dúvida e pode ser pausado a qualquer momento.
- **Segurança**: autenticador (código de 6 dígitos) e confirmação extra para ações sensíveis do super admin; segredos criptografados; auditoria de ações importantes.

---

## Em que pé está

**Implementado e coberto por testes automáticos:** vitrine, pedidos, painel, PDV/garçom/entregador, impressão, pagamentos, iFood, clientes com conta, cupons, assinaturas, monitoramento, versões por loja, MCP, checklist de funcionalidades por loja, pré-visualização da loja em rascunho, instalação como aplicativo e o atendimento por WhatsApp (extensão, agente de IA, respostas rápidas, disparos).

**Ainda precisa de validação no mundo real** (existe no código, mas não foi testado com os serviços e aparelhos de verdade): o atendimento por WhatsApp no WhatsApp Web real, as chamadas reais à IA e ao Whisper, a instalação como aplicativo em celulares, a impressão em impressora física e o envio real de e-mails.

**Decisões já tomadas:** o cliente entra na conta **só por e-mail** (o telefone é contato do pedido); a transcrição de áudio usa **Whisper**; o nome da plataforma é **PediuLanchou**.

**Limites a conhecer:** o atendimento por WhatsApp usa o WhatsApp Web (não é o canal oficial do WhatsApp), então há risco de limitação do número, principalmente em disparos em massa; e o agente de impressão ainda não tem instalador (hoje é instalado com Node.js).

---

## Tecnologias (em uma frase cada)

- **TypeScript / Node.js** em todo o código; **Fastify** na API; **React + Vite + Tailwind** nas telas.
- **PostgreSQL (Supabase)** com **RLS** (cadeado por loja) para isolar os dados.
- **Docker + Portainer + Caddy** para colocar no ar com HTTPS automático.
- **Extensão Chrome (Manifest V3)** + **WA-JS** para o WhatsApp; **Claude** (Anthropic) para o agente; **Whisper** para áudio.
- **Mercado Pago, Sicoob, Stripe, iFood** para pagamentos e pedidos externos.

---

## Para saber mais

| Quero... | Leia |
|---|---|
| Aprender a usar e configurar tudo, do zero | [`GUIA-DIDATICO.md`](GUIA-DIDATICO.md) (ou a versão em página única `GUIA-DIDATICO.html`) |
| Instalar um cliente novo (impressora, celulares de garçom, domínio) | Parte 12 do guia didático |
| Colocar no ar no Portainer | [`PORTAINER-DEPLOY.md`](PORTAINER-DEPLOY.md) |
| Entender o plano do WhatsApp com IA | [`PLANO-EXTENSAO-WHATSAPP.md`](PLANO-EXTENSAO-WHATSAPP.md) |
| Ver o estado do trabalho e as pendências | [`../HANDOFF.md`](../HANDOFF.md) |
