# Pediu Agente de Impressão

Programa que fica ligado no computador das impressoras. Recebe os cupons da loja e manda para a impressora certa.

## Para o lojista
No painel, **Impressão** tem o passo a passo e a zona de download. Resumo:

1. Instale o **Node.js LTS** (nodejs.org) no computador das impressoras.
2. Baixe `pediu-agent.mjs` e `iniciar-agente-windows.bat` (ou `.sh`) e deixe os dois na mesma pasta.
3. Dê dois cliques em `iniciar-agente-windows.bat`: a **tela do agente** abre no navegador (`http://127.0.0.1:4710`).
4. No painel, **Parear agente** gera um código de 6 dígitos. Digite o endereço da loja e o código na tela do agente. Pareou uma vez, fica pareado: o agente reconecta sozinho.
5. Na tela do agente, ligue **Iniciar junto com o computador**.
6. No painel, **Puxar impressoras** traz a lista do computador; clique em **Cadastrar** em cada uma e depois ligue cada zona à sua impressora.

No Windows a impressora precisa estar **compartilhada** (Propriedades › Compartilhamento) para o agente imprimir nela.

## Comandos
```
pediu-agent                 abre a tela do agente (padrão)
pediu-agent run             só conecta e imprime, sem tela
pediu-agent pair --url … --code …   pareia pelo terminal
pediu-agent printers        lista as impressoras do computador
pediu-agent test --connection rede|windows|cups --address …
pediu-agent autostart install|remove|status
```

## Segurança da tela local
Escuta só em `127.0.0.1`, confere o cabeçalho Host (contra DNS rebinding) e exige um token que só a própria página recebe. O token de pareamento fica em `config.json` (permissão 0600).

## Desenvolvimento
`npm run agent:build` (na raiz) gera `apps/print-agent/dist/agent.mjs`. O servidor oferece esse arquivo em `/v1/downloads/` (variável `AGENT_DIST_DIR`; a imagem Docker da API já compila e aponta para ele).

## Instalador do Windows (.exe)
`compilar-exe-windows.bat` (nesta pasta) gera o `pediu-agente.exe` com o Node.js embutido (Node SEA). Rode num Windows com Node 20+ e **fora** de discos virtuais (como o Google Drive).
O arquivo (~90 MB) não vai no Git: fica como *asset* do release `agente-v<versão>` no GitHub, e a API o oferece em `/v1/downloads/pediu-agente.exe` (redireciona para `AGENT_EXE_URL`, ou serve o arquivo se ele estiver em `AGENT_DIST_DIR`).
Versão atual publicada: 0.1.0 · sha256 `c79ee7ae88aaa3087ed2d4c73c276c7ea4ad0d70090aae12e7f496a1a8ff09a9`.
Pendente: ícone da PediuLanchou no .exe (o passo `rcedit` do script precisa de ajuste) e assinatura digital (evita o aviso do SmartScreen).
