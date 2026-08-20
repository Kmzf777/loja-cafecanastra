/**
 * Produção SEM Docker: PM2 gerenciando os dois processos Node, com o nginx do
 * sistema na frente (deploy/nginx/loja.conf — trocando `api:3333`/`web:3000`
 * por 127.0.0.1, como o cabeçalho de lá explica).
 *
 * Pré-requisitos (o passo a passo completo é docs/deploy.md):
 *
 *   1. Node 22 e `npm i -g pm2` na VPS.
 *   2. `npm --prefix backend ci --omit=dev` (o Express roda do node_modules).
 *   3. `backend/src/.env` preenchido (com NODE_ENV=production — o env daqui
 *      também força, mas o arquivo é o que o db:seed lê).
 *   4. O build standalone do frontend, que NÃO roda de `frontend/` e sim de
 *      `frontend/.next/standalone/`:
 *
 *        npm --prefix frontend ci
 *        NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *        NEXT_PUBLIC_SITE_URL=https://loja.exemplo.com.br \
 *        NEXT_PUBLIC_API_URL=/api \
 *          npm --prefix frontend run build
 *        # O standalone não carrega os estáticos junto — copie os dois:
 *        cp -r frontend/.next/static frontend/.next/standalone/.next/static
 *        cp -r frontend/public frontend/.next/standalone/public
 *
 *      NEXT_PUBLIC_* é BUILD-time: mudou valor, refaça build e cópias. Definir
 *      no `env` daqui embaixo não teria efeito nenhum sobre o bundle.
 *
 * CAMINHO DO SERVER.JS, CONFERIDO NUM BUILD REAL (2026-08-20): o standalone
 * sai em frontend/.next/standalone/server.js — SEM subdiretório frontend/ no
 * meio — porque next.config.mjs fixa `outputFileTracingRoot` em frontend/.
 * (Num monorepo com tracing root na RAIZ, o Next aninharia como
 * .next/standalone/frontend/server.js; não é o caso aqui, e se aquele tracing
 * root mudar, o `cwd` de canastra-web abaixo muda junto.)
 *
 * Subir e persistir:
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup   # reinício automático no boot da VPS
 */

const path = require("node:path");

// Este arquivo vive em deploy/; a raiz do repo é um nível acima. Nada de
// caminho absoluto chumbado: o repo roda de onde for clonado.
const RAIZ = path.join(__dirname, "..");

module.exports = {
  apps: [
    {
      name: "canastra-api",
      // cwd = backend/ NÃO é estilo: backend/src/index.js carrega o dotenv de
      // "./src/.env" RELATIVO AO CWD. Com outro cwd o .env simplesmente não é
      // lido e a API recusa subir (produção sem DATABASE_URL etc.).
      cwd: path.join(RAIZ, "backend"),
      script: "src/index.js",
      instances: 1,
      env: {
        NODE_ENV: "production",
        PORT: 3333,
      },
      // O processo é enxuto; passar disto é vazamento ou loop — melhor um
      // restart limpo do que a VPS inteira paginando.
      max_memory_restart: "300M",
      // Crash em loop (banco fora do ar, .env quebrado) não vira martelo de
      // restart por segundo: o PM2 espaça as tentativas exponencialmente.
      exp_backoff_restart_delay: 200,
      // Log sem data é log que não reconstrói incidente.
      time: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      out_file: path.join(RAIZ, "deploy", "logs", "api.out.log"),
      error_file: path.join(RAIZ, "deploy", "logs", "api.err.log"),
      kill_timeout: 12000, // > os 10s do encerramento gracioso do index.js
    },
    {
      name: "canastra-web",
      // Ver o bloco de comentário no topo: caminho conferido em build real.
      cwd: path.join(RAIZ, "frontend", ".next", "standalone"),
      script: "server.js",
      instances: 1,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        // Só o nginx da própria VPS fala com o Next — não abre para a rede.
        HOSTNAME: "127.0.0.1",
      },
      max_memory_restart: "512M",
      exp_backoff_restart_delay: 200,
      time: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      out_file: path.join(RAIZ, "deploy", "logs", "web.out.log"),
      error_file: path.join(RAIZ, "deploy", "logs", "web.err.log"),
    },
  ],
};
