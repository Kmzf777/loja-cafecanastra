#!/usr/bin/env bash
#
# Reescreve o histórico do Git removendo os 11 CSVs com dados pessoais reais
# (docs/seguranca-dados-pessoais.md: dump da loja anterior, com nomes, e-mails,
# endereços, hashes bcrypt de senha e 34 refresh tokens JWT).
#
# POR QUE ISTO EXISTE: os arquivos saíram do working tree em 2026-08-16
# (`git rm --cached` + apagados do disco), mas REMOVER DO DIRETÓRIO NÃO APAGA
# DO HISTÓRICO — `git show <commit-antigo>:usuarios.csv` continua devolvendo os
# dados hoje, em qualquer clone. Fechar de verdade exige reescrever todos os
# commits, e isso muda TODOS os SHAs dali em diante.
#
# ESTE SCRIPT É DESTRUTIVO E FOI DESENHADO PARA SER RODADO POR UM HUMANO,
# deliberadamente, uma vez. Ele NUNCA é executado por automação (a onda 3H o
# entregou pronto e NÃO o executou — plano mestre, decisão 9: push --force é
# ação de quem administra). Antes de rodar, leia o roteiro inteiro.
#
# O QUE ELE FAZ, NA ORDEM:
#   1. guarda interativa: você digita o NOME do repositório para prosseguir;
#   2. confere os pré-requisitos (git >= 2.22, git-filter-repo instalado);
#   3. cria um CLONE ESPELHO FRESCO num diretório temporário — o filter-repo
#      recusa rodar em clone "sujo" por segurança, e o espelho garante que a
#      reescrita cobre TODAS as refs (branches, tags), não só a atual;
#   4. roda `git filter-repo --invert-paths` com os 11 caminhos exatos e
#      confere o resultado; passando a conferência, ARMA o trap que imprime o
#      checklist de invalidação — assim ele sai mesmo que o push falhe, que é
#      quando ele mais faz falta;
#   5. apaga do espelho as refs que não se empurram (`refs/pull/*` do GitHub,
#      `refs/replace/*` do filter-repo);
#   6. mostra o resultado e SÓ empurra (heads e tags, com --force) depois de
#      uma SEGUNDA confirmação digitada.
#
# DEPOIS DO PUSH, NÃO É OPCIONAL:
#   - todo mundo com clone precisa RECLONAR (pull sobre histórico reescrito
#     ressuscita os commits antigos num merge — e os CSVs voltam); enquanto a
#     última pessoa não migrar, um push de branch antiga DEVOLVE os blobs ao
#     servidor — ver o item 6 do checklist (proteção de push + `rebase --onto`);
#   - se o repositório está no GitHub, forks e PRs antigos ainda seguram os
#     objetos: abra um chamado no suporte do GitHub pedindo a remoção dos
#     objetos órfãos e a invalidação dos caches ("remove cached views /
#     dangling commits" — procedimento padrão deles para dados sensíveis);
#   - o checklist de invalidação do fim deste arquivo (também em
#     docs/seguranca-dados-pessoais.md).

set -euo pipefail

# ── Os 11 caminhos, EXATOS ──────────────────────────────────────────────────
# Extraídos do histórico real em 2026-08-20 com:
#   git log --all --diff-filter=A --name-only -- '*.csv'
# Todos entraram num único commit (5ddcb71), na RAIZ do repositório, e saíram
# do working tree em 5a521c0. O desvio para `.dumps-antigos/` citado no
# documento NUNCA foi commitado (conferido: nenhum commit toca esse diretório),
# então não há segundo caminho a remover.
ARQUIVOS=(
  addresses.csv
  cart_items.csv
  carts.csv
  password_resets.csv
  pedidos.csv
  product_options.csv
  produtos.csv
  promotions.csv
  refresh_tokens.csv
  store_config.csv
  usuarios.csv
)

