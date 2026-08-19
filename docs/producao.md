# Colocar a loja em produção

Guia operacional do Café Canastra na VPS: o que existe, o que subir, em que
ordem, e as falhas que acontecem **em silêncio** — que é para isso que este
documento serve.

> **Leia isto antes de qualquer coisa: a loja ainda NÃO sobe inteira.**
> A fundação de dados (F1) e a autenticação (F2) estão prontas, e **nada foi
> aplicado na VPS ainda**. O que dá para fazer hoje é criar o schema `canastra`
> num Postgres Supabase, semear o catálogo e cadastrar/entrar pelo GoTrue. O
> catálogo do banco, as imagens no Storage, o serviço Node enxuto e o painel novo
> não existem. O desenho completo está em
> `docs/superpowers/specs/2026-08-17-supabase-selfhosted-design.md`.

---

## 1. Em que pé isto está

| Fase | Escopo | Estado |
|---|---|---|
| **F1** | Schema `canastra`, migrações versionadas, RLS provada por teste positivo **e** negativo, `clientes`/`admins`, RPC `fundir_sacola`, seed contra o GoTrue | **pronta**, não aplicada na VPS |
| **F2** | GoTrue assume cadastro, login, confirmação e reset; `@supabase/ssr`; RPC `garantir_cliente`; fusão da sacola no login; Express deixa de emitir token | **pronta**, não aplicada na VPS |
| **F4** (antecipada) | Vitrine e sacola lendo e escrevendo o PostgREST direto; Express fica só com pagamento, webhook, frete e e-mail | **próxima** |
| F3 | Bucket `canastra-produtos` no Storage; saída do Cloudinary | não existe |
| F5 | Serviço Node enxuto, transação e idempotência no webhook | não existe |
| F6 | Painel novo em App Router; `frontend/legacy/` apagado; CSP fechado | não existe |
| F7 | Proxy reverso, backup agendado, verificação ponta a ponta | não existe |

**A F4 passou na frente da F3, e o motivo importa.** Durante a F2 descobriu-se
que **os oito repositories do Express estão mortos contra o banco migrado**: eles
consultam as tabelas antigas em inglês (`orders`, `products`, `users`,
`addresses`, `carts`, `store_config`, `promotions`, `product_options`) e as
migrações só criam `canastra.*`, em português. Não é um endpoint: é o serviço
inteiro. Consertar aquele SQL seria escrever ~1.000 linhas que a própria F4
apaga. Registrado no fim de
`docs/superpowers/plans/2026-08-18-supabase-f2-autenticacao.md`.

### 1.1 O que NÃO funciona hoje, dito sem rodeio

Vale a pena ler antes de abrir um chamado — nada abaixo é bug novo:

- **O painel autentica e não mostra dado nenhum.** O login passou a ser do
  GoTrue e funciona; a decisão de administrador vem de `canastra.admins` e
  funciona. O que não funciona é o que vem depois: `GET /dashboard`,
  `GET /orders` e `GET /promotions` consultam tabelas que não existem e
  respondem **500 (`42P01`, "relation does not exist")**. O painel fica de pé e
  vazio. Fecha na F4/F6.
- **A vitrine mostra preço e estoque do JSON versionado**
  (`data/catalogo-canastra.json`), e não do banco — pelo mesmo `GET /dashboard`
  morto. **Isso é a degradação graciosa funcionando**, não um defeito: "loja
  fechada é pior que preço de ontem". Mas significa que **mudar o preço pelo
  painel não muda a vitrine hoje.** Fecha na F4.
- **A sacola de quem está logado vive em dois lugares.** A fusão do login grava
  em `canastra.carrinho_itens` (RPC `fundir_sacola`); a vitrine desenha a partir
  do `localStorage`. Enquanto a F4 não chega, a ponte é o `fusao.ts` reler a
  conta na primeira fusão de cada aparelho. Fecha na F4.
- **As imagens continuam no Cloudinary.** F3.
- **O webhook do Mercado Pago continua sem transação nem idempotência.** F5.

