# Colocar a loja em produção

Guia operacional do Café Canastra na VPS: o que existe, o que subir, em que
ordem, e as falhas que acontecem **em silêncio** — que é para isso que este
documento serve.

> **Leia isto antes de qualquer coisa: a loja vende de ponta a ponta, e nada
> disso foi aplicado na VPS ainda.** O código está pronto e coberto por teste —
> catálogo do banco, sacola, checkout por Pix e cartão, pedido idempotente,
> webhook transacional, e-mail de status, ERP/NF-e, assinatura e avaliações. O
> que falta não é código: é credencial, acesso ao servidor e decisão comercial,
> e está listado em **`docs/go-live.md`**. Para subir na VPS passo a passo,
> **`docs/deploy.md`**. O desenho da migração continua em
> `docs/superpowers/specs/2026-08-17-supabase-selfhosted-design.md`.

---

## 1. Em que pé isto está

| Fase | Escopo | Estado |
|---|---|---|
| **F1** | Schema `canastra`, migrações versionadas, RLS provada por teste positivo **e** negativo, `clientes`/`admins`, RPC `fundir_sacola`, seed contra o GoTrue | **pronta**, não aplicada na VPS |
| **F2** | GoTrue assume cadastro, login, confirmação e reset; `@supabase/ssr`; RPC `garantir_cliente`; fusão da sacola no login; Express deixa de emitir token | **pronta**, não aplicada na VPS |
| **F4** | Express inteiro reescrito contra `canastra.*` mantendo o contrato JSON; vitrine lendo preço e estoque do banco; checkout gravando `canastra.pedidos` com chave de idempotência; rotas de clientes do painel recriadas | **pronta**, não aplicada na VPS |
| F3 | Bucket `canastra-produtos` no Storage; saída do Cloudinary | **não existe** — as imagens continuam no Cloudinary |
| **F5** | Serviço Node enxuto, transação e idempotência no webhook | **parcial** — ver abaixo |
| F6 | Painel novo em App Router; `frontend/legacy/` apagado; CSP fechado | **não existe** — o painel continua sendo a ilha legada |
| **F7** | Docker/PM2, nginx de mesma origem, backup agendado, CI, verificação ponta a ponta | **pronta**, não aplicada na VPS |

**A F4 passou na frente da F3, e o motivo continua valendo como registro.**
Durante a F2 descobriu-se que os oito repositories do Express estavam **mortos**
contra o banco migrado: consultavam as tabelas antigas em inglês (`orders`,
`products`, `users`, `addresses`, `carts`, `store_config`, `promotions`,
`product_options`) e as migrações só criam `canastra.*`, em português. Não era um
endpoint: era o serviço inteiro. Isso foi refeito na F4 — hoje todo repository
fala `canastra.*` e o contrato JSON que o painel legado consome é preservado por
`AS` no SELECT, não por tabela em inglês. Registrado no fim de
`docs/superpowers/plans/2026-08-18-supabase-f2-autenticacao.md` e resolvido em
`docs/superpowers/plans/2026-08-20-f4-backend-canastra.md`.

### 1.1 O que NÃO funciona hoje, dito sem rodeio

Vale a pena ler antes de abrir um chamado — nada abaixo é bug novo:

- **O painel continua sendo a ilha legada.** `/dashboard` é uma página
  client-only (`ssr: false`) que carrega `frontend/legacy/` inteiro: React
  Router, styled-components e contextos do projeto original. Ele **mostra dado**
  desde a F4 e ganhou as telas que faltavam (cupons, avaliações, assinaturas,
  rastreio, SKU, exportação CSV), mas continua fora do App Router. Duas
  consequências operacionais seguem de pé, e as duas são a F6:
  - o **CSP tem `unsafe-inline`** no `script-src`. Esta linha já dizia
    "`unsafe-inline` e `unsafe-eval`, que existem só por causa do
    styled-components do painel", e **estava errada nas duas metades** — ver a
    entrada correspondente na lista de pendências, mais abaixo;
  - o **bundle do painel é servido a qualquer visitante** e o guard é de
    cliente. Não vaza dado — a API está protegida rota a rota e a RLS não
    depende do navegador —, vaza só código.
