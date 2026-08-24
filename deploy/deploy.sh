#!/usr/bin/env bash
#
# Deploy da loja na VPS. Chamado pelo .github/workflows/deploy.yml com UMA
# linha de SSH:  bash deploy/deploy.sh "<github.event_name>"
#
# ─────────────────────────────────────────────────────────────────────────────
# POR QUE ESTE ARQUIVO EXISTE, E NAO UM `script:` MULTILINHA NO WORKFLOW
#
# O appleboy/ssh-action usa o drone-ssh. Com `script_stop: true` (que e o que
# se quer: parar no primeiro erro), ele NAO entrega o script ao shell e deixa o
# shell cuidar disso. Ele QUEBRA O SCRIPT POR \n e injeta, depois de CADA
# linha (drone-ssh plugin.go, funcao commands()):
#
#   DRONE_SSH_PREV_COMMAND_EXIT_CODE=$? ; \
#   if [ $DRONE_SSH_PREV_COMMAND_EXIT_CODE -ne 0 ]; then exit $...; fi;
#
# Ou seja: o `$?` de TODA linha e conferido cegamente, e qualquer status != 0
# encerra o deploy. Isso quebra construcoes perfeitamente corretas em bash:
#
#   [ "$X" = "y" ] && FOO=true      # status 1 quando X != y — e legitimo
#   if [ -f arquivo ]; then         # status 1 quando o arquivo nao existe
#   grep -q padrao arquivo          # status 1 quando nao casa
#
# Foi exatamente isso que derrubou TODA execucao do deploy entre d6a0b8f e
# 2026-08-25: a linha `[ "$EVENTO" = workflow_dispatch ] && FORCADO=true`
# devolvia 1, e o deploy morria ali — logo depois de imprimir "revisao: ...",
# sem chegar na mensagem seguinte. O `set -e` do bash NAO tem culpa: ele
# ignora corretamente uma lista AND-OR em curto-circuito. Quem mata e o teste
# do drone-ssh, que nao conhece essa regra.
#
# Com o script num arquivo, o workflow manda UMA linha. Uma linha, uma
# conferencia de `$?` — a do script inteiro, que e justamente o que se quer.
# De quebra, isto vira testavel: `bash -n deploy/deploy.sh`.
#
# ─────────────────────────────────────────────────────────────────────────────
# POR QUE TUDO DENTRO DE main()
#
# Este script roda `git reset --hard`, que REESCREVE ESTE PROPRIO ARQUIVO
# enquanto o bash o executa. O bash le o script em pedacos, guardando um
# deslocamento em bytes; trocar o arquivo debaixo dele faz a execucao retomar
# no byte errado — e o sintoma e um erro de sintaxe absurdo, dificil de ligar
# a causa. Com o corpo todo dentro de uma funcao e a chamada na ultima linha,
# o bash precisa ter lido e analisado o arquivo INTEIRO antes de executar
# qualquer coisa. Nao mova o `main "$@"` para o meio do arquivo.

set -euo pipefail

