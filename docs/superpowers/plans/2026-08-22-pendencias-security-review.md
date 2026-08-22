# Pendências da Security Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os três defeitos reais que a security review encontrou e classificou abaixo do limiar de vulnerabilidade: HTML não escapado no e-mail de status, o backup que expõe dump e senha, e o frete que grava um método diferente do que cobrou.

**Architecture:** Três correções independentes, em arquivos disjuntos, cada uma por TDD. Duas mexem em JavaScript do backend (`utils/emailSender.js`, `controllers/PaymentController.js`); a terceira mexe num shell script e extrai duas funções puras para `scripts/lib/conexao-pg.sh`, testadas via `bash -c` a partir do runner do Node.

**Tech Stack:** Node.js, `node:test` (`node --test test/*.test.js`, rodado de dentro de `backend/`), Express, Postgres, Bash.

**Spec:** `docs/superpowers/specs/2026-08-22-pendencias-security-review-design.md`

**Branch:** `pendencias-security-review`

---

## Contexto que o executor precisa

**Todos os comandos de teste rodam de dentro de `backend/`.** O `package.json` de lá define
`"test": "node --test test/*.test.js"`. Para rodar um arquivo só, use
`node --test test/<arquivo>.test.js`.

**Sobre os módulos deste plano:**
- `src/config/mailer.js` devolve um dublê que só escreve no console quando `EMAIL_PASS2`
  está ausente — então dá para carregar `utils/emailSender.js` num teste sem chave de API.
- `src/pgPool.js` só constrói o `Pool`; não abre conexão até a primeira query. Carregar o
  módulo num teste não precisa de banco.
- Por isso a Task 1 **não** precisa do harness de Postgres (`test/ajuda/postgres.js`). A
  Task 3 precisa, e o arquivo de teste dela já o usa.

**Ordem:** as três tasks são independentes e podem ser feitas em qualquer ordem, ou em
paralelo. A Task 4 (verificação final) roda depois das três.

### Disciplina de teste: ver o teste morder

Ver o teste falhar antes de implementar não basta — ele pode falhar pelo motivo errado
(um `TypeError` de import ausente falha em qualquer teste, inclusive num que não afirma
nada). Depois de o teste passar, **quebre a implementação de propósito** e confirme que o
teste específico falha:

- apague a linha que o teste diz guardar;
- rode só aquele arquivo;
- confirme a falha, restaure, confirme que volta a passar.

Isto não é zelo excessivo: a primeira versão da Task 1 tinha uma asserção que passava
mesmo com a implementação inteira apagada, porque casava com um literal fixo do template.
Só a mutação revelou. Se o teste sobrevive à mutação, ele não guarda o que o nome dele
promete — reescreva-o antes de commitar.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `backend/src/utils/emailSender.js` | Modificar: extrair `corpoDoEmailDeStatus`, escapar HTML — **nos dois** senders fora da convenção (spec §1.1) | 1 |
| `backend/test/email_status.test.js` | Criar: escape do e-mail de status **e do aviso do admin** | 1 |
| `scripts/lib/conexao-pg.sh` | Criar: `senha_da_uri` e `uri_sem_senha`, funções puras | 2 |
| `backend/test/backup_conexao.test.js` | Criar: contratos das duas funções acima **e o e2e do script inteiro** (step 6) | 2 |
| `scripts/backup-banco.sh` | Modificar: `umask`, `chmod`, `PGPASSWORD` **e o guarda que aborta** | 2 |
| `scripts/backup-banco.cron.exemplo` | Modificar: nota sobre o `argv` | 2 |
| `docs/deploy.md` | Modificar: a senha do `backup.env` precisa vir percent-encoded | 2 |
| `README.md` | Modificar: `scripts/lib/conexao-pg.sh` no mapa de arquivos | 2 |
| `backend/src/controllers/PaymentController.js` | Modificar: `conferirFrete` devolve `{valor, metodo}` | 3 |
| `backend/test/f4_status_e_frete.test.js` | Modificar: casos do pareamento | 3 |
| `backend/test/pagamento.test.js` | Modificar: os dublês de cotação ganham `name`; o par cruzado mora aqui | 3 |
| `backend/test/f4_checkout_e_webhook.test.js` | Modificar: o checkout confere `metodo_envio` na coluna | 3 |
| `backend/src/controllers/ShippingController.js` | Modificar: só o comentário do frete grátis, que agora aponta o nome | 3 |

---

## Task 1: Escapar HTML no e-mail de status

**Files:**
- Modify: `backend/src/utils/emailSender.js:64-111` (e o `module.exports` no fim do arquivo)
  — mais `sendAdminNewOrderEmail`, que a revisão final do ramo trouxe junto (step 4)
- Test: `backend/test/email_status.test.js` (criar)