**O que a F2 tirou do `.env`:** `JWT_SECRET`, `JWT_SECRET_REFRESH`,
`ACCESS_TOKEN_EXPIRY` e `REFRESH_TOKEN_EXPIRY_DAYS`. O Express **não emite mais
token** — quem emite é o GoTrue, e este serviço só verifica: em **HS256** com
`SUPABASE_JWT_SECRET` (stack self-hosted) **ou** em **ES256/RS256** pela chave
pública do JWKS da instância (projeto já migrado para chaves de assinatura). Os
dois caminhos convivem e a §3.1 diz qual é o seu. `bcrypt`, `csurf`,
`cookie-parser` e `express-validator` saíram junto com as rotas que os usavam.
`CLOUDINARY_*` continua, e sai na F3.

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

### 3.1 Variáveis

Obrigatórias em produção. `backend/src/config/ambiente.js` **recusa subir o
processo** sem qualquer uma delas quando `NODE_ENV=production` — falhar no `npm
start` é barulhento e barato; descobrir depois, não.

| Variável | Para quê | Sem ela |
|---|---|---|
| `DATABASE_URL` | Postgres da instância Supabase. O papel precisa de `CREATE` no banco. | `db:migrar` e `db:seed` **recusam rodar** (ver §5.1) |
| `SUPABASE_URL` | origem da instância (o que o Kong atende). Usada pelo seed e pela exclusão de conta. | `db:seed` **falha** ao criar a conta inicial; exclusão de conta responde **503** |
| `SUPABASE_SERVICE_ROLE_KEY` | chave `service_role`; é com ela que o serviço fala com a **Admin API do GoTrue** | idem |
| `CORS_ORIGIN` | origem da vitrine | o painel não fala com a API |
| `MP_WEBHOOK_SECRET`, `MP_ACCESS_TOKEN` | Mercado Pago | nenhum pedido sai de "pendente" |

**`SUPABASE_JWT_SECRET` saiu da tabela: ela é CONDICIONAL.** Depende de como a
sua instância assina o token — e as duas formas são reais.

| Como a instância assina | Precisa de `SUPABASE_JWT_SECRET`? | Como o serviço verifica |
|---|---|---|
| **HS256 com segredo compartilhado** — stack self-hosted padrão, só com `GOTRUE_JWT_SECRET`. É o alvo de produção desta loja | **sim** | `jwt.verify` com o segredo, `algorithms: ["HS256"]` |
| **Chaves de assinatura assimétricas** (ES256/RS256) — Supabase hospedado já migrado, ou self-hosted com `GOTRUE_JWT_KEYS` | **não** — deixe **vazia** | busca a chave pública em `SUPABASE_URL/auth/v1/.well-known/jwks.json`, casa pelo `kid`, e fixa o algoritmo **pelo tipo da chave** |

**Onde achar o `SUPABASE_JWT_SECRET`, quando ele é o caso:** é o `JWT_SECRET` do
`docker/.env` do stack self-hosted (no Supabase hospedado que ainda usa segredo
legado, Settings → API → JWT Settings). Precisa ser **idêntico** ao da instância.

**A versão anterior deste parágrafo dizia "não há chave assimétrica aqui: JWKS/ECC
é recurso da plataforma hospedada". Isso é verdade da VPS e falso do projeto de
teste**, e custou caro: contra um projeto hospedado já migrado, um serviço que só
sabe HS256 responde **403 a toda requisição autenticada** e loga apenas
`invalid signature` — o sintoma que a linha da §6 atribuía a um segredo errado.
Vale dizer também que `GOTRUE_JWT_KEYS` existe no self-hosted: "assimétrico = só
hospedado" não é uma regra, é um padrão de configuração.

**O serviço não escolhe entre um e outro; ele lê o `alg` do token.** `alg: HS256`
só alcança `SUPABASE_JWT_SECRET`; `alg: ES256`/`RS256` só alcança a chave pública
do `kid` correspondente, e o algoritmo aceito é derivado do **tipo da chave**,
nunca do cabeçalho. Não dá para "tentar o JWKS primeiro e cair para o segredo":
num stack só com `GOTRUE_JWT_SECRET`, o endpoint responde `200 {"keys":[]}` (o
GoTrue **omite** chave HMAC de propósito) ou 404, em versão anterior ao endpoint.

**Deixar as duas de fora não passa em silêncio.** Se `SUPABASE_JWT_SECRET` estiver
vazia, o processo **busca o JWKS na subida**; se ele responder um conjunto vazio,
nada neste serviço consegue verificar token nenhum e a API **recusa subir** em
produção. Se o JWKS não responder, é só aviso — pode ser o Kong ainda subindo na
mesma VPS —, e enquanto durar as rotas autenticadas respondem **503**.

