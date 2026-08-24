# Tarefa: destravar o deploy da loja e pôr a home nova no ar

> **O que é este arquivo.** Um enunciado de tarefa para um agente com acesso à
> VPS de produção. Não é documentação de referência — é um pedido de trabalho,
> com o que já se sabe, o que já foi descartado e o critério de pronto.
>
> **Escrito em:** 24 de agosto de 2026, com a `main` em `9e47659`.
> **Documentação estável do deploy:** `docs/deploy.md` e `docs/producao.md`.

Você tem acesso à VPS que hospeda `loja.canastrainteligencia.com` (Docker Swarm
+ Traefik). É uma loja **real, que vende**. Trate como produção.

---

## Situação

A `main` está no commit `9e47659` — um merge que reformou a home: saíram as
seções institucionais "Torra da semana" e "História", entraram três carrosséis
de venda ("Mais vendidos", "Nossos kits", "Escolha do produtor") e uma trilha
de categorias. O CI do GitHub passou nesse commit: 867 testes, `tsc` e `lint`
limpos, `next build` verde, e as três homes (`/pt`, `/en`, `/es`) saem
estáticas do build.

**O código está correto e mergeado. O que não funciona é o deploy.**

O site ao vivo ainda serve a home ANTIGA. O workflow
`.github/workflows/deploy.yml` entra por SSH nesta VPS e falha **sempre**,
desde o commit que o criou (`d6a0b8f`) — nunca teve uma execução verde.

---

## O sintoma exato

O script roda `set -euo pipefail`, faz `cd /srv/loja-cafecanastra`,
`git fetch`, `git reset --hard origin/main`, `git clean -fd`, e imprime:

```
revisao: <sha-antes> -> <sha-depois>
```

Morre com exit 1 imediatamente depois, ~8 segundos após iniciar, **sem
imprimir a próxima saída obrigatória**, que seria:

```
== migracoes: nada mudou em backend/db/migrations/, pulando ==
```

Entre uma linha e outra existem apenas: a definição da função `mudou()`, quatro
atribuições de variável, e um `[ ... ] && FORCADO=true`.

---

## O que JÁ FOI DESCARTADO — não repita este trabalho

Testado com o trecho exato do script, em `bash` e em `sh`:

1. **Não é `set -e` com a lista `[ x = y ] && cmd`.** O bash não derruba uma
   lista AND-OR que faz curto-circuito. Verificado: sai 0.
2. **Não é a linha do `FORCADO`.** O workflow foi disparado por
   `workflow_dispatch`, onde o teste vira
   `[ "workflow_dispatch" = "workflow_dispatch" ]` — verdadeiro, sai 0.
   Falhou no MESMO ponto.
3. **Não é o estado de `ANTES`/`DEPOIS`.** Falhou com os dois diferentes
   (`workflow_run`) e com os dois iguais (`workflow_dispatch`). Reproduzido
   localmente nos dois casos: o script sobrevive e imprime a mensagem das
   migrações.
4. **Não é a lógica do laço de espera nem do `mudou()`.** Ambos verificados.

**Conclusão: a causa é ambiental, nesta VPS.** Shell, permissão, disco, estado
do git, docker, ou algo que o `appleboy/ssh-action` (drone-ssh 1.8.0, com
`script_stop: true`) faz de diferente de um `bash script.sh`.

---

## Objetivo, em ordem de prioridade

### 1º — Pôr a home nova no ar

Isto destrava o cliente e não depende de entender a falha. Faça primeiro.

```bash
cd /srv/loja-cafecanastra
git fetch --prune origin main && git reset --hard origin/main
git rev-parse HEAD   # tem de ser 9e47659... ou mais recente

set -a; . deploy/.env.build; set +a
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  --build-arg NEXT_PUBLIC_SITE_URL="$NEXT_PUBLIC_SITE_URL" \
  --build-arg NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL" \
  -f frontend/Dockerfile -t loja-web:latest .

docker stack deploy -c deploy/stack.swarm.yml loja
docker service update --force loja_web
```

**O `--force` NÃO é opcional.** Não há registry de container aqui. Sem ele o
swarm identifica a imagem pela string `loja-web:latest`, vê que a spec não
mudou, e mantém o container velho servindo o bundle antigo — respondendo HTTP
200 o tempo todo. Está documentado no próprio `deploy.yml`, e já aconteceu
antes.

O build passa de 10 minutos nesta VPS (3 vCPU). É esperado.

