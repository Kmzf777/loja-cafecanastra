# Bot de WhatsApp (Cloud API oficial da Meta) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um segundo canal de aviso ao cliente, ao lado do e-mail, no número oficial da loja na WhatsApp Cloud API da Meta — seis templates de utilidade para os marcos de pedido, um menu de suporte por botões, e uma tela de operação no painel.

**Architecture:** Módulos puros (`telefone`, `whatsappMensagens`) na base; um cliente HTTP com `fetchImpl` injetável; um `whatsappConfig` que lê a credencial na ordem memória → banco → env; e um wrapper `avisarCliente()` que **substitui** as seis chamadas de `sendStatusEmail` para herdar as guardas de disparo que já existem em cada call site. O webhook valida HMAC fail-closed, deduplica por `wamid[:status]` e roteia o menu por `button_reply.id`.

**Tech Stack:** Node 22 + Express (CommonJS), Postgres 16, `node --test` no backend, `vitest` no frontend, painel legado React + react-router, Graph API `v26.0`.

**Spec:** `docs/superpowers/specs/2026-08-22-bot-whatsapp-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/db/migrations/0017_whatsapp_meta.sql` | **novo** — 3 tabelas + 5 colunas em `clientes` + `CREATE OR REPLACE` de `garantir_cliente` |
| `backend/src/utils/telefone.js` | **novo** — E.164 do Brasil, e as duas variantes do 9º dígito |
| `backend/src/utils/whatsappMensagens.js` | **novo** — mapa dos 6 templates; `conteudoDoStatusWhats()` puro |
| `backend/src/utils/emailSender.js` | **editar** — exportar `conteudoDoStatus` (fonte única do recorte) |
| `backend/src/services/whatsappConfig.js` | **novo** — credencial e interruptores; memória → banco → env |
| `backend/src/services/whatsappClient.js` | **novo** — Graph API v26.0, `fetchImpl` injetável |
| `backend/src/services/notificacoes.js` | **novo** — `avisarCliente()`, o wrapper dos dois canais |
| `backend/src/controllers/WhatsappController.js` | **novo** — webhook (GET+POST) e rotas do painel |
| `backend/src/routes/whatsapp.routes.js` | **novo** — montagem, `isAuthenticated`→`isAdmin`, `whatsappLigado` |
| `backend/src/index.js` | **editar** — registrar a rota, com `express.json({verify})` só nela |
| `backend/src/controllers/OrderController.js:255` | **editar** — call site C1 |
| `backend/src/controllers/PaymentController.js:987,1227` | **editar** — call sites C2, C3 |
| `backend/src/controllers/ClubeController.js:620,850` | **editar** — call sites C4, C5 |
| `backend/src/services/blingPedidos.js:804` | **editar** — call site C6 (mantém o `await`) |
| `frontend/legacy/components/DashboardSection/WhatsApp/*` | **novo** — tela, contrato puro, hook de ações |
| `frontend/legacy/PainelApp.jsx` | **editar** — import preguiçoso + rota absoluta |
| `frontend/legacy/components/DashboardSection/MenuAside/MenuAside.jsx` | **editar** — item de menu |
| `frontend/app/(vitrine)/account/cadastro/page.tsx` | **editar** — telefone obrigatório + opt-in de promoções |
| `frontend/lib/conta/cadastro.ts` | **editar** — repassar telefone e preferência |
| `backend/src/.env.example` | **editar** — seção Meta / WhatsApp Cloud API |

**Regras da casa que valem em toda tarefa:** `"use strict"` na linha 1 dos arquivos de backend; `node:assert/strict`; nomes de teste em português descrevendo comportamento; asserção em **SQLSTATE**, nunca em texto de mensagem; nenhum teste toca a rede; `DATABASE_URL` é definida **antes** de qualquer `require("../src/...")`; migração aplicada não se edita — se errar, escreva a próxima.

---

## Task 1: Migração 0017 — as tabelas e as colunas

**Files:**
- Create: `backend/db/migrations/0017_whatsapp_meta.sql`
- Create: `backend/test/whatsapp_schema.test.js`
- Modify: `backend/db/instalacao-completa.sql` e `backend/db/reset.sql` (gerados, não escritos à mão)

- [ ] **Step 1: Confirmar que 0017 está livre**

Run: `ls backend/db/migrations | tail -3`
Expected: a última é `0016_redacao_ampliada.sql`. Se outro worktree tiver avançado, use o próximo número livre e ajuste todos os nomes deste plano.

- [ ] **Step 2: Escrever o teste que falha**

Create `backend/test/whatsapp_schema.test.js`:

```js
"use strict";

/**
 * O que a migracao 0017 promete ao resto do sistema, afirmado no CATALOGO e
 * nao no texto do arquivo: as tres tabelas existem, nenhuma delas e alcancavel
 * por `authenticated`, e o CHECK de status recusa vocabulario inventado.
 *
 * O banco e REAL porque privilegio e CHECK sao exatamente o que um duble de
 * pool nao prova.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);
}, { timeout: 120_000 });

after(async () => {
  await bd?.derrubar();
});

beforeEach(() => {
  if (!bd) {
    throw new Error("O Postgres nao subiu no before(); a causa real esta no erro daquele hook.");
  }
});

test("as tres tabelas do WhatsApp existem no schema canastra", async () => {
  const { rows } = await bd.pool.query(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'canastra'
        AND tablename LIKE 'whatsapp%'
      ORDER BY tablename`,
  );
  assert.deepEqual(
    rows.map((r) => r.tablename),
    ["whatsapp_config", "whatsapp_eventos", "whatsapp_mensagens"],
  );
});

test("nenhuma tabela do WhatsApp e alcancavel por anon nem por authenticated", async () => {
  // Impede o modo de falha real: uma politica distraida amanha acordaria o
  // pacote `arwd` que 0001 concede por default a `authenticated`.
  const { rows } = await bd.pool.query(
    `SELECT table_name, grantee, privilege_type
       FROM information_schema.role_table_grants
      WHERE table_schema = 'canastra'
        AND table_name LIKE 'whatsapp%'
        AND grantee IN ('anon', 'authenticated')`,
  );
  assert.deepEqual(rows, []);
});

test("as tres tabelas do WhatsApp tem RLS ligada", async () => {
  const { rows } = await bd.pool.query(
    `SELECT relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'canastra'
        AND c.relname LIKE 'whatsapp%'
        AND c.relkind = 'r'
        AND c.relrowsecurity = false`,
  );
  assert.deepEqual(rows, []);
});

test("whatsapp_config so aceita a linha 1", async () => {
  await bd.pool.query("INSERT INTO canastra.whatsapp_config (id) VALUES (1)");
  const erro = await bd.pool
    .query("INSERT INTO canastra.whatsapp_config (id) VALUES (2)")
    .then(() => null, (e) => e);
  // SQLSTATE, nunca o texto: 23514 é violacao de CHECK.
  assert.equal(erro?.code, "23514");
});

test("whatsapp_mensagens recusa status fora do vocabulario", async () => {
  const erro = await bd.pool
    .query(
      `INSERT INTO canastra.whatsapp_mensagens (template, status)
       VALUES ('pedido_enviado', 'entregando')`,
    )
    .then(() => null, (e) => e);
  assert.equal(erro?.code, "23514");
});

test("o mesmo wamid nao vira duas linhas, mas varios NULL cabem", async () => {
  await bd.pool.query(
    `INSERT INTO canastra.whatsapp_mensagens (template, wamid)
     VALUES ('pedido_enviado', 'wamid.AAA')`,
  );
  const erro = await bd.pool
    .query(
      `INSERT INTO canastra.whatsapp_mensagens (template, wamid)
       VALUES ('pedido_entregue', 'wamid.AAA')`,
    )
    .then(() => null, (e) => e);
  assert.equal(erro?.code, "23505");

  // O indice e PARCIAL: linha sem wamid nao colide com outra sem wamid.
  await bd.pool.query(
    `INSERT INTO canastra.whatsapp_mensagens (template) VALUES ('pedido_recebido')`,
  );
  await bd.pool.query(
    `INSERT INTO canastra.whatsapp_mensagens (template) VALUES ('pedido_recebido')`,
  );
});

