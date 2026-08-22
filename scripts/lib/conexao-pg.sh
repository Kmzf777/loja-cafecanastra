#!/usr/bin/env bash
#
# Tira a senha de uma URI de conexão do Postgres, para ela não viajar no argv.
#
# POR QUE EXISTE: `pg_dump ... "$DATABASE_URL"` põe a senha em
# /proc/<pid>/cmdline, que é legível por QUALQUER usuário local — um `ps aux`
# durante o dump entrega a credencial do papel postgres. /proc/<pid>/environ,
# ao contrário, só é legível pelo dono do processo e pelo root; daí a senha ir
# por PGPASSWORD e a URI seguir sem ela.
#
# ARQUIVO SEPARADO porque estas duas funções são PURAS e têm teste
# (backend/test/backup_conexao.test.js). A senha dentro de uma URI é
# percent-encoded e libpq a decodifica ao conectar; mover o valor cru para
# PGPASSWORD quebraria em silêncio toda senha com @, / ou %.
#
# Uso:
#   . "$(dirname "$0")/lib/conexao-pg.sh"
#   PGPASSWORD="$(senha_da_uri "$DATABASE_URL")"; export PGPASSWORD
#   pg_dump ... "$(uri_sem_senha "$DATABASE_URL")"

# %40 -> @. O backslash literal é escapado ANTES para não virar escape do %b.
_percent_decode() {
  local s="${1-}"
  s="${s//\\/\\\\}"
  s="${s//%/\\x}"
  printf '%b' "$s"
}

# A autoridade: o que fica entre :// e o primeiro / ? ou #.
_autoridade_da_uri() {
  local resto="${1#*://}"
  resto="${resto%%/*}"
  resto="${resto%%\?*}"
  resto="${resto%%#*}"
  printf '%s' "$resto"
}

# Imprime a senha já decodificada. Vazio se não houver userinfo ou senha.
senha_da_uri() {
  local autoridade
  autoridade="$(_autoridade_da_uri "${1-}")"
  case "$autoridade" in *@*) ;; *) return 0 ;; esac
  # O ÚLTIMO @ separa o userinfo (RFC 3986): senha com @ codificado não pode
  # partir a URI no lugar errado.
  local userinfo="${autoridade%@*}"
  case "$userinfo" in *:*) ;; *) return 0 ;; esac
  _percent_decode "${userinfo#*:}"
}

# Imprime a URI sem a senha, preservando esquema, usuário, host, porta,
# caminho e query. URI sem senha volta inalterada.
uri_sem_senha() {
  local uri="${1-}"
  local autoridade
  autoridade="$(_autoridade_da_uri "$uri")"
  case "$autoridade" in *@*) ;; *) printf '%s' "$uri"; return 0 ;; esac

  local esquema="${uri%%://*}"
  local resto="${uri#*://}"
  local sufixo="${resto#"$autoridade"}"
  local userinfo="${autoridade%@*}"
  local hostporta="${autoridade##*@}"
  local usuario="${userinfo%%:*}"

  printf '%s://%s@%s%s' "$esquema" "$usuario" "$hostporta" "$sufixo"
}
