# Checklist de testes — PediuLanchou (versão inicial)

Roteiro para testar a plataforma de ponta a ponta antes da primeira versão. Vai do **crucial** (dinheiro, pedidos e segurança) até a **enfeitaria** (visual e acabamento). Marque `[x]` ao passar e anote o problema ao lado quando falhar.

> **Prioridades**
> - **P0 — Crucial:** se falhar, não dá para abrir para clientes (pedido perdido, cobrança errada, vazamento de acesso).
> - **P1 — Importante:** operação do dia a dia (cozinha, caixa, garçom, entregador).
> - **P2 — Recursos:** integrações e diferenciais (MCP, totem, WhatsApp, iFood, PWAs).
> - **P3 — Enfeitaria:** visual, textos, responsividade, modo escuro.

---

## 0. Antes de começar

### Endereços (ambiente atual da VPS)
| O quê | Endereço |
|---|---|
| Super admin | `https://pediu.72-60-241-93.sslip.io` (definitivo: `https://api.pediulanchou.delivery`) |
| Loja (vitrine) | `https://SLUG.72-60-241-93.sslip.io` (definitivo: `https://SLUG.pediulanchou.delivery`) |
| Painel da loja | `https://SLUG.72-60-241-93.sslip.io/painel` |
| PDV / Garçom / Entregador / Totem | `…/pdv`, `…/garcom`, `…/entregador`, `…/totem` |
| MCP | `https://mcp.72-60-241-93.sslip.io/mcp` |

> As senhas **não** ficam neste arquivo. Use as que foram passadas fora do GitHub.

### O que ter em mãos
- [ ] Um computador e **dois celulares** (um faz o cliente, outro o garçom/entregador). Um tablet ajuda no teste do totem.
- [ ] App autenticador no celular (Google Authenticator, Authy…) para o super admin.
- [ ] Uma **loja de teste** (crie uma só para testar; não use a loja real).
- [ ] Para pagamentos: conta no Mercado Pago com **credenciais de teste** (`TEST-…`) — veja a seção 3.
- [ ] Anote data, aparelho e navegador quando algo falhar (ajuda muito a corrigir).

### Como registrar um problema
Para cada falha: **o que fez → o que esperava → o que aconteceu**, com print. Exemplo: *"Garçom › Mesa 3 › Pedir conta → esperava mesa roxa → ficou azul (Android, Chrome)"*.

---

## P0 — Crucial

### 1. Acesso e segurança
- [ ] **Super admin entra com e-mail + senha + código do autenticador.** No 1º acesso aparece o QR Code e 10 códigos de recuperação. *Guarde os códigos fora do computador.*
- [ ] Senha errada 5 vezes bloqueia o super admin por um tempo.
- [ ] Ações sensíveis (publicar loja, criar token do MCP) **pedem o código do autenticador de novo**.
- [ ] **Criar loja exige e-mail e senha do administrador** (sem eles o botão Criar fica desligado). Senha com menos de 10 caracteres é recusada.
- [ ] O administrador da loja entra em `/painel/entrar` **com a loja ainda em desenvolvimento**.
- [ ] Um funcionário (ex.: garçom) **não** abre telas que não são dele (tente `/painel/integracoes` logado como garçom → deve ser barrado).
- [ ] Sair (logout) realmente desloga: voltar com o botão do navegador não mostra dados.
- [ ] Abrir `/v1/staff/orders` no navegador **sem estar logado** → erro 401 (nada de dados).

### 2. Pedido da loja (vitrine → cozinha)
Faça no celular "cliente", com a loja **publicada** (super admin → loja → Publicar).
- [ ] A vitrine abre, mostra categorias, produtos, fotos e preços.
- [ ] Produto com adicionais obriga escolher o obrigatório e respeita o máximo (ex.: borda: só 1).
- [ ] Carrinho soma certo (produto + adicionais × quantidade + taxa de entrega − cupom).
- [ ] **Pedido em dinheiro** (com troco) chega no painel em **Pedidos** em segundos, com som.
- [ ] O total do pedido no painel é **igual** ao que o cliente viu.
- [ ] Loja **fechada** (fora do horário) não aceita pedido e mostra a mensagem de fechada.
- [ ] Pedido abaixo do **pedido mínimo** é recusado com a mensagem certa.
- [ ] Entrega sem endereço ou sem região é recusada.

