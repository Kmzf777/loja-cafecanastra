# Colocar a loja em produção

Guia operacional do Café Canastra na VPS: o que existe, o que subir, em que
ordem, e as falhas que acontecem **em silêncio** — que é para isso que este
documento serve.

> **Leia isto antes de qualquer coisa: a loja ainda NÃO sobe inteira.**
> Só a fundação de dados (fase F1) está pronta, e **nada foi aplicado na VPS
> ainda**. O que dá para fazer hoje é criar o schema `canastra` num Postgres
> Supabase e semear o catálogo. O resto — login pelo GoTrue, imagens no Storage,
> serviço Node enxuto, painel novo — é F2 a F7 e não existe.
> O desenho completo está em
> `docs/superpowers/specs/2026-08-17-supabase-selfhosted-design.md`.

---

## 1. Em que pé isto está

| Fase | Escopo | Estado |
|---|---|---|
| **F1** | Schema `canastra`, migrações versionadas, RLS provada por teste positivo **e** negativo, `clientes`/`admins`, RPC `fundir_sacola`, seed contra o GoTrue | **pronta**, não aplicada na VPS |
| F2 | GoTrue assume cadastro, login, confirmação e reset; `@supabase/ssr`; fusão da sacola no login | não existe |
| F3 | Bucket `canastra-produtos` no Storage; saída do Cloudinary | não existe |
| F4 | Vitrine e painel lendo o catálogo direto do Supabase | não existe |
| F5 | Serviço Node enxuto (5 endpoints), transação e idempotência no webhook | não existe |
| F6 | Painel novo em App Router; `frontend/legacy/` apagado; CSP fechado | não existe |
| F7 | Proxy reverso, backup agendado, verificação ponta a ponta | não existe |

**O que isso significa na prática.** Hoje o Express continua com autenticação
própria (`bcrypt` + `jsonwebtoken`) lendo as tabelas antigas em `public`, e o
painel continua sendo a ilha React em `frontend/legacy/`. As tabelas de
`canastra` estão prontas e **ninguém as usa ainda**. Aplicar as migrações não
liga a loja; prepara o terreno.

Enquanto F2–F6 não chegarem, o `.env` do serviço Express ainda precisa de
`JWT_SECRET`, `JWT_SECRET_REFRESH` e `CLOUDINARY_*`. Elas estão marcadas como
"EM SAÍDA" em `backend/src/.env.example` de propósito: apagá-las agora derrubaria
o serviço que está de pé sem substituir nada.

---

## 2. Topologia alvo

Tudo numa VPS só, atrás de um proxy reverso (nginx, Caddy ou Traefik — é
parâmetro de deploy, não afeta o desenho):

```
                    proxy reverso (VPS)
                              │
      ┌───────────────────────┼────────────────────────┐
      │                       │                        │
 <domínio-loja>         <domínio-loja>/api/*    <domínio-supabase>
      ▼                       ▼                        ▼
 Next 15 (Node)         serviço Node            Kong → PostgREST
 vitrine + painel       MP · webhook            GoTrue · Storage
                        frete · e-mail                  │
      │                       │                         ▼
      └───── supabase-js ─────┴──────────────────►  Postgres
                 anon key      service_role     (instância compartilhada)
```

Três consequências operacionais:

1. **Vitrine e API na mesma origem** (a API sob `/api/*`). É o que faz o cookie
   de sessão ser first-party e `SameSite=Lax`. A versão anterior desta loja
   tinha vitrine e API em domínios diferentes, e `SameSite=None; Secure` mais
   `CORS_ORIGIN` eram os dois pontos onde o deploy quebrava calado. Essa classe
   de bug some com a topologia nova.
2. **O navegador fala com o Supabase direto** para catálogo, carrinho, endereços
   e painel, com a `anon key` e RLS. É header `Authorization`, não cookie — o
   Supabase estar noutro subdomínio não cria problema de credencial em CORS.
3. **O serviço Node é a única peça com a `service_role key`** e com os segredos
   de Mercado Pago, Melhor Envio e Resend. É a fronteira de confiança. A
   `service_role key` **nunca** entra em variável `NEXT_PUBLIC_*`, porque tudo
   que é `NEXT_PUBLIC_*` vai embutido no bundle que qualquer visitante baixa.

---

## 3. Subir o banco

Este é o único passo executável hoje.