**Com o segredo definido, a subida não ganha dependência de rede.** A busca ainda
acontece (aquece o cache), mas falhar nela não é erro nem aviso.

**`SUPABASE_URL` NÃO tem trava de `localhost`, e a ausência é deliberada.** O
Express roda na **mesma VPS** do Kong, então `http://localhost:8000` é o valor
**certo** em produção. `CORS_ORIGIN` tem essa trava porque é um endereço de
navegador; copiá-la para cá impediria o deploy correto de subir.

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` também **não são opcionais quando
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` estão preenchidas**. O seed levanta erro
em vez de pular a etapa: pular em silêncio deixaria a produção no ar com ninguém
capaz de entrar no painel, e o sintoma só apareceria dias depois, quando alguém
tentasse mudar um preço.

**Saíram:** `SEED_ADMIN_ROLE` (ser administrador é uma **linha** em
`canastra.admins`, nunca um claim de JWT) e, na F2, `JWT_SECRET`,
`JWT_SECRET_REFRESH`, `ACCESS_TOKEN_EXPIRY` e `REFRESH_TOKEN_EXPIRY_DAYS` — o
Express não emite mais token. `CLOUDINARY_*` continua, e sai na F3.

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

O arquivo de instalação já registra as oito versões em `canastra.migracoes`, então
um `npm run db:migrar` depois dele responde "Nada pendente." — é isso que permite
começar pelo editor SQL e seguir com o runner daí para frente.

**As duas contas de teste têm senha escrita no repositório.** Elas existem para
conferir a fronteira de RLS na mão: entre como `cliente@canastra.teste` e confirme
que ele não enxerga pedido de outro; entre como `admin@canastra.teste` e confirme
que enxerga todos. Em produção a conta inicial nasce por `db:seed`, pelo GoTrue,
com `SEED_ADMIN_PASSWORD` gerado — nunca por este arquivo.

**O `reset.sql` é um reset TOTAL, e apaga por categoria.** Ele derruba todo schema
que não seja do próprio Supabase — `public` inclusive, recriado vazio com os
privilégios de fábrica — apaga **todos** os usuários de `auth.users` (e em cascata
identidades, sessões e refresh tokens) e esvazia buckets e objetos do Storage.
Ficam de pé apenas os schemas que o Supabase administra: `auth`, `storage`,
`realtime`, `extensions`, `graphql`, `vault`, `supabase_functions`, `cron`, `net`.
Derrubá-los não limparia nada — quebraria os serviços, e nenhum SQL de instalação
reconstrói isso.

**Só use num banco de teste que seja só deste projeto.** Como ele apaga por
categoria e não por nome, qualquer outro projeto que divida o mesmo banco morre
junto. Em produção, nunca.

Vale o registro de por que ele é assim: a primeira versão deste arquivo derrubava
apenas o schema `canastra`. Num banco de teste onde ainda moravam as tabelas da
loja antiga em `public`, ela rodava, dizia "concluído" e não apagava nada do que a
pessoa estava vendo — um reset que parece ter funcionado é pior que não ter reset.
`backend/test/instalacao.test.js` agora planta exatamente essa situação (tabela e
view em `public`, schema extra, conta em `auth.users`) antes de resetar, e exige
que tudo suma.

**Os dois arquivos são gerados**, por `npm run db:gerar-sql`, a partir das
próprias migrações e do `seed.js`. Não os edite à mão: a edição se perde na
próxima geração e, pior, cria um banco diferente do que o runner produz.
`backend/test/instalacao.test.js` sobe dois Postgres, aplica um caminho em cada e
compara colunas, índices, políticas, funções, privilégios de coluna e o catálogo
semeado — se alguém editar o SQL ou acrescentar uma migração sem regerar, é ali
que aparece.

### 3.5 Configuração do GoTrue — três passos manuais, três falhas mudas

**Nada em código faz isto, e nenhum teste alcança.** São ajustes no painel do
Supabase (Authentication) e, se faltarem, a loja sobe inteira, sem erro em lugar
nenhum, com o cadastro quebrado. Os três foram descobertos exercendo a F2 à mão.

