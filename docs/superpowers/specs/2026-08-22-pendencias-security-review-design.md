# Pendências da security review — design

Data: 2026-08-22
Branch: `pendencias-security-review`

## Contexto

A security review da leva F4–F7 (`git diff 5f85137~1 HEAD`, 202 arquivos) não encontrou
vulnerabilidade explorável: os quatro candidatos levantados foram rejeitados na
verificação independente. Mas três deles são defeitos reais de higiene ou de
integridade, que a review descartou por não terem caminho de ataque — não por
estarem corretos. É isso que este documento endereça.

O que a review confirmou como sólido e **não** se mexe aqui: HMAC do webhook do
Mercado Pago, recomputação do total no servidor, o portão do painel via
`getUser()` + tabela `admins`, e a RLS das quatro tabelas novas.

## Escopo

| # | Correção | Origem |
|---|---|---|
| 1 | Escapar HTML no `sendStatusEmail` | Observação sub-limiar da review |
| 2 | `backup-banco.sh`: permissões + senha fora do `argv` | Dois candidatos rejeitados (confiança 3) |
| 3 | `conferirFrete`: parear método com preço | Candidato rejeitado (confiança 3) |

### Fora de escopo, com motivo

**Token assinado no descadastro da newsletter.** O código já registra a decisão e a
justificativa em `newsletter.routes.js:88-102`: nenhuma campanha sai hoje, então não
existe e-mail onde o link assinado pudesse viajar; o token nasce junto da campanha,
com double opt-in. Implementar agora significa inventar um canal de entrega que não
existe. O risco e a pendência já estão escritos em `docs/seguranca-dados-pessoais.md`.
Isto é uma decisão registrada, não um esquecimento — e continua valendo.

---

## 1. Escapar HTML no `sendStatusEmail`

### Problema

`emailSender.js:87-97` monta o corpo com `conteudo.subject` e `conteudo.text` crus.
`conteudo.text` carrega dois valores que não são marcação:

- `nome`, lido de `canastra.clientes.nome` — texto que o próprio cliente cadastrou;
- `trackingCode`, digitado por um admin no painel.

Todos os outros senders do arquivo já passam por `escaparHtml` — `conteudoDoLembreteDeCarrinho`
(linhas 222, 230) e `sendAdminClubeSemEstoqueEmail` (linhas 178-181). Este é o único
que não passa, e a inconsistência é com a convenção do próprio arquivo.

O destinatário é sempre o dono do pedido, então não há impacto entre usuários — foi
por isso que a review não a classificou como vulnerabilidade. Continua sendo um
defeito de consistência que custa uma linha.

### Solução

Escapar **no template**, não na origem. `escaparHtml` não toca `\n`, então o
`replace` que transforma quebra de linha em `<br/>` continua funcionando depois do
escape — e `conteudo.text` permanece texto plano de verdade, útil para um eventual
corpo `text:` no futuro.

```js
<h2>${escaparHtml(conteudo.subject)}</h2>
<p>${escaparHtml(conteudo.text).replace(/\n/g, "<br/>")}</p>
```

O `subject` é derivado só de `order_id.slice(0, 8)` e de literais, mas entra no escape
pela mesma disciplina: quem lê o template não deveria ter de provar, campo por campo,
qual interpolação é segura.

`Number(order.total_amount).toFixed(2)` já é numérico e fica como está.

#### Extrair o corpo para poder testá-lo

Hoje o HTML é montado inline dentro de `sendStatusEmail`, que consulta o banco e chama
o Resend — não há como afirmar sobre o corpo sem tocar os dois. O corpo sai para uma
função pura, exportada:

```js
function corpoDoEmailDeStatus(conteudo, order) { /* devolve a string HTML */ }
```

É exatamente o recorte que `conteudoDoLembreteDeCarrinho` (linha 216) já faz no mesmo
arquivo, pelo mesmo motivo, e com o mesmo comentário justificando: "separado do envio
para o teste afirmar assunto e conteúdo sem tocar o Resend". `sendStatusEmail` passa a
chamá-la.

### Testes

Novo `backend/test/email_status.test.js`, sobre `conteudoDoStatus` e `corpoDoEmailDeStatus`
— nenhum dos dois toca banco ou Resend:

1. `nome` = `<img src=x onerror=alert(1)>` sai escapado no HTML final;
2. `trackingCode` = `AA<BB>CC` sai escapado;
3. o `\n` que separa a linha do rastreio continua virando `<br/>` (não vira `&lt;br/&gt;`,
   nem some);
4. o `subject` do `<h2>` sai escapado.

`conteudoDoStatus` e `corpoDoEmailDeStatus` passam a ser exportados para o teste
alcançá-los.

---

## 2. `backup-banco.sh`: permissões e senha

### Problema A — o dump nasce legível por todos

O script cria o destino e escreve o dump sem `umask` nem `chmod`. Com o umask padrão
do operador (022, que o `backup-banco.cron.exemplo` assume), `/var/backups/canastra`
fica 0755 e `canastra-*.dump` fica 0644. O dump cobre "catálogo, pedidos, clientes,
auth do GoTrue" (cabeçalho do próprio script, linhas 39-40) — ou seja, PII completa
mais hashes de senha e refresh tokens.

### Problema B — a senha viaja no `argv`

```sh
pg_dump --format=custom --compress=6 --no-owner --file "$PARCIAL" "$DATABASE_URL"
```

`DATABASE_URL` embute a senha do papel `postgres`. `/proc/<pid>/cmdline` é legível por
qualquer usuário local, então `ps aux` mostra a credencial enquanto o dump roda.

O agravante é a contradição: `backup-banco.cron.exemplo:6-7` afirma que a URL fica
fora da linha do cron justamente porque "process list, idem" — e o script desfaz a
disciplina um passo depois.

### Solução

**Permissões** — três linhas, explícitas, sem depender do umask de quem chama:

```sh
umask 077                      # logo após `set -euo pipefail`
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
mv "$PARCIAL" "$ARQUIVO";      chmod 600 "$ARQUIVO"
```

**Senha** — novo `scripts/lib/conexao-pg.sh` com duas funções puras, e o script passando
a exportar `PGPASSWORD` e a entregar ao `pg_dump` a URI já sem credencial:

```sh
. "$(dirname "$0")/lib/conexao-pg.sh"
PGPASSWORD="$(senha_da_uri "$DATABASE_URL")"; export PGPASSWORD
pg_dump --format=custom --compress=6 --no-owner \
        --file "$PARCIAL" "$(uri_sem_senha "$DATABASE_URL")"
```

`DATABASE_URL` continua sendo a interface única — é o que o cabeçalho do script valoriza
("é a mesma conexão do `backend/src/.env`"). `/proc/<pid>/environ`, ao contrário de
`cmdline`, só é legível pelo dono do processo e pelo root.

#### Por que as funções são um arquivo separado

A senha dentro de uma URI é **percent-encoded**, e libpq a decodifica ao conectar.
Mover o valor cru para `PGPASSWORD` quebraria em silêncio qualquer senha contendo
`@`, `/`, `:` ou `%` — exatamente os caracteres que obrigam a codificação. A decodificação
tem casos de borda suficientes para merecer teste, e função pura em arquivo próprio é
o que a torna testável.

Contratos:

- `senha_da_uri <uri>` → imprime a senha já decodificada; string vazia se a URI não
  tiver userinfo ou não tiver senha.
- `uri_sem_senha <uri>` → imprime a URI preservando esquema, usuário, host, porta,
  caminho e query, sem a senha. URI sem senha volta inalterada.

Ambas cortam a autoridade em `/`, `?` e `#`, e tomam o **último** `@` como separador
do userinfo (RFC 3986) — uma senha com `@` codificado não pode partir a URI no lugar
errado.

### Testes

Novo `backend/test/backup_conexao.test.js`, que roda as funções via `bash -c` e afirma
sobre a saída:

| Caso | URI | Esperado |
|---|---|---|
| senha simples | `postgres://postgres:segredo@localhost:5432/postgres` | `segredo` |
| `@` codificado | `...:s%40gredo@localhost...` | `s@gredo` |
| `/` codificado | `...:a%2Fb@localhost...` | `a/b` |
| `%` codificado | `...:a%25b@localhost...` | `a%b` |
| barra invertida | `...:a%5Cb@localhost...` | `a\b` |
| sem senha | `postgres://postgres@localhost:5432/postgres` | vazio |
| query preservada | `...@host:5432/db?sslmode=require` | `uri_sem_senha` mantém `?sslmode=require` |
| a senha some | qualquer uma acima | saída de `uri_sem_senha` não contém a senha |