### 3.1 Variáveis

| Variável | Para quê | Sem ela |
|---|---|---|
| `DATABASE_URL` | Postgres da instância Supabase. O papel precisa de `CREATE` no banco. | `db:migrar` e `db:seed` **recusam rodar** (ver §5.1) |
| `SUPABASE_URL` | origem pública da instância (o que o Kong atende) | `db:seed` **falha** ao criar a conta inicial |
| `SUPABASE_SERVICE_ROLE_KEY` | chave `service_role`; é com ela que o seed fala com a Admin API do GoTrue | idem |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são novas nesta fase e **não são
opcionais quando `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` estão preenchidas**. O
seed levanta erro em vez de pular a etapa: pular em silêncio deixaria a produção
no ar com ninguém capaz de entrar no painel, e o sintoma só apareceria dias
depois, quando alguém tentasse mudar um preço.

**Saíram:** `SEED_ADMIN_ROLE` (ser administrador é uma **linha** em
`canastra.admins`, nunca um claim de JWT), e, quando F2/F3 chegarem, `JWT_SECRET`,
`JWT_SECRET_REFRESH` e `CLOUDINARY_*`.

### 3.2 Ordem

```bash
export DATABASE_URL="postgres://postgres:SENHA@HOST:5432/postgres"
export SUPABASE_URL="https://supabase.SEU-DOMINIO"
export SUPABASE_SERVICE_ROLE_KEY="..."

npm run db:migrar    # aplica as migrações pendentes, em ordem, em transação
npm run db:seed      # popula o catálogo e cria a conta inicial no GoTrue
```

`npm run db:setup` faz os dois na ordem certa.

**Não é preciso ter `psql` na máquina de deploy.** O runner é
`backend/db/migrar.js` e usa o driver `pg`; a versão antiga desta documentação
mandava rodar `psql -f schema.sql`, e aquele arquivo não existe mais.

**`db:migrar` pode rodar a cada deploy.** Cada arquivo de
`backend/db/migrations/` roda **uma vez**, dentro da própria transação, e fica
registrado em `canastra.migracoes`. Rodar de novo responde "Nada pendente.".

**`db:seed` é idempotente, e o sentido disso importa.** Produtos são casados por
um UUID v5 derivado do `sku` — o `produto_id` nunca muda entre execuções, o que
mantém pedidos e itens de sacola antigos apontando para o lugar certo — e a
inserção é `ON CONFLICT DO NOTHING`. Ou seja: **o seed nunca sobrescreve preço,
estoque nem configuração da loja.** Essa metade do catálogo passa a pertencer ao
painel a partir da primeira semeadura. A versão anterior fazia `DO UPDATE` e o
efeito era reverter, a cada deploy, o preço e o estoque que o administrador
tinha acabado de corrigir — sem erro e sem log, descoberto só quando um cliente
pagasse o valor velho ou comprasse café esgotado. Pelo mesmo motivo, `db:seed`
**nunca toca a senha de uma conta que já existe** no GoTrue.

### 3.3 Configuração do PostgREST — o erro nº 1 de primeiro deploy

**`PGRST_DB_SCHEMAS` precisa incluir `canastra`.**

```
PGRST_DB_SCHEMAS=public,storage,graphql_public,canastra
```

Sem isso, **toda rota da loja responde 404 com as migrações perfeitamente
aplicadas** — inclusive a RPC `fundir_sacola`, que só aparece em
`/rest/v1/rpc/` se o schema estiver listado. Nada no banco reclama, nada no log
aponta para cá, e a leitura natural do 404 é "a migração não rodou" — que é
exatamente a conclusão errada. Depois de alterar, reinicie o container do
PostgREST (ou mande `NOTIFY pgrst, 'reload config'`).

---


### 3.4 O caminho do editor SQL (instância nova ou de teste)

Há dois jeitos de levantar este banco, e eles servem a momentos diferentes.

| | `npm run db:migrar` | `backend/db/instalacao-completa.sql` |
|---|---|---|
| Para quê | aplicar o que ainda falta | levantar tudo de uma vez, do zero |
| Como | linha de comando, com `DATABASE_URL` | colar no editor SQL do Supabase |
| Precisa de Node | sim | não |
| Cria conta | pelo GoTrue, senha gerada | duas contas de **teste**, senha publicada neste repositório |
| Numa instalação existente | roda só as migrações novas | **aborta**, e diz o que fazer |