O corpo do e-mail hoje é montado inline dentro de `sendStatusEmail`, que consulta o banco
e chama o Resend. Para o teste afirmar sobre o HTML sem tocar nenhum dos dois, o corpo sai
para uma função pura — o mesmo recorte que `conteudoDoLembreteDeCarrinho` (linha 216) já
faz no mesmo arquivo.

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/test/email_status.test.js`:

```js
"use strict";

/**
 * O e-mail de status era o UNICO sender deste arquivo que interpolava texto do
 * cliente cru no HTML — `nome` (cadastro) e `trackingCode` (digitado no painel).
 * Os outros ja passavam por escaparHtml. Estes testes fixam a convencao.
 *
 * Nao precisa de banco nem de chave do Resend: `conteudoDoStatus` e
 * `corpoDoEmailDeStatus` sao puras, `config/mailer.js` cai num duble sem
 * EMAIL_PASS2, e `pgPool` so constroi o Pool (nao conecta).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  conteudoDoStatus,
  corpoDoEmailDeStatus,
} = require("../src/utils/emailSender.js");

const PEDIDO = {
  order_id: "abcdef12-0000-0000-0000-000000000001",
  total_amount: 149.9,
};

// SEM after() fechando o pgPool: as duas funcoes sao puras e o Pool e
// preguicoso — nada conectou, entao nao ha handle para o runner segurar.

test("o nome do cliente sai escapado no corpo do e-mail", () => {
  const conteudo = conteudoDoStatus(
    "aprovado",
    PEDIDO,
    "<img src=x onerror=alert(1)>",
    null,
  );
  const html = corpoDoEmailDeStatus(conteudo, PEDIDO);

  assert.ok(
    !html.includes("<img src=x"),
    "o nome entrou como marcacao viva no HTML",
  );
  assert.ok(
    html.includes("&lt;img src=x onerror=alert(1)&gt;"),
    "o nome deveria aparecer escapado",
  );
});

test("o codigo de rastreio sai escapado", () => {
  const conteudo = conteudoDoStatus("enviado", PEDIDO, "Ana", "AA<BB>CC");
  const html = corpoDoEmailDeStatus(conteudo, PEDIDO);

  assert.ok(html.includes("AA&lt;BB&gt;CC"), "o rastreio deveria vir escapado");
  assert.ok(!html.includes("AA<BB>CC"), "o rastreio entrou cru");
});

test("a quebra de linha do rastreio continua virando <br/>", () => {
  const conteudo = conteudoDoStatus("enviado", PEDIDO, "Ana", "PY123BR");
  const html = corpoDoEmailDeStatus(conteudo, PEDIDO);

  // O \n tem de chegar como <br/> DE VERDADE, e a assercao precisa provar isso:
  // `includes("<br/>")` sozinho passaria pelo <br/> FIXO do template (o que fica
  // antes do link "Ver Meus Pedidos"), e por isso nao falharia nem se o replace
  // fosse apagado inteiro. Ancorar no texto seguinte e o que a torna real.
  assert.match(html, /<br\/>Seu código de rastreio é: PY123BR/);
  assert.ok(!html.includes("&lt;br/&gt;"), "o <br/> do template foi escapado");
});

test("o assunto tambem sai escapado no <h2>", () => {
  const conteudo = conteudoDoStatus("aprovado", PEDIDO, "Ana", null);
  conteudo.subject = "Pagamento <b>aprovado</b>";
  const html = corpoDoEmailDeStatus(conteudo, PEDIDO);

  assert.ok(html.includes("&lt;b&gt;aprovado&lt;/b&gt;"));
  assert.ok(!html.includes("<b>aprovado</b>"));
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd backend && node --test test/email_status.test.js
```

Esperado: FALHA. `conteudoDoStatus` e `corpoDoEmailDeStatus` não são exportados hoje —
o erro é `TypeError: conteudoDoStatus is not a function`.

- [ ] **Step 3: Extrair o corpo e escapar**

Em `backend/src/utils/emailSender.js`, adicionar a função nova logo após
`conteudoDoStatus` (depois da linha 50):

```js
/**
 * O corpo do e-mail de status, PURO — separado do envio para o teste afirmar
 * sobre o HTML sem tocar o banco nem o Resend. Mesmo recorte que
 * `conteudoDoLembreteDeCarrinho` faz mais abaixo, pelo mesmo motivo.
 *
 * TUDO que vem de `conteudo` passa por escaparHtml: `text` carrega o nome do
 * cliente (cadastro) e o codigo de rastreio (digitado no painel), e o assunto
 * entra pela mesma disciplina — quem le o template nao deveria ter de provar,
 * campo por campo, qual interpolacao e segura.
 *
 * A ORDEM IMPORTA: escapa primeiro, troca \n por <br/> depois. escaparHtml nao
 * toca quebra de linha, entao o <br/> nasce como marcacao de verdade; inverter
 * os dois passos produziria &lt;br/&gt; no e-mail.
 */