# ── 1. Guarda interativa ────────────────────────────────────────────────────
# O nome vem do remote de quem roda (ou do argumento), e é preciso DIGITÁ-LO:
# um "y" apressado não reescreve histórico de ninguém. Rodar sem terminal
# interativo (CI, pipe) falha aqui — que é o comportamento desejado.
URL_DO_REPO="${1:-$(git remote get-url origin 2>/dev/null || true)}"
if [ -z "$URL_DO_REPO" ]; then
  echo "ERRO: informe a URL do repositório: $0 <url-do-remote>" >&2
  echo "(ou rode de dentro de um clone que tenha o remote 'origin')" >&2
  exit 1
fi

NOME_DO_REPO="$(basename -s .git "$URL_DO_REPO")"

echo
echo "Você está prestes a REESCREVER O HISTÓRICO de:"
echo
echo "    $URL_DO_REPO"
echo
echo "Isso muda todos os SHAs, exige push --force e obriga todo mundo a"
echo "reclonar. Não tem desfazer depois do push."
echo
printf 'Para prosseguir, digite o nome do repositório (%s): ' "$NOME_DO_REPO"
read -r CONFIRMACAO
if [ "$CONFIRMACAO" != "$NOME_DO_REPO" ]; then
  echo "Nome não confere. Nada foi feito." >&2
  exit 1
fi

# ── 2. Pré-requisitos ───────────────────────────────────────────────────────
# git-filter-repo NÃO vem com o git: https://github.com/newren/git-filter-repo
#   instalação usual:  pip install git-filter-repo   (ou o gerenciador do SO)
# (filter-branch e BFG existem, mas o próprio manual do git aponta para o
# filter-repo; é a ferramenta que o docs/seguranca-dados-pessoais.md fixou.)
if ! git filter-repo --version >/dev/null 2>&1; then
  echo "ERRO: git-filter-repo não está instalado (git filter-repo --version falhou)." >&2
  echo "Instale com: pip install git-filter-repo" >&2
  exit 1
fi

# ── 3. Clone espelho fresco ─────────────────────────────────────────────────
# Espelho (--mirror), não clone comum: carrega TODAS as refs — branches
# remotos, tags — e é o formato que o push --mirror do passo 5 espera. Fresco,
# não reaproveitado: o filter-repo recusa repositório com estado local
# (proteção dele contra perder trabalho não empurrado), e um espelho recém
# clonado é por definição idêntico ao remoto.
TRABALHO="$(mktemp -d "${TMPDIR:-/tmp}/reescrita-${NOME_DO_REPO}-XXXXXX")"
ESPELHO="$TRABALHO/${NOME_DO_REPO}.git"

echo
echo "Clonando espelho fresco em: $ESPELHO"
git clone --mirror "$URL_DO_REPO" "$ESPELHO"

# ── 4. A reescrita ──────────────────────────────────────────────────────────
# `--invert-paths` = "remova ESTES caminhos de todos os commits e mantenha o
# resto". Cada arquivo entra com `--path` literal (sem glob: glob poderia
# apanhar um CSV legítimo futuro; estes 11 nomes são exatos e conferidos).
# Commits que ficarem vazios após a remoção são podados pelo filter-repo.
ARGUMENTOS_DE_CAMINHO=()
for arquivo in "${ARQUIVOS[@]}"; do
  ARGUMENTOS_DE_CAMINHO+=(--path "$arquivo")
done

echo
echo "Reescrevendo ${#ARQUIVOS[@]} caminhos fora do histórico..."
git -C "$ESPELHO" filter-repo --invert-paths "${ARGUMENTOS_DE_CAMINHO[@]}"

# Prova do resultado, antes de qualquer push: nenhum commit do espelho
# reescrito pode citar CSV nenhum da lista.
echo
echo "Conferência: procurando os arquivos no histórico reescrito..."
SOBROU=0
for arquivo in "${ARQUIVOS[@]}"; do
  if [ -n "$(git -C "$ESPELHO" log --all --oneline -- "$arquivo" | head -1)" ]; then
    echo "  !! AINDA NO HISTÓRICO: $arquivo" >&2
    SOBROU=1
  fi
