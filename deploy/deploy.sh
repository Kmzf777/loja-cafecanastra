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
#
# A ULTIMA LINHA E UM GRUPO, `{ main "$@"; exit $?; }`, e o motivo e o caso
# que a nota acima nao cobre: quando um commit deixa este script MAIOR do que
# a copia em execucao, sobra conteudo no arquivo depois do deslocamento em
# bytes onde o bash parou de ler. Se ele voltasse ali, executaria um pedaco de
# linha do arquivo novo. O grupo fecha essa porta sem depender de saber se o
# bash volta: ele le o grupo inteiro antes de executar, entao o `exit` ja esta
# analisado quando main() comeca, e o processo sai de dentro dele.
#
# HONESTIDADE SOBRE A PROVA: em experimento local (bash 5, arquivo de 32 KB
# reescrito por outro no meio da execucao) o bash NAO voltou a ler o arquivo
# nem sem o grupo. Ou seja, o risco e teorico aqui e nao foi reproduzido — o
# grupo fica porque custa uma linha e nao depende de qual bash roda na VPS.

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

  # O CONTAINER QUE ESTA SERVINDO AGORA. `status=running` e o `head -1` estao
  # aqui porque no meio de um rolling update existem DOIS por um instante, e um
  # `docker exec` com duas linhas de id nao roda.
  local cid
  cid=$(docker ps -q --filter name=loja_web --filter status=running | head -1)
  [ -n "$cid" ] || { echo "ERRO: nenhum container de loja_web rodando"; return 1; }

  # A PROVA DE VIDA E POR DENTRO DO CONTAINER, e este foi o conserto de um
  # deploy que falhava DEPOIS de ja ter publicado tudo.
  #
  # Aqui havia `curl --resolve loja...:443:127.0.0.1`. O stack nao publica
  # porta nenhuma (ver stack.swarm.yml): quem tem a 443 e o Traefik, que e
  # externo a ele. Chegar no Traefik pelo loopback DO PROPRIO HOST depende de
  # como ELE publica a porta — em modo ingress do Swarm, conexao que nasce no
  # proprio host costuma pendurar. Foi o que aconteceu em 25/08/2026: o curl
  # estourou o --max-time e saiu 28, o `set -e` matou o script na atribuicao
  # crua (a armadilha que o cabecalho deste arquivo descreve) e o workflow
  # apareceu vermelho com a loja no ar, servindo a versao nova.
  #
  # A pergunta aqui e outra, e nao passa pela rede do host: o processo que
  # acabou de subir responde 200 na porta dele? E o mesmo `fetch` do
  # HEALTHCHECK da imagem (frontend/Dockerfile), que ja e sabido funcionar
  # dentro dela — a imagem e node:22-slim e nao tem curl.
  echo "== provando a vitrine por dentro do container =="
  local tentativa codigo=""
  for tentativa in 1 2 3 4 5; do
    codigo=$(docker exec "$cid" node -e \
      "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>console.log(r.status),()=>console.log('sem-resposta'))" \
      2>/dev/null || echo "exec-falhou")
    echo "  tentativa $tentativa: $codigo"
    [ "$codigo" = "200" ] && break
    sleep 5
  done
  [ "$codigo" = "200" ] || {
    echo "ERRO: a vitrine nao respondeu 200 por dentro do container"
    docker service ps loja_web --no-trunc
    return 1
  }

  # A PROVA POR FORA VIRA AVISO. Ela atravessa Traefik e TLS, que e o caminho
  # que a pessoa de fato percorre, e por isso continua valendo a pena tentar —
  # mas o deploy nao pode virar falha por uma limitacao de rede do host quando
  # a vitrine ja respondeu. Quando nao passa, o que interessa e o codigo de
  # saida do curl: 7 e porta fechada, 28 e pacote engolido.
  local externo="" saida=0
  externo=$(curl -s -o /dev/null -w '%{http_code}' \
    --resolve loja.canastrainteligencia.com:443:127.0.0.1 \
    https://loja.canastrainteligencia.com/ --max-time 15) || saida=$?
  if [ "$saida" = "0" ] && [ "$externo" = "200" ]; then
    echo "traefik respondeu HTTP $externo"
  else
    echo "AVISO: a prova por fora nao passou — curl saiu $saida, HTTP ${externo:-nenhum}."
    echo "AVISO: nao derruba o deploy; a vitrine ja respondeu 200 por dentro."
  fi

  # 200 NAO PROVA que a versao nova subiu: o container velho tambem responde
  # 200. Confere o projeto Supabase assado no bundle — se o container fosse o
  # antigo, esta contagem daria zero.
  if [ "$construiu_web" = "true" ]; then
    local achou
    achou=$(docker exec "$cid" sh -c \
      "grep -rl hmxbdpmgwmbygwmngusy .next/static 2>/dev/null | wc -l")
    echo "arquivos do bundle apontando para o projeto cloud: $achou"
    [ "$achou" -gt 0 ] || { echo "ERRO: container servindo bundle antigo"; return 1; }
  fi
}

# NAO MOVA ESTA LINHA, E NAO TIRE O GRUPO NEM O `exit` — ver o cabecalho.
{ main "$@"; exit $?; }