function corpoDoEmailDeStatus(conteudo, order) {
  return `
        <div>
           <h2>${escaparHtml(conteudo.subject)}</h2>
           <p>${escaparHtml(conteudo.text).replace(/\n/g, "<br/>")}</p>
           <hr/>
           <p><strong>Resumo do Pedido:</strong></p>
           <p>Total: R$ ${Number(order.total_amount).toFixed(2)}</p>
           <br/>
           <a href="${URL_LOJA}/account">Ver Meus Pedidos</a>
        </div>
      `;
}
```

Substituir o bloco `html:` dentro de `sendStatusEmail` (linhas 87-97) por:

```js
        html: corpoDoEmailDeStatus(conteudo, order),
```

Acrescentar as duas ao `module.exports` no fim do arquivo:

```js
module.exports = {
  sendStatusEmail,
  sendAdminNewOrderEmail,
  sendAdminClubeSemEstoqueEmail,
  sendCartReminderEmail,
  conteudoDoLembreteDeCarrinho,
  conteudoDoStatus,
  corpoDoEmailDeStatus,
};
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd backend && node --test test/email_status.test.js
```

Esperado: PASS. **São 5 testes no arquivo entregue**: a revisão holística do ramo achou
que `sendAdminNewOrderEmail`, no MESMO arquivo, seguia interpolando `order_id` e
`payment_method` crus — e `payment_method` vem do corpo da requisição, filtrado só pelo
Mercado Pago (spec §1.1). Os dois passaram a `escaparHtml` e o quinto teste os fixa,
capturando a mensagem que o sender entrega ao Resend (este sender não tem corpo puro
para chamar).

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/emailSender.js backend/test/email_status.test.js
git commit -m "fix: o e-mail de status para de tratar nome do cliente como marcacao

Era o unico sender do arquivo que interpolava texto cru no HTML. O corpo sai
para uma funcao pura para o teste alcanca-lo sem banco nem Resend."
```

---

## Task 2: `backup-banco.sh` — permissões e senha fora do `argv`

**Files:**
- Create: `scripts/lib/conexao-pg.sh`
- Test: `backend/test/backup_conexao.test.js` (criar)
- Modify: `scripts/backup-banco.sh` (linhas 42, 68, 85, 97 e o cabeçalho)
- Modify: `scripts/backup-banco.cron.exemplo`

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/test/backup_conexao.test.js`:

```js
"use strict";

/**
 * As duas funcoes que tiram a senha do argv do pg_dump (scripts/lib/conexao-pg.sh).
 *
 * POR QUE TEM TESTE: a senha dentro de uma URI e percent-encoded, e libpq a
 * decodifica ao conectar. Mover o valor CRU para PGPASSWORD quebraria em
 * silencio toda senha com @, / ou % — exatamente os caracteres que obrigam a
 * codificacao. E falha silenciosa de backup so aparece no dia do desastre.
 *
 * Roda bash de verdade: Git Bash no Windows, bash do ubuntu-latest no CI.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const LIB = path.resolve(__dirname, "../../scripts/lib/conexao-pg.sh");

/**
 * A URI vai como ARGUMENTO ($2), nunca interpolada no texto do script: assim o
 * proprio teste nao depende de aspas do shell para valer.
 */
function rodar(funcao, uri) {
  return execFileSync(
    "bash",
    ["-c", `. "$1"; ${funcao} "$2"`, "bash", LIB, uri],
    { encoding: "utf8" },
  );
}

const senha = (uri) => rodar("senha_da_uri", uri);
const semSenha = (uri) => rodar("uri_sem_senha", uri);

test("senha simples", () => {
  assert.equal(
    senha("postgres://postgres:segredo@localhost:5432/postgres"),
    "segredo",
  );
});

test("senha com @ codificado", () => {
  assert.equal(
    senha("postgres://postgres:s%40gredo@localhost:5432/postgres"),
    "s@gredo",
  );
});

test("senha com / codificado", () => {
  assert.equal(senha("postgres://u:a%2Fb@localhost:5432/postgres"), "a/b");
});

test("senha com % codificado", () => {
  assert.equal(senha("postgres://u:a%25b@localhost:5432/postgres"), "a%b");
});

test("senha com barra invertida codificada", () => {
  assert.equal(senha("postgres://u:a%5Cb@localhost:5432/postgres"), "a\\b");
});

test("URI sem senha devolve vazio", () => {
  assert.equal(senha("postgres://postgres@localhost:5432/postgres"), "");
});

test("uri_sem_senha preserva usuario, host, porta e banco", () => {
  assert.equal(
    semSenha("postgres://postgres:segredo@localhost:5432/postgres"),
    "postgres://postgres@localhost:5432/postgres",
  );
});