### 2º — Descobrir por que o workflow morre

Rode o prefixo do script com rastreio, para ver a linha exata:

```bash
cd /srv/loja-cafecanastra
bash -x <<'FIM'
set -euo pipefail
ANTES=$(git rev-parse HEAD); DEPOIS=$(git rev-parse HEAD)
echo "revisao: $ANTES -> $DEPOIS"
mudou() {
  [ "$ANTES" = "$DEPOIS" ] && return 1
  git diff --name-only "$ANTES" "$DEPOIS" | grep -qE "$1"
}
FORCADO=true; CONSTRUIU_WEB=false; CONSTRUIU_API=false
if mudou '^backend/db/migrations/'; then echo A; else echo B; fi
echo SOBREVIVI
FIM
```

E colete o ambiente:

```bash
echo "SHELL=$SHELL"; readlink -f /bin/sh; bash --version | head -1
df -h /; docker system df
git -C /srv/loja-cafecanastra status --short | head
git -C /srv/loja-cafecanastra rev-parse --is-shallow-repository
ls -la /srv/loja-cafecanastra/deploy/
id; groups
```

Hipóteses a checar, em ordem de plausibilidade:

| Hipótese | Como confirmar |
|---|---|
| Disco cheio | `df -h /`, `docker system df` |
| `/bin/sh` é dash e o drone-ssh executa por `sh -c` (sem `pipefail`) | `readlink -f /bin/sh` |
| `deploy/.env.build` ausente ou ilegível pelo usuário do deploy | `ls -la deploy/` |
| Permissão sobre `/srv/loja-cafecanastra` ou o socket do Docker | `id`, `groups` |
| Repositório shallow (`git diff` entre dois SHAs falha) | `git rev-parse --is-shallow-repository` |

### 3º — Corrigir o `deploy.yml`, com prova

Só depois de saber a causa. Se for o script, conserte e commite. Se for
ambiente, conserte o ambiente **e registre o que era em `docs/deploy.md`** —
sem isso, volta a morder no próximo deploy e ninguém vai lembrar.

Se a causa for o drone-ssh executando de forma diferente de um shell normal, a
saída limpa é mover o script para um arquivo versionado (`deploy/deploy.sh`) e
o workflow passar a chamar `bash deploy/deploy.sh` — uma linha só por SSH, sem
ambiguidade de shell, e o script passa a ser testável com `bash -n`.

---

## Regras — a loja está no ar

- **NUNCA `git clean -x` ou `-X`.** Os arquivos ignorados são os SEGREDOS do
  deploy: `deploy/.env.build`, `deploy/.env.migracao`, `backend/src/.env`.
  Apagá-los derruba a loja e **não há cópia**.
- **Não remova o stack** (`docker stack rm loja`). Atualize, não recrie.
- **Não rode migrações** a menos que `deploy/.env.migracao` exista E haja
  migração nova em `backend/db/migrations/`. O banco é Supabase **cloud**
  (projeto `hmxbdpmgwmbygwmngusy`), não local.
- `loja_api` está com `replicas=0` de propósito — faltam as credenciais do
  Mercado Pago. Não tente subir.
- Se o build falhar, **não apague a imagem antiga**: é ela que mantém a loja de
  pé.

---

## Como saber que deu certo

A home ao vivo tem de mostrar as seções NOVAS, e não a antiga:

```bash
curl -s https://loja.canastrainteligencia.com/ \
  | grep -o '<h2[^>]*>[^<]*</h2>' | head -8
```

**Esperado:** `Mais vendidos`, `Nossos kits`, `Escolha do produtor`,
`Clube da Canastra` e, mais abaixo, `Do pé à xícara`.

**Se aparecer `Torra da semana` ou `Quarenta anos de café`, o container ainda é
o antigo** — quase certamente faltou o `docker service update --force`.

Confirmação de dentro do container:

```bash
CID=$(docker ps -qf name=loja_web)
docker exec "$CID" sh -c "grep -rl 'Mais vendidos' .next/server 2>/dev/null | wc -l"
```

Maior que zero = bundle novo.

---

## Relate ao final

1. A home nova está no ar? Cole a saída do `curl` acima.
2. Qual era a causa real da falha — com a evidência que a provou.
3. O que mudou: no `deploy.yml`, na VPS, ou nos dois.
4. O que ficou pendente.

Se travar no mesmo erro três vezes, pare e relate em vez de insistir.