```
1.  backend/db/reset.sql               (só se já houver instalação anterior)
2.  backend/db/instalacao-completa.sql
```

O arquivo de instalação já registra as sete versões em `canastra.migracoes`, então
um `npm run db:migrar` depois dele responde "Nada pendente." — é isso que permite
começar pelo editor SQL e seguir com o runner daí para frente.

**As duas contas de teste têm senha escrita no repositório.** Elas existem para
conferir a fronteira de RLS na mão: entre como `cliente@canastra.teste` e confirme
que ele não enxerga pedido de outro; entre como `admin@canastra.teste` e confirme
que enxerga todos. Em produção a conta inicial nasce por `db:seed`, pelo GoTrue,
com `SEED_ADMIN_PASSWORD` gerado — nunca por este arquivo.

**Sobre o `reset.sql` numa instância compartilhada.** Ele derruba o schema
`canastra` inteiro e remove de `auth.users` **apenas** os dois endereços de teste,
por igualdade exata. Isso é deliberado e é a parte mais importante do arquivo:
`auth.users` é único por instância self-hosted, então um `DELETE` mais largo — ou
um `LIKE '%teste%'` — apagaria as contas dos seus outros projetos. Nada fora de
`canastra` e desses dois endereços é tocado.

**Os dois arquivos são gerados**, por `npm run db:gerar-sql`, a partir das
próprias migrações e do `seed.js`. Não os edite à mão: a edição se perde na
próxima geração e, pior, cria um banco diferente do que o runner produz.
`backend/test/instalacao.test.js` sobe dois Postgres, aplica um caminho em cada e
compara colunas, índices, políticas, funções, privilégios de coluna e o catálogo
semeado — se alguém editar o SQL ou acrescentar uma migração sem regerar, é ali
que aparece.

## 4. Duas invariantes que só o TESTE protege

O banco não impede nenhuma das duas. `npm --prefix backend test` reprova as
duas. Confira depois de qualquer mudança de schema feita fora das migrações.

### 4.1 Nenhuma tabela de `canastra` pode ter `FORCE ROW LEVEL SECURITY`

**Sintoma:** o painel do administrador para de funcionar e o cliente deixa de
ver o próprio endereço — **sem erro nenhum**, sem log, com as políticas todas
corretas no catálogo.

**Causa:** `canastra.eh_cliente()` e `canastra.eh_admin()` são `SECURITY
DEFINER` e leem `clientes` e `admins` como **dono**, contando com a isenção de
RLS que todo dono de tabela tem. `FORCE ROW LEVEL SECURITY` tira essa isenção. As
políticas dessas tabelas são `TO authenticated`, portanto não se aplicam ao dono:
nenhuma política casa, a leitura devolve **zero linhas**, e as duas funções
passam a responder `false` para todo mundo. As políticas não erram — passam a
dizer "não" para todos.