test("uri_sem_senha preserva a query string", () => {
  assert.equal(
    semSenha("postgres://u:p@host:5432/db?sslmode=require"),
    "postgres://u@host:5432/db?sslmode=require",
  );
});

test("uri_sem_senha e no-op quando nao ha senha", () => {
  const uri = "postgres://postgres@localhost:5432/postgres";
  assert.equal(semSenha(uri), uri);
});

test("a senha nunca sobra na URI de saida", () => {
  for (const uri of [
    "postgres://postgres:segredo@localhost:5432/postgres",
    "postgres://u:s%40gredo@localhost:5432/postgres",
    "postgres://u:p@host:5432/db?sslmode=require",
  ]) {
    const saida = semSenha(uri);
    assert.ok(!saida.includes("segredo"), `sobrou senha em ${saida}`);
    assert.ok(!saida.includes("s%40gredo"), `sobrou senha em ${saida}`);
    assert.ok(!/:[^@/]*@/.test(saida.replace("://", "")), `sobrou userinfo com senha em ${saida}`);
  }
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd backend && node --test test/backup_conexao.test.js
```

Esperado: FALHA. `scripts/lib/conexao-pg.sh` não existe — o `bash` sai com erro
"No such file or directory" e o `execFileSync` lança.

- [ ] **Step 3: Escrever as funções**

Criar `scripts/lib/conexao-pg.sh`:

```sh
#!/usr/bin/env bash
#
# Tira a senha de uma URI de conexao do Postgres, para ela nao viajar no argv.
#
# POR QUE EXISTE: `pg_dump ... "$DATABASE_URL"` poe a senha em
# /proc/<pid>/cmdline, que e legivel por QUALQUER usuario local — um `ps aux`
# durante o dump entrega a credencial do papel postgres. /proc/<pid>/environ,
# ao contrario, so e legivel pelo dono do processo e pelo root; dai a senha ir
# por PGPASSWORD e a URI seguir sem ela.
#
# ARQUIVO SEPARADO porque estas duas funcoes sao PURAS e tem teste
# (backend/test/backup_conexao.test.js). A senha dentro de uma URI e
# percent-encoded e libpq a decodifica ao conectar; mover o valor cru para
# PGPASSWORD quebraria em silencio toda senha com @, / ou %.
#
# Uso:
#   . "$(dirname "$0")/lib/conexao-pg.sh"
#   PGPASSWORD="$(senha_da_uri "$DATABASE_URL")"; export PGPASSWORD
#   pg_dump ... "$(uri_sem_senha "$DATABASE_URL")"

# %40 -> @. O backslash literal e escapado ANTES para nao virar escape do %b.
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

# Imprime a senha ja decodificada. Vazio se nao houver userinfo ou senha.
senha_da_uri() {
  local autoridade
  autoridade="$(_autoridade_da_uri "${1-}")"
  case "$autoridade" in *@*) ;; *) return 0 ;; esac
  # O ULTIMO @ separa o userinfo (RFC 3986): senha com @ codificado nao pode
  # partir a URI no lugar errado.
  local userinfo="${autoridade%@*}"
  case "$userinfo" in *:*) ;; *) return 0 ;; esac
  _percent_decode "${userinfo#*:}"
}

# Imprime a URI sem a senha, preservando esquema, usuario, host, porta,
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
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd backend && node --test test/backup_conexao.test.js
```

Esperado: PASS. **O arquivo entregue tem 14 testes**, não os 10 deste rascunho: 11 são
das funções puras e 3 são o e2e do step 6. A revisão acrescentou "uri_sem_senha em URI
sem caminho" (o atalho óbvio para o sufixo devolvia a senha ali) e reescreveu "a senha
nunca sobra" para levar um segredo POR URI — procurar `segredo` numa URI que nunca o
teve é asserção que passa sozinha.

Em Windows são **13 pass + 1 skip**: o das permissões 600/700 não roda porque o Git
Bash não aplica modo de arquivo — quem o executa de verdade é a CI (ubuntu-latest), que
é também o sistema do alvo, a VPS.

- [ ] **Step 5: Aplicar as correções no `backup-banco.sh`**

Em `scripts/backup-banco.sh`:

Logo depois de `set -euo pipefail` (linha 42), acrescentar:

```sh
# O dump cobre catalogo, pedidos, clientes e o auth do GoTrue — PII completa
# mais hash de senha e refresh token. Com o umask padrao do operador (022) ele
# nasceria 0644 numa pasta 0755, legivel por qualquer usuario da VPS.
umask 077