- **As imagens continuam no Cloudinary.** F3. O upload do painel sobe para lá e
  o banco guarda a URL absoluta.
- **A F5 ficou pela metade, e a metade que importava está feita.** O webhook do
  Mercado Pago é **transacional e idempotente**, e responde **500** quando
  falha, para o MP reenviar — o 200 silencioso acabou. O pedido nasce no banco
  **antes** da cobrança, com chave de idempotência. `PUT /config` virou
  atualização parcial de verdade (campo ausente não vira NULL). O que **sobrou**:
  - `PUT /promotions/:id` continua sobrescrevendo com NULL o que não veio no
    corpo e continua respondendo 200 sem checar `rowCount` — editar uma promoção
    inexistente "dá certo";
  - `axios` continua nas dependências do backend;
  - `pgPool.js` continua com `rejectUnauthorized: false` em produção.
- **Não há trilha de auditoria.** Ninguém registra quem mudou preço, estoque ou
  status de pedido. Não tem fase.
- **Metade dos recursos nasce desligada, e isso não é defeito.** Cartão, Bling,
  NF-e, rastreio automático, GA4, WhatsApp e carrinho abandonado só existem com a
  credencial correspondente preenchida; sem ela o processo sobe igual e o recurso
  não aparece. A tabela de o-que-liga-o-quê está em `docs/go-live.md` §2 e no
  `README.md`; as consequências operacionais dos crons e do Clube, na §5.8.

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

**`WEBHOOK_URL` NÃO está nessa lista, e vale saber por quê.** O processo sobe sem
ela e a loja vende por Pix e cartão do mesmo jeito — o webhook de pagamento
avulso é cadastrado no painel do Mercado Pago, não derivado dela. Mas o **Clube**
usa `WEBHOOK_URL` para montar a `notification_url` de cada `preapproval`, e sem
isso a cobrança recorrente não vira pedido, **sem erro em lugar nenhum**. Se for
vender assinatura, ela é obrigatória na prática: §5.8.

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

O arquivo de instalação já registra as 16 versões em `canastra.migracoes`, então
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

## 4. Três invariantes que só o TESTE protege

O banco não impede nenhuma das três. `npm --prefix backend test` reprova as
três. Confira depois de qualquer mudança de schema feita fora das migrações.

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

**Efeito colateral conhecido e barulhento:** onde há privilégio de `SELECT` **por
coluna**, um `select=*` cru responde `42501` em vez de devolver dados. No
`supabase-js` isso alcança qualquer `.insert(x).select()` sem `RETURNING` escrito
à mão — vira `select=*` no PostgREST. Liste as colunas:
`.select('produto_id, nome, preco, ...')`. Erra na hora, nunca entrega dado
errado.

**São três relações hoje, e o motivo de cada uma é o mesmo.** A técnica de 0006
virou o padrão do schema para "coluna que não pode sair":

| Relação | Coluna escondida | Por quê |
|---|---|---|
| `canastra.produtos` (0006) | `custo`, `criado_em`, `tsv` | `custo` é margem de lucro |
| `canastra.config_loja` (0012) | `bling_refresh_token` | credencial que emite nota fiscal e mexe em estoque — ver §4.3 |
| `canastra.avaliacoes` (0014) | para `anon`: `user_id`, `moderado_em` | o `user_id` daria linkabilidade gratuita entre a avaliação e as outras tabelas da instância |

Nas três, o `42501` do `select=*` é **de propósito**: barulhento, nunca vazado.

### 4.3 `canastra.config_loja` é uma tabela PÚBLICA com uma credencial dentro