**O que já está feito:** as duas funções levam `SET row_security = off`. No
caminho saudável é um no-op; no caminho quebrado troca o silêncio por um `42501`
que **nomeia a tabela culpada** ("query would be affected by row-level security
policy for table admins"). Isso remove a mudez, não a dependência. Nada no banco
impede alguém de ligar `FORCE` amanhã.

**Como conferir à mão:**

```sql
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'canastra' AND c.relkind IN ('r','p') AND c.relforcerowsecurity;
-- tem de voltar vazio (fora `migracoes`, que é escrituração do runner)
```

### 4.2 O `GRANT SELECT` de 14 colunas em `canastra.produtos` tem de ser igual à projeção da view `produtos_publicos`

As duas listas têm de andar juntas e **nada no Postgres as amarra**. A view
projeta um conjunto de colunas; o `GRANT` de coluna concede outro.

**Sintomas, um para cada lado da divergência:**

- coluna **na view e fora do GRANT** → a vitrine quebra com `42501` ao ler o
  catálogo;
- coluna **no GRANT e fora da view** → ela vaza calada para qualquer token da
  instância compartilhada.

As 14 públicas: `produto_id`, `nome`, `tamanho`, `categoria`, `preco`, `imagem`,
`quantidade`, `descricao`, `peso`, `largura`, `altura`, `comprimento`,
`destacado_em`, `sku`. Ficam **de fora de propósito**: `custo`, `criado_em` e
`tsv`. `custo` é margem de lucro — foi para fechar essa porta que
`produtos_publicos` virou `security_invoker = true` em 0006.

O teste "a lista pública de colunas de `produtos` é exatamente a projeção da
view" afirma a igualdade. O banco, não.

**Efeito colateral conhecido e barulhento:** `canastra.produtos` é a única
relação do schema com privilégio de `SELECT` **por coluna**, então um `select=*`
cru nela responde `42501` em vez de devolver dados. No `supabase-js` isso alcança
qualquer `.insert(x).select()` sem `RETURNING` escrito à mão — vira `select=*` no
PostgREST. Na tela de CRUD de produto do painel, liste as colunas:
`.select('produto_id, nome, preco, ...')`. Erra na hora, nunca entrega dado
errado.

---

## 5. Armadilhas de operação

### 5.1 Rodar sem `DATABASE_URL` não é inofensivo — e por isso é recusado

`new Pool({ connectionString: undefined })` **não falha**: o `pg` cai no
comportamento do libpq e monta a conexão a partir de `PGHOST`/`PGUSER`/
`PGDATABASE` ou, na ausência deles, de `localhost:5432` com o usuário do
sistema. Um `DATABASE_URL` esquecido no shell aplicaria as migrações em
**qualquer banco à mão**, em silêncio, com a saída de sucesso de sempre.
`db:migrar` e `db:seed` recusam rodar sem ela.

### 5.2 `ALTER DEFAULT PRIVILEGES` só alcança quem o rodou

**Sintoma:** PostgREST responde **404** numa tabela nova, com a política de RLS
perfeitamente correta.

**Causa:** os `GRANT`s padrão de 0001 (`ALTER DEFAULT PRIVILEGES IN SCHEMA
canastra`) só alcançam objetos criados **pelo mesmo papel** que rodou o comando
(o padrão é `FOR ROLE current_user`). Nas migrações isso funciona porque quem
roda e quem cria é sempre o dono do `DATABASE_URL`. Uma tabela criada por outro
caminho — **Supabase Studio**, um `psql` com outro login, script de manutenção —
nasce **sem GRANT nenhum**.

**Conserto:** `GRANT` explícito na própria tabela. Não mexa no
`ALTER DEFAULT PRIVILEGES`.

**Regra prática:** crie tabela por migração. Sempre.

### 5.3 Dois `db:migrar` ao mesmo tempo

Acontece com dois deploys simultâneos ou com alguém rodando à mão durante um
deploy. **Não corrompe nada**: o `INSERT` de registro vive dentro da transação da
própria migração, então a chave primária `versao` funciona como mutex e o
perdedor faz rollback **inteiro** — nem o SQL nem o registro entram.

O que ele **não** faz é explicar isso. O perdedor morre com um `23505` em
`canastra.migracoes_pkey`, e não com "outra migração está rodando". Se vir esse
erro num deploy, procure o outro processo antes de procurar bug na migração.

### 5.4 Renomear uma migração já aplicada faz ela rodar de novo

A versão registrada é o **nome do arquivo** sem `.sql`. Renomear
`0004_enderecos.sql` para `0004_enderecos_e_carrinho.sql` cria uma versão nova
aos olhos do runner, e o conteúdo roda outra vez — normalmente estourando em
`42P07` ("relation already exists") no meio de um deploy. **Arquivo de migração
aplicado não se renomeia e não se edita.** Escreva a próxima.

### 5.5 `.sql` vazio (ou só com comentário) é recusado de propósito

Criar `0008_algo.sql`, rodar `db:migrar` por hábito e **só então** escrever o SQL
deixaria a versão registrada para sempre como aplicada, com o conteúdo real
nunca executado — e o `db:migrar` seguinte responderia "Nada pendente.". O runner
recusa o arquivo. Não é frescura, é a única trava contra isso (não há checksum).

Pela mesma família de problema, o runner também recusa: arquivo sem prefixo
numérico (`NNNN_descricao.sql`) e dois arquivos com o mesmo número — com números
iguais a ordem passaria a depender do sistema de arquivos (alfabética no NTFS,
ordem de hash no ext4), e a mesma pasta rodaria numa ordem aqui e noutra na VPS.

### 5.6 Backup é responsabilidade de quem opera. Não existe automático.

**Supabase self-hosted não tem backup automático e não tem PITR.** Nada nesta
instalação faz cópia de nada.

O mínimo:

- `pg_dump` agendado, com retenção e **restauração testada pelo menos uma vez**
  (backup nunca restaurado é backup presumido);
- cópia do volume do Storage (as imagens dos produtos vivem lá a partir da F3);
- as duas coisas guardadas **fora da VPS**.

Sem isso, a loja está a um disco de distância de perder tudo: catálogo, pedidos,
clientes e imagens.

---

## 6. Sintoma → causa

Tabela de busca. Se está caçando um problema às 2h da manhã, comece por aqui.

| Sintoma | Causa provável | Onde |
|---|---|---|
| **404 em toda rota da loja**, com migrações aplicadas | `canastra` fora de `PGRST_DB_SCHEMAS` | §3.3 |
| **404 em `/rest/v1/rpc/fundir_sacola`** | a mesma | §3.3 |
| **404 numa tabela nova**, com RLS correta | tabela criada fora das migrações, sem `GRANT` | §5.2 |
| **Painel do admin vazio e cliente sem ver o próprio endereço, sem erro** | `FORCE ROW LEVEL SECURITY` ligado em `admins`/`clientes` | §4.1 |
| **`42501` citando "row-level security policy for table admins"** | a mesma, já denunciada pelo `SET row_security = off` | §4.1 |
| **`42501` ao ler o catálogo na vitrine** | coluna na view sem `GRANT` correspondente | §4.2 |
| **`42501` num `.insert(...).select()` do painel** | `select=*` alcança coluna sem privilégio em `produtos` | §4.2 |
| **`23505` em `canastra.migracoes_pkey`** | dois `db:migrar` ao mesmo tempo | §5.3 |
| **`42P07` ("relation already exists") no meio do deploy** | migração já aplicada foi renomeada | §5.4 |
| **`db:migrar` diz "Nada pendente." e a mudança não está no banco** | arquivo registrado vazio (não deveria acontecer: o runner recusa) ou versão renomeada | §5.4, §5.5 |
| **Preço ou estoque voltando ao valor antigo depois de um deploy** | não é o seed (ele é `DO NOTHING`). Procure quem mais escreve em `produtos` | §3.2 |
| **Ninguém consegue entrar no painel depois do primeiro deploy** | `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` ausentes no seed — mas ele **falha alto**, então confira a saída do deploy | §3.1 |
| **`22P05` ("character with byte sequence 0xef 0xbb 0xbf")** | não deveria acontecer: o runner corta o BOM na leitura. Se aparecer, o SQL veio por outro caminho | — |
| **Migrações aplicadas num banco que não era o pretendido** | `DATABASE_URL` ausente — mas os dois comandos recusam rodar sem ela | §5.1 |

---

## 7. Conta inicial

`db:seed` cria a conta de `SEED_ADMIN_EMAIL` **no GoTrue** (`POST
/auth/v1/admin/users`, com a `service_role key`), já com o e-mail confirmado, e
depois a liga à loja com uma linha em `canastra.clientes` e outra em
`canastra.admins`.

Três detalhes que importam na hora:

- **A conta nasce confirmada de propósito.** O fluxo normal exige clicar num link
  de e-mail, e numa instalação nova o envio de e-mail é justamente o que ainda
  não está de pé — a conta nasceria travada em "confirme seu e-mail", sem
  ninguém para destravá-la.
- **A senha de uma conta existente nunca é sobrescrita.** O seed roda a cada
  deploy, e o deploy ainda carrega `SEED_ADMIN_PASSWORD` do ambiente. Reenviar a
  senha rebaixaria, calado, a credencial real de volta para a do arquivo de
  deploy. Quando o GoTrue responde 422 ("já existe"), o seed apenas **busca** o
  id e para por aí. Recuperar conta é operação deliberada, não efeito colateral
  de um seed.
- **`SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` vêm vazias no `.env.example`, de
  propósito.** O cabeçalho daquele arquivo manda copiá-lo para `.env`; uma senha
  escrita ali faria todo deploy feito "conforme a documentação" nascer com
  administrador de e-mail previsível e senha conhecida por quem leu o
  repositório. Gere as suas (`openssl rand -base64 24`).

Ser administrador **é a linha em `canastra.admins`** — não existe mais
`SEED_ADMIN_ROLE`, e nenhum claim de JWT promove ninguém. Só a `service_role`
escreve nessa tabela.

---

## 8. Verificação

Depois de qualquer mudança em migração, schema ou seed:

```bash
npm --prefix backend test   # 123 testes: regras de pagamento + banco (RLS, migrações, seed)
npm test                    # 52 testes da vitrine (vitest)
```

Os testes de banco sobem um Postgres embutido, aplicam as migrações de verdade e
verificam cada política **nos dois sentidos** — o caso positivo e, principalmente,
o negativo: um `sub` de JWT válido que **não** está em `canastra.clientes` não
enxerga absolutamente nada. É a trava da §9; se ela falhar em silêncio, o
isolamento entre projetos da instância desaparece.

Depois de aplicar na VPS, confira à mão:

- [ ] `npm run db:migrar` rodado uma segunda vez responde "Nada pendente.".
- [ ] `SELECT versao, aplicada_em FROM canastra.migracoes ORDER BY versao;` lista
      as 7 migrações.
- [ ] `SELECT count(*) FROM canastra.produtos;` devolve os 29 SKUs.
- [ ] Uma requisição anônima à instância lê `canastra.produtos_publicos` e **não**
      lê `canastra.clientes`.
- [ ] A conta de `SEED_ADMIN_EMAIL` existe no GoTrue **e** tem linha em
      `canastra.admins`.

`npm run verifica` (37 checagens num Chromium real) cobre a loja **antiga**,
contra o Express e o painel legado. Ele só volta a valer para a arquitetura nova
na F7, quando for reescrito.

---

## 9. Segurança

### 9.1 A instância Supabase é compartilhada com outros projetos

Registrado como decisão em
`docs/superpowers/specs/2026-08-17-supabase-selfhosted-design.md` §2.2.

**Supabase self-hosted não é multi-projeto.** Um stack tem **um** `auth.users` e
**um** `JWT_SECRET`. Um token emitido para outro projeto da VPS chega aqui com
assinatura válida e `auth.uid()` preenchido. Não há como recusá-lo pela
assinatura.

**O que protege a loja de um usuário legítimo de outro projeto:**

| Trava | O quê |
|---|---|
| Schema `canastra` | nenhuma tabela da loja em `public`; permissão concedida por schema, uma vez |
| `canastra.clientes` | **toda** política de dono exige linha aqui (`eh_cliente()`). Nenhuma política usa `auth.uid() IS NOT NULL` sozinho — essa é a regra inviolável do schema |
| `canastra.admins` | ser administrador é linha nesta tabela, **nunca** claim no JWT |
| `REVOKE` de INSERT | `clientes`, `admins` e `pedidos` têm `INSERT` revogado de `authenticated` no nível de tabela (mais `DELETE`, em `clientes` e `pedidos`), além da RLS. Uma política distraída amanhã não abre a porta sozinha — e `clientes` é o alvo mais valioso dos três, porque inserir uma linha ali **fabrica** `eh_cliente()`, que é a metade que sustenta toda política de dono do schema |

Resultado: um token estrangeiro autentica, não é cliente, e não enxerga nada.

### 9.2 O que **não** está protegido

**Quem obtiver o `JWT_SECRET` ou a `service_role key` da instância — por
qualquer um dos projetos que a dividem — compromete a loja junto.** As travas da
§9.1 contêm *usuário*; não contêm *vazamento de chave*.

Subir um stack Supabase separado só para a loja (~1,5–2 GB de RAM, isolamento
real) é o que fecha isso. **Foi avaliado e recusado.** Fica registrado aqui como
risco aceito, não como pendência esquecida.

Consequência prática: a rotação do `JWT_SECRET` e da `service_role key` é um
evento que atinge **todos** os projetos da VPS ao mesmo tempo. Trate as duas
chaves como credenciais compartilhadas entre sistemas diferentes, porque é o que
elas são.

### 9.3 Histórico do Git ainda tem dado pessoal

Os dumps CSV da loja anterior saíram do repositório, mas **continuam
recuperáveis em commits antigos** — `git show <commit>:usuarios.csv` devolve os
dados hoje, em qualquer clone. Ver `docs/seguranca-dados-pessoais.md`: exige
`git filter-repo`, `push --force` e rotação dos segredos que vazaram. Não foi
feito automaticamente porque reescrever histórico quebra o clone de todo mundo —
é decisão de quem administra o repositório.

### 9.4 LGPD: apagar cliente não apaga o dado pessoal dele

`canastra.pedidos.user_id` é `ON DELETE SET NULL`, e não `CASCADE` — a única
exceção entre as chaves estrangeiras do schema. É deliberado: apagar um cliente
não pode apagar a venda, que é registro fiscal e contábil.

**Mas o nome, o CPF e o endereço da pessoa sobrevivem** em
`canastra.pedidos.endereco_json` e nos itens do pedido, que são cópias
congeladas no momento da compra. Um pedido de eliminação de dados sob a LGPD
exige um passo de **redação** desses campos que **não existe ainda**. Se um
titular pedir hoje, apagar a linha de `clientes` não cumpre o pedido.

---

## 10. Em aberto

Ordenado por urgência. Cada item diz qual fase o fecha, ou que não há fase.

### 10.1 Fechado pelas fases planejadas

- **Webhook do Mercado Pago sem transação nem idempotência** — entregas repetidas
  da mesma notificação podem inflar o estoque, e o MP reenvia por desenho. **F5.**
- **A cobrança acontece antes de o pedido existir no banco**, sem chave de
  idempotência: uma queda entre as duas coisas deixa pagamento sem pedido. **F5.**
- **Refresh token gravado em texto puro** — morre junto com a autenticação
  própria. **F2.**
- **`PUT /promotions/:id` e `PUT /config`** sobrescrevem com NULL os campos
  ausentes e respondem 200 sem checar `rowCount`. Esses endpoints deixam de
  existir; a escrita passa a ser `PATCH` via PostgREST, parcial por natureza.
  **F5.**
- **`csurf` (arquivado) e `axios` (advisory)** — saem com o serviço enxuto. **F5.**
- **CSP com `unsafe-inline` e `unsafe-eval` no `script-src`** — existem só por
  causa do styled-components do painel legado. **F6.**
- **O bundle do painel é servido a qualquer visitante** e o guard é de cliente. A
  API está protegida rota a rota, então não há vazamento de dado — só de código.
  O guard vira server-side no App Router. **F6.**
- **Conexão com o Postgres sem validar o certificado TLS**
  (`rejectUnauthorized: false` em `pgPool.js`). Com Postgres e serviço Node na
  mesma VPS a exposição muda de natureza, mas a linha continua lá e precisa
  sair. **F5.**

### 10.2 Sem fase que os feche

- **Sem trilha de auditoria**: não há registro de quem mudou preço, estoque ou
  status de pedido. Numa loja oficial com mais de um administrador, é o primeiro
  pedido de quem investiga uma divergência.
- **Redação de dado pessoal em pedidos** (§9.4).
- **Backup** (§5.6) — precisa ser definido por quem opera a VPS, não por código.
- **Pagamento com cartão**: o checkout aceita só Pix. Falta tokenizar o número no
  navegador com o SDK do Mercado Pago e `NEXT_PUBLIC_MP_PUBLIC_KEY`; o backend já
  aceita cartão pelo mesmo endpoint assim que `formData.token` chegar.
- **Política de Privacidade e Termos de Uso** ainda atribuem a loja à Shopnaw.
- **Sem `sitemap.ts`/`robots.ts`**; `/account` e `/dashboard` são indexáveis.
- **Acervo fotográfico**: `estetica.md` §8 pede três famílias de foto (sabor,
  território, produto) em 4:5. Hoje existem quatro pack shots quadrados
  (500×500) e a "foto de sabor" é o próprio pacote repetido, então o crossfade do
  card não aparece. É produção fotográfica, não código — e o §8 estima isso como
  ~60% da percepção de qualidade do site.
- **Dados de catálogo por conferir**: os SKUs marcados como `pesquisa-web` ou
  `inferido` em `data/catalogo-canastra.json` merecem conferência contra a loja
  real antes de campanha — preço do Canastra Canela avulso, preços das cápsulas e
  dos drip coffees (todos esgotados nas capturas, a loja não exibia valor) e foto
  própria do Néctar de Minas, que hoje reusa a arte do Clássico.

**Fechado na F1:** "sem migrações versionadas". `schema.sql` não existe mais;
cada alteração de schema é um arquivo em `backend/db/migrations/`, aplicado uma
vez e registrado.
