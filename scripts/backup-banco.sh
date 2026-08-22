#!/usr/bin/env bash
#
# Backup do banco da loja (docs/producao.md §5.6: "Supabase self-hosted não tem
# backup automático e não tem PITR. Nada nesta instalação faz cópia de nada.")
#
# O que este script faz, nesta ordem:
#   1. carrega /etc/canastra/backup.env se existir (DATABASE_URL e afins) —
#      assim o cron só precisa chamar o script, sem montar ambiente na linha;
#   2. pg_dump em formato custom (-Fc), com compressão interna (--compress=6);
#   3. VERIFICA o arquivo recém-escrito com `pg_restore --list` — dump que não
#      lista não é backup, é esperança; o script falha ali, na hora, e não às
#      3h da manhã do dia do desastre;
#   4. aplica a retenção (apaga os mais velhos que RETENCAO_DIAS);
#   5. (comentado) copia para FORA da VPS via rclone — §5.6 exige: backup no
#      mesmo disco que o banco morre junto com ele.
#
# Uso direto (sem o arquivo de ambiente):
#   DATABASE_URL="postgres://postgres:SENHA@localhost:5432/postgres" \
#     scripts/backup-banco.sh
#
# Configuração por variável de ambiente (todas com padrão, menos a primeira):
#   DATABASE_URL    obrigatória — a mesma do backend/src/.env
#   BACKUP_DIR      destino local          (padrão /var/backups/canastra)
#   RETENCAO_DIAS   dias de retenção local (padrão 14)
#
# Agendamento: scripts/backup-banco.cron.exemplo (diário, 03h).
#
# RESTAURAÇÃO — teste pelo menos uma vez ANTES de precisar (backup nunca
# restaurado é backup presumido, §5.6). Contra um banco de ENSAIO, nunca o de
# produção:
#
#   # conferir o conteúdo (é o que o passo 3 automatiza):
#   pg_restore --list canastra-AAAAMMDD-HHMMSS.dump | head
#
#   # restaurar só o schema da loja num banco de ensaio:
#   pg_restore --dbname "postgres://postgres:SENHA@host-de-ensaio:5432/postgres" \
#     --schema canastra --no-owner canastra-AAAAMMDD-HHMMSS.dump
#
# O dump cobre o BANCO (catálogo, pedidos, clientes, auth do GoTrue). O volume
# do Storage (imagens de produto, a partir da F3) é cópia separada — ver §5.6.
#
# A SENHA NÃO TRAFEGA NO argv: o script exporta PGPASSWORD e entrega ao pg_dump
# a URI já sem credencial (lib/conexao-pg.sh). O dump e a pasta nascem 600/700.

set -euo pipefail

# O dump cobre catálogo, pedidos, clientes e o auth do GoTrue — PII completa
# mais hash de senha e refresh token. Com o umask padrão do operador (022) ele
# nasceria 0644 numa pasta 0755, legível por qualquer usuário da VPS.
umask 077

# As duas funções que mantêm a senha fora do argv do pg_dump. Ver o cabeçalho
# de lib/conexao-pg.sh.
# shellcheck source=lib/conexao-pg.sh
. "$(dirname "$0")/lib/conexao-pg.sh"

# ── 1. Ambiente ─────────────────────────────────────────────────────────────
# O cron chama este script pelado; quem carrega a DATABASE_URL é este source.
# `set -a` exporta tudo que o arquivo definir mesmo sem `export` na linha —
# assim um backup.env escrito à mão sem export continua funcionando.
AMBIENTE="/etc/canastra/backup.env"
if [ -f "$AMBIENTE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$AMBIENTE"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/canastra}"
RETENCAO_DIAS="${RETENCAO_DIAS:-14}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERRO: DATABASE_URL não está definida (nem no shell, nem em $AMBIENTE)." >&2
  echo "É a mesma conexão do backend/src/.env (o papel precisa ler o schema canastra e o auth)." >&2
  exit 1
fi