# As duas funcoes que mantem a senha fora do argv do pg_dump. Ver o cabecalho
# de lib/conexao-pg.sh.
# shellcheck source=lib/conexao-pg.sh
. "$(dirname "$0")/lib/conexao-pg.sh"
```

Trocar a linha 68 (`mkdir -p "$BACKUP_DIR"`) por:

```sh
mkdir -p "$BACKUP_DIR"
# Explicito, e nao so herdado do umask: a pasta pode ja existir de uma execucao
# anterior, criada com outro umask.
chmod 700 "$BACKUP_DIR"
```

Trocar a linha 85 (o `pg_dump`) por:

```sh
# A senha vai por PGPASSWORD (so o dono do processo e o root leem
# /proc/<pid>/environ) e a URI segue SEM ela — /proc/<pid>/cmdline e legivel
# por qualquer usuario local, e um `ps aux` durante o dump entregaria a
# credencial do papel postgres. E a mesma disciplina que o backup-banco.cron.exemplo
# ja aplicava ao manter a URL fora da linha do cron.
PGPASSWORD="$(senha_da_uri "$DATABASE_URL")"
export PGPASSWORD
pg_dump --format=custom --compress=6 --no-owner --file "$PARCIAL" \
  "$(uri_sem_senha "$DATABASE_URL")"
```

**E o guarda entre o `export` e o `pg_dump`** (não estava neste rascunho; entrou na
revisão da task e é o que shippou, `scripts/backup-banco.sh:107-130`). Sem ele a
correção FALHA ABERTO: senha com `/`, `?` ou `#` CRU faz `_autoridade_da_uri` cortar
cedo, achar uma autoridade sem `@` e devolver senha vazia — e aí `uri_sem_senha`
devolve a URI INTEIRA, com a senha, de volta para o `argv` do `pg_dump`. Exatamente o
bug que este step remove, restaurado em silêncio e só nas senhas piores. Melhor
abortar:

```sh
# O teste é DE PROPÓSITO mais grosseiro que o parser: ele olha a URI CRUA, sem
# cortar em / ? #. É essa diferença que pega o caso perigoso — senha com / crua
# faz o parser cortar cedo, achar autoridade sem @ e devolver senha vazia,
# enquanto o glob ainda enxerga o :...@ e reprova. NÃO troque este glob por
# algo que corte em / ? # — olhar a autoridade já analisada repete o mesmo
# engano e não pega nada.
#
# O preço é um falso positivo conhecido: URI SEM senha cuja query traga um @
# cru depois do : da porta (…host:5432/db?opt=a@b) também aborta. Aborta com
# mensagem, e não vazando — e o @ ali deveria ser %40 de qualquer forma.
case "$DATABASE_URL" in
  *://*:*@*)
    [ -n "$PGPASSWORD" ] || {
      echo "ERRO: a DATABASE_URL tem senha mas não consegui extraí-la." >&2
      echo "Percent-encode / ? # na senha (%2F %3F %23) — ver lib/conexao-pg.sh." >&2
      exit 1; } ;;
esac
```

Como o guarda reprova uma URI que o operador escreveria de boa-fé, `docs/deploy.md`
§10 passa a dizer, junto do template da `DATABASE_URL`, que `/ ? #` na senha precisam
vir percent-encoded (`%2F %3F %23`), e o `README.md` ganha o `lib/conexao-pg.sh` no
mapa de arquivos.

Trocar a linha 97 (`mv "$PARCIAL" "$ARQUIVO"`) por:

```sh
mv "$PARCIAL" "$ARQUIVO"
chmod 600 "$ARQUIVO"
```

No cabeçalho, acrescentar ao fim do bloco de comentário do topo (depois da linha 40):

```sh
# A SENHA NAO TRAFEGA NO argv: o script exporta PGPASSWORD e entrega ao pg_dump
# a URI ja sem credencial (lib/conexao-pg.sh). O dump e a pasta nascem 600/700.
```

- [ ] **Step 6: Verificar o script RODANDO o script**

Este step pedia `bash -n` (sintaxe) mais um `bash -c` na função. Não bastava, e é por
isso que o que shippou é outra coisa: **os 11 testes das funções puras passam inteiros
com a linha do `pg_dump` revertida para `"$DATABASE_URL"`**. Eles provam que a
biblioteca sabe tirar a senha; nada provava que o backup a usa — que é o motivo do
commit. Verificação que sobrevive à mutação que ela deveria pegar não é verificação.

O que entrou no lugar, em `backend/test/backup_conexao.test.js` (função `rodarBackup`,
~1s, sem Postgres nenhum):

- `pg_dump` e `pg_restore` **falsos** escritos num diretório temporário que entra na
  frente do `PATH`. O de `pg_dump` anota o `argv` e o `PGPASSWORD` que recebeu e cria o
  arquivo de `--file` — senão o `pg_restore --list` e o `mv` seguintes não teriam o que
  abrir. Os dois nascem com `mode: 0o755`: sem o bit de execução, a busca do `PATH`
  PULA o shim e o script acha o `pg_dump` real do runner (Git Bash não aplica modo, então
  o defeito só apareceria na CI);
