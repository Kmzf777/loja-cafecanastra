# Vitrine + painel (Next 15, build standalone) do Café Canastra.
#
# CONTEXTO DE BUILD = RAIZ DO REPOSITÓRIO, não frontend/. O motivo é um import:
# frontend/lib/catalogo/produtos.ts lê ../../../data/catalogo-canastra.json,
# que vive em data/ na raiz. O webpack embute o JSON no bundle durante o build
# (o runtime não precisa do arquivo), mas na hora de compilar ele tem de estar
# no contexto. Por isso:
#
#   docker build -f frontend/Dockerfile -t canastra-web \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
#     --build-arg NEXT_PUBLIC_SITE_URL=... \
#     .
#
# ATENÇÃO — NEXT_PUBLIC_* É DE BUILD-TIME, NÃO DE RUNTIME. O Next não injeta
# process.env no navegador: ele SUBSTITUI o texto `process.env.NEXT_PUBLIC_X`
# pelo valor presente NA HORA DO `next build`. Passar essas variáveis no
# `docker run`/compose `environment` chega TARDE DEMAIS: o bundle já foi
# escrito com o valor (ou a ausência) do build. Consequência prática: mudou
# NEXT_PUBLIC_*, reconstrói a imagem. É por isso que elas entram como ARG aqui
# e como `build.args` no deploy/docker-compose.prod.yml.
#
# O frontend/.env.local NÃO participa: o .dockerignore da raiz o corta do
# contexto de propósito, para o build de produção ser determinístico — só ARG.

# ── Estágio 1: dependências ─────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# ── Estágio 2: build ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Obrigatórias — sem as duas do Supabase o build ABORTA (lib/supabase/ambiente.ts
# levanta erro nomeando a variável; melhor no build que na cara do cliente).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
# Origem pública da loja (metadata + redirectTo dos e-mails do GoTrue). Precisa
# casar com a allow-list do painel do Supabase (docs/producao.md §3.5.1).
ARG NEXT_PUBLIC_SITE_URL
# Em produção a API vive na MESMA origem, sob /api/* (docs/producao.md §2) —
# o nginx de deploy/nginx/loja.conf tira o prefixo. Por isso o default é /api.
ARG NEXT_PUBLIC_API_URL=/api
# Reservadas pelas ondas seguintes do plano mestre (checkout com cartão, GA4,
# WhatsApp). Vazias hoje: integração desligada por padrão, decisão 5 do plano.
ARG NEXT_PUBLIC_MP_PUBLIC_KEY=
ARG NEXT_PUBLIC_GA4_ID=
ARG NEXT_PUBLIC_WHATSAPP=

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_MP_PUBLIC_KEY=$NEXT_PUBLIC_MP_PUBLIC_KEY \
    NEXT_PUBLIC_GA4_ID=$NEXT_PUBLIC_GA4_ID \
    NEXT_PUBLIC_WHATSAPP=$NEXT_PUBLIC_WHATSAPP \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY data ./data
COPY frontend ./frontend

WORKDIR /app/frontend
RUN npm run build

# ── Estágio 3: runtime ──────────────────────────────────────────────────────
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

# O standalone sai DIRETO em frontend/.next/standalone/server.js — sem
# subdiretório frontend/ no meio — porque next.config.mjs fixa
# outputFileTracingRoot em frontend/ (conferido num build real em 2026-08-20).
# Se um dia aquele tracing root apontar para a raiz do repo, o caminho vira
# .next/standalone/frontend/server.js e estas três COPY mudam junto.
#
# O standalone NÃO inclui .next/static nem public/ de propósito (o desenho do
# Next supõe CDN); aqui os dois entram na imagem e o próprio server.js os serve.
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static ./.next/static
COPY --from=build --chown=node:node /app/frontend/public ./public

USER node

EXPOSE 3000

# Healthcheck na raiz: a home é prerenderizada, então responder 200 prova que o
# server.js está de pé e servindo — sem depender do Supabase estar no ar.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "server.js"]