Esta é a armadilha que a integração com o Bling criou, e ela não é óbvia.

`config_loja` é lida por `anon` desde 0005 — banner, título e piso do frete
grátis **são** informação pública, e a política de leitura é `USING (true)`. A
migração 0012 acrescentou ali `bling_refresh_token`, que é o refresh token
rotativo do ERP: **a credencial que emite nota fiscal e movimenta estoque.**

**Uma coluna nova nessa tabela nasceria legível por qualquer chave anônima da
instância**, via PostgREST, sem erro em lugar nenhum. Por isso 0012 revoga o
`SELECT` de tabela e devolve a lista explícita de colunas — todas menos o token
—, e faz o mesmo com `INSERT`/`UPDATE` de `authenticated`: **a política decide a
LINHA, o GRANT decide as COLUNAS**, e nem o administrador escreve o token pelo
PostgREST. Quem o escreve é só o serviço Node, que conecta como dono do banco e
não passa por GRANT nenhum.

**Sintoma da divergência:** se alguém acrescentar coluna a `config_loja` por
migração e esquecer de estendê-la no `GRANT`, a vitrine deixa de enxergar aquele
campo (`42501` ou coluna faltando no `GET /config`); se alguém devolver o
`GRANT SELECT` de tabela "para simplificar", **o refresh token do Bling passa a
sair pelo PostgREST para qualquer visitante**, calado. O teste que grita é o de
`backend/test/pedidos.test.js` ("o que 0005 abre para anon…"), que confere
coluna a coluna que `titulo_site` e `frete_gratis_minimo_centavos` saem e que
`bling_refresh_token` **não** sai nem para `anon` nem para `authenticated`.

**Regra prática:** coluna nova em `config_loja` entra no `GRANT` explicitamente,
ou não é lida. Segredo novo **não** entra nessa tabela sem repetir o recorte.

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

O que existe hoje é `scripts/backup-banco.sh` (dump com verificação embutida e
retenção) e `scripts/backup-banco.cron.exemplo`. **Agendar e testar a restauração
continua sendo trabalho de gente** — `docs/go-live.md` §7.

### 5.7 O Bling exige INSTÂNCIA ÚNICA, e escalar horizontalmente quebra tudo

**O refresh token do Bling é rotativo:** a cada renovação o Bling **invalida** o
token usado e devolve outro. O serviço grava o novo em
`canastra.config_loja.bling_refresh_token` e passa a usá-lo; a variável
`BLING_REFRESH_TOKEN` do `.env` vale só como semente da **primeira**
autorização.

**Com duas instâncias, as duas renovam, cada rotação invalida a da outra, e a
integração entra em `invalid_grant` permanente** — sem parar a loja, sem parar o
checkout, sem nada além de erro no log e nota fiscal que deixou de sair.

`deploy/ecosystem.config.cjs` já fixa `instances: 1` por causa disto. Se algum
dia a API for escalada (mais réplicas no compose, cluster do PM2, dois
contêineres atrás do nginx), **releia `docs/bling.md` antes** — o resto do
serviço aguenta réplica; esta integração, não.

Quando o Bling recusa a renovação com `invalid_grant`, o cliente **esquece o
token da memória** de propósito, para a próxima tentativa recomeçar pelo que
estiver gravado no banco (o do gestor, colado à mão pelo SQL do runbook). Isso é
rede de recuperação, não permissão para rodar dois processos.

### 5.8 Os crons nascem desligados — e o Clube não tem cron nenhum

Toda integração nova nasce desligada, e o processo sobe idêntico ao de antes
quando a chave não está lá. São **dois** crons, ambos no serviço Node:

| Cron | Liga com | Quando roda |
|---|---|---|
| Carrinho abandonado | `ABANDONO_ATIVO=true` **literal** | de hora em hora (minuto 0). Sem a variável o `node-cron` nem é carregado |
| Rastreio do Bling | `BLING_ATIVO=true` **e** `BLING_RASTREIO_CRON=true` | minuto 30, de propósito fora do outro |