done
if [ "$SOBROU" -ne 0 ]; then
  echo "ERRO: a reescrita não removeu tudo. NADA foi empurrado; o espelho está em $ESPELHO." >&2
  exit 1
fi
echo "  ok: nenhum dos 11 arquivos aparece em commit algum."

# ── 4b. O encerramento, ARMADO NUM TRAP ─────────────────────────────────────
# POR QUE UM TRAP E NÃO UM `cat` NO FIM: o aviso de reclonar e o checklist são
# necessários MESMO (e principalmente) quando algo dá errado do meio para o
# fim. Com `set -e`, qualquer comando não-zero daqui em diante — um push
# recusado, uma ref que o servidor não aceita — encerrava o script ANTES de
# imprimi-los. No trap de EXIT eles saem sempre: sucesso, fracasso ou Ctrl-C.
#
# Armado SÓ AQUI, depois da conferência: uma saída anterior (nome do repo
# errado, filter-repo ausente) não reescreveu nada e não tem checklist a dar.
PUSH_TENTADO=0

imprimir_encerramento() {
  # Guardado na primeira linha: o código de saída real do script, para o
  # `return` no fim não o substituir pelo do último `echo`.
  local codigo=$?

  if [ "$PUSH_TENTADO" -eq 1 ]; then
    echo
    echo "AVISE TODO MUNDO COM CLONE: reclonar, não fazer pull. Um pull sobre"
    echo "histórico reescrito faz merge com os commits antigos e os CSVs VOLTAM."
  fi

  # O histórico ficou exposto enquanto existiu; o que estava nele é considerado
  # vazado para quem clonou no período (docs/seguranca-dados-pessoais.md).
  cat <<'CHECKLIST'

────────────────────────────────────────────────────────────────────────────
CHECKLIST DE INVALIDAÇÃO (fazer AGORA, na ordem):

 [ ] 1. Trocar o JWT_SECRET_REFRESH da loja ANTIGA, se aquele
        backend ainda roda em algum ambiente — os 34 refresh tokens de
        refresh_tokens.csv foram assinados com ele e valem até o segredo
        mudar.
 [ ] 2. Forçar redefinição de senha das 2 contas de usuarios.csv (os hashes
        bcrypt vazaram; bcrypt atrasa, não impede, quebra offline).
 [ ] 3. Invalidar os tokens de password_resets.csv (apagar as linhas na base
        antiga, se ela ainda existir).
 [ ] 4. Se o repositório foi PÚBLICO em algum momento: tratar como incidente
        de segurança com dado pessoal — comunicar os titulares (as 2 pessoas
        de usuarios.csv/addresses.csv) e avaliar comunicação à ANPD,
        conforme LGPD art. 48.
 [ ] 5. GitHub: pedir ao suporte a remoção de objetos órfãos/caches de forks
        e PRs antigos que ainda referenciem os commits pré-reescrita.
 [ ] 6. FECHAR A PORTA DE VOLTA — a reescrita não se defende sozinha:
        um colaborador que ainda tenha o clone ANTIGO e empurre uma branch
        baseada no histórico pré-reescrita DEVOLVE ao servidor todos os blobs
        removidos (os CSVs voltam pelo caminho de sempre, um `git push`), e o
        trabalho todo se desfaz sem ninguém perceber.
          - proteja os branches / bloqueie push temporariamente até que TODOS
            confirmem ter reclonado (no GitHub: branch protection ou tornar o
            repo somente-leitura por algumas horas);
          - quem tiver trabalho não empurrado NÃO deve fazer merge nem pull:
            reclona e transplanta os commits com
              git rebase --onto <novo-main> <base-antiga> <branch-local>
            (o `--onto` recria os commits SOBRE o histórico novo em vez de
            arrastar os pais antigos junto);
          - só libere o push de volta quando a última pessoa tiver migrado.
 [ ] 7. Registrar a data da execução em docs/seguranca-dados-pessoais.md.
────────────────────────────────────────────────────────────────────────────
CHECKLIST

  return "$codigo"
}

