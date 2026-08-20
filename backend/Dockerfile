# API Express do Café Canastra — pagamento, webhook, frete, e-mail.
#
# Contexto de build: backend/ (ver deploy/docker-compose.prod.yml).
#   docker build -t canastra-api backend/
#
# Dois estágios: o primeiro instala dependências com toolchain disponível; o
# segundo leva SÓ o resultado. O que não entra na imagem final: npm cache,
# devDependencies (embedded-postgres, ~50 MB de binário de teste), testes.
#
# SEGREDOS NÃO ENTRAM AQUI. O backend/src/.env chega por env_file no compose
# (ou --env-file no docker run). O .dockerignore corta qualquer .env do
# contexto de propósito — imagem é artefato que circula, .env não.

# ── Estágio 1: dependências de produção ─────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
# `npm ci` instala exatamente o lockfile; `--omit=dev` deixa as
# devDependencies (embedded-postgres, nodemon) fora da imagem.
RUN npm ci --omit=dev

# ── Estágio 2: runtime ──────────────────────────────────────────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# db/ entra para permitir `docker compose exec api node db/migrar.js`
# (o runner de migração só precisa de DATABASE_URL, que já está no ambiente
# do container). O `db:seed` NÃO roda daqui: ele lê data/catalogo-canastra.json
# na raiz do REPO, fora deste contexto — o runbook (docs/deploy.md) manda
# rodá-lo do clone na VPS.
COPY db ./db

# /uploads é o fallback local de imagem quando o Cloudinary não está
# configurado (sai na F3). Criado gravável pelo usuário `node` e montado como
# volume no compose para sobreviver a recriação de container.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

# Usuário sem privilégio: a imagem oficial do Node já traz `node` (uid 1000).
USER node

EXPOSE 3333

# O /health responde 200 com banco de pé e 503 degradado — o healthcheck usa o
# fetch nativo do Node 22 em vez de instalar curl na imagem. start-period dá
# folga para o pool falar com o Postgres na primeira subida da VPS (Kong e
# banco podem estar subindo junto).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3333}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "src/index.js"]