Dependência: `bash` no PATH. Existe no Git Bash local e no `ubuntu-latest` do CI.

### Documentação

O cabeçalho do script e o `backup-banco.cron.exemplo` ganham a nota de que a senha não
trafega mais no `argv`, fechando a contradição apontada acima. `docs/deploy.md` §5.6
menciona as permissões 700/600 do destino.

---

## 3. `conferirFrete`: parear método com preço

### Problema

`PaymentController.js:116-118` valida só o número, contra o **conjunto** de opções:

```js
const combina = opcoes.some(
  (o) => Math.abs(Number(o.price) - valor) <= TOLERANCIA_FRETE,
);
```

Nada exige que o preço pertença à opção que o cliente diz ter escolhido. `shippingMethod`
só é consultado no atalho de retirada (linha 85) e depois é gravado cru (linha 840).

Consequência: o pedido pode registrar `metodo_envio = "Correios SEDEX"` cobrando o preço
do PAC. Existe um caso latente adicional — requisição **sem** método escapa do atalho de
retirada, casa com um preço real, e é gravada como `"Retirada"` com frete maior que zero,
por causa do `shippingMethod || "Retirada"`.

Este código é anterior à leva revisada e nada automatizado consome `metodo_envio` (o Bling
recebe o `shipping_cost` conferido; o método vai como texto livre em `observacoes`). Por
isso a review o rejeitou como vulnerabilidade. Segue sendo integridade de dado errada.

### Solução

`conferirFrete` passa a devolver `{ valor, metodo }` e a casar por **nome + preço**:

```js
const escolhida = opcoes.find(
  (o) => String(o.name) === String(shippingMethod) &&
         Math.abs(Number(o.price) - valor) <= TOLERANCIA_FRETE,
);
if (!escolhida) { /* 409 FRETE_MUDOU, mesma frase de hoje */ }
return { valor: Number(escolhida.price), metodo: String(escolhida.name) };
```

O atalho de retirada devolve `{ valor: 0, metodo: "Retirada" }`, mantendo a constante
que o site de gravação já usava como padrão.

O site de gravação passa a usar o método **conferido**:

```js
shippingCost: freteConferido.valor,
shippingMethod: freteConferido.metodo,   // nunca mais o campo cru da requisição
```

O frete grátis não atrapalha: quando o piso é atingido, `ShippingController.js:171-177`
zera o `price` de **todas** as opções preservando o `name`, então o casamento por nome
continua exato — e é justamente nesse estado que a comparação só por preço fica ambígua.

### Trade-off assumido

O casamento fica estrito: preço sem nome, ou nome que não existe na cotação, passa a
receber 409 em vez de ser aceito. A frase do 409 já é "O frete mudou desde que você
escolheu. Recalcule e tente de novo.", que se resolve sozinha na tela. O frontend manda
`shippingMethod: dados.frete.name` (`frontend/lib/sacola/checkout.ts`), então o caminho
normal não muda. Sessões de checkout abertas no momento do deploy podem ver um 409 e
recalcular — custo aceitável.

### Pontos de mudança

`conferirFrete` é chamado uma vez (linha 558) e o retorno é usado em dois lugares
(linhas 735 e 839-840); é exportado em `module.exports.conferirFrete` (linha 1253) e
consumido pelos testes. Todos os quatro passam a falar `{ valor, metodo }`.

`ClubeController.js:781` grava `shippingMethod: "Clube da Canastra"` por um caminho que
não passa por `conferirFrete` — não é afetado.

### Testes

Em `backend/test/f4_status_e_frete.test.js` (existente):

1. nome e preço casados → passa, e devolve o nome canônico da opção;
2. preço de uma opção com o nome de outra → 409;
3. frete grátis (todas as opções `price: 0`) → casa pelo nome, devolve o nome certo;
4. retirada → segue devolvendo `valor: 0` sem cotar;
5. requisição sem `shippingMethod` com preço válido → 409 (o caso latente de hoje);
6. o pedido gravado recebe o método conferido, não o campo cru.

---

## Ordem de execução

As três correções são independentes — arquivos distintos, sem sobreposição. Podem ser
implementadas em paralelo, cada uma por TDD (teste vermelho antes do código).

A verificação final roda `npm test` no `backend/` inteiro, para garantir que a mudança
de contrato do `conferirFrete` não quebrou nenhum dos 25 arquivos de teste existentes.
