# Domínios das lojas — o que cada hospedagem permite

O edge resolve qualquer domínio verificado para a loja certa, mas o **HTTPS** de cada domínio depende de quem fica na frente:

| Onde você hospeda | Domínio padrão `loja.seudominio.com.br` | Domínio próprio do cliente |
|---|---|---|
| **Docker + Caddy** (`deploy/`) | automático (wildcard ou on-demand) | **automático**: o Caddy pergunta à API (`/v1/edge/tls-check`) e emite o certificado no primeiro acesso |
| **Easypanel (Traefik)** | um domínio wildcard configurado no Easypanel (`*.seudominio.com.br`, exige DNS por API para o certificado) | **manual**: cada domínio novo precisa ser adicionado ao serviço `edge` no painel do Easypanel |
| **Cloudflare na frente** (Cloudflare for SaaS) | automático | automático (Custom Hostnames) — exige configurar o fallback origin e o plano do Cloudflare; **não está automatizado neste código** |

Recomendação honesta: se você vai ter muitos domínios de clientes, use o Caddy (ou o Cloudflare for SaaS) na frente. Com Easypanel puro, cada domínio próprio vira uma tarefa manual sua.

Fluxo do lojista (igual em todos): Painel → Domínios → adicionar → criar o CNAME e o TXT que a tela mostra → Verificar. A verificação é feita pela API (consulta o TXT `_pediu-verify.<domínio>`).