- o script roda de verdade (`spawnSync("bash", [SCRIPT])`), com `DATABASE_URL`,
  `BACKUP_DIR` e os caminhos dos logs pelo **ambiente** — nada interpolado no texto do
  shim, para o teste não depender de escapar caminho de Windows;
- `BACKUP_ENV` aponta para um arquivo que não existe, para o `set -a` do step 5 não
  poder carregar `/etc/canastra/backup.env`. Este repositório fica clonado na VPS: sem
  isso, um `npm test` lá dentro dumparia o banco real e a retenção do script apagaria
  dumps reais.

Os três casos: (12) `PGPASSWORD` chega decodificada e a senha não aparece no `argv`,
nem crua nem codificada, e o `.dump` verificado existe; (13) senha com `/` cru aborta —
status 1, mensagem, e `pg_dump` nem foi chamado (é o guarda do step 5); (14) pasta 700
e dump 600, **skip fora de Linux**.

- [ ] **Step 7: Atualizar o cron de exemplo**

Em `scripts/backup-banco.cron.exemplo`, no bloco de comentário que já explica por que a
`DATABASE_URL` fica fora da linha do cron, acrescentar:

```
# O script fecha o outro lado dessa mesma disciplina: a senha nao vai no argv do
# pg_dump (vai por PGPASSWORD), entao `ps aux` durante o backup tambem nao a mostra.
```

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/conexao-pg.sh scripts/backup-banco.sh \
        scripts/backup-banco.cron.exemplo backend/test/backup_conexao.test.js
git commit -m "fix: o backup para de expor o dump e a senha do postgres

Dump e pasta nascem 600/700 (eram 644/755 com o umask padrao) e a senha sai do
argv do pg_dump — o cron de exemplo ja dizia que a process list vaza, e o
script contradizia a propria justificativa."
```

---

## Task 3: `conferirFrete` devolve o método conferido

**Files:**
- Modify: `backend/src/controllers/PaymentController.js` — `conferirFrete` (linhas 70-129),
  o consumo em 735 e em 839-840
- Test: `backend/test/f4_status_e_frete.test.js` (existente)
- Test: `backend/test/pagamento.test.js` (existente) — os dublês de cotação passam a ter
  `name` nas opções falsas: sem isso os testes de PREÇO passariam pelo motivo errado
  (409 por nome divergente, e não pelo que cada um afirma). É lá, e só lá, que o **par
  cruzado** existe — o dublê devolve PAC e SEDEX na mesma cotação
- Test: `backend/test/f4_checkout_e_webhook.test.js` (existente) — o checkout passa a
  conferir `metodo_envio` na coluna. Ver a nota do self-review: sem essa asserção,
  reverter a linha da gravação não quebrava teste nenhum
- Modify: `backend/src/controllers/ShippingController.js` — só o comentário do frete
  grátis, que dizia "qualquer opção real casa com o zero" e agora aponta o nome como o
  que separa uma opção da outra depois do zero

Hoje `conferirFrete` devolve um número e casa só por preço, contra o **conjunto** de
opções. O pedido pode gravar `metodo_envio = "Correios SEDEX"` cobrando o preço do PAC.
A linha 838 já comenta "o frete gravado no pedido e o CONFERIDO, nao o que o cliente
mandou" — e a linha seguinte grava o método cru. Esta task faz a linha 840 cumprir o que
a 838 promete.

**Antes de escrever os testes:** abra `backend/test/f4_status_e_frete.test.js` e veja a
forma dos `itens` que os testes de frete existentes já passam para `conferirFrete`. Reuse
exatamente essa forma nos casos novos, em vez da forma genérica abaixo, se ela diferir.
O ambiente do arquivo aponta `MELHOR_ENVIO_URL` para uma porta fechada de propósito
(linha 53), então a única opção cotada é a `Entrega Local` — `price: 0` quando a
quantidade total é ≥ 3, `price: 5` abaixo disso (ver `ShippingController.js:87-95`).

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao fim de `backend/test/f4_status_e_frete.test.js`:

```js
/**
 * O PAREAMENTO metodo/preco. Antes, `conferirFrete` casava so o NUMERO contra o
 * conjunto de opcoes: mandar o preco do PAC com o nome do SEDEX passava, e o
 * pedido gravava um metodo que ninguem cotou.
 */

const ITENS_UM = [{ product_id: "11111111-0000-0000-0000-000000000001", quantity: 1, price: 50 }];