#### 3.5.1 Allow-list de redirecionamento (Authentication → URL Configuration)

Precisam estar na lista, com o domínio real da loja no lugar de `${origin}`:

```
${origin}/account/verify-email
${origin}/account/reset-password
```

**Uma URL fora da lista não dá erro: ela é SILENCIOSAMENTE TROCADA pela Site
URL.** O cliente recebe o e-mail, clica no link, e cai na **home**, logado ou
não, sem mensagem nenhuma — nem na tela, nem no console, nem no log do GoTrue. A
leitura natural disso é "o link do e-mail está quebrado" ou "o cadastro não
funcionou", e as duas conclusões estão erradas: o cadastro funcionou e o link
estava certo. Se aparecer confirmação de e-mail "que não faz nada", comece aqui.

Vale para **todo** ambiente separadamente — a lista de produção não conhece o
`http://localhost:3000` do desenvolvimento, e vice-versa.

#### 3.5.2 Modelos de e-mail: `{{ .ConfirmationURL }}` × `{{ .TokenHash }}`

Os dois funcionam, e não funcionam nas mesmas circunstâncias:

| No modelo | Como funciona | Quando falha |
|---|---|---|
| `{{ .ConfirmationURL }}` | fluxo **PKCE**: o verificador fica no navegador que **começou** o cadastro | abrir o link em **outro navegador ou outro aparelho** |
| `{{ .TokenHash }}` | token no próprio link, verificado no servidor | — |

**A pessoa se cadastra no computador e abre o e-mail no celular.** Isso é o caso
comum, não a exceção, e com `{{ .ConfirmationURL }}` ele falha — com uma
mensagem de código inválido que não explica que o problema é o aparelho. Prefira
`{{ .TokenHash }}` nos modelos de confirmação e de recuperação de senha.

#### 3.5.3 SMTP configurado (Authentication → Emails / SMTP Settings)

Sem provedor de e-mail, **cadastro e recuperação de senha simplesmente param**:
a conta é criada, o e-mail nunca sai, e o erro aparece **só no log do GoTrue** —
a tela da loja mostra "confira sua caixa de entrada" e fica esperando para
sempre. O servidor SMTP embutido do stack self-hosted não entrega para fora.

> A conta inicial do `db:seed` nasce **já confirmada** justamente por isto (§7):
> numa instalação nova o envio de e-mail é o que ainda não está de pé, e ela
> nasceria travada em "confirme seu e-mail" sem ninguém para destravá-la.