**O Clube da Canastra NÃO tem cron**, e essa é a parte que surpreende quem
procura um. A cobrança recorrente é do Mercado Pago: cada assinatura vira um
`preapproval` cuja `notification_url` aponta para
`/webhook/mercadopago/assinaturas`, e é a notificação de cada cobrança que vira
pedido no banco.

**Consequência operacional:** sem `WEBHOOK_URL` pública e alcançável por HTTPS,
o preapproval **nasce sem `notification_url`** — a assinatura é criada, o cliente
autoriza, o cartão é cobrado pelo MP, e **nenhum pedido aparece na loja**. Não há
erro na subida e não há erro no checkout da assinatura; o sintoma é assinatura
ativa sem entrega. Assinatura **exige** essa variável em produção.

Não é preciso cadastrar o webhook de assinaturas no painel do Mercado Pago: a
URL por preapproval basta. Se cadastrar também não há mal — a validação HMAC usa
o **mesmo** `MP_WEBHOOK_SECRET`.

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
| **Preço mudado no painel não aparece na vitrine** | a vitrine guarda a resposta de `GET /dashboard` por **60 s** (`frontend/lib/catalogo/repositorio.ts`). Se passar disso, a API está fora e a vitrine caiu para o JSON versionado — é a degradação graciosa, não um bug: o preço fica velho, a loja continua vendendo, e o checkout reconfere no servidor antes de cobrar | §1.1 |
| **A sacola do cliente dobra a cada visita** | a base `cart:na_conta` do `localStorage` se perdeu; a RPC `fundir_sacola` soma por desenho e quem impede a segunda soma é ela | `frontend/lib/sacola/fusao.ts` |
| **Bling parou de sincronizar e o log diz `invalid_grant`** | o refresh token rotativo foi usado por outro processo — quase sempre uma segunda instância da API. Confira `instances: 1` antes de gerar token novo | §5.7 |
| **Assinatura ativa, cartão cobrado, e nenhum pedido na loja** | `WEBHOOK_URL` ausente ou ilegível: o preapproval nasceu sem `notification_url` e a cobrança não tem para onde avisar | §5.8 |
| **O carrinho abandonado / o rastreio do Bling nunca dispara** | os crons nascem desligados; só o valor **literal** `true` liga | §5.8 |
| **404 numa tabela nova**, com RLS correta | tabela criada fora das migrações, sem `GRANT` | §5.2 |
| **Painel do admin vazio e cliente sem ver o próprio endereço, sem erro** | `FORCE ROW LEVEL SECURITY` ligado em `admins`/`clientes` | §4.1 |
| **`42501` citando "row-level security policy for table admins"** | a mesma, já denunciada pelo `SET row_security = off` | §4.1 |
| **`42501` ao ler o catálogo na vitrine** | coluna na view sem `GRANT` correspondente | §4.2 |
| **`42501` num `select=*` ou `.insert(...).select()`** | a relação tem privilégio por COLUNA — `produtos`, `config_loja` ou `avaliacoes`. Liste as colunas; é o erro fazendo o trabalho dele | §4.2 |
| **Campo novo de `config_loja` não aparece no `GET /config`** | a coluna entrou por migração e ficou fora do `GRANT` explícito de 0012 | §4.3 |
| **O `bling_refresh_token` sai pelo PostgREST** | alguém devolveu `GRANT SELECT` de TABELA em `config_loja`. É vazamento de credencial fiscal, não bug de tela | §4.3 |
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
npm --prefix backend test   # pagamento, banco (RLS, migrações, seed, RPCs),
                            # cupons, Bling, LGPD, avaliações e Clube