### 3. Pagamento online (Mercado Pago — checkout transparente)
**Preparação:** no Mercado Pago Developers crie as **credenciais de teste** (Access Token e Public Key começando com `TEST-`). No painel da loja: **Integrações → Mercado Pago → Instalar**, cole as duas chaves → ligue **Pix online** e **Cartão de crédito**.

> **Cartões de teste do Mercado Pago** (confira a lista atual na documentação deles): Mastercard `5031 4332 1540 6351`, Visa `4235 6477 2802 5682`, CVV `123`, validade `11/30`, CPF `12345678909`. O **nome do titular** escolhe o resultado: `APRO` = aprovado, `OTHE` = recusado, `CONT` = pendente, `FUND` = sem saldo.

- [ ] Conectar com Access Token e Public Key de **ambientes diferentes** (um TEST, outro APP_USR) é recusado.
- [ ] O cartão aparece **dentro da loja** (formulário do Mercado Pago), **sem ir para outro site**.
- [ ] Titular `APRO` → "Pagamento aprovado"; o pedido aparece na cozinha **só depois** de aprovado.
- [ ] Titular `FUND` → mensagem "O cartão não tem limite suficiente" e **dá para tentar de novo** com outro cartão no mesmo pedido.
- [ ] Depois de uma recusa, pagar com `APRO` aprova normalmente (sem duplicar o pedido).
- [ ] Titular `CONT` → "Pagamento em análise"; o pedido fica aguardando até o Mercado Pago confirmar.
- [ ] **Pix**: aparece o QR Code e o copia-e-cola; no ambiente de teste, o pedido fica aguardando (o Pix de teste não é pago de verdade).
- [ ] No painel do Mercado Pago, o **valor cobrado é igual** ao total do pedido.
- [ ] Desinstalar o Mercado Pago (Integrações) tira Pix/cartão online do checkout.
- [ ] *(Quando o domínio da API estiver no ar)* cadastrar o **webhook** mostrado na tela do app Mercado Pago e confirmar que a aprovação chega em segundos.

### 4. Caixa (PDV) e dinheiro
- [ ] Abrir o caixa com valor inicial.
- [ ] Lançar pedido de balcão e **receber** em dinheiro com troco certo.
- [ ] Receber em cartão (maquininha) e Pix manual.
- [ ] Receber a **conta de uma mesa** encerra a comanda (a mesa fica livre no app do garçom).
- [ ] Fechar o caixa: totais por forma de pagamento batem com o que foi lançado.
- [ ] Cancelar pedido **exige motivo** e some da cozinha.

### 5. Dados e backup
- [ ] Gerar um backup manual do banco e conferir que o arquivo existe:
  `docker exec pediu-db-1 pg_dump -U postgres -d pediu -Fc > /root/teste.dump`
- [ ] O arquivo `/opt/pediu/.env` (tem a `SECRETS_KEYS`) está guardado **fora** da VPS.

---

## P1 — Importante (operação)

### 6. Painel da loja
- [ ] **Cardápio:** criar/editar/desativar categoria, produto, grupo de adicionais; marcar produto como indisponível (some ou fica cinza na vitrine).
- [ ] Enviar foto de produto (PNG/JPG até 5 MB): a foto aparece na vitrine. Arquivo que não é imagem é recusado.
- [ ] **Loja e entrega:** dados, horários, regiões de entrega (taxa e tempo), **formas de pagamento** manuais (dinheiro, maquininha, vale) e **Mesas no salão**.
- [ ] **Cupons:** cupom de % e de valor fixo, pedido mínimo, limite de uso — aplicar no checkout.
- [ ] **Equipe:** criar garçom, caixa e entregador; cada um só vê o app dele.
- [ ] **Pedidos:** mudar status (aceitar → preparo → pronto → saiu → entregue) e ver o histórico.

### 7. App do garçom (`/garcom`) — use no celular
- [ ] O mapa mostra a **quantidade de mesas** configurada em Loja e entrega.
- [ ] **Cores:** livre (tracejada), ocupada (azul), pronta para servir (verde piscando), conta pedida (roxa), parada há 40+ min (amarela), chamando pelo totem (vermelha).
- [ ] Filtros (Todas, Chamando, Servir, Conta, Ocupadas, Paradas, Livres) e busca pelo número.
- [ ] **Abrir comanda:** escolher pessoas, adicionar itens (lista grande com "+"), barra fixa embaixo "Revisar e enviar · R$", observação por item, enviar.
- [ ] Os itens chegam na cozinha/impressão.
- [ ] **Nova rodada** na mesma mesa: aparece como "Rodada 2" com horário.
- [ ] Quando a cozinha marca **pronto**, o celular do garçom **vibra** e aparece o aviso verde.
- [ ] **Pedir conta:** a mesa fica roxa e no PDV aparece "Conta pedida". Adicionar itens depois disso tira o "conta pedida".
- [ ] **Transferir** a mesa 3 para a 5: a comanda muda de mesa; transferir para mesa ocupada é recusado.
- [ ] **Pessoas:** "+/−" e o valor por pessoa.
- [ ] Dois garçons tentando abrir a **mesma mesa** ao mesmo tempo: o segundo recebe "mesa já tem comanda aberta".