main() {
  local EVENTO="${1:-desconhecido}"
  local REPO=/srv/loja-cafecanastra
  cd "$REPO"

  local ANTES DEPOIS
  ANTES=$(git rev-parse HEAD)
  git fetch --prune origin main
  git reset --hard origin/main
  # Sem -x: arquivos ignorados (deploy/.env.build, deploy/.env.migracao,
  # backend/src/.env) sao os SEGREDOS do deploy e nao tem copia.
  git clean -fd
  DEPOIS=$(git rev-parse HEAD)
  echo "revisao: $ANTES -> $DEPOIS"
  echo "evento: $EVENTO"

  local FORCADO=false
  [ "$EVENTO" = "workflow_dispatch" ] && FORCADO=true
  local CONSTRUIU_WEB=false
  local CONSTRUIU_API=false

  # ── Migracoes ───────────────────────────────────────────────────────────
  # O banco e o Supabase CLOUD (hmxbdpmgwmbygwmngusy) e o schema canastra ja
  # esta migrado la. Este passo so roda se alguem tiver criado
  # deploy/.env.migracao na VPS com a DATABASE_URL do pooler do projeto —
  # sem o arquivo, avisa e segue, em vez de derrubar o deploy por uma
  # migracao que ninguem pediu.
  if mudou "$ANTES" "$DEPOIS" '^backend/db/migrations/'; then
    if [ -f deploy/.env.migracao ]; then
      echo "== migracoes =="
      npm --prefix backend ci --omit=dev
      set -a; . deploy/.env.migracao; set +a
      npm run db:migrar
    else
      echo "== ATENCAO: ha migracao nova em backend/db/migrations/,"
      echo "   mas deploy/.env.migracao nao existe nesta VPS."
      echo "   Rode 'npm run db:migrar' a mao contra o projeto cloud."
    fi
  else
    echo "== migracoes: nada mudou em backend/db/migrations/, pulando =="
  fi

  # ── Vitrine (Next) ──────────────────────────────────────────────────────
  # data/ entra na lista: o catalogo JSON e importado pelo bundle no build
  # (ver o cabecalho de frontend/Dockerfile), entao mexer nele exige imagem
  # nova.
  if $FORCADO || mudou "$ANTES" "$DEPOIS" '^(frontend/|data/|package(-lock)?\.json)'; then
    echo "== build da vitrine =="
    set -a; . deploy/.env.build; set +a
    docker build \
      --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
      --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
      --build-arg NEXT_PUBLIC_SITE_URL="$NEXT_PUBLIC_SITE_URL" \
      --build-arg NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" \
      -f frontend/Dockerfile -t loja-web:latest .
    CONSTRUIU_WEB=true
  else
    echo "== vitrine: nada mudou, pulando build =="
  fi

  # ── API (Express) ───────────────────────────────────────────────────────
  # Construida mesmo com replicas=0: quando as credenciais do Mercado Pago
  # chegarem, subir e so mudar o replicas no stack file — a imagem ja estara
  # pronta.
  if $FORCADO || mudou "$ANTES" "$DEPOIS" '^backend/'; then
    echo "== build da API =="
    docker build -t loja-api:latest ./backend
    CONSTRUIU_API=true
  else
    echo "== API: nada mudou, pulando build =="
  fi

  # ── Publicar ────────────────────────────────────────────────────────────
  echo "== docker stack deploy =="
  docker stack deploy -c deploy/stack.swarm.yml loja

  # SEM REGISTRY, `stack deploy` SOZINHO NAO TROCA O CONTAINER — e a falha e
  # MUDA: o comando responde "Updating service loja_web", o servico segue 1/1
  # e o container velho continua servindo o bundle antigo, respondendo 200 o
  # tempo todo. O swarm identifica imagem por digest; sem registry para
  # consultar, a spec continua sendo a string "loja-web:latest", identica a
  # anterior — nada a fazer, na visao dele. O --force recria a tarefa.
  # Conferido na pratica em 2026-08-24 e de novo em 2026-08-25.
  if $CONSTRUIU_WEB; then
    echo "== forcando recriacao de loja_web =="
    docker service update --force --quiet loja_web
  fi
  # loja_api so e forcado se estiver de fato rodando: com replicas=0 (o estado
  # de hoje) um --force nao teria tarefa para recriar.
  if $CONSTRUIU_API && \
     [ "$(docker service ls --filter name=loja_api --format '{{.Replicas}}')" != "0/0" ]; then
    echo "== forcando recriacao de loja_api =="
    docker service update --force --quiet loja_api
  fi

  conferir "$CONSTRUIU_WEB"
  echo "deploy concluido: $DEPOIS"
}

# Houve mudanca casando com o padrao, entre as duas revisoes?
# Recebe as revisoes como argumento em vez de ler variavel global: assim a
# funcao e testavel isoladamente.
mudou() {
  local antes="$1" depois="$2" padrao="$3"
  [ "$antes" = "$depois" ] && return 1
  git diff --name-only "$antes" "$depois" | grep -qE "$padrao"
}

conferir() {
  local construiu_web="$1"

  echo "== aguardando loja_web ficar saudavel =="
  local i estado
  for i in $(seq 1 30); do
    estado=$(docker service ls --filter name=loja_web --format '{{.Replicas}}')
    echo "  tentativa $i: $estado"
    [ "$estado" = "1/1" ] && break
    if [ "$i" = "30" ]; then
      docker service ps loja_web --no-trunc
      echo "ERRO: loja_web nao ficou 1/1"
      return 1
    fi
    sleep 10
  done

  local codigo
  codigo=$(curl -s -o /dev/null -w '%{http_code}' \
    --resolve loja.canastrainteligencia.com:443:127.0.0.1 \
    https://loja.canastrainteligencia.com/ --max-time 30)
  echo "vitrine respondeu HTTP $codigo"
  [ "$codigo" = "200" ] || { echo "ERRO: esperava HTTP 200"; return 1; }

  # HTTP 200 NAO PROVA que a versao nova subiu: o container velho tambem
  # responde 200. Confere o projeto Supabase assado no bundle — se o container
  # fosse o antigo, esta contagem daria zero.
  if [ "$construiu_web" = "true" ]; then
    local cid achou
    cid=$(docker ps -qf name=loja_web)
    achou=$(docker exec "$cid" sh -c \
      "grep -rl hmxbdpmgwmbygwmngusy .next/static 2>/dev/null | wc -l")
    echo "arquivos do bundle apontando para o projeto cloud: $achou"
    [ "$achou" -gt 0 ] || { echo "ERRO: container servindo bundle antigo"; return 1; }
  fi
}

# NAO MOVA ESTA LINHA. Ver o cabecalho: o git reset reescreve este arquivo.
main "$@"
