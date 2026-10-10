# Uma imagem por serviço, escolhidos com --target:  api | edge | mcp
#   docker build --target api  -t pediu-api  .
#   docker build --target edge -t pediu-edge .
#   docker build --target mcp  -t pediu-mcp  .

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
# tsx (devDependency) executa o TypeScript direto; as telas precisam de vite/tailwind no build
RUN npm ci --include=dev && npm cache clean --force

# ---- build das telas ----
FROM deps AS ui
RUN npm run build -w @pediu/web && npm run build -w @pediu/platform

# ---- API (traz o super admin embutido) ----
FROM deps AS api
COPY --from=ui /app/apps/platform/dist /app/platform-ui
# agente de impressão compilado: a loja oferece o download em Impressão › Baixar o agente
RUN npm run agent:build && mkdir -p /app/agent-dist && cp apps/print-agent/dist/agent.mjs /app/agent-dist/
ENV NODE_ENV=production PORT=3000 PLATFORM_UI_DIR=/app/platform-ui UPLOADS_DIR=/data/uploads AGENT_DIST_DIR=/app/agent-dist
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=25s CMD wget -qO- http://127.0.0.1:${PORT}/health >/dev/null || exit 1
CMD ["sh", "-c", "cd apps/api && exec npx tsx src/server.ts"]

# ---- edge: serve a loja de cada domínio, na versão fixada para ela (traz o app web embutido) ----
FROM deps AS edge
COPY --from=ui /app/apps/web/dist /app/builtin/web/builtin
ENV NODE_ENV=production PORT=3200 BUILTIN_DIR=/app/builtin CACHE_DIR=/tmp/pediu-releases
RUN chown -R node:node /app
USER node
EXPOSE 3200
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT}/health >/dev/null || exit 1
CMD ["sh", "-c", "cd apps/web-edge && exec npx tsx src/server.ts"]

# ---- MCP ----
FROM deps AS mcp
ENV NODE_ENV=production PORT=3100
RUN chown -R node:node /app
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT}/health >/dev/null || exit 1
CMD ["sh", "-c", "cd apps/mcp && exec npx tsx src/server.ts"]