test("clientes ganhou as cinco colunas de WhatsApp", async () => {
  const { rows } = await bd.pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'canastra' AND table_name = 'clientes'
        AND column_name LIKE 'whatsapp%'
      ORDER BY column_name`,
  );
  assert.deepEqual(rows.map((r) => r.column_name), [
    "whatsapp_optin_em",
    "whatsapp_optout_em",
    "whatsapp_promo_optin_em",
    "whatsapp_ultima_entrada_em",
    "whatsapp_wa_id",
  ]);
});

test("garantir_cliente carimba o optin quando um telefone e gravado", async () => {
  const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
  await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ana@ex.com')", [ANA]);
  await bd.pool.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ANA]);

  await bd.pool.query("SELECT canastra.garantir_cliente('Ana', '31999990000', NULL)");

  const { rows } = await bd.pool.query(
    "SELECT telefone, whatsapp_optin_em FROM canastra.clientes WHERE user_id = $1::uuid",
    [ANA],
  );
  assert.equal(rows[0].telefone, "31999990000");
  assert.notEqual(rows[0].whatsapp_optin_em, null);
});

test("garantir_cliente sem telefone nao carimba optin", async () => {
  const BIA = "aaaaaaaa-0000-0000-0000-000000000002";
  await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, 'bia@ex.com')", [BIA]);
  await bd.pool.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [BIA]);

  await bd.pool.query("SELECT canastra.garantir_cliente('Bia', NULL, NULL)");

  const { rows } = await bd.pool.query(
    "SELECT whatsapp_optin_em FROM canastra.clientes WHERE user_id = $1::uuid",
    [BIA],
  );
  assert.equal(rows[0].whatsapp_optin_em, null);
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `cd backend && node --test test/whatsapp_schema.test.js`
Expected: FAIL — `relation "canastra.whatsapp_config" does not exist` (42P01).

- [ ] **Step 4: Ler o shim de `auth.uid()` antes de escrever o SQL**

Run: `sed -n '109,151p' backend/test/ajuda/postgres.js`
Expected: você verá como `auth.uid()` é montado no teste. Se ele **não** lê `request.jwt.claim.sub`, ajuste as duas últimas asserções do Step 2 para o mecanismo real antes de seguir — o teste é que se adapta ao shim, nunca o contrário.

- [ ] **Step 5: Escrever a migração**

Create `backend/db/migrations/0017_whatsapp_meta.sql`:

```sql
-- WhatsApp Cloud API (Meta): a credencial, o rastro do que foi enviado, a
-- trava de idempotencia do webhook e o consentimento do cliente.
--
-- A integracao NASCE DESLIGADA (`ativo` default false, como BLING_ATIVO em
-- 0012): um banco sem WhatsApp nenhum e exatamente igual ao de ontem.
--
-- O QUE ESTA MIGRACAO DELIBERADAMENTE NAO FAZ: nao guarda telefone completo em
-- tabela nova. Guardar telefone fora de `clientes` abriria um SEGUNDO elo a
-- manter na redacao da LGPD (0013, 0016) para sempre. O painel se vira com os
-- quatro ultimos digitos.

/* ------------------------------------------------------------------------- *
 * A configuracao e a credencial
 * ------------------------------------------------------------------------- */

-- Tabela PROPRIA, e nao coluna em `config_loja`, por um motivo medido:
-- `config_loja` e publica por desenho -- GRANT SELECT para `anon` (0005:133),
-- politica USING (true) (0006:434) e `GET /config` SEM autenticacao
-- (products.routes.js:32). O Bling conseguiu guardar segredo la porque
-- 0012:105-116 trancou por privilegio de COLUNA, e funciona; mas cada segredo
-- novo naquela tabela e mais um que depende de ninguem escrever `select=*`.
-- Uma tabela sem GRANT nenhum nao tem esse risco.
--
-- Linha unica pelo mesmo par de guardas de 0005:109-115: o CHECK pega o INSERT
-- com id explicito (23514) e a chave primaria pega o caminho comum, que pega o
-- DEFAULT 1 (23505).
CREATE TABLE canastra.whatsapp_config (
  id integer PRIMARY KEY DEFAULT 1
       CONSTRAINT whatsapp_config_linha_unica CHECK (id = 1),

  ativo boolean NOT NULL DEFAULT false,

  -- O token de System User da Meta NAO rotaciona -- a Meta nao devolve um
  -- substituto a cada uso, diferente do refresh token do Bling (0012:75-82).
  -- Ele mora aqui mesmo assim porque o painel e quem o grava, e a env vale
  -- como semente. O preco esta escrito no spec: segredo em tabela entra em
  -- pg_dump e continua legivel por quem tiver a service_role key.
  access_token    text,
  app_secret      text,
  verify_token    text,
  phone_number_id text,
  waba_id         text,

  -- Para onde vai quem apertar "Falar com alguem". Semente: LOJA_WHATSAPP.
  numero_suporte  text,

  -- Um interruptor por status, e nao um jsonb: o painel mapeia 1:1 e um valor
  -- invalido aqui seria um aviso que ninguem sabe explicar.
  aviso_pendente    boolean NOT NULL DEFAULT true,
  aviso_aprovado    boolean NOT NULL DEFAULT true,
  aviso_enviado     boolean NOT NULL DEFAULT true,
  aviso_entregue    boolean NOT NULL DEFAULT true,
  aviso_cancelado   boolean NOT NULL DEFAULT true,
  aviso_reembolsado boolean NOT NULL DEFAULT true,

  -- MANTIDA POR QUEM ESCREVE: nao ha trigger de moddatetime neste schema
  -- (0015:66-67). Todo UPDATE do servico escreve now() junto.
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

/* ------------------------------------------------------------------------- *
 * O rastro do que saiu
 * ------------------------------------------------------------------------- */

CREATE TABLE canastra.whatsapp_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE SET NULL como o resto do schema: o registro do que foi enviado
  -- nao desaparece com a exclusao LGPD do cliente; a linha perde o dono.
  pedido_id uuid REFERENCES canastra.pedidos (pedido_id) ON DELETE SET NULL,

  -- Sem FK, como o resto do schema faz com auth.users.
  user_id uuid,

  -- SO os quatro ultimos digitos. Ver o cabecalho: telefone completo mora em
  -- `clientes.telefone` e em lugar nenhum mais.
  telefone_final text,

  template text NOT NULL,

  -- Vocabulario PROPRIO, em portugues, traduzido do provedor pelo servico
  -- (a mesma disciplina de 0015:58-63 e de utils/statusDePedido.js).
  status text NOT NULL DEFAULT 'pendente'
           CONSTRAINT whatsapp_mensagens_status_valido
             CHECK (status IN ('pendente', 'enviada', 'entregue', 'lida', 'falhou')),

  -- Identificador OPACO do outro sistema: TEXTO, nunca inteiro -- a mesma
  -- lente de `bling_id` (0012:12-14) e de `pagamento_id_mp` (0005).
  wamid text,

  erro_codigo integer,
  erro_texto  text,

  criado_em     timestamptz NOT NULL DEFAULT now(),
  enviado_em    timestamptz,
  entregue_em   timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- PARCIAL como `pedidos_bling_id_idx` (0012:71-73): quase toda linha nasce com
-- wamid NULL, e um indice total indexaria a tabela inteira para proteger um
-- punhado de linhas.
--
-- O QUE ELE **NAO** FAZ: nao impede duas mensagens do mesmo template para o
-- mesmo pedido. Quem impede isso e a guarda de status igual no wrapper
-- (services/notificacoes.js) -- aqui embaixo so nao ha como o mesmo envio da
-- Meta virar duas linhas.
CREATE UNIQUE INDEX whatsapp_mensagens_wamid_idx
  ON canastra.whatsapp_mensagens (wamid)
  WHERE wamid IS NOT NULL;

CREATE INDEX whatsapp_mensagens_pedido_idx
  ON canastra.whatsapp_mensagens (pedido_id);

/* ------------------------------------------------------------------------- *
 * A trava de idempotencia do webhook
 * ------------------------------------------------------------------------- */

-- A Meta reentrega por ATE 7 DIAS diante de qualquer resposta diferente de 200,
-- e reentrega tambem quando o 200 se perde na volta. Nenhuma quantidade de
-- "responder 200 rapido" elimina a duplicata; so deduplicacao elimina.
--
-- A chave e o PAR wamid+status para status, e o wamid puro para entrada: o
-- mesmo wamid gera `sent`, `delivered` e `read`, entao deduplicar so por wamid
-- DESCARTARIA status legitimos.
CREATE TABLE canastra.whatsapp_eventos (
  dedupe_key  text PRIMARY KEY,
  recebido_em timestamptz NOT NULL DEFAULT now()
);

-- A limpeza corta por aqui. Retencao de 7 dias, alinhada a janela de
-- reentrega documentada -- TTL de "algumas horas" deixa passar a duplicata do
-- fim da janela, que e justamente a que ninguem esta olhando.
CREATE INDEX whatsapp_eventos_recebido_idx
  ON canastra.whatsapp_eventos (recebido_em);

/* ------------------------------------------------------------------------- *
 * RLS -- nada entra pelo navegador
 * ------------------------------------------------------------------------- */

-- Obrigatorio: a invariante de backend/test/schema.test.js:65 reprova qualquer
-- tabela de `canastra` sem isto, sem precisar citar o nome dela.
ALTER TABLE canastra.whatsapp_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.whatsapp_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.whatsapp_eventos   ENABLE ROW LEVEL SECURITY;

-- NAO HA POLITICA, e a ausencia e o desenho: enviar e receber WhatsApp passa
-- pelo Express e pelo webhook, nunca por um INSERT de navegador. RLS ligada sem
-- politica ja nega; o REVOKE e a SEGUNDA TRANCA, pelo argumento de 0006:300-330
-- e 0011:33-37 -- a ausencia de politica se perde com um CREATE POLICY
-- distraido de outro dia; o privilegio de tabela nao. O pacote `arwd` que
-- 0001:39-40 concede por default a `authenticated` esta inerte hoje e sai
-- inteiro para nao ser acordado amanha.
--
-- `service_role` NAO e tocado: e credencial de servidor (0001:41-42).
-- `anon` nao aparece porque nunca teve nada: 0001:20-28 o mantem fora do
-- default, e quem for publico leva GRANT proprio.
REVOKE ALL ON canastra.whatsapp_config    FROM authenticated;
REVOKE ALL ON canastra.whatsapp_mensagens FROM authenticated;
REVOKE ALL ON canastra.whatsapp_eventos   FROM authenticated;

/* ------------------------------------------------------------------------- *
 * O consentimento, no cliente
 * ------------------------------------------------------------------------- */

-- CARIMBO DE DATA, e nao booleano, nos tres consentimentos: o onus de provar
-- que o consentimento existiu e do controlador (LGPD Art. 8 par. 2), e um
-- `true` nao diz QUANDO a pessoa concordou.
ALTER TABLE canastra.clientes
  -- A CHAVE CANONICA. A doc da Meta diz, com estas palavras: "For Brazil and
  -- Mexico, the extra added prefix of the phone number may be modified by the
  -- Cloud API" -- o nono digito. Casar o `from` do webhook com o telefone do
  -- cadastro daria "cliente desconhecido" para metade do Brasil. O telefone
  -- digitado e a semente do PRIMEIRO envio; daí em diante manda o wa_id.
  ADD COLUMN whatsapp_wa_id text,

  -- Avisos de pedido: execucao de contrato (LGPD Art. 7 V), carimbado junto
  -- com o telefone no cadastro.
  ADD COLUMN whatsapp_optin_em timestamptz,

  -- Promocoes: consentimento (Art. 7 I), caixa a parte e desmarcada.
  ADD COLUMN whatsapp_promo_optin_em timestamptz,

  -- Nao existe STOP nativo: a Meta nao intercepta texto. Parar de mandar e
  -- inteiramente responsabilidade da loja, e e esta coluna.
  ADD COLUMN whatsapp_optout_em timestamptz,

  -- O relogio da janela de 24h. Fora dela a Meta responde 131047 e so template
  -- aprovado sai. E tambem o teto de "um menu por janela" do roteador.
  ADD COLUMN whatsapp_ultima_entrada_em timestamptz;

-- MESMA ASSINATURA de 0008:113-116, de proposito: test/garantir_cliente.test.js
-- afirma a assinatura NO CATALOGO, e um quarto parametro criaria uma FUNCAO
-- NOVA que aquele teste nao veria. CREATE OR REPLACE preserva a assinatura.
--
-- A UNICA mudanca de comportamento: carimbar `whatsapp_optin_em` quando um
-- telefone e efetivamente gravado. O corpo abaixo precisa ser o de 0008 com
-- essa linha somada -- copie-o de la, nao o reescreva de memoria.
--
-- <<< AO EXECUTAR: rode `sed -n '113,400p' backend/db/migrations/0008_garantir_cliente.sql`,
--     copie o corpo INTEIRO, e acrescente `whatsapp_optin_em` ao INSERT (com
--     `CASE WHEN telefone_limpo IS NOT NULL THEN now() END`) e ao UPDATE de
--     conflito (so quando o telefone passa de NULL para preenchido). >>>
```

- [ ] **Step 6: Copiar o corpo de `garantir_cliente`**

Run: `sed -n '104,400p' backend/db/migrations/0008_garantir_cliente.sql`

Cole o `CREATE FUNCTION` inteiro no fim de `0017`, trocando `CREATE FUNCTION` por `CREATE OR REPLACE FUNCTION`, mantendo a assinatura `(nome text, telefone text DEFAULT NULL, cpf text DEFAULT NULL)` **exatamente** como está, e acrescentando `whatsapp_optin_em` no `INSERT` e no ramo de conflito conforme o comentário do Step 5. Remova o comentário `<<< AO EXECUTAR ... >>>`.

- [ ] **Step 7: Rodar o teste e ver passar**

Run: `cd backend && node --test test/whatsapp_schema.test.js`
Expected: PASS, 9 testes.

- [ ] **Step 8: Regenerar o SQL colável e rodar as invariantes**

Run: `npm run db:gerar-sql && cd backend && node --test test/schema.test.js test/rls.test.js test/instalacao.test.js`
Expected: PASS. `instalacao.test.js` sobe dois Postgres e compara catálogo a catálogo — é ele que pega um `db:gerar-sql` esquecido.

- [ ] **Step 9: Commit**

```bash
git add backend/db/migrations/0017_whatsapp_meta.sql backend/db/instalacao-completa.sql backend/db/reset.sql backend/test/whatsapp_schema.test.js
git commit -m "feat: o banco ganha lugar para o WhatsApp, e nenhum navegador o alcanca"
```

---

## Task 2: `utils/telefone.js` — o Brasil e o nono dígito

**Files:**
- Create: `backend/src/utils/telefone.js`
- Test: `backend/test/telefone.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/test/telefone.test.js`:

```js
"use strict";

/**
 * A normalizacao de telefone para a Cloud API, e a armadilha que e do Brasil.
 *
 * Sem banco e sem rede de proposito: e funcao pura, e o teste que precisa de
 * mock pesado e sinal de que o codigo esta no lugar errado.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { paraE164, variantesBrasil, ultimosQuatro } = require("../src/utils/telefone.js");

test("tira mascara e devolve E.164 com o 55 na frente", () => {
  assert.equal(paraE164("(31) 99999-0000"), "5531999990000");
  assert.equal(paraE164("31 99999 0000"), "5531999990000");
  assert.equal(paraE164("31999990000"), "5531999990000");
});

test("aceita o numero que ja vem com o 55", () => {
  assert.equal(paraE164("5531999990000"), "5531999990000");
  assert.equal(paraE164("+55 31 99999-0000"), "5531999990000");
});

test("aceita fixo e celular de oito digitos", () => {
  assert.equal(paraE164("3133330000"), "553133330000");
});

test("devolve null para o que nao e telefone brasileiro", () => {
  // O modo de falha que isto impede: mandar lixo para a Meta gasta cota e
  // derruba a nota de qualidade do numero.
  assert.equal(paraE164(""), null);
  assert.equal(paraE164(null), null);
  assert.equal(paraE164("999"), null);
  assert.equal(paraE164("31999990000999999"), null);
  assert.equal(paraE164("(31) 9999-000A"), null);
});

test("devolve as duas formas do nono digito, sem repetir", () => {
  // A doc da Meta: "For Brazil and Mexico, the extra added prefix of the phone
  // number may be modified by the Cloud API". O webhook pode voltar sem o 9.
  assert.deepEqual(variantesBrasil("5531999990000"), [
    "5531999990000",
    "553199990000",
  ]);
  assert.deepEqual(variantesBrasil("553199990000"), [
    "553199990000",
    "5531999990000",
  ]);
});

test("fixo nao ganha variante de nono digito", () => {
  // Acrescentar 9 a um fixo produz um numero que nao existe.
  assert.deepEqual(variantesBrasil("553133330000"), ["553133330000"]);
});

test("variantesBrasil devolve lista vazia para entrada invalida", () => {
  assert.deepEqual(variantesBrasil("abc"), []);
});

test("ultimosQuatro devolve so o fim, para o painel", () => {
  assert.equal(ultimosQuatro("5531999990000"), "0000");
  assert.equal(ultimosQuatro("(31) 99999-1234"), "1234");
  assert.equal(ultimosQuatro(null), null);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node --test test/telefone.test.js`
Expected: FAIL — `Cannot find module '../src/utils/telefone.js'`.

- [ ] **Step 3: Implementar**

Create `backend/src/utils/telefone.js`:

```js
"use strict";

/**
 * Telefone do cliente para a Cloud API da Meta.
 *
 * A ARMADILHA QUE JUSTIFICA ESTE MODULO e do Brasil. A documentacao da Meta
 * diz, com estas palavras: "For Brazil and Mexico, the extra added prefix of
 * the phone number may be modified by the Cloud API." Ou seja: voce manda
 * 5531999990000 e o webhook pode devolver 553199990000, sem o nono digito.
 * Comparar o `from` do webhook com o que esta em `clientes.telefone` daria
 * "cliente desconhecido" para metade do pais.
 *
 * Daí as duas funcoes: `paraE164` normaliza o que o cliente digitou (para o
 * PRIMEIRO envio), e `variantesBrasil` devolve as duas formas para o webhook
 * casar ate `clientes.whatsapp_wa_id` estar gravado. Depois disso a chave
 * canonica e o wa_id, e nada mais adivinha.
 */

const DDI_BRASIL = "55";

/** Digitos e nada mais. Mascara, espaco, parentese e o "+" saem. */
function soDigitos(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

/**
 * Devolve o numero em E.164 sem o "+" (o formato que a Graph API quer no campo
 * `to`), ou `null` quando o que veio nao e telefone brasileiro plausivel.
 *
 * O recorte: depois do 55, sobram 10 digitos (DDD + fixo de 8) ou 11 (DDD +
 * celular de 9). Qualquer outra coisa e `null` — mandar lixo para a Meta gasta
 * cota e derruba a nota de qualidade do numero.
 */
function paraE164(valor) {
  const digitos = soDigitos(valor);
  if (!digitos) return null;

  const semDdi = digitos.startsWith(DDI_BRASIL)
    ? digitos.slice(DDI_BRASIL.length)
    : digitos;

  if (semDdi.length !== 10 && semDdi.length !== 11) return null;

  // DDD brasileiro vai de 11 a 99; nenhum comeca com zero.
  const ddd = Number(semDdi.slice(0, 2));
  if (!Number.isInteger(ddd) || ddd < 11) return null;

  return DDI_BRASIL + semDdi;
}

/**
 * As duas formas do mesmo celular — com e sem o nono digito —, a informada
 * primeiro. Fixo devolve só a si mesmo: acrescentar 9 a um fixo produz um
 * numero que nao existe.
 *
 * Lista vazia quando a entrada nao normaliza; quem chama itera e nao acha nada,
 * em vez de consultar o banco com `undefined`.
 */
function variantesBrasil(valor) {
  const e164 = paraE164(valor);
  if (!e164) return [];

  const assinante = e164.slice(DDI_BRASIL.length + 2);
  const prefixo = e164.slice(0, DDI_BRASIL.length + 2);

  if (assinante.length === 9 && assinante.startsWith("9")) {
    return [e164, prefixo + assinante.slice(1)];
  }
  // Oito digitos comecando com 6-9 e celular antigo: ganha a forma com o 9.
  if (assinante.length === 8 && /^[6-9]/.test(assinante)) {
    return [e164, prefixo + "9" + assinante];
  }
  return [e164];
}

/**
 * Os quatro ultimos digitos, que e tudo que o painel precisa mostrar.
 * O telefone completo mora em `clientes.telefone` e em lugar nenhum mais — ver
 * o cabecalho de 0017.
 */
function ultimosQuatro(valor) {
  const digitos = soDigitos(valor);
  return digitos.length >= 4 ? digitos.slice(-4) : null;
}

module.exports = { paraE164, variantesBrasil, ultimosQuatro };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && node --test test/telefone.test.js`
Expected: PASS, 8 testes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/telefone.js backend/test/telefone.test.js
git commit -m "feat: o telefone do cliente aprende que a Meta mexe no nono digito"
```

---

## Task 3: `emailSender` exporta `conteudoDoStatus`

**Files:**
- Modify: `backend/src/utils/emailSender.js:276-282`
- Test: `backend/test/whatsapp_conteudo.test.js` (criado na Task 4; aqui só o export)

- [ ] **Step 1: Editar o `module.exports`**

Em `backend/src/utils/emailSender.js`, troque o bloco final por:

```js
module.exports = {
  sendStatusEmail,
  sendAdminNewOrderEmail,
  sendAdminClubeSemEstoqueEmail,
  sendCartReminderEmail,
  conteudoDoLembreteDeCarrinho,
  // EXPORTADO PARA O SEGUNDO CANAL, e nao por conveniencia: o `default: null`
  // desta funcao e o que mantem `em_processamento` e `autorizado` silenciosos
  // (ver o docblock em :6-12). O WhatsApp deriva o recorte DESTA fonte, ou o
  // cliente recebe no zap o que a loja decidiu nao mandar por e-mail.
  conteudoDoStatus,
};
```

- [ ] **Step 2: Verificar que nada quebrou**

Run: `cd backend && node --test test/pedidos.test.js test/painel_pedidos.test.js`
Expected: PASS, sem mudança de contagem.

- [ ] **Step 3: Commit**

```bash
git add backend/src/utils/emailSender.js
git commit -m "refactor: o recorte de quais status avisam o cliente vira fonte unica"
```

---

## Task 4: `utils/whatsappMensagens.js` — os seis templates

**Files:**
- Create: `backend/src/utils/whatsappMensagens.js`
- Test: `backend/test/whatsapp_conteudo.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/test/whatsapp_conteudo.test.js`:

```js
"use strict";

/**
 * Os seis templates de utilidade, e as regras da Meta afirmadas em TESTE e nao
 * em comentario -- um template que viola a regra de formatacao volta REJECTED
 * depois de ate 24h de espera, e o erro so aparece la.
 *
 * Sem banco e sem rede: e mapa e funcao pura.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  TEMPLATES,
  conteudoDoStatusWhats,
  corpoSemVariavelPendurada,
} = require("../src/utils/whatsappMensagens.js");

const PEDIDO = {
  order_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  total_amount: "89.90",
  tracking_code: "AA123456789BR",
};

test("cada status que avisa produz o seu template", () => {
  const casos = [
    ["pendente", "pedido_recebido"],
    ["aprovado", "pagamento_aprovado"],
    ["enviado", "pedido_enviado"],
    ["entregue", "pedido_entregue"],
    ["cancelado", "pedido_cancelado"],
    ["rejeitado", "pedido_cancelado"],
    ["reembolsado", "pedido_reembolsado"],
  ];
  for (const [status, template] of casos) {
    const c = conteudoDoStatusWhats(status, PEDIDO, "Ana", PEDIDO.tracking_code);
    assert.equal(c?.template, template, `status ${status}`);
    assert.equal(c?.idioma, "pt_BR");
  }
});

test("os status intermediarios do gateway ficam em silencio", () => {
  // O MESMO recorte que o e-mail faz (emailSender.js:47-48). Avisar "seu
  // pagamento esta em analise" a cada oscilacao do gateway so gera ansiedade —
  // e, no WhatsApp, custa dinheiro por mensagem.
  assert.equal(conteudoDoStatusWhats("em_processamento", PEDIDO, "Ana"), null);
  assert.equal(conteudoDoStatusWhats("autorizado", PEDIDO, "Ana"), null);
  assert.equal(conteudoDoStatusWhats("inventado", PEDIDO, "Ana"), null);
});

test("o recorte do WhatsApp e o mesmo do e-mail, status por status", () => {
  // A prova de que as duas listas nao divergem: se alguem acrescentar um status
  // ao e-mail e esquecer o WhatsApp (ou o contrario), este teste morde.
  const { conteudoDoStatus } = require("../src/utils/emailSender.js");
  const { STATUS_VALIDOS } = require("../src/utils/statusDePedido.js");

  for (const status of STATUS_VALIDOS) {
    const email = conteudoDoStatus(status, PEDIDO, "Ana", null);
    const zap = conteudoDoStatusWhats(status, PEDIDO, "Ana", null);
    assert.equal(
      Boolean(email),
      Boolean(zap),
      `status "${status}": e-mail e WhatsApp discordam sobre avisar`,
    );
  }
});

test("os parametros nomeados chegam preenchidos", () => {
  const c = conteudoDoStatusWhats("enviado", PEDIDO, "Ana", "AA123456789BR");
  assert.equal(c.parametros.nome_cliente, "Ana");
  assert.equal(c.parametros.numero_pedido, "3f2504e0");
  assert.equal(c.parametros.codigo_rastreio, "AA123456789BR");
});

test("pedido enviado sem rastreio ainda avisa, sem prometer codigo", () => {
  // O painel permite mudar para 'enviado' sem digitar o codigo. O aviso nao
  // pode sair com "seu codigo e undefined".
  const c = conteudoDoStatusWhats("enviado", PEDIDO, "Ana", null);
  assert.equal(c.template, "pedido_enviado_sem_rastreio");
  assert.equal(c.botaoUrl, null);
});

test("o botao de rastreio leva o codigo como sufixo, percent-encoded", () => {
  // A Meta aceita UMA variavel no botao URL, e so no fim. E exige
  // percent-encoding de caractere especial.
  const c = conteudoDoStatusWhats("enviado", PEDIDO, "Ana", "AA 123/BR");
  assert.equal(c.botaoUrl, "AA%20123%2FBR");
});

test("nenhum corpo de template comeca ou termina em variavel", () => {
  // Regra dura e documentada da Meta: "dangling parameters are not allowed".
  // Violar isto reprova o template na revisao, ate 24h depois.
  for (const [nome, tpl] of Object.entries(TEMPLATES)) {
    assert.equal(
      corpoSemVariavelPendurada(tpl.corpo),
      true,
      `template "${nome}" comeca ou termina em variavel`,
    );
  }
});

test("nenhum corpo tem duas variaveis coladas", () => {
  for (const [nome, tpl] of Object.entries(TEMPLATES)) {
    assert.equal(
      /\}\}\s*\{\{/.test(tpl.corpo),
      false,
      `template "${nome}" tem variaveis adjacentes`,
    );
  }
});

test("nenhum corpo passa de 1024 caracteres e nenhum rodape passa de 60", () => {
  for (const [nome, tpl] of Object.entries(TEMPLATES)) {
    assert.ok(tpl.corpo.length <= 1024, `corpo de "${nome}" estourou 1024`);
    assert.ok(tpl.rodape.length <= 60, `rodape de "${nome}" estourou 60`);
    // Rodape com variavel e recusado pela Meta.
    assert.equal(/\{\{/.test(tpl.rodape), false, `rodape de "${nome}" tem variavel`);
  }
});

test("todo nome de template respeita o alfabeto que a Meta aceita", () => {
  for (const nome of Object.keys(TEMPLATES)) {
    assert.match(nome, /^[a-z0-9_]{1,512}$/, `nome "${nome}" invalido`);
  }
});

test("nenhum template de utilidade carrega palavra de venda", () => {
  // O exemplo LITERAL da Meta do que vira MARKETING e "an order update with a
  // promo". Reclassificacao multiplica o preco por ~9 e "template
  // misclassification" e motivo explicito de bloqueio de envio.
  const proibidas = [
    "desconto", "promo", "oferta", "cupom", "aproveite",
    "compre", "%", "gratis", "imperdivel", "novidade",
  ];
  for (const [nome, tpl] of Object.entries(TEMPLATES)) {
    const texto = (tpl.corpo + " " + tpl.rodape).toLowerCase();
    for (const palavra of proibidas) {
      assert.equal(
        texto.includes(palavra),
        false,
        `template "${nome}" contem "${palavra}" — isso o reclassifica para MARKETING`,
      );
    }
  }
});

test("todo template leva o botao que abre a janela de atendimento", () => {
  // E o quick-reply que da entrada no menu de suporte: sem ele, o cliente que
  // precisa de ajuda nao tem por onde comecar sem sair do WhatsApp.
  for (const [nome, tpl] of Object.entries(TEMPLATES)) {
    assert.ok(
      tpl.botoes.some((b) => b.type === "QUICK_REPLY"),
      `template "${nome}" nao tem quick-reply de ajuda`,
    );
  }
});

test("quando ha botao URL, ele vem antes dos quick-reply", () => {
  // A Meta recusa quick-reply intercalado com nao-quick-reply: "URL, QR, QR" e
  // valido; "QR, URL, QR" nao e.
  for (const [nome, tpl] of Object.entries(TEMPLATES)) {
    const tipos = tpl.botoes.map((b) => b.type);
    const primeiroQr = tipos.indexOf("QUICK_REPLY");
    const ultimoNaoQr = tipos.map((t, i) => (t === "QUICK_REPLY" ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
    assert.ok(
      primeiroQr === -1 || ultimoNaoQr < primeiroQr,
      `template "${nome}" intercala quick-reply com outro tipo`,
    );
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node --test test/whatsapp_conteudo.test.js`
Expected: FAIL — `Cannot find module '../src/utils/whatsappMensagens.js'`.

- [ ] **Step 3: Implementar**

Create `backend/src/utils/whatsappMensagens.js`. O arquivo declara `TEMPLATES` (mapa único: `corpo`, `rodape`, `botoes`, `parametros`), `conteudoDoStatusWhats(status, order, nome, rastreio)` que devolve `{ template, idioma, parametros, botaoUrl }` ou `null`, e `corpoSemVariavelPendurada(corpo)`.

Regras que o código precisa cumprir — todas já afirmadas pelo teste do Step 1:
- `pendente→pedido_recebido`, `aprovado→pagamento_aprovado`, `enviado→pedido_enviado` (ou `pedido_enviado_sem_rastreio` quando não há código), `entregue→pedido_entregue`, `cancelado`/`rejeitado`→`pedido_cancelado`, `reembolsado→pedido_reembolsado`; qualquer outro devolve `null`.
- `numero_pedido` é `order.order_id.slice(0, 8)`, o mesmo recorte que o e-mail usa (`emailSender.js:15`).
- `botaoUrl` é `encodeURIComponent(rastreio)` quando há rastreio, `null` quando não.
- Todo corpo começa com `Olá, ` e termina em texto fixo.

Texto de cada corpo (copie literalmente — o teste de palavras proibidas e o de variável pendurada dependem deles):

```
pedido_recebido:
  "Olá, {{nome_cliente}}. Recebemos seu pedido {{numero_pedido}}. Assim que o pagamento for confirmado, começamos o preparo do seu café."

pagamento_aprovado:
  "Olá, {{nome_cliente}}. O pagamento do pedido {{numero_pedido}} foi confirmado e já estamos preparando seu café."

pedido_enviado:
  "Olá, {{nome_cliente}}. Seu pedido {{numero_pedido}} saiu para entrega. O código de rastreio é {{codigo_rastreio}}, e você acompanha pelo botão abaixo."

pedido_enviado_sem_rastreio:
  "Olá, {{nome_cliente}}. Seu pedido {{numero_pedido}} saiu para entrega. Assim que o código de rastreio estiver disponível, enviamos aqui."

pedido_entregue:
  "Olá, {{nome_cliente}}. Seu pedido {{numero_pedido}} foi entregue. Se algo não estiver certo, fale com a gente pelo botão abaixo."

pedido_cancelado:
  "Olá, {{nome_cliente}}. Houve um problema com o pagamento do pedido {{numero_pedido}} e ele não seguiu adiante."

pedido_reembolsado:
  "Olá, {{nome_cliente}}. O valor do pedido {{numero_pedido}} foi devolvido. O prazo para aparecer na fatura depende do seu banco."
```

Rodapé de todos: `"Café Canastra"`.
Botões: todos levam `{ type: "QUICK_REPLY", text: "Preciso de ajuda" }`; `pedido_enviado` leva **antes** dele `{ type: "URL", text: "Rastrear pedido", url: "https://cafecanastra.com/rastreio?codigo={{1}}", example: ["AA123456789BR"] }`.

`corpoSemVariavelPendurada` devolve `false` se `corpo.trim()` começar com `{{` ou terminar com `}}`.

O docblock do arquivo precisa registrar, com estas palavras: que o mapa é **a fonte única** e que o painel cria na Meta exatamente o que está aqui; e que uma frase de venda em qualquer corpo reclassifica o template para MARKETING — o exemplo literal da Meta é *"an order update with a promo"*.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && node --test test/whatsapp_conteudo.test.js`
Expected: PASS, 13 testes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/whatsappMensagens.js backend/test/whatsapp_conteudo.test.js
git commit -m "feat: os seis templates de utilidade, com as regras da Meta afirmadas em teste"
```

---

## Task 5: `services/whatsappConfig.js` — memória → banco → env

**Files:**
- Create: `backend/src/services/whatsappConfig.js`
- Test: `backend/test/whatsapp_config.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/test/whatsapp_config.test.js`:

```js
"use strict";

/**
 * A credencial e os interruptores. Banco REAL porque a ordem de precedencia
 * (memoria -> banco -> env) e a garantia de que a linha 1 existe sao
 * exatamente o que um duble de pool nao prova.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let config;

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  // DATABASE_URL ANTES do require de src/ — pgPool.js le a variavel ao ser
  // carregado, e um require adiantado apontaria para o banco errado.
  process.env.DATABASE_URL = bd.connectionString;
  process.env.NODE_ENV = "development";

  config = require("../src/services/whatsappConfig.js");
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(async () => {
  if (!bd) {
    throw new Error("O Postgres nao subiu no before(); a causa real esta no erro daquele hook.");
  }
  await bd.pool.query("DELETE FROM canastra.whatsapp_config");
  config.esquecer();
  delete process.env.META_ACCESS_TOKEN;
  delete process.env.META_PHONE_NUMBER_ID;
});

test("sem banco e sem env, a integracao nao esta configurada", async () => {
  const atual = await config.carregar();
  assert.equal(atual.ativo, false);
  assert.equal(config.configurado(atual), false);
});

test("a env vale como semente quando o banco esta vazio", async () => {
  process.env.META_ACCESS_TOKEN = "EAAG-token-da-env";
  process.env.META_PHONE_NUMBER_ID = "111";
  config.esquecer();

  const atual = await config.carregar();
  assert.equal(atual.access_token, "EAAG-token-da-env");
  assert.equal(atual.phone_number_id, "111");
});

test("o que o painel gravou vence a env", async () => {
  // A ordem e memoria -> banco -> env, a mesma de blingClient.js:118-136: o
  // painel e a fonte, a env e a semente.
  process.env.META_ACCESS_TOKEN = "EAAG-token-da-env";
  await config.gravar({ access_token: "EAAG-token-do-painel" });

  const atual = await config.carregar();
  assert.equal(atual.access_token, "EAAG-token-do-painel");
});

test("gravar cria a linha 1 quando ela nao existe", async () => {
  // Sem o INSERT ... ON CONFLICT DO NOTHING, o UPDATE seria no-op SILENCIOSO
  // numa instalacao sem seed — o gestor salvaria e nada aconteceria.
  await config.gravar({ phone_number_id: "222" });
  const { rows } = await bd.pool.query("SELECT id, phone_number_id FROM canastra.whatsapp_config");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].phone_number_id, "222");
});

test("gravar e parcial: o que nao vem no corpo nao e apagado", async () => {
  await config.gravar({ access_token: "tok", phone_number_id: "333" });
  await config.gravar({ phone_number_id: "444" });

  const atual = await config.carregar();
  assert.equal(atual.access_token, "tok");
  assert.equal(atual.phone_number_id, "444");
});

test("configurado() exige token, phone_number_id e o interruptor ligado", async () => {
  await config.gravar({ access_token: "tok", phone_number_id: "555" });
  assert.equal(config.configurado(await config.carregar()), false, "ativo false");

  await config.gravar({ ativo: true });
  assert.equal(config.configurado(await config.carregar()), true);

  await config.gravar({ access_token: null });
  assert.equal(config.configurado(await config.carregar()), false, "sem token");
});

test("paraOPainel devolve mascara, nunca o segredo", async () => {
  // O modo de falha que isto impede: um GET que devolve o token deixa o
  // segredo no cache do navegador, no log do proxy e no DevTools de quem abrir.
  await config.gravar({ access_token: "EAAGsuperSecretoLongo4821", app_secret: "abc123" });
  const visivel = await config.paraOPainel();

  assert.equal(visivel.access_token, undefined);
  assert.equal(visivel.app_secret, undefined);
  assert.equal(visivel.access_token_mascara, "••••4821");
  assert.equal(visivel.app_secret_mascara, "••••c123");
  assert.equal(JSON.stringify(visivel).includes("superSecreto"), false);
});

test("mascara de valor curto nao revela o valor", async () => {
  await config.gravar({ access_token: "abc" });
  const visivel = await config.paraOPainel();
  assert.equal(visivel.access_token_mascara, "••••");
});

test("avisoLigado responde por status, e o desconhecido e nao", async () => {
  await config.gravar({ aviso_enviado: true, aviso_entregue: false });
  const atual = await config.carregar();

  assert.equal(config.avisoLigado(atual, "enviado"), true);
  assert.equal(config.avisoLigado(atual, "entregue"), false);
  // `rejeitado` compartilha o interruptor de `cancelado`, como o template.
  await config.gravar({ aviso_cancelado: false });
  assert.equal(config.avisoLigado(await config.carregar(), "rejeitado"), false);
  assert.equal(config.avisoLigado(atual, "em_processamento"), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node --test test/whatsapp_config.test.js`
Expected: FAIL — `Cannot find module '../src/services/whatsappConfig.js'`.

- [ ] **Step 3: Implementar**

Create `backend/src/services/whatsappConfig.js` com estas exportações: `carregar()`, `gravar(campos)`, `esquecer()`, `configurado(cfg)`, `avisoLigado(cfg, status)`, `paraOPainel()`.

Pontos que o teste do Step 1 já fixa e que o código precisa cumprir:
- **Ordem memória → banco → env**, com cache em módulo invalidado por `esquecer()` e por `gravar()`.
- `gravar()` faz `INSERT INTO canastra.whatsapp_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING` e depois um `UPDATE` **parcial montado dinamicamente**, com `$n` parametrizado e `atualizado_em = now()` sempre presente — o molde é `configRepository.js:58-89`.
- Campos aceitos por `gravar()` vêm de uma **lista literal** no módulo; chave fora dela é ignorada em silêncio (impede que um corpo de requisição escolha coluna).
- `mascarar(v)` devolve `"••••" + v.slice(-4)` para valor com mais de 4 caracteres, `"••••"` senão, e `null` para vazio.
- `paraOPainel()` devolve os campos não-secretos + `*_mascara` dos quatro secretos (`access_token`, `app_secret`, `verify_token`, e `waba_id` **não** é secreto — vai inteiro).
- `avisoLigado` mapeia `rejeitado→aviso_cancelado` e devolve `false` para status sem interruptor.
- O docblock registra: nenhum log e nenhuma mensagem de erro deste módulo carrega o token (`blingClient.js:27-28`).

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && node --test test/whatsapp_config.test.js`
Expected: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/whatsappConfig.js backend/test/whatsapp_config.test.js
git commit -m "feat: a credencial da Meta, com o painel na frente e a env como semente"
```

---

## Task 6: `services/whatsappClient.js` — a Graph API

**Files:**
- Create: `backend/src/services/whatsappClient.js`
- Test: `backend/test/whatsapp_client.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/test/whatsapp_client.test.js`:

```js
"use strict";

/**
 * O cliente HTTP da Graph API.
 *
 * A Graph API e DUBLE porque teste que faz requisicao de verdade nao distingue
 * "a logica esta errada" de "a Meta caiu". A costura e `fetchImpl` no default
 * do parametro, o mesmo desenho de blingClient.js:175.
 *
 * REGRA ZERO DA CASA: ninguem sobrescreve globalThis.fetch.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const cliente = require("../src/services/whatsappClient.js");

const CFG = {
  ativo: true,
  access_token: "EAAG-token-secreto-4821",
  phone_number_id: "1234567890",
  waba_id: "9876543210",
};

/** O formato de Response falso e fixo na casa (f7_bling.test.js:680-693). */
function graphFalsa(respostas) {
  const chamadas = [];
  const fetchImpl = async (url, opts) => {
    chamadas.push({ url: String(url), opts });
    const { status = 200, corpo = {} } = respostas.shift() ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => corpo,
      text: async () => JSON.stringify(corpo),
    };
  };
  return { fetchImpl, chamadas };
}

test("o template sai para o numero certo, na versao fixada, com o Bearer", async () => {
  const g = graphFalsa([{ corpo: { messages: [{ id: "wamid.OK" }] } }]);

  const r = await cliente.enviarTemplate(
    CFG,
    {
      para: "5531999990000",
      template: "pedido_enviado",
      idioma: "pt_BR",
      parametros: { nome_cliente: "Ana", numero_pedido: "3f2504e0" },
      botaoUrl: "AA123456789BR",
    },
    { fetchImpl: g.fetchImpl },
  );

  assert.equal(r.wamid, "wamid.OK");
  assert.equal(g.chamadas.length, 1);
  assert.equal(g.chamadas[0].url, "https://graph.facebook.com/v26.0/1234567890/messages");
  assert.equal(g.chamadas[0].opts.method, "POST");
  assert.equal(g.chamadas[0].opts.headers.Authorization, "Bearer EAAG-token-secreto-4821");

  const corpo = JSON.parse(g.chamadas[0].opts.body);
  assert.equal(corpo.messaging_product, "whatsapp");
  assert.equal(corpo.to, "5531999990000");
  assert.equal(corpo.type, "template");
  assert.equal(corpo.template.name, "pedido_enviado");
  assert.equal(corpo.template.language.code, "pt_BR");
});

test("os parametros nomeados viram a forma que a Meta espera", async () => {
  const g = graphFalsa([{ corpo: { messages: [{ id: "wamid.OK" }] } }]);
  await cliente.enviarTemplate(
    CFG,
    { para: "5531999990000", template: "t", idioma: "pt_BR", parametros: { nome_cliente: "Ana" } },
    { fetchImpl: g.fetchImpl },
  );

  const corpo = JSON.parse(g.chamadas[0].opts.body);
  const body = corpo.template.components.find((c) => c.type === "body");
  assert.deepEqual(body.parameters, [
    { type: "text", parameter_name: "nome_cliente", text: "Ana" },
  ]);
});

test("o botao de URL entra como componente proprio, indice zero", async () => {
  const g = graphFalsa([{ corpo: { messages: [{ id: "wamid.OK" }] } }]);
  await cliente.enviarTemplate(
    CFG,
    { para: "5531999990000", template: "t", idioma: "pt_BR", parametros: {}, botaoUrl: "AA1BR" },
    { fetchImpl: g.fetchImpl },
  );

  const corpo = JSON.parse(g.chamadas[0].opts.body);
  const botao = corpo.template.components.find((c) => c.type === "button");
  assert.equal(botao.sub_type, "url");
  assert.equal(botao.index, "0");
  assert.deepEqual(botao.parameters, [{ type: "text", text: "AA1BR" }]);
});

test("sem botaoUrl, nenhum componente de botao e enviado", async () => {
  // Mandar componente de botao para um template que nao tem botao URL faz a
  // Meta recusar a mensagem inteira com 132000.
  const g = graphFalsa([{ corpo: { messages: [{ id: "wamid.OK" }] } }]);
  await cliente.enviarTemplate(
    CFG,
    { para: "5531999990000", template: "t", idioma: "pt_BR", parametros: {}, botaoUrl: null },
    { fetchImpl: g.fetchImpl },
  );
  const corpo = JSON.parse(g.chamadas[0].opts.body);
  assert.equal(corpo.template.components.some((c) => c.type === "button"), false);
});

test("a mensagem interativa carrega ate tres botoes com id proprio", async () => {
  const g = graphFalsa([{ corpo: { messages: [{ id: "wamid.INT" }] } }]);
  await cliente.enviarInterativa(
    CFG,
    {
      para: "5531999990000",
      texto: "Como posso ajudar?",
      botoes: [
        { id: "meu_pedido", titulo: "Meu pedido" },
        { id: "falar_humano", titulo: "Falar com alguém" },
        { id: "parar_avisos", titulo: "Parar avisos" },
      ],
    },
    { fetchImpl: g.fetchImpl },
  );

  const corpo = JSON.parse(g.chamadas[0].opts.body);
  assert.equal(corpo.type, "interactive");
  assert.equal(corpo.interactive.type, "button");
  assert.equal(corpo.interactive.body.text, "Como posso ajudar?");
  assert.deepEqual(corpo.interactive.action.buttons[0], {
    type: "reply",
    reply: { id: "meu_pedido", title: "Meu pedido" },
  });
});

test("o erro da Meta vira erro nomeado, com o codigo preservado", async () => {
  const g = graphFalsa([
    { status: 400, corpo: { error: { code: 131047, message: "Re-engagement message" } } },
  ]);

  const erro = await cliente
    .enviarTemplate(CFG, { para: "5531999990000", template: "t", idioma: "pt_BR", parametros: {} }, { fetchImpl: g.fetchImpl })
    .then(() => null, (e) => e);

  assert.equal(erro.codigo, 131047);
  assert.match(erro.message, /131047/);
});

test("nenhum erro do cliente carrega o token", async () => {
  // O modo de falha que isto impede: o token no log do PM2, que fica em disco
  // e vai para qualquer backup.
  const g = graphFalsa([{ status: 401, corpo: { error: { code: 190, message: "Invalid OAuth" } } }]);

  const erro = await cliente
    .enviarTemplate(CFG, { para: "5531999990000", template: "t", idioma: "pt_BR", parametros: {} }, { fetchImpl: g.fetchImpl })
    .then(() => null, (e) => e);

  const tudo = String(erro.message) + String(erro.stack);
  assert.equal(tudo.includes("EAAG-token-secreto-4821"), false);
});

test("nenhum erro do cliente carrega o telefone do cliente", async () => {
  // Telefone e dado pessoal, e mensagem de erro acaba em log e em ticket.
  const g = graphFalsa([{ status: 400, corpo: { error: { code: 131026, message: "undeliverable" } } }]);

  const erro = await cliente
    .enviarTemplate(CFG, { para: "5531999990000", template: "t", idioma: "pt_BR", parametros: {} }, { fetchImpl: g.fetchImpl })
    .then(() => null, (e) => e);

  assert.equal(String(erro.message).includes("5531999990000"), false);
});

test("a rede caindo vira erro nomeado, e nao um TypeError cru", async () => {
  const fetchImpl = async () => {
    const e = new Error("The operation was aborted");
    e.name = "AbortError";
    throw e;
  };

  const erro = await cliente
    .enviarTemplate(CFG, { para: "5531999990000", template: "t", idioma: "pt_BR", parametros: {} }, { fetchImpl })
    .then(() => null, (e) => e);

  assert.equal(erro.name, "ErroDaMeta");
});

test("criarTemplate posta na WABA, nao no numero", async () => {
  const g = graphFalsa([{ corpo: { id: "999", status: "PENDING", category: "UTILITY" } }]);
  const r = await cliente.criarTemplate(
    CFG,
    { nome: "pedido_enviado", corpo: "Olá, {{nome_cliente}}. Fim.", rodape: "Café Canastra", botoes: [], exemplos: { nome_cliente: "Ana" } },
    { fetchImpl: g.fetchImpl },
  );

  assert.equal(g.chamadas[0].url, "https://graph.facebook.com/v26.0/9876543210/message_templates");
  const corpo = JSON.parse(g.chamadas[0].opts.body);
  assert.equal(corpo.category, "UTILITY");
  assert.equal(corpo.language, "pt_BR");
  assert.equal(corpo.parameter_format, "named");
  assert.equal(r.status, "PENDING");
});

test("listarTemplates pede os campos que o painel mostra", async () => {
  const g = graphFalsa([{ corpo: { data: [{ name: "pedido_enviado", status: "APPROVED" }] } }]);
  await cliente.listarTemplates(CFG, { fetchImpl: g.fetchImpl });

  assert.match(g.chamadas[0].url, /^https:\/\/graph\.facebook\.com\/v26\.0\/9876543210\/message_templates\?/);
  // `correct_category` e o que revela reclassificacao pendente da Meta.
  assert.match(g.chamadas[0].url, /correct_category/);
  assert.equal(g.chamadas[0].opts.method ?? "GET", "GET");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node --test test/whatsapp_client.test.js`
Expected: FAIL — `Cannot find module '../src/services/whatsappClient.js'`.

- [ ] **Step 3: Implementar**

Create `backend/src/services/whatsappClient.js`, exportando `VERSAO_GRAPH`, `enviarTemplate`, `enviarInterativa`, `enviarTexto`, `criarTemplate`, `listarTemplates`, `perfilDoNumero`.

- `const VERSAO_GRAPH = "v26.0";` numa **constante única** — a Meta mantém cada versão por pelo menos 2 anos e, ao expirar, roteia silenciosamente para a anterior em vez de quebrar, que é pior.
- Toda função recebe `(cfg, dados, { fetchImpl = fetch, timeoutMs = 15000 } = {})`.
- `requisitar()` interno monta a URL, injeta `Authorization: Bearer`, usa `AbortController` para o timeout, e transforma toda falha num `ErroDaMeta` (`err.name = "ErroDaMeta"`, `err.codigo` = `body.error.code`). A mensagem de erro leva **método + caminho + código**, e **nunca** o token, o telefone nem a querystring.
- `enviarTemplate` devolve `{ wamid }` lido de `body.messages[0].id`.
- `enviarInterativa` monta `interactive.action.buttons` com `{ type: "reply", reply: { id, title } }`, no máximo 3.
- `criarTemplate` monta `components` com `BODY` (+`example.body_text_named_params`), `FOOTER` e `BUTTONS`, e posta em `/{waba_id}/message_templates` com `category: "UTILITY"`, `language: "pt_BR"`, `parameter_format: "named"`.
- `listarTemplates` faz `GET /{waba_id}/message_templates?fields=name,status,category,correct_category,rejected_reason&limit=100`.
- `perfilDoNumero` faz `GET /{phone_number_id}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && node --test test/whatsapp_client.test.js`
Expected: PASS, 11 testes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/whatsappClient.js backend/test/whatsapp_client.test.js
git commit -m "feat: o cliente da Graph API, que nunca deixa token nem telefone no log"
```

---

## Task 7: `services/notificacoes.js` — o wrapper dos dois canais

**Files:**
- Create: `backend/src/services/notificacoes.js`
- Test: `backend/test/whatsapp_notificacoes.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/test/whatsapp_notificacoes.test.js`:

```js
"use strict";

/**
 * O wrapper que substitui as seis chamadas de sendStatusEmail.
 *
 * Banco REAL: quem tem telefone, quem deu opt-out e qual e o wa_id sao
 * perguntas que so o banco responde. E-mail e WhatsApp sao DUBLES, instalados
 * pelo hook de Module.prototype.require — o desenho de f7_bling.test.js:290-330.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let notificacoes;
let config;
const emails = [];
const zaps = [];

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const BIA = "aaaaaaaa-0000-0000-0000-000000000002";
const CADU = "aaaaaaaa-0000-0000-0000-000000000003";

const dubleEmail = {
  sendStatusEmail: async (order, status, rastreio) => {
    emails.push({ order, status, rastreio });
  },
  conteudoDoStatus: require("../src/utils/emailSender.js").conteudoDoStatus,
};

const dubleCliente = {
  VERSAO_GRAPH: "v26.0",
  enviarTemplate: async (cfg, dados) => {
    zaps.push(dados);
    if (dados.para === "5531000000000") {
      const e = new Error("ErroDaMeta: POST /messages 131026");
      e.name = "ErroDaMeta";
      e.codigo = 131026;
      throw e;
    }
    return { wamid: "wamid.T" + zaps.length };
  },
};

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  for (const [id, email, nome, telefone] of [
    [ANA, "ana@ex.com", "Ana", "31999990000"],
    [BIA, "bia@ex.com", "Bia", null],
    [CADU, "cadu@ex.com", "Cadu", "31000000000"],
  ]) {
    await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [id, email]);
    await bd.pool.query(
      `INSERT INTO canastra.clientes (user_id, nome, telefone, whatsapp_optin_em)
       VALUES ($1::uuid, $2, $3, CASE WHEN $3 IS NULL THEN NULL ELSE now() END)`,
      [id, nome, telefone],
    );
  }

  process.env.DATABASE_URL = bd.connectionString;
  process.env.NODE_ENV = "development";

  // O `caminho` casado e o LITERAL que o modulo alvo escreve.
  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (caminho) {
    if (caminho === "../utils/emailSender") return dubleEmail;
    if (caminho === "./whatsappClient") return dubleCliente;
    return requireOriginal.apply(this, arguments);
  };
  try {
    notificacoes = require("../src/services/notificacoes.js");
  } finally {
    Module.prototype.require = requireOriginal;
  }

  config = require("../src/services/whatsappConfig.js");
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(async () => {
  if (!bd) {
    throw new Error("O Postgres nao subiu no before(); a causa real esta no erro daquele hook.");
  }
  emails.length = 0;
  zaps.length = 0;
  await bd.pool.query("DELETE FROM canastra.whatsapp_mensagens");
  await bd.pool.query("DELETE FROM canastra.whatsapp_config");
  await bd.pool.query("UPDATE canastra.clientes SET whatsapp_optout_em = NULL");
  config.esquecer();
  await config.gravar({
    ativo: true,
    access_token: "tok",
    phone_number_id: "111",
    aviso_enviado: true,
    aviso_entregue: true,
  });
});

const pedidoDe = (userId, extras = {}) => ({
  order_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  user_id: userId,
  total_amount: "89.90",
  status: "aprovado",
  ...extras,
});

test("os dois canais saem para quem tem telefone", async () => {
  await notificacoes.avisarCliente(pedidoDe(ANA), "enviado", "AA123BR");

  assert.equal(emails.length, 1);
  assert.equal(zaps.length, 1);
  assert.equal(zaps[0].para, "5531999990000");
  assert.equal(zaps[0].template, "pedido_enviado");
});

test("quem nao tem telefone recebe so o e-mail, sem erro", async () => {
  // O caso comum de quem tem conta antiga: silencio no zap nao e falha.
  await notificacoes.avisarCliente(pedidoDe(BIA), "enviado", "AA123BR");

  assert.equal(emails.length, 1);
  assert.equal(zaps.length, 0);
});

test("o WhatsApp falhando nao impede o e-mail nem lanca", async () => {
  // O contrato de emailSender.js:105-110 vale para os dois: pedido pago nao
  // pode virar erro porque o aviso nao saiu.
  await notificacoes.avisarCliente(pedidoDe(CADU), "enviado", "AA123BR");

  assert.equal(emails.length, 1);
  const { rows } = await bd.pool.query(
    "SELECT status, erro_codigo FROM canastra.whatsapp_mensagens",
  );
  assert.equal(rows[0].status, "falhou");
  assert.equal(rows[0].erro_codigo, 131026);
});

test("o envio bem-sucedido deixa rastro com o wamid e so quatro digitos", async () => {
  await notificacoes.avisarCliente(pedidoDe(ANA), "enviado", "AA123BR");

  const { rows } = await bd.pool.query(
    "SELECT status, wamid, telefone_final, template FROM canastra.whatsapp_mensagens",
  );
  assert.equal(rows[0].status, "enviada");
  assert.equal(rows[0].wamid, "wamid.T1");
  assert.equal(rows[0].telefone_final, "0000");
  assert.equal(rows[0].template, "pedido_enviado");
});

test("integracao desligada e silencio no zap, e-mail normal", async () => {
  await config.gravar({ ativo: false });
  await notificacoes.avisarCliente(pedidoDe(ANA), "enviado", "AA123BR");

  assert.equal(emails.length, 1);
  assert.equal(zaps.length, 0);
});

test("aviso desligado para aquele status e silencio no zap", async () => {
  await config.gravar({ aviso_entregue: false });
  await notificacoes.avisarCliente(pedidoDe(ANA), "entregue", null);

  assert.equal(emails.length, 1);
  assert.equal(zaps.length, 0);
});

test("quem pediu para parar nao recebe mais", async () => {
  await bd.pool.query(
    "UPDATE canastra.clientes SET whatsapp_optout_em = now() WHERE user_id = $1::uuid",
    [ANA],
  );
  await notificacoes.avisarCliente(pedidoDe(ANA), "enviado", "AA123BR");

  assert.equal(emails.length, 1, "o e-mail continua: o opt-out e do WhatsApp");
  assert.equal(zaps.length, 0);
});

test("status intermediario do gateway nao aciona canal nenhum", async () => {
  await notificacoes.avisarCliente(pedidoDe(ANA), "em_processamento", null);

  assert.equal(emails.length, 1, "o e-mail e chamado e decide sozinho ficar quieto");
  assert.equal(zaps.length, 0);
});

test("o mesmo status duas vezes so avisa uma", async () => {
  // A guarda que C1 (OrderController.js:243) nao tem: dois cliques no painel
  // hoje mandam dois e-mails. WhatsApp duplicado custa dinheiro e derruba a
  // nota de qualidade do template.
  const pedido = pedidoDe(ANA, { status: "enviado" });
  await notificacoes.avisarCliente(pedido, "enviado", "AA123BR");
  await notificacoes.avisarCliente(pedido, "enviado", "AA123BR");

  assert.equal(zaps.length, 1);
  assert.equal(emails.length, 1);
});

test("o wa_id gravado vence o telefone digitado", async () => {
  // Depois da primeira resposta do cliente, a chave canonica e o wa_id — a
  // Meta pode ter mexido no nono digito.
  await bd.pool.query(
    "UPDATE canastra.clientes SET whatsapp_wa_id = '553199990000' WHERE user_id = $1::uuid",
    [ANA],
  );
  await notificacoes.avisarCliente(pedidoDe(ANA), "enviado", "AA123BR");

  assert.equal(zaps[0].para, "553199990000");
});

test("pedido sem dono nao aciona canal nenhum", async () => {
  await notificacoes.avisarCliente(pedidoDe(null), "enviado", "AA123BR");
  assert.equal(zaps.length, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node --test test/whatsapp_notificacoes.test.js`
Expected: FAIL — `Cannot find module '../src/services/notificacoes.js'`.

- [ ] **Step 3: Implementar**

Create `backend/src/services/notificacoes.js`, exportando `avisarCliente(order, novoStatus, trackingCode)`.

O que ele faz, em ordem:
1. Chama `sendStatusEmail(order, novoStatus, trackingCode)` — que engole erro sozinho. **Sempre**, sem condição: o e-mail já tem os próprios recortes e não é papel do wrapper decidir por ele.
2. Chama `enviarWhatsappDeStatus(order, novoStatus, trackingCode)` dentro do próprio `try/catch`, que **engole** e loga.
3. `avisarCliente` nunca lança.

`enviarWhatsappDeStatus` sai em silêncio (sem erro, sem log de erro) quando: `!order?.user_id`; `conteudoDoStatusWhats` devolve `null`; a integração não está `configurado()`; `avisoLigado(cfg, status)` é falso; o cliente não tem telefone nem `wa_id`; o cliente tem `whatsapp_optout_em`; ou **já existe** linha em `whatsapp_mensagens` com o mesmo `pedido_id` e o mesmo `template` e status diferente de `falhou` (é a guarda de status repetido).

Uma consulta só para o destinatário, no molde de `sendStatusEmail:68-77`:

```sql
SELECT COALESCE(c.nome, 'Cliente') AS nome,
       c.telefone, c.whatsapp_wa_id, c.whatsapp_optout_em
  FROM canastra.clientes c
 WHERE c.user_id = $1::uuid
```

O destino é `whatsapp_wa_id` quando existe, senão `paraE164(telefone)`.

Grava a linha em `whatsapp_mensagens` **antes** do envio (`status='pendente'`), e a atualiza para `enviada` + `wamid` + `enviado_em`, ou para `falhou` + `erro_codigo` + `erro_texto`. `pool.query` direto, **sem `pool.connect()`** — a lição de `emailSender.js:60-63`: pegar cliente na mão e só devolver depois da query vaza conexão quando a query lança.

O docblock precisa registrar **por que envolver e não duplicar**: cada um dos seis call sites tem uma guarda de disparo diferente (`mudou` em C3/C4, `statusAplicado` em C2, `rowCount === 1` em C6, e nada em C1); duplicar a chamada obrigaria a reescrever cinco guardas corretamente cinco vezes.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && node --test test/whatsapp_notificacoes.test.js`
Expected: PASS, 11 testes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/notificacoes.js backend/test/whatsapp_notificacoes.test.js
git commit -m "feat: um so lugar decide avisar o cliente, e ele fala pelos dois canais"
```

---

## Task 8: Trocar os seis call sites

**Files:**
- Modify: `backend/src/controllers/OrderController.js:243-257`
- Modify: `backend/src/controllers/PaymentController.js:987` e `:1227-1229`
- Modify: `backend/src/controllers/ClubeController.js:620-622` e `:850`
- Modify: `backend/src/services/blingPedidos.js:804`

- [ ] **Step 1: Trocar C1, e passar a linha certa**

Em `OrderController.js`, troque o import de `sendStatusEmail` por `const { avisarCliente } = require("../services/notificacoes");` e substitua o bloco de `:255-257` por:

```js
      // O AVISO VAI COM `updated`, e nao com `order`: `order` (:171) e a linha
      // LIDA ANTES do UPDATE — status velho e sem `tracking_code`. `updated`
      // (:243) e a projecao completa, ja com o status novo e o rastreio.
      // Depois do COMMIT e sem travar a resposta: avisar o cliente e
      // importante, mas o provedor estar fora nao pode fazer o admin achar que
      // a mudanca de status falhou — ela ja esta gravada.
      avisarCliente(updated, newStatus, trackingCode).catch((e) =>
        console.error("Falha ao avisar o cliente:", e.message),
      );
```

- [ ] **Step 2: Trocar C2 e C3**

Em `PaymentController.js`, importe `avisarCliente` e troque:
- `:987` — `sendStatusEmail(newOrder, statusAplicado)` → `avisarCliente(newOrder, statusAplicado)`. **Mantém o `Promise.allSettled`** de `:985-992`.
- `:1227-1229` — `sendStatusEmail(pedido, statusPt)` → `avisarCliente(pedido, statusPt)`. **Mantém o `if (mudou)`** de `:1224` e o `.catch`.

- [ ] **Step 3: Trocar C4 e C5**

Em `ClubeController.js`, importe `avisarCliente` e troque `:620-622` e `:850`, preservando o `if (mudou)` de `:619` e o `Promise.allSettled` de `:841-855`.

- [ ] **Step 4: Trocar C6, mantendo o `await`**

Em `blingPedidos.js:804`, troque `sendStatusEmail` por `avisarCliente` e **mantenha o `await`**:

```js
        // O `await` FICA. Sem ele, a rota POST /bling/pedidos/:id/rastreio
        // responderia antes de o aviso sair, e o cron perderia a ordem. E
        // `avisarCliente` engole erro por contrato, entao esperar aqui nao
        // torna a rota capaz de falhar por causa do WhatsApp.
        await avisarCliente(avanco.rows[0], "enviado", rastreio);
```

- [ ] **Step 5: Confirmar que sobrou zero chamada direta**

Run: `grep -rn "sendStatusEmail" backend/src/`
Expected: **uma só linha** — a definição em `backend/src/utils/emailSender.js`. Nenhum `require` e nenhuma chamada em controller ou service.

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm --prefix backend test`
Expected: PASS. Testes que hoje contam e-mails enviados (`f4_checkout_e_webhook.test.js:141-150,347,355,363`) continuam passando, porque `avisarCliente` chama `sendStatusEmail` com os mesmos argumentos.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers backend/src/services/blingPedidos.js
git commit -m "refactor: os seis avisos de status passam a falar pelos dois canais"
```

---

## Task 9: O webhook — assinatura, verificação e deduplicação

**Files:**
- Create: `backend/src/controllers/WhatsappController.js`
- Test: `backend/test/whatsapp_webhook.test.js`
- Modify: `backend/src/index.js`

- [ ] **Step 1: Ler o precedente antes de escrever**

Run: `sed -n '149,206p' backend/test/pagamento.test.js`
Expected: você verá os cinco casos que a casa fixou para assinatura de webhook. O teste do Step 2 é a tradução deles para o HMAC da Meta — leia antes de escrever, para não inventar um sexto formato.

- [ ] **Step 2: Escrever o teste que falha**

Create `backend/test/whatsapp_webhook.test.js` com estes testes, todos sobre **funções puras exportadas do controller** (sem servidor, sem banco):

`validarAssinatura(rawBody, header, appSecret, ambiente)`:
1. aceita corpo assinado corretamente;
2. recusa segredo forjado;
3. **recusa corpo alterado depois de assinado** (o ataque real: assina `{"a":1}` e manda `{"a":2}`);
4. recusa cabeçalho ausente — e este é o ponto: **o código de exemplo publicado pela Meta deixa passar**, só faz `console.warn`;
5. recusa cabeçalho sem o prefixo `sha256=`;
6. sem segredo configurado → `false` em produção, `true` com warn em desenvolvimento (o par que `pagamento.test.js:192-206` fixou);
7. o HMAC é sobre o **Buffer cru**, não sobre `JSON.stringify(req.body)` — o teste prova mandando um corpo com acento e reserializando.

`responderVerificacao({ modo, token, desafio }, verifyToken)`:
8. token correto devolve `{ status: 200, corpo: desafio }` com o desafio **cru, string** — `res.json()` devolveria `"123"` com aspas e **quebra o handshake**;
9. token errado devolve `{ status: 403 }`;
10. `hub.mode` diferente de `subscribe` devolve `{ status: 403 }`.

`chavesDeDeduplicacao(corpoDoWebhook)`:
11. mensagem de entrada gera a chave `wamid`;
12. status gera a chave `wamid:status` — e `sent`, `delivered` e `read` do **mesmo** wamid geram **três chaves diferentes**, senão deduplicar descartaria status legítimos;
13. um lote com dois `entry` e dois `changes` gera todas as chaves — a Meta agrega até 1000 updates e "batching cannot be guaranteed", então iterar é obrigatório;
14. corpo com `object` diferente de `whatsapp_business_account` gera lista vazia.

`classificarMensagem(msg)`:
15. `type: "text"` → `{ tipo: "texto", corpo }`;
16. `type: "button"` (quick-reply de **template**) → `{ tipo: "botao_template", payload }`;
17. `type: "interactive"` com `button_reply` → `{ tipo: "botao", id, titulo }`;
18. `type: "image"` → `{ tipo: "image" }` (o `default` não pode lançar).

Use o formato de Response falso da casa e `crypto.createHmac("sha256", segredo).update(buf).digest("hex")` para assinar dentro do próprio teste, como `pagamento.test.js:153-161` faz.

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd backend && node --test test/whatsapp_webhook.test.js`
Expected: FAIL — `Cannot find module '../src/controllers/WhatsappController.js'`.

- [ ] **Step 4: Implementar as funções puras**

Create `backend/src/controllers/WhatsappController.js` exportando, além dos handlers, as quatro funções puras acima.

`validarAssinatura` — o desenho, com o aviso no docblock de que o exemplo oficial da Meta tem duas falhas reais (deixa passar sem header; compara com `!=`):

```js
function validarAssinatura(corpoCru, header, appSecret, ambiente) {
  if (!appSecret) {
    // O MESMO par de PaymentController.js:220-230: producao recusa, dev avisa.
    if (ambiente === "production") return false;
    console.warn("WHATSAPP: sem META_APP_SECRET — assinatura NAO conferida (dev).");
    return true;
  }
  if (typeof header !== "string" || !header.startsWith("sha256=")) return false;
  if (!corpoCru || corpoCru.length === 0) return false;

  const recebida = Buffer.from(header.slice("sha256=".length), "utf8");
  const esperada = Buffer.from(
    crypto.createHmac("sha256", appSecret).update(corpoCru).digest("hex"),
    "utf8",
  );
  // timingSafeEqual LANCA se os comprimentos diferirem — a checagem vem antes.
  if (recebida.length !== esperada.length) return false;
  return crypto.timingSafeEqual(recebida, esperada);
}
```

`chavesDeDeduplicacao` itera `entry[] → changes[]`, ignora `change.field !== "messages"`, e produz `msg.id` para cada `value.messages[]` e `` `${st.id}:${st.status}` `` para cada `value.statuses[]`.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd backend && node --test test/whatsapp_webhook.test.js`
Expected: PASS, 18 testes.

- [ ] **Step 6: Montar a rota com o corpo cru preservado**

Em `backend/src/index.js`, **antes** do `app.use(express.json(...))` global de `:100`, monte o parser específico do webhook — sem isso `req.rawBody` é `undefined` e o HMAC nunca fecha:

```js
/**
 * O CORPO CRU DO WEBHOOK DA META, preservado so nesta rota.
 *
 * `express.json()` consome o stream; sem o hook `verify`, o corpo cru se perde
 * e nao ha como recalcular o HMAC. Reserializar com JSON.stringify NAO serve:
 * a Meta assina uma forma com unicode escapado, e o stringify do V8 emite os
 * caracteres decodificados — assinatura diferente, 401 so com acento e emoji.
 *
 * Montado ANTES do express.json global de :100, e so em /whatsapp/webhook,
 * para nao pendurar um Buffer extra em toda requisicao da API.
 */
app.use(
  "/whatsapp/webhook",
  express.json({
    limit: "3mb", // o teto documentado pela Meta para payload de webhook
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
```

E, junto do `webhookLimiter` de `:113-117`, um limitador próprio para a rota — é pública e cada entrega custa trabalho.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/WhatsappController.js backend/test/whatsapp_webhook.test.js backend/src/index.js
git commit -m "feat: o webhook da Meta recusa o que o exemplo oficial dela deixaria passar"
```

---

## Task 10: O roteador do menu de suporte

**Files:**
- Modify: `backend/src/controllers/WhatsappController.js`
- Test: `backend/test/whatsapp_suporte.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/test/whatsapp_suporte.test.js`, com banco real e o cliente da Graph API como dublê (mesmo hook de `Module.prototype.require` da Task 7). Testes:

1. clique no quick-reply do template (`type: "button"`) faz o bot responder com a mensagem interativa de três botões;
2. o clique **carimba `whatsapp_ultima_entrada_em`** — é o relógio da janela de 24h;
3. `button_reply.id === "meu_pedido"` responde com o status do pedido mais recente daquele `wa_id`, por extenso, com o código de rastreio;
4. `meu_pedido` sem pedido nenhum responde "não encontrei pedido no seu número", sem erro;
5. `button_reply.id === "falar_humano"` responde com o link do número humano lido de `whatsapp_config.numero_suporte`;
6. `button_reply.id === "parar_avisos"` carimba `whatsapp_optout_em` e confirma;
7. depois do opt-out, `avisarCliente` não manda mais nada para aquele cliente (a prova ponta a ponta do opt-out);
8. texto livre `"PARAR"` (e `"parar"`, e `"sair"`) tem o mesmo efeito do botão — **não existe STOP nativo na Meta**, e é a loja que precisa reconhecer;
9. texto livre não reconhecido responde o menu de botões;
10. texto livre não reconhecido **duas vezes na mesma janela** responde o menu **uma vez só** — sem esse teto, cliente e bot entram em pingue-pongue e cada volta conta contra a nota de qualidade do número;
11. o roteamento usa `button_reply.id`, **não** `button.payload`: um payload com o texto traduzido não deve casar com nada;
12. mensagem de quem não é cliente (`from` desconhecido) não quebra e não responde;
13. o `from` sem o nono dígito casa com o cliente cadastrado com ele — a armadilha do Brasil, ponta a ponta;
14. ao casar por variante, o `wa_id` é **gravado** em `clientes.whatsapp_wa_id`, e a partir daí não se adivinha mais.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node --test test/whatsapp_suporte.test.js`
Expected: FAIL — `rotearMensagem is not a function`.

- [ ] **Step 3: Implementar**

Acrescente ao `WhatsappController.js` a função `rotearMensagem(msg, valor)`:

1. Classifica com `classificarMensagem`.
2. Acha o cliente: primeiro por `whatsapp_wa_id = msg.from`; se não achar, por `telefone` casando com `variantesBrasil(msg.from)`; ao achar por variante, **grava** `whatsapp_wa_id = msg.from`.
3. Carimba `whatsapp_ultima_entrada_em = now()` — sempre, mesmo para quem não é cliente conhecido não haver nada a carimbar.
4. Decide a resposta: `botao_template` → menu; `botao` com `id` conhecido → a ação; `texto` com `PARAR|SAIR|STOP` (sem acento, sem caixa) → opt-out; qualquer outro texto → menu, com o teto de um por janela.
5. Nunca lança para fora — o handler do webhook já respondeu 200.

O teto de "um menu por janela" usa `whatsapp_ultima_entrada_em` lido **antes** do carimbo do passo 3: se a entrada anterior foi há menos de 24h e já houve um menu naquela janela, não responde.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && node --test test/whatsapp_suporte.test.js`
Expected: PASS, 14 testes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/WhatsappController.js backend/test/whatsapp_suporte.test.js
git commit -m "feat: o menu de suporte, e o opt-out que a Meta nao faz por voce"
```

---

## Task 11: As rotas do painel

**Files:**
- Create: `backend/src/routes/whatsapp.routes.js`
- Modify: `backend/src/index.js`
- Modify: `backend/src/controllers/WhatsappController.js`
- Test: `backend/test/whatsapp_rotas.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/test/whatsapp_rotas.test.js`, chamando os handlers do controller diretamente com `req`/`res` falsos (o `respostaFalsa()` da convenção). Testes:

1. `GET /whatsapp/config` devolve máscara e **nunca** o token — o teste procura a string do segredo no JSON inteiro;
2. `PUT /whatsapp/config` grava só os campos da lista permitida e ignora chave estranha;
3. `PUT /whatsapp/config` com token vazio **não apaga** o token gravado (o mesmo cuidado de `ordersRepository.js:125-128` com `codigo_rastreio`);
4. `GET /whatsapp/status` devolve `{ ligado: false, faltando: [...] }` quando não configurado, listando o que falta;
5. `POST /whatsapp/teste` com a integração desligada devolve **503 com código e frase**, não 404 nem 500 — o molde é `bling.routes.js:37-47`;
6. `POST /whatsapp/templates` posta os seis templates e devolve o resultado de cada um;
7. `GET /whatsapp/mensagens` devolve o histórico com `telefone_final`, e **nenhum telefone completo**;
8. o erro da Meta vira a **frase do servidor** no corpo, para o painel poder exibi-la.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node --test test/whatsapp_rotas.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar as rotas**

Create `backend/src/routes/whatsapp.routes.js` no molde de `bling.routes.js`:

```js
"use strict";

const { Router } = require("express");
const authenticateToken = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");
const WhatsappController = require("../controllers/WhatsappController");

const whatsappRoutes = Router();

/**
 * As duas rotas SEM autenticacao, por natureza: o webhook e chamado pela Meta,
 * que nao carrega token da loja. Ele se autentica por HMAC (verificado dentro
 * do controller) e o GET por `hub.verify_token`.
 */
whatsappRoutes.get("/webhook", WhatsappController.verificar);
whatsappRoutes.post("/webhook", WhatsappController.receber);

/**
 * Daqui para baixo, painel. `authenticateToken` SEMPRE antes de `isAdmin`:
 * `isAdmin` le `req.user.ehAdmin`, que so existe depois do primeiro — rota
 * montada fora de ordem fica inacessivel, nao aberta (isAdmin.js:15-18).
 */
whatsappRoutes.get("/status", authenticateToken, isAdmin, WhatsappController.status);
whatsappRoutes.get("/config", authenticateToken, isAdmin, WhatsappController.lerConfig);
whatsappRoutes.put("/config", authenticateToken, isAdmin, WhatsappController.gravarConfig);
whatsappRoutes.get("/mensagens", authenticateToken, isAdmin, WhatsappController.historico);
whatsappRoutes.get("/templates", authenticateToken, isAdmin, WhatsappController.lerTemplates);
whatsappRoutes.post("/templates", authenticateToken, isAdmin, WhatsappController.criarTemplates);
whatsappRoutes.post("/teste", authenticateToken, isAdmin, WhatsappController.enviarTeste);

module.exports = whatsappRoutes;
```

Em `backend/src/index.js`, duas linhas: `const whatsappRoutes = require("./routes/whatsapp.routes");` no bloco de `:13-23`, e `app.use("/whatsapp", whatsappRoutes);` ao lado do `app.use("/bling", blingRoutes)` de `:180`.

**Não invente cabeçalho novo:** `allowedHeaders` é `["Content-Type","Authorization","Accept"]` (`index.js:87`), e cabeçalho fora da lista quebra o preflight.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && node --test test/whatsapp_rotas.test.js`
Expected: PASS, 8 testes.

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm --prefix backend test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/whatsapp.routes.js backend/src/index.js backend/src/controllers/WhatsappController.js backend/test/whatsapp_rotas.test.js
git commit -m "feat: o painel ganha por onde operar o bot"
```

---

## Task 12: A tela do painel

**Files:**
- Create: `frontend/legacy/components/DashboardSection/WhatsApp/whatsappContrato.js`
- Create: `frontend/legacy/components/DashboardSection/WhatsApp/whatsappContrato.test.ts`
- Create: `frontend/legacy/components/DashboardSection/WhatsApp/useWhatsAppAcoes.js`
- Create: `frontend/legacy/components/DashboardSection/WhatsApp/WhatsAppManager.jsx`
- Modify: `frontend/legacy/PainelApp.jsx`
- Modify: `frontend/legacy/components/DashboardSection/MenuAside/MenuAside.jsx`

- [ ] **Step 1: Ler o molde antes de escrever**

Run: `sed -n '1,60p' frontend/legacy/components/DashboardSection/Bling/BlingManager.jsx && sed -n '1,60p' frontend/legacy/components/DashboardSection/Bling/blingContrato.js`
Expected: o padrão da casa para tela de integração — kit de estilo importado de `PromotionsManager.style`, lógica pura extraída para o `*Contrato.js`, ações num hook.

- [ ] **Step 2: Escrever o teste que falha**

Create `frontend/legacy/components/DashboardSection/WhatsApp/whatsappContrato.test.ts`, com `vitest`, sobre as funções puras:

1. `oQueFalta(config)` lista os campos ausentes, em português, na ordem em que a tela os mostra;
2. `oQueFalta` de uma configuração completa devolve lista vazia;
3. `descreverStatus({ligado:false, faltando:[...]})` produz a frase que a tarja exibe — "desligado" é estado conhecido, não erro;
4. `descreverTemplate({status:"REJECTED", rejected_reason:"INVALID_FORMAT"})` produz frase que **diz o motivo**, não só "rejeitado";
5. `descreverTemplate` de um template ausente na Meta diz "ainda não criado";
6. `precisaDeAtencao(t)` é verdadeiro quando `category !== correct_category` — é o sinal de reclassificação pendente da Meta, e passa despercebido se a tela não o mostrar;
7. `rotuloDeEnvio({status:"falhou", erro_texto:"..."})` mostra a frase do servidor.

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd frontend && npx vitest run legacy/components/DashboardSection/WhatsApp/whatsappContrato.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 4: Implementar o contrato**

Create `whatsappContrato.js` com as sete funções acima, puras, sem `import` de React.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd frontend && npx vitest run legacy/components/DashboardSection/WhatsApp/whatsappContrato.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 6: Escrever o hook de ações**

Create `useWhatsAppAcoes.js`, no molde de `useBlingAcoes.js`:
- `authFetch` vem do `authContext` e exige **URL completa** (`${API_BASE}/whatsapp/...`);
- trava de duplo clique em `ref`, não em estado (`useBlingAcoes.js:41-56`);
- toast **e** tarja persistente com a frase do servidor (`corpo.message || corpo.error`);
- `403` e `503` tratados como estados distintos de `500`.

- [ ] **Step 7: Escrever a tela**

Create `WhatsAppManager.jsx` com os seis blocos do spec §8: estado da integração, credenciais (campos **write-only**, mostrando só a máscara), seis interruptores de aviso, lista de templates com botão "Criar na Meta", envio de teste, e histórico. Kit de estilo importado de `../Settings/OffersAndCupons/PromotionsManager.style`. `if (carregando) return <Loading/>`.

- [ ] **Step 8: Registrar a rota**

Em `frontend/legacy/PainelApp.jsx`, duas edições — o import preguiçoso junto do bloco de `:15-60`, e a entrada no array `children` depois de `:112-115`:

```jsx
const WhatsAppManager = lazy(
  () => import("./components/DashboardSection/WhatsApp/WhatsAppManager.jsx"),
);
```
```jsx
{ path: "/dashboard/whatsapp", element: Load(WhatsAppManager) },
```

**Path absoluto** — não existe `basename`, e um path relativo produziria `/dashboard/dashboard/whatsapp` (`PainelApp.jsx:62-68`). E `Load(X)`, nunca `<X/>` (`load.jsx:4-8`).

- [ ] **Step 9: Adicionar o item de menu**

Em `MenuAside.jsx`, o ícone no import de `lucide-react` (`:3-16`) e o link no grupo "Configurações gerais", depois de `:125`:

```jsx
<Link className="link" to={"/dashboard/whatsapp"}>
  <MessageCircle size={18} />
  <li>WhatsApp</li>
</Link>
```

`to` idêntico ao `path` do Step 8. **Nenhum teste faz paridade rota↔menu** — esquecer o link não quebra nada, só some do menu. É o erro de omissão a evitar.

- [ ] **Step 10: Conferir que o painel compila**

Run: `npm --prefix frontend run build`
Expected: build sem erro.

- [ ] **Step 11: Commit**

```bash
git add frontend/legacy/components/DashboardSection/WhatsApp frontend/legacy/PainelApp.jsx frontend/legacy/components/DashboardSection/MenuAside/MenuAside.jsx
git commit -m "feat: a tela de WhatsApp no painel, com o segredo que nunca volta pelo GET"
```

---

## Task 13: O cadastro pede o número

**Files:**
- Modify: `frontend/lib/conta/cadastro.ts`
- Modify: `frontend/app/(vitrine)/account/cadastro/page.tsx`
- Modify: `frontend/app/(vitrine)/account/page.tsx`
- Modify: `frontend/app/(vitrine)/politica-de-privacidade/page.tsx`
- Test: `frontend/lib/conta/cadastro.test.ts`

- [ ] **Step 1: Ler o teste que já existe**

Run: `sed -n '100,145p' frontend/lib/conta/cadastro.test.ts`
Expected: o padrão de como `garantirCliente` é exercido hoje, incluindo o caso que prova que telefone vazio é **omitido** e não mandado como `null`.

- [ ] **Step 2: Acrescentar os testes que falham**

Em `frontend/lib/conta/cadastro.test.ts`, acrescente:

1. telefone com máscara chega à RPC **só com dígitos** — o servidor não deveria ter de limpar o que a tela pode limpar;
2. cadastro sem telefone é **recusado na tela**, com frase própria, antes de qualquer chamada de rede;
3. a preferência de promoções, quando marcada, vira uma chamada separada; quando desmarcada, **não** vira chamada nenhuma;
4. telefone que não é celular brasileiro plausível é recusado com frase própria.

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd frontend && npx vitest run lib/conta/cadastro.test.ts`
Expected: FAIL nos quatro testes novos.

- [ ] **Step 4: Implementar**

Em `frontend/app/(vitrine)/account/cadastro/page.tsx`, acrescente entre os campos de e-mail (`:214-228`) e senha (`:230`):

- um `<input name="telefone" type="tel" required>` com rótulo **"WhatsApp"** e `inputMode="numeric"`;
- abaixo dele, o texto do opt-in, que precisa dizer **as duas coisas que a Meta exige**: que a pessoa vai receber mensagens no WhatsApp, e o nome do negócio. Por exemplo: *"Vamos avisar o andamento do seu pedido pelo WhatsApp, em nome do Café Canastra. Você pode parar quando quiser, respondendo PARAR."*;
- uma `<input type="checkbox" name="promocoes">` **desmarcada**, com o rótulo *"Quero receber também novidades e ofertas do Café Canastra pelo WhatsApp."*

A validação de telefone reaproveita a mesma regra do backend. Como `frontend/lib/` não importa de `backend/`, crie `frontend/lib/conta/telefone.ts` com `paraE164` **portada** e um teste próprio que prove que ela concorda com a versão do backend nos mesmos casos — duas cópias que divergem em silêncio são piores que uma cópia declarada.

Em `frontend/app/(vitrine)/account/page.tsx`, um bloco que aparece **só para quem não tem telefone**, convidando a informar, sem travar nada.

Em `politica-de-privacidade/page.tsx:19`, acrescente que o telefone também é usado para avisar o andamento do pedido pelo WhatsApp, e que promoções dependem de consentimento separado e revogável.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd frontend && npx vitest run lib/conta/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/conta frontend/app/\(vitrine\)/account frontend/app/\(vitrine\)/politica-de-privacidade
git commit -m "feat: o cadastro pede o WhatsApp, e separa o aviso do pedido da promocao"
```

---

## Task 14: `.env.example` e a documentação

**Files:**
- Modify: `backend/src/.env.example`
- Create: `docs/whatsapp.md`

- [ ] **Step 1: Acrescentar a seção ao `.env.example`**

No molde das seções existentes (`:146-182`), depois do bloco do Bling:

```
# ── Meta / WhatsApp Cloud API ──────────────────────────────────────────────
#
# DESLIGADO por padrao. Nenhuma destas entra em OBRIGATORIAS_EM_PRODUCAO
# (config/ambiente.js:66-75): integracao que nasce desligada nao pode impedir o
# `npm start` de quem nao tem conta na Meta — e por isso que BLING_* tambem nao
# esta la.
#
# A ORDEM DE LEITURA e memoria -> banco -> env (services/whatsappConfig.js).
# O painel e a fonte; estas variaveis sao a SEMENTE, para quem preferir nao ter
# segredo no banco. Ver docs/whatsapp.md.
#
#   1. developers.facebook.com/apps -> criar app "Connect with customers
#      through WhatsApp".
#   2. WhatsApp -> API Setup: anote WABA_ID e PHONE_NUMBER_ID (e ID interno,
#      NAO o telefone).
#   3. business.facebook.com -> Usuarios do sistema -> Admin -> atribuir App e
#      WABA (controle total) -> gerar token com whatsapp_business_messaging,
#      whatsapp_business_management e business_management, expiracao "Nunca".
#      O token e exibido UMA VEZ so.
#   4. App settings -> Basic: o App Secret.
#   5. Webhook: Callback URL https://<api-da-loja>/whatsapp/webhook, o Verify
#      Token que voce escolher aqui, e assine os campos `messages` (ele cobre
#      entrada E status) e `message_template_status_update`.
#
META_ATIVO=false
META_ACCESS_TOKEN=
META_APP_SECRET=
META_VERIFY_TOKEN=
META_PHONE_NUMBER_ID=
META_WABA_ID=
```

- [ ] **Step 2: Escrever `docs/whatsapp.md`**

No molde de `docs/bling.md`. Precisa cobrir, sem eufemismo:
- o passo a passo do §12 do spec, incluindo que **o número precisa estar limpo** (apagado do WhatsApp comum antes, liberação em até ~24h) e que, uma vez na Cloud API, **ele não funciona mais no aplicativo do celular**;
- o número de teste da Meta: grátis, 5 destinatários, sem cartão — dá para exercitar o bot inteiro antes do número real existir, e o `PHONE_NUMBER_ID` **muda** quando o número real é registrado;
- **o prazo de 01/10/2026**: acaba a gratuidade de utility-dentro-da-janela e de mensagem de serviço; as tarifas saem até 01/09/2026;
- que uma frase de venda em qualquer template de utilidade o reclassifica para MARKETING, e que "template misclassification" é motivo explícito de bloqueio de envio;
- que o rate card em BRL não foi lido (está atrás de seletor interativo) e precisa ser conferido antes de virar orçamento.

- [ ] **Step 3: Rodar tudo**

Run: `npm --prefix backend test && npm --prefix frontend run test && npm --prefix frontend run build`
Expected: PASS nos três.

- [ ] **Step 4: Commit**

```bash
git add backend/src/.env.example docs/whatsapp.md
git commit -m "docs: como ligar o bot quando o numero existir, e o que ele custa"
```

---

## Task 15: Os dois autocuidados — desligar sozinho, e esquecer o que passou

**Files:**
- Modify: `backend/src/services/notificacoes.js`
- Modify: `backend/src/controllers/WhatsappController.js`
- Modify: `backend/src/index.js`
- Test: `backend/test/whatsapp_autocuidado.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Create `backend/test/whatsapp_autocuidado.test.js`, com banco real e o cliente da Graph API como dublê (mesmo hook da Task 7):

```js
"use strict";

/**
 * As duas coisas que o bot faz por conta propria: parar de tentar quando a
 * credencial morreu, e esquecer eventos velhos.
 *
 * Sao testes SEPARADOS dos de notificacao porque provam POLITICA, nao envio:
 * o que acontece depois que a Meta diz "nao".
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd, notificacoes, config, controller;
let proximoErro = null;
const zaps = [];

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";

const dubleCliente = {
  VERSAO_GRAPH: "v26.0",
  enviarTemplate: async (cfg, dados) => {
    zaps.push(dados);
    if (proximoErro) {
      const e = new Error(`ErroDaMeta: POST /messages ${proximoErro}`);
      e.name = "ErroDaMeta";
      e.codigo = proximoErro;
      throw e;
    }
    return { wamid: "wamid.A" + zaps.length };
  },
};

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query("INSERT INTO auth.users (id, email) VALUES ($1, 'ana@ex.com')", [ANA]);
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome, telefone, whatsapp_optin_em)
     VALUES ($1::uuid, 'Ana', '31999990000', now())`,
    [ANA],
  );

  process.env.DATABASE_URL = bd.connectionString;
  process.env.NODE_ENV = "development";

  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (caminho) {
    if (caminho === "./whatsappClient") return dubleCliente;
    return requireOriginal.apply(this, arguments);
  };
  try {
    notificacoes = require("../src/services/notificacoes.js");
    controller = require("../src/controllers/WhatsappController.js");
  } finally {
    Module.prototype.require = requireOriginal;
  }

  config = require("../src/services/whatsappConfig.js");
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(async () => {
  if (!bd) {
    throw new Error("O Postgres nao subiu no before(); a causa real esta no erro daquele hook.");
  }
  zaps.length = 0;
  proximoErro = null;
  await bd.pool.query("DELETE FROM canastra.whatsapp_mensagens");
  await bd.pool.query("DELETE FROM canastra.whatsapp_eventos");
  await bd.pool.query("DELETE FROM canastra.whatsapp_config");
  config.esquecer();
  await config.gravar({ ativo: true, access_token: "tok", phone_number_id: "111" });
});

const pedido = (id) => ({
  order_id: id,
  user_id: ANA,
  total_amount: "89.90",
  status: "aprovado",
});

test("token invalido desliga a integracao, e o motivo fica visivel", async () => {
  // O modo de falha que isto impede: com a credencial morta, cada pedido novo
  // dispara uma tentativa que ja se sabe perdida — queima cota da API, enche o
  // log e a loja so descobre quando um cliente reclama.
  proximoErro = 190;
  await notificacoes.avisarCliente(pedido("3f2504e0-4f89-11d3-9a0c-0305e82c3301"), "aprovado", null);

  const atual = await config.carregar();
  assert.equal(atual.ativo, false);
  assert.match(String(atual.ultimo_erro), /190/);
});

test("depois de desligar sozinho, nao tenta de novo", async () => {
  proximoErro = 190;
  await notificacoes.avisarCliente(pedido("3f2504e0-4f89-11d3-9a0c-0305e82c3301"), "aprovado", null);
  assert.equal(zaps.length, 1);

  proximoErro = null;
  await notificacoes.avisarCliente(pedido("3f2504e0-4f89-11d3-9a0c-0305e82c3302"), "aprovado", null);
  assert.equal(zaps.length, 1, "a integracao esta desligada; nao deveria ter tentado");
});

test("erro de entrega NAO desliga a integracao", async () => {
  // 131026 e "aquele numero nao recebe" — problema de UM cliente. Desligar a
  // loja inteira por causa de um numero errado seria a cura pior que a doenca.
  proximoErro = 131026;
  await notificacoes.avisarCliente(pedido("3f2504e0-4f89-11d3-9a0c-0305e82c3301"), "aprovado", null);

  assert.equal((await config.carregar()).ativo, true);
});

test("fora da janela tambem nao desliga", async () => {
  // 131047 e "re-engagement": so significa que o template era necessario.
  proximoErro = 131047;
  await notificacoes.avisarCliente(pedido("3f2504e0-4f89-11d3-9a0c-0305e82c3301"), "aprovado", null);

  assert.equal((await config.carregar()).ativo, true);
});

test("a limpeza apaga evento com mais de sete dias e preserva o de ontem", async () => {
  // Sete dias, e nao "algumas horas": e a janela de reentrega documentada pela
  // Meta. Cortar antes deixa passar justamente a duplicata do fim da janela,
  // que e a que ninguem esta olhando.
  await bd.pool.query(
    `INSERT INTO canastra.whatsapp_eventos (dedupe_key, recebido_em) VALUES
       ('velho', now() - interval '8 days'),
       ('limite', now() - interval '7 days' - interval '1 minute'),
       ('ontem', now() - interval '1 day'),
       ('agora', now())`,
  );

  const apagados = await controller.limparEventosVelhos();

  assert.equal(apagados, 2);
  const { rows } = await bd.pool.query(
    "SELECT dedupe_key FROM canastra.whatsapp_eventos ORDER BY dedupe_key",
  );
  assert.deepEqual(rows.map((r) => r.dedupe_key), ["agora", "ontem"]);
});

test("a limpeza numa tabela vazia devolve zero, sem erro", async () => {
  assert.equal(await controller.limparEventosVelhos(), 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node --test test/whatsapp_autocuidado.test.js`
Expected: FAIL — `limparEventosVelhos is not a function`.

- [ ] **Step 3: Acrescentar a coluna do motivo**

A migração `0017` **já foi aplicada** e não se edita — escreva a próxima. Create `backend/db/migrations/0018_whatsapp_ultimo_erro.sql`:

```sql
-- O motivo de o bot ter se desligado sozinho.
--
-- SEPARADA de `whatsapp_mensagens.erro_texto` de proposito: aquela coluna diz
-- por que UMA mensagem falhou; esta diz por que a INTEGRACAO parou. Sem ela, o
-- gestor abre o painel, ve "desligado", e nao tem como saber se foi ele quem
-- desligou ou se a credencial morreu — que sao duas conversas bem diferentes.
--
-- Texto livre, e nao codigo: quem le e uma pessoa, e a frase que a Meta
-- devolve e mais util que o numero sozinho. NUNCA recebe token: quem escreve e
-- services/notificacoes.js, a partir do `message` de ErroDaMeta, que ja nasce
-- sem credencial (services/whatsappClient.js).
ALTER TABLE canastra.whatsapp_config
  ADD COLUMN ultimo_erro    text,
  ADD COLUMN desligado_em   timestamptz;
```

Acrescente `ultimo_erro` e `desligado_em` à lista de campos gravaveis de `whatsappConfig.js` e a `paraOPainel()` — **não** são segredo, vão inteiros.

- [ ] **Step 4: Implementar o desligamento**

Em `notificacoes.js`, no `catch` do envio, uma lista literal dos códigos que significam "a credencial ou a conta morreu" — e **só** eles desligam:

```js
/**
 * Os erros que sao da INTEGRACAO, e nao de uma mensagem.
 *
 * 190  = OAuth invalido (token revogado, expirado, ou app removido)
 * 200  = permissao faltando no token
 * 10   = a app nao tem permissao para esta acao
 * 131031 = a conta foi bloqueada pela politica da Meta
 *
 * O que NAO esta aqui, e por que: 131026 ("aquele numero nao recebe") e
 * 131047 ("fora da janela") sao problemas de UM destinatario. Desligar a loja
 * inteira por causa de um numero errado seria a cura pior que a doenca.
 */
const ERROS_QUE_DESLIGAM = Object.freeze([190, 200, 10, 131031]);
```

Ao pegar um deles: `gravar({ ativo: false, ultimo_erro: <frase>, desligado_em: new Date() })` e um `console.error` que **grita a consequência** ("o bot parou; ninguém receberá aviso até a credencial ser trocada no painel"), no espírito de `blingClient.js:157-166`.

- [ ] **Step 5: Implementar a limpeza**

Em `WhatsappController.js`, exporte:

```js
/**
 * Apaga os eventos fora da janela de reentrega da Meta. Devolve quantos saiu.
 *
 * SETE DIAS porque e o prazo documentado de reentrega ("for up to 7 days").
 * A tabela so existe para responder "ja processei este?", e depois desse prazo
 * a pergunta nao pode mais ser feita — guardar mais e so custo de disco.
 */
async function limparEventosVelhos(conexao = pool) {
  const { rowCount } = await conexao.query(
    "DELETE FROM canastra.whatsapp_eventos WHERE recebido_em < now() - interval '7 days'",
  );
  return rowCount;
}
```

E em `backend/src/index.js`, pendure a chamada no cron que já existe, junto do bloco de `:191-198`, com o mesmo desenho de gate por env: um `setInterval` diário só quando `META_ATIVO === "true"`, engolindo erro e logando.

- [ ] **Step 6: Rodar e ver passar**

Run: `cd backend && node --test test/whatsapp_autocuidado.test.js`
Expected: PASS, 6 testes.

- [ ] **Step 7: Regenerar o SQL e rodar as invariantes**

Run: `npm run db:gerar-sql && npm --prefix backend test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/db/migrations/0018_whatsapp_ultimo_erro.sql backend/db/instalacao-completa.sql backend/db/reset.sql backend/src/services backend/src/controllers/WhatsappController.js backend/src/index.js backend/test/whatsapp_autocuidado.test.js
git commit -m "feat: o bot desliga sozinho quando a credencial morre, e diz por que"
```

---

## Verificação final

- [ ] `npm --prefix backend test` — suíte inteira verde
- [ ] `npm --prefix frontend run test` — verde
- [ ] `npm --prefix frontend run build` — sem erro
- [ ] `grep -rn "sendStatusEmail" backend/src/` devolve **uma** linha (a definição)
- [ ] `grep -rniE "(META_ACCESS_TOKEN|access_token).*(console\.|throw)" backend/src/services/whatsappClient.js` não devolve nada
- [ ] `git log --oneline` mostra um commit por tarefa, nenhum "wip"
- [ ] `META_ATIVO=false` e `whatsapp_config.ativo = false` — a loja sobe hoje exatamente como subia ontem