// Titulo entregue. Era "…e devolvem o nome canonico", que ali e INFALSIFICAVEL: o
// casamento e igualdade exata de string, entao devolver o campo cru da requisicao
// passaria byte a byte. A canonicalizacao quem prova e a retirada, mais abaixo.
test("método e preço casados passam e devolvem os dois", async () => {
  const conferido = await conferirFrete({
    address: { zip_code: CEP_LOCAL },
    itens: ITENS_UM,
    shippingCost: 5,
    shippingMethod: "Entrega Local",
  });

  assert.deepEqual(conferido, { valor: 5, metodo: "Entrega Local" });
});

// Titulo entregue. Era "preco de uma opcao com o nome de outra e recusado", cenario
// que ESTE arquivo nao consegue montar: com MELHOR_ENVIO_URL numa porta fechada a
// cotacao tem UMA opcao, e "Correios SEDEX" nao e outra opcao — e um nome AUSENTE. O
// par cruzado mora em pagamento.test.js, cujo duble devolve PAC e SEDEX juntos.
test("nome que não está na cotação é recusado, mesmo com preço real", async () => {
  await assert.rejects(
    () =>
      conferirFrete({
        address: { zip_code: CEP_LOCAL },
        itens: ITENS_UM,
        shippingCost: 5,
        shippingMethod: "Correios SEDEX",
      }),
    (erro) => erro.status === 409,
    "o preco da entrega local nao pode passar como SEDEX",
  );
});

test("requisicao sem metodo e recusada em vez de virar 'Retirada' com frete", async () => {
  // O caso latente de antes: sem metodo, escapava do atalho de retirada, casava
  // com um preco real e era gravado como "Retirada" com frete maior que zero.
  await assert.rejects(
    () =>
      conferirFrete({
        address: { zip_code: CEP_LOCAL },
        itens: ITENS_UM,
        shippingCost: 5,
        shippingMethod: undefined,
      }),
    (erro) => erro.status === 409,
  );
});

test("retirada segue devolvendo zero sem cotar", async () => {
  const conferido = await conferirFrete({
    address: { zip_code: CEP_LOCAL },
    itens: ITENS_UM,
    shippingCost: 0,
    shippingMethod: "Retirada na loja",
  });

  assert.equal(conferido.valor, 0);
  assert.equal(conferido.metodo, "Retirada");
});