### 8. Entregador (`/entregador`)
- [ ] Vê os pedidos prontos de entrega, pega um, marca "saiu" e "entregue".
- [ ] Receber na porta (dinheiro/maquininha) marca o pedido como pago.

### 9. Conta do cliente na loja
- [ ] Em **Conta**: tela de **e-mail e senha** com "**ou crie sua conta aqui**" embaixo do botão.
- [ ] Criar conta (nome, e-mail, telefone, senha de 8+) já entra logado.
- [ ] Criar conta com e-mail que já existe → "Este e-mail já tem conta".
- [ ] Senha errada → "E-mail ou senha incorretos" (a mesma mensagem para e-mail que não existe).
- [ ] 5 senhas erradas seguidas → bloqueio de 15 minutos.
- [ ] Trocar a senha em "Minha senha" (pede a atual); o outro aparelho logado sai.
- [ ] Pedido feito logado aparece em **Meus pedidos**.
- [ ] *(Só com SMTP configurado)* "Esqueci minha senha" envia o código e permite definir senha nova.

### 10. Impressão
- [ ] Zonas (cozinha, bar…) e categorias ligadas às zonas.
- [ ] *(Em espera: instalador do agente para Windows.)* Com o agente rodando, um pedido imprime na zona certa; reimprimir funciona.

---

## P2 — Recursos

### 11. Prévia de loja em desenvolvimento
- [ ] Super admin → loja → **Pré-visualizar** abre a vitrine (mesmo sem publicar).
- [ ] **Link de prévia** → copiar e abrir num celular **sem login**: a loja aparece; pedidos continuam bloqueados.
- [ ] "Trocar link" invalida o anterior; "Desligar" bloqueia.

### 12. Integrações (hub)
- [ ] Menu **Integrações** mostra os apps com logo: Mercado Pago, Sicoob Pix, iFood, WhatsApp e IA, e "Em breve": PediuPay, Nota Fiscal (NFC-e), Maquininha integrada.
- [ ] Instalar **iFood** faz o item aparecer no menu; desinstalar some.
- [ ] Instalar **WhatsApp e IA** idem.
- [ ] `/painel/pagamentos` (endereço antigo) leva para Integrações.
- [ ] *(Sicoob, se houver conta PJ + certificado A1)* conectar, registrar webhook, Pix online.

### 13. Totem de mesa (`/totem`) — use um tablet
**Preparação:** super admin → Lojas → a loja → **Funcionalidades → Totem de mesa** (ligar, pede o autenticador).
- [ ] Sem a liberação, o painel diz "não está liberado para esta loja".
- [ ] Painel → **Loja e entrega → Totens de mesa → Novo totem** (mesa 4) mostra um código de 6 dígitos.
- [ ] No tablet, abrir `…/totem`, digitar o código: aparece o cardápio **com fotos** e "Mesa 4".
- [ ] O mesmo código **não funciona duas vezes**; código errado é recusado.
- [ ] Pedir pelo totem: o pedido vai para a **comanda da mesa 4** (aparece no garçom e na cozinha).
- [ ] Pedir de novo: entra como nova rodada na mesma comanda.
- [ ] **Chamar garçom:** o app do garçom vibra e a mesa 4 fica **vermelha** "Chamando!".
- [ ] **Minha conta:** mostra só os itens da mesa 4 e o total. **Pedir a conta:** a mesa fica roxa no garçom e "Conta pedida" no PDV.
- [ ] Deixar o carrinho parado 3 minutos: ele limpa sozinho.
- [ ] Remover o totem no painel (ou desligar no super admin): o tablet para de funcionar na hora.