---

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
| **404 em `/rest/v1/rpc/fundir_sacola`** ou **`/rpc/garantir_cliente`** | a mesma | §3.3 |
| **TODO cliente recebe 403** do serviço Node, e o log diz `[auth:assinatura-hs256] invalid signature` | `SUPABASE_JWT_SECRET` diferente do `JWT_SECRET` da instância. Não é a conta de ninguém: é a variável. **Confira o prefixo do log antes de mexer no segredo** — se ele não citar `assinatura-hs256`, o problema é outro | §3.1 |
| **TODO cliente recebe 403** e o log diz `[auth:kid-desconhecido]` ou `[auth:alg-nao-suportado]` | a instância assina em **ES256/RS256** e o token não casa com nenhuma chave publicada — `SUPABASE_URL` aponta para outro projeto, ou a chave foi rotacionada e o JWKS de lá não a publica. **O segredo não tem nada a ver**: mexer nele não muda nada | §3.1 |
| **TODO cliente recebe 503** ("Não consegui verificar sua credencial agora") e o log diz `[auth:jwks-indisponivel]` ou `JWKS indisponível` | o `/auth/v1/.well-known/jwks.json` não respondeu. É infraestrutura, não credencial: Kong fora do ar, `SUPABASE_URL` errada, rede bloqueada | §3.1 |
| **TODO cliente recebe 503** e o log diz `[auth:hs256-sem-segredo]` | chegou token HS256 e `SUPABASE_JWT_SECRET` está vazia. Ou a instância assina em HS256 e falta a variável, ou alguém está mandando a `anon`/`service_role` legada como credencial de pessoa | §3.1 |
| **A API recusa subir** com "Nenhum caminho de verificação de token configurado" | `SUPABASE_JWT_SECRET` vazia **e** o JWKS da instância sem nenhuma chave assimétrica. É a trava de §3.1 fazendo o trabalho dela: sem ela, a loja subiria e responderia 503 para todo mundo | §3.1 |
| **UM cliente recebe 403** com `"Sua conta ainda não está vinculada a esta loja."` | esse `sub` não tem linha em `canastra.clientes` — e-mail não confirmado, ou `garantir_cliente` nunca rodou para ele. É a defesa da §9.1 fazendo o trabalho dela | §9.1, migração 0008 |
| **Rota autenticada responde 503** ("Não consegui confirmar sua conta agora") | a consulta de vínculo falhou. O problema é o **banco**, não o token — banco fora do ar não pode virar "entra sem conferir" | §9.1 |
| **Exclusão de conta responde 503** | `SUPABASE_URL` ou `SUPABASE_SERVICE_ROLE_KEY` ausentes: `auth.users` pertence ao GoTrue e só a Admin API apaga de lá | §3.1 |
| **Login responde `Database error querying schema`** | conta criada por SQL com os campos de token em NULL em `auth.users`. Não cita conta nem senha, e não é nenhuma das duas | §3.4 |
| **O cliente clica no e-mail de confirmação e cai na HOME**, sem erro nenhum | a URL de redirecionamento não está na allow-list e foi trocada em silêncio pela Site URL | §3.5.1 |
| **O link do e-mail falha só quando aberto em OUTRO aparelho** | modelo usando `{{ .ConfirmationURL }}` (PKCE) em vez de `{{ .TokenHash }}` | §3.5.2 |
| **Cadastro e recuperação de senha param, e a tela fica esperando** | SMTP não configurado. O erro só existe no log do GoTrue | §3.5.3 |
| **O painel entra e não mostra dado nenhum** (500, `42P01`) | não é a autenticação: os repositories do Express consultam as tabelas antigas em inglês. Fecha na F4 | §1.1 |
| **Preço mudado no painel não aparece na vitrine** | a vitrine lê o JSON versionado porque `GET /dashboard` está morto — é a degradação graciosa, não um bug | §1.1 |
| **A sacola do cliente dobra a cada visita** | a base `cart:na_conta` do `localStorage` se perdeu; a RPC `fundir_sacola` soma por desenho e quem impede a segunda soma é ela | `frontend/lib/sacola/fusao.ts` |
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
npm --prefix backend test   # 174 testes: regras de pagamento + banco (RLS, migrações, seed, RPCs)
npm test                    # 185 testes da vitrine (vitest)
```

Os testes de banco sobem um Postgres embutido, aplicam as migrações de verdade e
verificam cada política **nos dois sentidos** — o caso positivo e, principalmente,
o negativo: um `sub` de JWT válido que **não** está em `canastra.clientes` não
enxerga absolutamente nada. É a trava da §9; se ela falhar em silêncio, o
isolamento entre projetos da instância desaparece.

### 8.1 `npm run verifica:rls` — a fronteira contra uma instância de verdade

```bash
npm run verifica:rls
```

**Os testes acima provam a POLÍTICA; este script prova o CAMINHO.** Cada peça
entre o navegador e a linha da tabela — GoTrue emitindo o token, Kong
repassando, PostgREST injetando o claim, `Accept-Profile` escolhendo o schema,
`GRANT` de coluna escondendo `custo`, `REVOKE EXECUTE` barrando o `anon` numa
RPC — pode estar errada com **todas as políticas certas**. Foi ele que achou o
`canastra` fora de "Exposed schemas" e a conta com campos de token em NULL.

O que ele exerce, além da F1: `garantir_cliente` recusada ao `anon` e deixando
**exatamente um** vínculo para o próprio `sub`; um token de outro projeto da
instância levando **vazio** do PostgREST e **403** do serviço Node com a frase
que a tela mostra; e a fusão da sacola entrando **uma vez** e não somando de novo
numa segunda carga de página — com a contraprova de que, perdida a base do
navegador, a mesma sacola dobra.

Três coisas a saber antes de rodar:

- **Ele escreve no banco.** Só dentro da conta de `VERIFICA_EMAIL_CLIENTE`, com o
  token dela, sob RLS, e apaga as próprias sondas de `canastra.carrinho_itens` no
  fim. Ainda assim: aponte-o para uma instância de **teste**.
- **Ele degrada.** Sem `VERIFICA_EMAIL_*`/`VERIFICA_SENHA_*` roda só a metade
  anônima; sem `SUPABASE_JWT_SECRET` a seção do token estrangeiro é **pulada**
  com o motivo escrito; com o serviço Node fora do ar, idem. Pulado não conta
  como aprovado nem reprova a corrida.
- **Refazendo a fusão à mão no navegador, limpe as TRÊS chaves** de
  `localStorage`: `cart`, `cart:na_conta` e `cart:fundindo`. Limpar só `cart`
  deixa a base de pé, a fusão calcula zero pendente, não chama a RPC — e **parece
  quebrada estando certa**.

Depois de aplicar na VPS, confira à mão:

- [ ] `npm run db:migrar` rodado uma segunda vez responde "Nada pendente.".
- [ ] `SELECT versao, aplicada_em FROM canastra.migracoes ORDER BY versao;` lista
      as 8 migrações.
- [ ] `SELECT count(*) FROM canastra.produtos;` devolve os 29 SKUs.
- [ ] Uma requisição anônima à instância lê `canastra.produtos_publicos` e **não**
      lê `canastra.clientes`.
- [ ] A conta de `SEED_ADMIN_EMAIL` existe no GoTrue **e** tem linha em
      `canastra.admins`.
- [ ] Os três passos da §3.5 estão feitos: allow-list de redirecionamento,
      modelos com `{{ .TokenHash }}` e SMTP.
- [ ] Um cadastro novo, de ponta a ponta, num navegador limpo: formulário →
      e-mail → link → conta com linha em `canastra.clientes`.

`npm run verifica` (37 checagens num Chromium real) cobre a loja **antiga**,
contra o Express e o painel legado, e **boa parte dele já não vale**: ele exerce
o login do Express e as rotas de carrinho, que a F2 apagou. Ele só volta a valer
para a arquitetura nova na F7, quando for reescrito.

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

**A F2 acrescentou o espelho disso no serviço Node, e ele não é redundante.** O
PostgREST responde ao token estrangeiro com **zero linhas** — silêncio, que é a
resposta certa de uma política de RLS. O Express não pode se contentar com isso:
ele não lê por política, lê por consulta, e um controller distraído sem
`WHERE user_id = ...` entregaria tudo. Por isso `isAuthenticated` confere o
**vínculo** (`canastra.clientes`) depois de verificar a assinatura, e responde
**403** antes de qualquer controller. É o caso que `npm run verifica:rls` mede
nos dois lados com o mesmo token (§8).

**A decisão de "esta pessoa é administradora" vem de `canastra.admins`, nunca de
um claim do JWT — e ela FALHA FECHADA.** Numa instância compartilhada, qualquer
claim é forjável por um projeto vizinho: quem consegue assinar um token escreve
`role: "admin"` dentro dele sem esforço. Por isso `role` no token só serve para
**recusar** (o que não for `authenticated` é barrado, o que fecha a `anon key` e
a `service_role key` usadas como credencial de pessoa), nunca para conceder. Se a
consulta de vínculo não puder ser respondida, a resposta é 503 — e não "entra sem
conferir". Vale igual para o painel legado e para o painel novo da F6.

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
- **`PUT /promotions/:id` e `PUT /config`** sobrescrevem com NULL os campos
  ausentes e respondem 200 sem checar `rowCount`. Esses endpoints deixam de
  existir; a escrita passa a ser `PATCH` via PostgREST, parcial por natureza.
  **F5.**
- **`axios` (advisory)** — sai com o serviço enxuto. **F5.**
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

**Fechado na F2:**

- "refresh token gravado em texto puro" — o Express não emite mais token nenhum,
  e a sessão do GoTrue não passa por aqui;
- "`csurf` arquivado" — saiu junto com `bcrypt`, `cookie-parser` e
  `express-validator`, com as 1.239 linhas das rotas que os usavam;
- "senha da loja em `bcrypt` num banco nosso" — quem guarda credencial agora é o
  GoTrue.

**Nasceu na F2 e não tem fase:** a loja depende de **três passos manuais no
painel do Supabase** (§3.5) que nada em código verifica. Um script de verificação
de configuração do GoTrue seria o fecho; hoje o que existe é a lista de conferência
da §8.