test("com frete gratis, o casamento por nome ainda identifica a opcao", async () => {
  // Piso default de 0009: 14900 centavos. Acima dele TODA opcao vira price 0
  // (ShippingController) — e o preco sozinho deixa de distinguir qualquer coisa.
  //
  // QUANTIDADE 2, DE PROPOSITO: com 3 ou mais a Entrega Local ja custa 0 pela
  // regra local (ShippingController:91), e o teste passaria sem nunca exercitar
  // o piso. Com 2 o preco base e 5, entao o zero so pode ter vindo do frete
  // gratis. 2 × R$ 80 = R$ 160 = 16000 centavos, acima do piso de 14900.
  const itensCaros = [
    { product_id: "11111111-0000-0000-0000-000000000001", quantity: 2, price: 80 },
  ];

  const conferido = await conferirFrete({
    address: { zip_code: CEP_LOCAL },
    itens: itensCaros,
    shippingCost: 0,
    shippingMethod: "Entrega Local",
  });

  assert.deepEqual(conferido, { valor: 0, metodo: "Entrega Local" });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

```bash
cd backend && node --test test/f4_status_e_frete.test.js
```

Esperado: FALHA. `conferirFrete` ainda devolve um número, então
`assert.deepEqual(conferido, { valor: 5, ... })` falha com `5 !== { valor: 5, ... }`, e o
caso do nome trocado passa quando deveria dar 409.

- [ ] **Step 3: Mudar `conferirFrete`**

Em `backend/src/controllers/PaymentController.js`, no atalho de retirada (linhas 85-93),
trocar `return 0;` por:

```js
    return { valor: 0, metodo: "Retirada" };
```

Trocar o bloco `combina` (linhas 116-126) por:

```js
  /**
   * CASA NOME **E** PRECO, nao so o preco. Antes era `.some()` sobre o valor,
   * contra o CONJUNTO de opcoes: o preco do PAC com o nome do SEDEX passava, e
   * o pedido nascia com um metodo que ninguem cotou — a operacao comprava a
   * etiqueta cara lendo uma string que o cliente escolheu.
   *
   * O nome sai da opcao COTADA, nunca do corpo da requisicao. E quando o frete
   * gratis zera TODAS as opcoes (ShippingController), o nome e a unica coisa
   * que ainda distingue uma da outra.
   */
  const escolhida = opcoes.find(
    (o) =>
      String(o.name) === String(shippingMethod) &&
      Math.abs(Number(o.price) - valor) <= TOLERANCIA_FRETE,
  );

  if (!escolhida) {
    const erro = new Error(
      "O frete mudou desde que você escolheu. Recalcule e tente de novo.",
    );
    erro.status = 409;
    throw erro;
  }

  return { valor: Number(escolhida.price), metodo: String(escolhida.name) };
```

- [ ] **Step 4: Atualizar os dois consumos**

Na linha 735 (dentro do cálculo de `finalAmountToCharge`), trocar `freteConferido` por:

```js
          freteConferido.valor
```

Nas linhas 839-840, trocar por:

```js
          shippingCost: freteConferido.valor,
          // O METODO tambem e o conferido: a linha acima ja dizia isso do valor,
          // e o metodo continuava vindo cru do corpo da requisicao.
          shippingMethod: freteConferido.metodo,
```

- [ ] **Step 5: Rodar o arquivo de teste e confirmar que passa**

```bash
cd backend && node --test test/f4_status_e_frete.test.js
```

Esperado: PASS, incluindo os 5 casos novos e os que já existiam no arquivo.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/PaymentController.js backend/test/f4_status_e_frete.test.js
git commit -m "fix: o pedido para de gravar um frete que ninguem cotou

conferirFrete casava so o numero contra o conjunto de opcoes: o preco da
entrega local passava com o nome do SEDEX. Passa a casar nome e preco e a
devolver { valor, metodo }, e a gravacao usa o metodo conferido."
```

---

## Task 4: Verificação final

**Files:** nenhum (só verificação)

- [ ] **Step 1: Rodar a suíte inteira do backend**

```bash
cd backend && npm test
```

Esperado: todos os arquivos passam. A mudança de contrato do `conferirFrete` é a de maior
alcance — se algum outro teste consumia o retorno como número, ele aparece aqui. Os
suspeitos são `test/pagamento.test.js` e `test/f4_checkout_e_webhook.test.js`.

- [ ] **Step 2: Se algo quebrou, corrigir o consumo (não o contrato)**

Qualquer teste que trate o retorno como número passa a ler `.valor`. O contrato novo é o
correto; não reverta.

- [ ] **Step 3: Confirmar que nada além do previsto mudou**

```bash
git status --porcelain
git log --oneline
```

Esperado: árvore limpa, e sobre o commit da spec **um commit por task mais os das
revisões**. Este passo dizia "três commits de correção" e o ramo tem mais: cada revisão
de qualidade (o guarda que aborta, os shims executáveis, os títulos de teste que
prometiam o que não exercitavam) virou commit próprio, de propósito — a mensagem de
cada um é onde o motivo da correção fica registrado. Contar commits não é o critério;
o critério é não haver nada fora das tasks.

---

## Self-review

**Cobertura da spec:**
- §1 (escapar HTML) → Task 1, incluindo a extração de `corpoDoEmailDeStatus` que a spec
  exige para o teste ser possível. §1.1 (o aviso do admin) → mesma Task 1, step 4.
- §2 problema A (permissões) → Task 2 steps 5 (`umask 077`, `chmod 700`, `chmod 600`).
- §2 problema B (senha no argv) → Task 2 steps 1-5, **guarda de fail-closed incluído**:
  sem ele a correção falha aberta justamente nas senhas com `/ ? #` cru.
- §2 documentação → Task 2 steps 5 (cabeçalho do script, `docs/deploy.md` §10 e o
  `README.md`) e 7 (cron).
- §3 (pareamento) → Task 3, com os 6 casos de teste da spec cobertos pelos 5 testes novos
  mais os existentes do arquivo. **Correção deste parágrafo:** o caso "o pedido gravado
  recebe o método conferido" NÃO era "verificado pela suíte inteira na Task 4" — reverter
  a linha da gravação não quebrava teste nenhum, e foi a mutação que mostrou isso. Quem o
  cobre hoje é a asserção acrescentada em `f4_checkout_e_webhook.test.js` ("checkout grava
  canastra.pedidos…"), que lê `frete` e `metodo_envio` na coluna e exige `0` e
  `"Retirada"` onde o corpo da requisição mandou `"Retirada na loja"`. Cobertura só
  existe onde alguma asserção morre quando o código morre — "a suíte inteira roda" não é
  cobertura de nada.
- Fora de escopo (token da newsletter) → nenhuma task, como especificado.

**Consistência de tipos:** `conferirFrete` devolve `{ valor: number, metodo: string }` na
Task 3 step 3, e é consumido como `.valor`/`.metodo` no step 4 e nos testes do step 1.
`corpoDoEmailDeStatus(conteudo, order)` tem a mesma assinatura na Task 1 step 1 (teste) e
step 3 (implementação). `senha_da_uri`/`uri_sem_senha` recebem um argumento e imprimem em
stdout, igual na Task 2 steps 1 e 3.

**Placeholders:** nenhum. Todo passo que muda código mostra o código.