### 14. MCP (Claude Code)
- [ ] Super admin → **Tokens do MCP** → criar token, conectar no Claude Code (`claude mcp add …`), rodar `/mcp`.
- [ ] `criar_loja` exige `adminEmail` e `adminSenha`.
- [ ] `enviar_imagem` (base64) e `criar_link_upload` (+ comando curl) devolvem a URL da imagem, que abre na loja.
- [ ] `link_previa` devolve o link secreto da loja em desenvolvimento.
- [ ] Token **sem** "Produção" não altera loja publicada; ligando "Produção" no token, altera (e continua sem conseguir publicar/mudar status).

### 15. Apps instaláveis (PWA)
Em cada um, use "Instalar" (Android/Chrome) ou "Adicionar à Tela de Início" (iPhone/Safari):
- [ ] Loja (vitrine) — ícone da loja.
- [ ] Painel (azul), PDV (verde), Garçom (laranja), Entregador (roxo), Totem (vermelho) — **cada um com ícone e nome próprios**.
- [ ] Cada app abre **direto na sua tela**; o login acontece dentro do app (ex.: `/garcom/entrar`).
- [ ] Ter o app da loja e o do garçom instalados ao mesmo tempo, e um não abrir dentro do outro.

### 16. WhatsApp e IA / iFood
- [ ] *(Precisa de chave da Anthropic e da extensão)* agente responde com cardápio e pedidos reais.
- [ ] *(Precisa de conta iFood)* pedido do iFood entra no painel.

### 17. Domínio e HTTPS (quando o `pediulanchou.delivery` liberar)
- [ ] Registros A: `api`, `mcp` e `*` apontando para `72.60.241.93`.
- [ ] `https://api.pediulanchou.delivery` e `https://SLUG.pediulanchou.delivery` abrem com cadeado.
- [ ] Domínio próprio de loja: verificar no painel (Domínios) e o HTTPS ser emitido sozinho.
- [ ] Apagar `PREVIEW_DOMAIN` e `MCP_PUBLIC_URL` de `/opt/pediu/.env` e reiniciar.

---

## P3 — Enfeitaria (visual e acabamento)

- [ ] Cards, botões e caixas da loja com as **quatro quinas arredondadas** (raio do tema).
- [ ] Trocar cores, fonte e raio em **Aparência**: a vitrine muda e o preview do editor acompanha.
- [ ] Logo, favicon e banners aparecem nos tamanhos certos (celular e computador).
- [ ] **Celular pequeno** (360 px): nada cortado, botões fáceis de tocar, barra fixa do garçom não cobre conteúdo.
- [ ] **Tablet** deitado e em pé no totem.
- [ ] **Modo escuro** no painel e nos apps de operação: textos legíveis, cores das mesas visíveis.
- [ ] Textos sem erro de português e sem termos técnicos para o cliente.
- [ ] Estados vazios (sem pedidos, sem produtos, sem mesas) com mensagem amigável.
- [ ] Carregamentos mostram indicador (nada "travado" sem aviso).
- [ ] Logos do hub de Integrações (trocar pelas oficiais quando tiver os arquivos).

---

## Como testar sozinho (roteiro rápido de 30 minutos)

1. **Super admin:** entrar → criar a loja "Teste" com administrador → ligar *Totem de mesa*.
2. **Painel da loja** (`/painel/entrar`): 2 categorias, 4 produtos (um com adicionais e foto), 1 região de entrega, dinheiro + Pix manual, 10 mesas, horário aberto agora.
3. **Super admin:** Pré-visualizar → conferir a vitrine → Publicar (com motivo de cortesia).
4. **Celular cliente:** pedido em dinheiro → ver chegar no painel → aceitar → pronto → entregue.
5. **Mercado Pago (teste):** instalar com chaves TEST → pedido no cartão com `FUND` (recusa) e depois `APRO` (aprova).
6. **Celular garçom** (`/garcom`, usuário garçom): abrir mesa 2 com 3 pessoas → enviar itens → na cozinha marcar pronto → sentir a vibração → pedir conta → no PDV receber.
7. **Tablet:** parear totem na mesa 4 → pedir → chamar garçom → pedir a conta.
8. **Conta do cliente:** criar conta, sair, entrar com senha, errar 5 vezes.
9. **Instalar** os apps no celular e conferir os ícones.

## Testes automáticos (para quem mexe no código)

```bash
npm install --include=dev
npm run check   # tipos de todos os pacotes
npm test        # shared, api, mcp, edge… (Postgres em memória, sem internet)
```

Eles cobrem regras de negócio e segurança (preço sempre do servidor, travas do MCP, RLS, checkout transparente, totem, garçom, login do cliente). **Não** substituem o teste manual acima: tela, celular, impressora e pagamento real só se testam usando.
