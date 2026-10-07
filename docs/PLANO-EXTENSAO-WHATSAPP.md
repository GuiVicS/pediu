# Plano — agente de atendimento delivery pela extensão

Atualizado em 2026-10-07. Planejamento concluído; implementação pendente.

## Escopo confirmado

Um agente de atendimento para delivery conectado à plataforma pela sessão do lojista. Usa o WhatsApp Web já logado, consulta catálogo e pedidos reais, entende texto, transcreve áudio e analisa imagens. O operador pode revisar respostas e assumir a conversa. O super admin habilita as funcionalidades disponíveis para cada loja por checklist.

Primeiro entregar atendimento assistido, depois automático opcional. Disparos e respostas rápidas permanecem no pedido original; disparos são complemento posterior, sem transformar o projeto em CRM.

## Onde Claude parou

A sessão `ef411d89-dcec-46eb-8ae2-c9e532876881` recebeu o pedido enquanto trabalhava em clientes/rodapé e encerrou por limite de uso após iniciar os testes. Não foi encontrada análise da Orbita, consulta ao WA-JS ou planejamento da extensão nesse histórico.

Este plano foi criado após nova análise estática da Orbita local, do Pediu e da documentação oficial. Nenhuma extensão Pediu foi implementada e nenhuma mensagem foi enviada.

## Referências analisadas

Orbita: `C:\Users\thnkad\Documents\extensão\Orbita-Extensao`, versão 1.25.1.

| Arquivo | O que foi observado |
|---|---|
| `manifest.json` | Manifest V3, WA-JS no contexto MAIN, content scripts isolados e background |
| `js/content_script.js` | Ponte de comandos, request id, timeout, porta runtime, reconexão e mídia em partes |
| `js/quick-replies-page.js` | Conversa ativa e envio de texto, arquivos e áudio |
| `js/chat-page.js` | `chat.new_message`, envio e download de mídia, transporte em chunks |
| `js/chat-common.js` | IndexedDB e operações de transcrição |
| `js/chat-transcribe.js` | Transcrição por provedores, validação de arquivo, timeout e retry |
| `js/service_worker.js` | Trechos de campanhas com ritmo, estado RUNNING e próximo envio persistido |

A Orbita já tem transcrição de áudio. A busca dirigida não confirmou análise de imagem nos arquivos de IA examinados; não foi auditoria integral da extensão. Visão é requisito explícito deste plano. Não copiar credenciais ou dados da referência.

## Sessão e funcionamento

1. Lojista entra no painel e conecta a extensão à sua loja por pareamento de uso único aprovado na sessão autenticada.
2. Backend vincula dispositivo, sessão, usuário e loja. A extensão recebe credencial restrita; não copia o cookie HttpOnly `pediu_staff`.
3. Extensão recebe mensagens da conversa pelo WA-JS e solicita resposta ao backend com contexto autorizado da loja.
4. Backend consulta catálogo/pedido e processa áudio ou imagem quando necessário. Chaves de IA ficam no servidor.
5. Resposta aparece para revisão ou é enviada quando o modo automático estiver habilitado. Atendente pode pausar e assumir.
6. Logout, expiração/revogação da sessão, troca de loja ou desativação do recurso interrompem atendimento. Revalidar antes de enviar.

A ponte do WhatsApp aceita só comandos limitados de mensagens/mídia e não recebe credenciais Pediu. Contexto MAIN não é uma fronteira confiável para segredos. Persistir tarefas e recuperar após encerramento do service worker; processamento longo ocorre no backend. Atendimento depende de navegador e WhatsApp Web disponíveis.

## Catálogo, clientes e pedidos do Pediu

- `apps/api/src/menu.ts`: produtos ativos, disponibilidade, preços, imagens, adicionais obrigatórios/min/max, zonas/taxas/ETA e pagamentos.
- `apps/api/src/orders.ts`: horários, pedido mínimo, validação dos itens, preço calculado no servidor, checkout, status e acompanhamento.
- `apps/api/src/customers.ts`: clientes e histórico por loja. Telefone atual é contato não verificado; não liberar histórico só pela coincidência de número.
- `apps/api/src/staff.ts` e `apps/web/src/lib/session.tsx`: sessão, tenant, loja e permissões do lojista.

Ferramentas do agente: consultar loja/cardápio, buscar produto/adicionais, calcular orçamento, consultar pedido vinculado, montar rascunho e chamar atendente. O backend determina tenant/loja pela credencial e valida cada ação.

Primeira versão monta rascunho e link de checkout. Criação direta depois exige confirmação do cliente, idempotência e reutilização das regras do checkout. Não duplicar preço/taxa no prompt. Não marcar pagamento recebido pelo relato do cliente.