command -v pg_dump >/dev/null || { echo "ERRO: pg_dump não encontrado (apt install postgresql-client)." >&2; exit 1; }
command -v pg_restore >/dev/null || { echo "ERRO: pg_restore não encontrado (apt install postgresql-client)." >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
# Explícito, e não só herdado do umask: a pasta pode já existir de uma execução
# anterior, criada com outro umask.
chmod 700 "$BACKUP_DIR"

CARIMBO="$(date +%Y%m%d-%H%M%S)"
ARQUIVO="$BACKUP_DIR/canastra-$CARIMBO.dump"
PARCIAL="$ARQUIVO.parcial"

# Morreu no meio (erro, SIGTERM, disco cheio)? O .parcial não fica para trás
# fingindo ser backup. Depois do `mv` lá embaixo o rm -f vira um no-op.
trap 'rm -f "$PARCIAL"' EXIT

# ── 2. Dump ─────────────────────────────────────────────────────────────────
# -Fc (formato custom): comprimido POR DENTRO (--compress=6, zlib) e é o que o
# pg_restore lê, lista e restaura por partes (--schema, --table). Nada de gzip
# externo nem pipe: escrever direto no arquivo deixa o dump "seekable", que é o
# que a verificação abaixo precisa. Escreve em .parcial e só renomeia depois de
# verificado: um dump interrompido nunca fica com nome de backup válido.
echo "[backup] pg_dump -> $ARQUIVO"
# A senha vai por PGPASSWORD (só o dono do processo e o root leem
# /proc/<pid>/environ) e a URI segue SEM ela — /proc/<pid>/cmdline é legível
# por qualquer usuário local, e um `ps aux` durante o dump entregaria a
# credencial do papel postgres. É a mesma disciplina que o backup-banco.cron.exemplo
# já aplicava ao manter a URL fora da linha do cron.
PGPASSWORD="$(senha_da_uri "$DATABASE_URL")"
export PGPASSWORD
pg_dump --format=custom --compress=6 --no-owner --file "$PARCIAL" \
  "$(uri_sem_senha "$DATABASE_URL")"

# ── 3. Verificação ──────────────────────────────────────────────────────────
# pg_restore --list lê o índice (TOC) do arquivo: detecta dump truncado ou
# corrompido. Direto sobre o arquivo, sem pipe — pg_restore lendo de pipe pode
# fechar a leitura cedo e derrubar backup BOM com SIGPIPE sob pipefail. Não
# substitui o ensaio de restauração completo (comentário no topo), mas barra o
# caso mais comum — o backup que nasce quebrado.
if ! pg_restore --list "$PARCIAL" > /dev/null; then
  echo "[backup] ERRO: o dump não passou no pg_restore --list; arquivo descartado." >&2
  exit 1   # o trap apaga o .parcial
fi
mv "$PARCIAL" "$ARQUIVO"
chmod 600 "$ARQUIVO"
echo "[backup] ok: $(du -h "$ARQUIVO" | cut -f1) verificado com pg_restore --list."

# ── 4. Retenção ─────────────────────────────────────────────────────────────
# Só apaga o que este script criou (os padrões de nome), nunca a pasta inteira.
find "$BACKUP_DIR" -maxdepth 1 -name 'canastra-*.dump' -mtime "+$RETENCAO_DIAS" -print -delete |
  sed 's/^/[backup] retenção: apagado /' || true
# .parcial órfão de uma execução que morreu sem rodar o trap (queda de energia,
# SIGKILL): mais velho que um dia nunca é uma execução em andamento.
find "$BACKUP_DIR" -maxdepth 1 -name 'canastra-*.parcial' -mtime +1 -delete || true

# ── 5. Cópia para FORA da VPS (descomente e configure) ──────────────────────
# §5.6: as duas coisas (dump + Storage) guardadas FORA da VPS. Um backup no
# mesmo disco morre no mesmo incidente. Com rclone (https://rclone.org):
#
#   rclone config          # uma vez: crie o remote "backups-canastra"
#                          # (B2, S3, R2, Google Drive... qualquer um serve)
#
# e então descomente:
#
# echo "[backup] enviando para fora da VPS..."
# rclone copy "$ARQUIVO" "backups-canastra:canastra/banco/" --no-traverse
# # Retenção no destino remoto (espelha a local):
# rclone delete "backups-canastra:canastra/banco/" --min-age "${RETENCAO_DIAS}d"

echo "[backup] concluído."