trap imprimir_encerramento EXIT

# ── 5. Refs que NÃO podem entrar no push ────────────────────────────────────
# `refs/pull/*`: um clone --mirror de repositório do GitHub TRAZ as refs de
# pull request (o GitHub as anuncia — `git ls-remote` as lista), e elas são
# HIDDEN REFS do lado de lá: qualquer push que as inclua é recusado com
# "deny updating a hidden ref", o push inteiro sai não-zero e, com `set -e`, o
# script morria AQUI — antes do aviso de reclonar e do checklist, que são
# justamente o que precisa aparecer quando o push dá errado.
#
# `refs/replace/*`: o filter-repo pode criar refs de replace que MAPEIAM sha
# antigo -> sha novo. Elas referenciam objetos que a reescrita acabou de podar;
# empurrá-las falha por objeto ausente, e ressuscitaria a ponte para o
# histórico velho se não falhasse.
#
# Apagá-las do espelho é local e não muda o que já está no servidor — as refs
# de PR do GitHub continuam segurando os objetos antigos lá, e é exatamente por
# isso que o item 5 do checklist (chamado no suporte) não é opcional.
echo
echo "Removendo do espelho as refs que não se empurram (pull requests, replace)..."
git -C "$ESPELHO" for-each-ref refs/pull refs/replace --format='delete %(refname)' \
  | git -C "$ESPELHO" update-ref --stdin

# ── 6. O push, atrás da SEGUNDA confirmação ─────────────────────────────────
# O filter-repo remove o remote 'origin' do espelho de propósito (para ninguém
# empurrar sem pensar); recolocamos e empurramos as refs reescritas.
#
# REFSPEC EXPLÍCITO, NÃO `--mirror`: `--mirror` empurra (e apaga) TUDO que há
# ou deixou de haver sob `refs/*`, e basta UMA categoria de ref que o servidor
# não aceita escrever para o push inteiro voltar não-zero — foi o que o passo 5
# acabou de desarmar, e o refspec explícito é a segunda tranca do mesmo
# problema: heads e tags são o que a reescrita mudou e o que precisa chegar lá.
# (Reescrita não apaga branch nenhum, então não há deleção remota a fazer.)
#
# Se preferir inspecionar antes, responda outra coisa: o espelho fica no
# diretório temporário e os comandos exatos ficam impressos.
echo
printf 'Empurrar AGORA com --force para %s? Digite "reescrever" para empurrar: ' "$URL_DO_REPO"
read -r EMPURRAR
if [ "$EMPURRAR" != "reescrever" ]; then
  echo
  echo "Push NÃO feito. Para inspecionar e empurrar depois, manualmente:"
  echo "    cd $ESPELHO"
  echo "    git remote add origin $URL_DO_REPO"
  echo "    git push --force origin 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*'"
else
  PUSH_TENTADO=1
  git -C "$ESPELHO" remote add origin "$URL_DO_REPO"
  # No `if`, e não solto: com `set -e` um push recusado mataria o script antes
  # do aviso e do checklist. Dentro da condição, o errexit fica suspenso e o
  # fracasso vira mensagem + código de saída no fim.
  if git -C "$ESPELHO" push --force origin \
       'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*'; then
    echo
    echo "Histórico reescrito e empurrado."
  else
    CODIGO_FINAL=1
    echo >&2
    # "Falhou" não quer dizer "nada foi empurrado": um push de várias refs
    # pode ter aceitado umas e recusado outras. Leia a saída acima ref a ref
    # antes de concluir qualquer coisa sobre o estado do servidor.
    echo "ERRO: o push FALHOU (parte das refs pode ter ido; confira a saída acima)." >&2
    echo "O espelho já reescrito continua em: $ESPELHO" >&2
    echo "Depois de resolver a causa (credencial, branch protegida, ref recusada):" >&2
    echo "    git -C $ESPELHO push --force origin 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*'" >&2
  fi
fi

exit "${CODIGO_FINAL:-0}"