Confirmar vínculo entre conversa WhatsApp e cliente antes de consultar histórico privado. Tratar ids/LID sem assumir telefone disponível. Login por telefone e cupons ainda não foram implementados no Pediu; o agente só os oferece quando existirem e estiverem liberados.

## Transcrição de áudio

Receber mensagem → baixar mídia pelo WA-JS → transportar partes com limite → upload autenticado → tarefa no backend → transcrição → mostrar texto e usar na conversa.

Suportar OGG/Opus e validar formato/tamanho/duração conforme provedor escolhido. Testar ruído, silêncio, arquivo inválido, timeout e retry limitado. Texto deve ser revisável. Se produto, quantidade ou endereço forem ambíguos, perguntar ao cliente antes de confirmar pedido. Definir retenção/exclusão de mídia temporária e não registrar áudio integral em logs.

## Análise de imagens

Usar o mesmo transporte e tarefa no backend, com validação de formato/tamanho e modelo com visão. Casos iniciais:

- Foto de produto: sugerir correspondência no catálogo e confirmar.
- Print/cardápio: extrair itens, mas consultar preço atual no Pediu.
- Foto de endereço: extrair texto e pedir confirmação de endereço/zona.
- Reclamação: resumir e encaminhar ao atendente.
- Comprovante: ajudar na leitura; confirmação de pagamento continua pelo gateway ou operador autorizado.

Mostrar dúvidas; imagem ilegível não gera certeza. Texto em áudio/imagem é conteúdo do cliente, não autorização para ferramentas administrativas.

## Checklist por loja no super admin

Adicionar “Funcionalidades disponíveis” ao detalhe da loja em `apps/platform/src/pages/Stores.tsx`, com marcadores para atendimento WhatsApp, respostas rápidas, agente IA, respostas automáticas, transcrição, análise de imagens, montagem de pedido e disparos posteriores.

Função ainda não implementada aparece indisponível para ativação. Liberação do recurso e estado da conexão são informações distintas. Respostas automáticas dependem de agente IA habilitado.

Persistir por loja no banco; alteração exige super admin, step-up e auditoria. Backend aplica a autorização em consulta, processamento e envio. Ao desmarcar, interromper tarefas pendentes do recurso. A base já tem `modules` em planos; conferir seu uso e definir como combinar plano e liberação por loja, evitando fontes contraditórias.

## Plano de ação

| Etapa | Entrega | Critério de aceite |
|---|---|---|
| 1 | Extensão básica WA-JS e ponte | Conta de teste recebe texto/áudio/imagem e reconecta |
| 2 | Pareamento com sessão e checklist no super admin | Logout/revogação/desmarcação bloqueiam; lojas isoladas |
| 3 | Catálogo, respostas rápidas e pedidos autorizados | Preços/adicionais/taxas/status reais; histórico protegido |
| 4 | Agente assistido com áudio e imagens | Respostas revisáveis; ambiguidade gera pergunta |
| 5 | Rascunho/link de checkout | Horário, mínimo, disponibilidade e adicionais validados |
| 6 | Automático opcional e atendimento humano | Operador pausa agente; mensagem própria não cria loop; resposta obsoleta cancelada |
| 7 | Disparos complementares | Prévia, pausa e recuperação; envio incerto não repetido automaticamente |

Criar `apps/whatsapp-extension` e módulo próprio da API. Definir contratos e migrations para vínculos de sessão/dispositivo, liberações por loja, conversas/mensagens, templates e tarefas IA/mídia. Aplicar RLS e reutilizar auditoria/criptografia existentes. Escolher adaptadores de IA ao implementar; nenhum provedor foi fixado neste plano.

Testes necessários: isolamento entre lojas/tenants, replay de pareamento, encerramento do service worker, dupla aba, falha de mídia, áudio ambíguo, imagem ilegível, preço alterado, takeover, instrução maliciosa em conteúdo e comprovante que não confirma pagamento.

Critério final: lojista conectado atende cliente por texto/áudio/imagem, com catálogo e pedidos reais, pode assumir a conversa e só usa funcionalidades liberadas no super admin.

## Fontes oficiais

- [WA-JS](https://github.com/wppconnect-team/wa-js).
- [Download de mídia](https://wppconnect.io/wa-js/functions/chat.downloadMedia.html).
- [Envio de arquivo/áudio](https://wppconnect.io/wa-js/functions/chat.sendFileMessage.html).
- [Content scripts Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).
- [Ciclo do service worker](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

Documentação WA-JS consultada identifica v4.6.1; fixar versão e testar readiness, eventos e ids antes de implementar. `chat.new_message` foi observado na Orbita; confirmar payload na versão escolhida. A referência Orbita permanece local e não acompanha o Git.

Próxima ação: executar etapa 1 e seguir este escopo, registrando entregas e testes no handoff.