npm test                    # a vitrine (vitest)
```

Piso medido em **22/08/2026**: **398** no backend, **799 testes em 62 arquivos**
na vitrine. O número está datado porque ele sobe a cada onda — o que importa é
que **não caia**. Não o copie para outro documento: as três contagens diferentes
que este repositório carregou vieram exatamente disso.

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
      as 16 migrações.
- [ ] `SELECT count(*) FROM canastra.produtos;` devolve os 29 SKUs.
- [ ] Uma requisição anônima à instância lê `canastra.produtos_publicos` e **não**
      lê `canastra.clientes`.
- [ ] A conta de `SEED_ADMIN_EMAIL` existe no GoTrue **e** tem linha em
      `canastra.admins`.
- [ ] Os três passos da §3.5 estão feitos: allow-list de redirecionamento,
      modelos com `{{ .TokenHash }}` e SMTP.
- [ ] Um cadastro novo, de ponta a ponta, num navegador limpo: formulário →
      e-mail → link → conta com linha em `canastra.clientes`.

O checklist completo de pós-deploy (nginx, TLS, healthcheck, webhook) está em
`docs/deploy.md` §11.

### 8.2 `npm run verifica` — apagado na Onda 7, e não substituído

Havia aqui um script de fumaça num Chromium real
(`frontend/scripts/verifica-fluxo.mjs`, 37 checagens). **Ele foi apagado, e não
porque a reescrita o quebrou: ele já não rodava.** Três defeitos, e cada um
sozinho já o impedia de passar:

- o `executablePath` estava cravado em `/opt/pw-browsers/...`, um caminho Linux
  que não existe na máquina de desenvolvimento;
- a primeira checagem exigia que `/dashboard` sem sessão redirecionasse para
  `/account/login`, e o guard manda para `/dashboard/entrar` desde a reescrita
  do acesso;
- oito das checagens visitavam rotas do painel legado
  (`/dashboard/products/addedProducts`, `/dashboard/orders`,
  `/dashboard/settings/*`), que a Onda 7 apagou.

Consertá-lo exigiria reescrevê-lo inteiro contra as rotas novas **e** ter loja,
API e banco no ar para provar a reescrita — e um script de fumaça que ninguém
conseguiu rodar é pior que nenhum, porque a linha `npm run verifica` no README
faz parecer que existe uma prova que não existe.

**Não há E2E hoje.** A cobertura é a de `npm test` (frontend) e
`npm --prefix backend test`. Reconstruí-lo é decisão registrada em
`docs/pesquisa/2026-08-26-riscos-da-reescrita.md` §4 ("E2E NO CI"), e é a única
forma de cobrir sessão real, cookie, redirect e RLS chegando via PostgREST.
`playwright` continua em `devDependencies` do `frontend` para quando isso for
feito — hoje sem nenhum consumidor.

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

### 9.4 LGPD: apagar cliente não apagava o dado pessoal dele — agora redige antes

`canastra.pedidos.user_id` é `ON DELETE SET NULL`, e não `CASCADE`. É deliberado:
apagar um cliente não pode apagar a venda, que é registro fiscal e contábil.

**O problema era o efeito colateral disso:** nome, CPF, telefone e endereço
sobrevivem em `canastra.pedidos.endereco_json`, cópia congelada no momento da
compra. Apagar a linha de `clientes` não cumpria um pedido de eliminação sob a
LGPD — e, pior, deixava o pedido **órfão e irredigível**, porque sem o vínculo
ninguém mais sabe de quem ele era.

**As migrações 0013 e 0016 criaram o passo que faltava**, e a exclusão de conta
(`backend/src/routes/conta.routes.js`) passou a executá-lo **antes** do DELETE no
GoTrue, abortando a exclusão se a redação falhar. A ordem importa e é essa de
propósito. A redação alcança as três fotografias de dado pessoal do schema:
`pedidos.endereco_json`, `assinaturas.endereco_json` e `avaliacoes.nome_exibicao`
(que é público — a PDP exibe). Antes de redigir, o fluxo **cancela no Mercado
Pago** toda assinatura viva do titular: apagar a conta deixando um `preapproval`
cobrando alguém que já não existe seria pior que não apagar.

**O que a redação PRESERVA, e por quê:** cidade e UF (estatística de venda por
região, não identificam sozinhas), o prefixo do CEP (região de distribuição,
nunca a porta da casa), e total, status e itens do pedido — a venda, que é a
obrigação fiscal. O endereço sai por **whitelist**, não denylist: um campo novo
do checkout de amanhã vira `[redigido]` em vez de vazar por omissão.

**Dois limites que continuam de pé:**

- **Pedido JÁ órfão é irredigível por titular** — o vínculo se foi. Órfãos
  criados antes da 0013 só têm redação **manual, em massa**; o SQL pronto está em
  `docs/seguranca-dados-pessoais.md`, e rodá-lo uma vez em produção é item de
  `docs/go-live.md` §6.
- **O histórico do Git continua com os CSVs** (§9.3).

Para atendimento a titular sem exclusão de conta, há `GET /lgpd/titulares/:userId/dados`
e `POST /lgpd/titulares/:userId/redigir`, ambos só para admin.

---

## 10. Em aberto

Esta seção lista o que **falta em código**. O que virou ação humana — credencial,
acesso à VPS, decisão comercial, conversa com o contador — saiu daqui e mora em
**`docs/go-live.md`**, que é o documento a ler antes de abrir a loja.

### 10.1 Fechado pelas fases que faltam

- **`PUT /promotions/:id`** sobrescreve com NULL os campos ausentes e responde
  200 sem checar `rowCount` — editar promoção inexistente "dá certo". `PUT
  /config` já foi consertado (atualização parcial de verdade); este ficou. **F5.**
- **`axios` (advisory)** — continua nas dependências do backend. **F5.**
- **Conexão com o Postgres sem validar o certificado TLS**
  (`rejectUnauthorized: false` em `pgPool.js`). Com Postgres e serviço Node na
  mesma VPS a exposição muda de natureza, mas a linha continua lá. **F5.**
- **CSP com `unsafe-inline` no `script-src`** — e a atribuição que este
  documento fazia estava errada. Dizia "existem só por causa do
  styled-components do painel legado", o que sugeria que apagar o painel legado
  destravaria as duas diretivas. A Onda 7 apagou o legado e mediu:

  - **`unsafe-eval` saiu de produção.** Zero `eval(` e zero `new Function(` nos
    33 chunks de um build de produção. Continua ligado em desenvolvimento, onde
    o `next dev` gera source map por eval.
  - **`unsafe-inline` fica, e nunca teve a ver com o painel.** Toda página
    pré-renderizada carrega de 34 a 44 `<script>` inline do próprio Next (o
    `self.__next_f.push(...)`, que é o payload RSC da hidratação) e **zero**
    `nonce=` — medido em `.next/server/app/*.html`. Sem `unsafe-inline` o
    navegador recusa todos eles e a loja para de hidratar.

  O caminho continua sendo nonce via middleware, mas com o preço agora escrito:
  **nonce obriga render dinâmico**, e `/[locale]` hoje sai como `● (SSG)`. Trocar
  a estática de 74 páginas por essa diretiva é decisão de arquitetura, não
  tarefa de limpeza.
- **O bundle do painel é servido a qualquer visitante** e o guard é de cliente. A
  API está protegida rota a rota e a RLS não depende do navegador, então não há
  vazamento de dado — só de código. O guard vira server-side no App Router. **F6.**
- **As imagens continuam no Cloudinary**, e `CLOUDINARY_*` continua no `.env`.
  **F3.**

### 10.2 Sem fase que os feche

- **Sem trilha de auditoria**: não há registro de quem mudou preço, estoque ou
  status de pedido. Numa loja oficial com mais de um administrador, é o primeiro
  pedido de quem investiga uma divergência.
- **A loja depende de três passos manuais no painel do Supabase** (§3.5) que nada
  em código verifica. Um script de verificação de configuração do GoTrue seria o
  fecho; hoje o que existe é a lista de conferência da §8.
- **`npm run verifica` não cobre as superfícies novas** e tem caminho de Chromium
  e credenciais fixos no script (§8.2).
- **Acervo fotográfico**: `estetica.md` §8 pede três famílias de foto (sabor,
  território, produto) em 4:5. Hoje existem pack shots quadrados e a "foto de
  sabor" é o próprio pacote repetido, então o crossfade do card não aparece. É
  produção fotográfica, não código — e o §8 estima isso como ~60% da percepção de
  qualidade do site.

### 10.3 Passou a ser ação humana — está em `go-live.md`

Nenhum destes é pendência de código; todos têm o passo a passo lá:

| O que era | Onde está agora |
|---|---|
| Backup (§5.6) | `go-live.md` §7 — o script existe; falta agendar e **testar a restauração** |
| Redação dos pedidos já órfãos (§9.4) | `go-live.md` §6 — SQL pronto em `seguranca-dados-pessoais.md` |
| Reescrever o histórico do Git (§9.3) | `go-live.md` §6 — `scripts/reescrever-historico.sh`, pronto e **nunca executado** |
| Dados de catálogo por conferir | `go-live.md` §5 — decisão comercial: 13 SKUs com estoque zero, 11 com preço zero |
| Ligar o Bling e a NF-e | `go-live.md` §4 e `docs/bling.md` — exige app no Bling, 29 SKUs cadastrados lá e configuração fiscal com o contador |

### 10.4 Fechado

**Na F1:** "sem migrações versionadas". `schema.sql` não existe mais; cada
alteração de schema é um arquivo em `backend/db/migrations/`, aplicado uma vez e
registrado.

**Na F2:**

- "refresh token gravado em texto puro" — o Express não emite mais token nenhum,
  e a sessão do GoTrue não passa por aqui;
- "`csurf` arquivado" — saiu junto com `bcrypt`, `cookie-parser` e
  `express-validator`, com as 1.239 linhas das rotas que os usavam;
- "senha da loja em `bcrypt` num banco nosso" — quem guarda credencial agora é o
  GoTrue.

**Na F4:**

- "os repositories do Express estão mortos contra o banco migrado" — todos falam
  `canastra.*`, e o contrato JSON do painel legado é preservado por `AS` no
  SELECT;
- "a vitrine mostra preço e estoque do JSON versionado" — o comercial vem do
  banco, com o JSON como degradação (§6);
- "a sacola de quem está logado vive em dois lugares".

**Na F5, a metade que importava:**

- "webhook do Mercado Pago sem transação nem idempotência" — ele é transacional,
  idempotente, e responde **500** para o MP reenviar em vez do 200 silencioso;
- "a cobrança acontece antes de o pedido existir no banco" — o pedido nasce
  primeiro, com chave de idempotência;
- "`PUT /config` sobrescreve com NULL os campos ausentes".

**Na F7:** proxy reverso de mesma origem, Dockerfiles e compose, PM2, script de
backup com verificação do dump, CI com as duas suítes mais o build de produção, e
o runbook `docs/deploy.md`.

**Fora de fase, nas ondas 2 e 3:**

- "pagamento com cartão: o checkout aceita só Pix" — o cartão é tokenizado no
  navegador pelo SDK do MP, atrás de `NEXT_PUBLIC_MP_PUBLIC_KEY`;
- "Política de Privacidade e Termos de Uso ainda atribuem a loja à marca antiga";
- "sem `sitemap.ts`/`robots.ts`; `/account` e `/dashboard` são indexáveis" — os
  dois existem, e o `robots.ts` barra `/dashboard`, `/account`, `/checkout` e
  `/sacola`;
- "redação de dado pessoal em pedidos" — migrações 0013 e 0016 (§9.4).
