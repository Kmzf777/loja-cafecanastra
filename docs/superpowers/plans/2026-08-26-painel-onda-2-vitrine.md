# Painel de gestão — Onda 2: a vitrine editável

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`.
> Quem tocar em `frontend/` DEVE invocar `frontend-design:frontend-design` antes da primeira linha
> de JSX; a direção estética está fixada em `estetica.md` §3/§4 e na §2.5 da spec, e não é escolha
> de quem executa.

**Goal:** o gestor troca a imagem e o texto do herói da home, nos três idiomas, e a barra de aviso —
sozinho, com prévia ao vivo, sem tocar em código. E a loja passa a ler isso do banco, caindo no
texto de hoje quando o banco não tiver nada.

**Por que esta onda vem antes do motor de promoção.** O roteiro original punha as migrações todas
juntas. Esta fatia é **vertical e independente**: não depende do motor, e atravessa a pilha inteira —
migração, RLS, rota do Express, tela do painel, consumo na vitrine. Fazer uma fatia fina de ponta a
ponta antes de uma camada grossa prova que as junções funcionam enquanto ainda é barato descobrir
que não. E é o item que o dono do projeto pediu nominalmente.

**Architecture:** duas tabelas em `canastra`, servidas ao público por `GET /vitrine` e escritas por
`PUT /vitrine` (admin). A home lê pela mesma função que já busca produtos, com fallback para a
tabela `TEXTOS` chumbada no `page.tsx` — que deixa de ser a fonte e vira o **piso**.

**Tech Stack:** Postgres 16 · Express · Next 15 App Router · Tailwind v4 · Vitest 4 · `node:test`
com PostgreSQL embarcado.

**Leitura obrigatória antes de começar:** §3.6 e §5.2 da spec; a seção CRÍTICO de
`docs/pesquisa/2026-08-26-riscos-da-reescrita.md`; e `backend/db/migrations/0006_politicas_rls.sql`
inteiro — é o arquivo que define o padrão de segurança que a migração nova tem de seguir.

---

## As três armadilhas desta onda

**1. `generateStaticParams` + `revalidate = 3600` fazem as três homes saírem do build.** Qualquer
`cookies()`, `headers()` ou `searchParams` introduzido na home a derruba para render sob demanda,
com uma ida ao servidor a cada visita. O custo está medido em `docs/performance-dev.md §7` e citado
em `page.tsx:54-70`. **A leitura do herói tem de ser `fetch` com revalidação, nunca API dinâmica.**

**2. `PUT /config` já mostrou como se apaga configuração de produção sem querer:** o corpo chega por
multipart, campo enviado **vazio** sobrescreve, e `Number('')` é `0` — que no mínimo de frete grátis
desliga o frete grátis da loja inteira. `PUT /vitrine` nasce com a mesma disciplina: **campo ausente
não é campo vazio**, e o teste prova isso.

**3. O herói nunca pode nascer em branco.** Linha ausente, coluna nula ou string vazia no banco ⇒ a
home aparece exatamente como aparece hoje. Um gestor que salva o formulário pela metade não pode
apagar o topo da loja.

---

### Task 1: A migração `0030_vitrine.sql`

**Files:**
- Create: `backend/db/migrations/0030_vitrine.sql`
- Create: `backend/test/vitrine.test.js`

> **Numeração:** 0030, e não 0017. O número 0017 está **triplamente disputado** —
> `worktree-melhor-envio` tem `0017_melhor_envio.sql` e `worktree-whatsapp-bot` vai de `0017` a
> `0021`. O runner (`backend/db/migrar.js`) **aborta em número repetido**, e a chave de controle em
> `canastra.migracoes` é o **nome completo do arquivo** — uma migração já aplicada não pode ser
> renomeada, ou roda de novo.

- [ ] **Step 1: Escrever o teste, antes do SQL**

`backend/test/vitrine.test.js`, no molde de `backend/test/rls.test.js` (que é o exemplo de teste de
RLS por papel neste repositório — leia-o antes). Casos:

```js
test("a vitrine anônima LÊ o herói e os textos", ...)          // anon: SELECT ok nas duas
test("a vitrine anônima NÃO escreve", ...)                      // anon: INSERT/UPDATE negados
test("cliente logado NÃO escreve", ...)                         // authenticated sem linha em admins
test("admin escreve", ...)                                      // authenticated com linha em admins
test("vitrine_heroi é linha única", ...)                        // INSERT com id 2 estoura 23514
test("locale fora de (pt,en,es) é recusado", ...)               // 23514
test("chave fora de (heroi,barra_aviso) é recusada", ...)       // 23514
test("a migração é idempotente sob o runner", ...)              // aplicar duas vezes não estoura
```

Use `comoPapel(pool, { papel, sub }, acao)` de `backend/test/ajuda/sessao.js` para assumir papel do
Supabase dentro de `BEGIN/ROLLBACK`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node --test --test-concurrency=1 test/vitrine.test.js`
Expected: FAIL — `relation "canastra.vitrine_heroi" does not exist`.

- [ ] **Step 3: Escrever a migração**

```sql
-- O conteúdo editável da vitrine: o herói da home e a barra de aviso.
--
-- POR QUE ISTO EXISTE. `config_loja` já tinha `banner_desktop`, `banner_mobile`
-- e `barra_de_aviso`, o painel legado já os editava — e a vitrine nova NUNCA
-- LEU nenhum dos três. O herói da home é `<Image src="/imagem-banner.jpg">`,
-- arquivo estático, com kicker/título/texto numa tabela chumbada dentro do
-- próprio `page.tsx`. Eram três campos write-only: o gestor salvava e nada
-- acontecia em lugar nenhum.
--
-- POR QUE DUAS TABELAS E NÃO COLUNAS EM `config_loja`. A loja fala três
-- idiomas (`app/[locale]`), e o texto do herói precisa existir nos três. Em
-- coluna isso seriam quinze colunas novas (cinco campos × três idiomas) que
-- viram trinta no dia em que entrar um quarto idioma. A imagem, ao contrário,
-- é UMA para os três — pedir três uploads da mesma foto é trabalho inventado.
-- Daí a divisão: imagem numa linha única, texto numa linha por (chave, idioma).

CREATE TABLE canastra.vitrine_heroi (
  id               integer PRIMARY KEY DEFAULT 1
                     CONSTRAINT vitrine_heroi_linha_unica CHECK (id = 1),
  imagem_desktop   text,
  imagem_mobile    text,
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);

-- O MESMO GUARDA DUPLO de `config_loja` (ver 0005): um INSERT com id explícito
-- diferente de 1 bate no CHECK (23514); um INSERT sem citar `id` pega o DEFAULT,
-- passa pelo CHECK e bate na chave primária (23505). Quem tratar erro no painel
-- precisa esperar os dois SQLSTATEs.

CREATE TABLE canastra.vitrine_texto (
  chave         text NOT NULL
                  CONSTRAINT vitrine_texto_chave_valida
                    CHECK (chave IN ('heroi', 'barra_aviso')),
  -- 'pt', 'en', 'es' — os mesmos três de `app/[locale]`. Lista fechada por
  -- CHECK e não texto livre: um 'pt-BR' gravado por engano nunca seria lido
  -- pela vitrine, que procura por 'pt', e o gestor veria o texto sumir sem
  -- nenhuma mensagem de erro.
  locale        text NOT NULL
                  CONSTRAINT vitrine_texto_locale_valido
                    CHECK (locale IN ('pt', 'en', 'es')),
  kicker        text,
  titulo        text,
  texto         text,
  rotulo_botao  text,
  destino       text,
  imagem_alt    text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chave, locale)
);

-- TODA COLUNA DE CONTEÚDO É NULÁVEL, e isso é a regra de segurança do §3.6 da
-- spec escrita no schema: o valor de hoje, chumbado em `page.tsx`, vira o
-- FALLBACK. Linha ausente, coluna nula ou string vazia ⇒ a home aparece como
-- aparece hoje. Um NOT NULL aqui obrigaria o gestor a preencher os seis campos
-- dos três idiomas antes de trocar uma foto, e um formulário salvo pela metade
-- apagaria o topo da loja.

-- A vitrine mostra herói e barra de aviso ANTES de qualquer login, então as
-- duas levam GRANT próprio — mesma regra de 0001 que `promocoes` e
-- `config_loja` já seguem.
GRANT SELECT ON canastra.vitrine_heroi TO anon;
GRANT SELECT ON canastra.vitrine_texto TO anon;

ALTER TABLE canastra.vitrine_heroi ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.vitrine_texto ENABLE ROW LEVEL SECURITY;

-- Leitura pública, escrita só de admin — `canastra.eh_admin()` (0006:120) lê
-- `canastra.admins`, e NUNCA um claim do JWT: a instância do Supabase é
-- compartilhada, e um token de projeto vizinho carrega o que quiser em
-- `user_metadata`.
CREATE POLICY vitrine_heroi_publico_le ON canastra.vitrine_heroi
  FOR SELECT USING (true);
CREATE POLICY vitrine_texto_publico_le ON canastra.vitrine_texto
  FOR SELECT USING (true);

CREATE POLICY vitrine_heroi_admin_escreve ON canastra.vitrine_heroi
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());
CREATE POLICY vitrine_texto_admin_escreve ON canastra.vitrine_texto
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

GRANT INSERT, UPDATE, DELETE ON canastra.vitrine_heroi TO authenticated;
GRANT INSERT, UPDATE, DELETE ON canastra.vitrine_texto TO authenticated;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && node --test --test-concurrency=1 test/vitrine.test.js`
Expected: PASS.

- [ ] **Step 5: Confirmar que `rls.test.js` continua verde**

Ele afirma como **invariante sobre `pg_policies`** que não existe política `USING (true)` que não
seja `FOR SELECT`. As duas políticas públicas acima são `FOR SELECT` — mas confirme, não suponha.

Run: `cd backend && node --test --test-concurrency=1 test/rls.test.js`

- [ ] **Step 6: Regerar a instalação completa**

`backend/db/instalacao-completa.sql` é gerado por `gerar-instalacao.js` e comparado por
`test/instalacao.test.js`. Sem regerar, esse teste fica vermelho dizendo que a instalação está
desatualizada.

Run: `cd backend && node db/gerar-instalacao.js && node --test --test-concurrency=1 test/instalacao.test.js`

- [ ] **Step 7: Commit**

```bash
git add backend/db/migrations/0030_vitrine.sql backend/db/instalacao-completa.sql backend/test/vitrine.test.js
git commit -m "feat(vitrine): o heroi e a barra de aviso viram tabela, com RLS"
```

---

### Task 2: O contrato HTTP

**Files:**
- Create: `backend/src/repositories/vitrineRepository.js`
- Create: `backend/src/routes/vitrine.routes.js`
- Modify: `backend/src/index.js` (montar a rota)
- Create: `backend/test/vitrine_rotas.test.js`

- [ ] **Step 1: Escrever o teste, antes do código**

No molde de `backend/test/painel_pedidos.test.js` — ele mostra o padrão completo: sobe o Postgres
embarcado, insere `auth.users`/`canastra.clientes`/`canastra.admins` por SQL com UUIDs fixos, define
`process.env.DATABASE_URL` **e só então** faz o `require` dos módulos de `src/` (o `pgPool` lê a
variável no momento do require), e chama o controller com o dublê `respostaFalsa()`.

Casos que **precisam** existir:

```js
test("GET /vitrine é público — sem token, responde 200")
test("GET /vitrine devolve os três idiomas, mesmo com a tabela vazia")
test("PUT /vitrine sem token responde 401")
test("PUT /vitrine com token de cliente responde 403")
test("PUT /vitrine parcial NÃO apaga o que não veio")        // ← a armadilha 2
test("PUT /vitrine com string vazia GRAVA vazio, e o fallback cuida")
test("PUT /vitrine recusa locale inválido com 400 e frase legível")
test("PUT /vitrine recusa chave inválida com 400")
```

O quinto caso é o que impede repetir o defeito de `PUT /config`: grave `titulo` e `texto`, depois
mande um PUT só com `titulo`, e afirme que `texto` **continua lá**.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && node --test --test-concurrency=1 test/vitrine_rotas.test.js`

- [ ] **Step 3: O repositório**

Contrato de resposta do `GET /vitrine`:

```json
{
  "heroi": { "imagem_desktop": "...|null", "imagem_mobile": "...|null" },
  "textos": {
    "heroi":       { "pt": {...}|null, "en": {...}|null, "es": {...}|null },
    "barra_aviso": { "pt": {...}|null, "en": {...}|null, "es": {...}|null }
  }
}
```

Sempre com as duas chaves e os três idiomas presentes, valor `null` quando não houver linha — assim
o consumidor nunca precisa checar existência de chave, só de valor.

`PUT /vitrine` aceita o mesmo formato, e **só escreve o que veio**: `undefined` é "não mexer",
`null` e `""` são "gravar vazio". A diferença tem de estar num comentário, porque é exatamente
a que `PUT /config` errou.

- [ ] **Step 4: A rota**

```js
vitrineRoutes.get("/", (req, res) => repo.get(req, res));                      // público
vitrineRoutes.put("/", authenticateToken, isAdmin, (req, res) => repo.put(req, res));
```

Montar em `backend/src/index.js` como `/vitrine`.

> **Ordem de registro é load-bearing neste projeto.** Três pares já quebram se invertidos
> (`/dashboard/summary` antes de `/dashboard/:id`, `/admin/orders/export` antes de
> `/admin/orders/:id`, `/users/me` antes de `/users/:id`). `/vitrine` não tem `:id`, então não cria
> par novo — mas **não reordene nada do que já está lá** ao acrescentar a linha.

- [ ] **Step 5: Rodar, ver passar, commitar**

```bash
git commit -m "feat(vitrine): GET publico e PUT de admin, com PUT que nao apaga o que nao veio"
```

---

### Task 3: A tela `/dashboard/vitrine`

**Invoque `frontend-design:frontend-design` antes de escrever JSX.**

**Files:**
- Create: `frontend/lib/painel/vitrine/vitrine.logica.ts` + teste
- Create: `frontend/app/dashboard/(protegido)/vitrine/page.tsx`
- Create: `frontend/app/dashboard/(protegido)/vitrine/FormularioDaVitrine.tsx` + teste
- Create: `frontend/app/dashboard/(protegido)/vitrine/acoes.ts`

- [ ] **Step 1: O módulo puro primeiro**

`vitrine.logica.ts`, sem React e sem fetch. É onde a decisão mora e onde o teste é barato:

- `montarPayload(formulario)` — transforma o estado do formulário no corpo do PUT, **omitindo campo
  não tocado** (é aqui que a armadilha 2 é derrotada do lado do cliente também).
- `comFallback(doBanco, doCodigo)` — resolve valor a exibir na prévia, campo a campo.
- `validar(formulario)` — destino tem de ser caminho interno ou URL absoluta válida; `imagem_alt`
  obrigatório quando há imagem (uma foto de herói sem ALT é a falha de acessibilidade mais comum de
  toda loja).
- `estaSujo(inicial, atual)` — o que faz a barra de salvar aparecer.

- [ ] **Step 2: A Server Action, com a checagem na primeira linha**

`acoes.ts` declara `"use server"` e **precisa** chamar `exigirAdminEmAcao()` antes de qualquer outra
coisa. Não é estilo: o layout de `(protegido)` **não** protege Server Action — a ação executa e só
depois a página re-renderiza, então a checagem do layout roda depois de a ação ter gravado. Há um
teste de inventário que fica vermelho se você esquecer (`lib/conta/painel-servidor.test.ts`).

- [ ] **Step 3: A tela, com prévia ao vivo lado a lado**

R33 da pesquisa existe para proibir exatamente o padrão de "editar às cegas e abrir a loja noutra
aba para conferir". Editor à esquerda, prévia à direita, atualizando enquanto se digita.

A prévia **não** precisa ser um `<iframe>` da home — precisa ser uma miniatura fiel do bloco do
herói: a imagem, o kicker em `text-juta` caixa alta, o título em `font-titulo`, o texto e o botão,
sobre `bg-fuligem`. Fiel o bastante para decidir; barata o bastante para renderizar a cada tecla.

Abas por idioma (pt/en/es). Barra de salvar contextual com **Salvar** e **Descartar**, e bloqueio de
saída com alteração pendente (R5). Use os primitivos que já existem em `components/painel/ui/` —
`Ficha`, `Campo`, `Botao`, `Tarja`, `EstadoDaTela`. **Não crie primitivo novo.**

- [ ] **Step 4: Rodar, ver passar, commitar**

---

### Task 4: A home passa a ler do banco

**Files:**
- Create: `frontend/lib/vitrine/heroi.ts` + teste
- Modify: `frontend/app/[locale]/(vitrine)/page.tsx`
- Modify: `frontend/components/layout/Cabecalho.tsx` (barra de aviso)

- [ ] **Step 1: O leitor, com o fallback testado antes de existir**

`lib/vitrine/heroi.ts` exporta `buscarHeroi(locale)`, que faz `fetch` da API **com revalidação**
(`{ next: { revalidate: 3600 } }`) e **nunca** usa `cookies()`, `headers()` ou `searchParams`.

Testes que precisam existir, e que são o coração desta tarefa:

```ts
it("devolve o texto do banco quando ele existe")
it("cai no texto chumbado quando a API não responde")
it("cai no texto chumbado quando a linha existe mas o campo é null")
it("cai no texto chumbado quando o campo é string vazia")   // ← o gestor que salvou pela metade
it("cai no idioma pt quando o idioma pedido não tem linha")
it("nunca devolve campo vazio para nenhum dos três idiomas")
```

- [ ] **Step 2: Ligar na home**

A tabela `TEXTOS` de `page.tsx` **não sai do arquivo**: ela deixa de ser a fonte e vira o argumento
de fallback. `<Image src>` passa a vir de `heroi.imagemDesktop ?? "/imagem-banner.jpg"`.

> **Host de imagem são DOIS lugares que mudam juntos:** `images.remotePatterns` em
> `next.config.mjs:157-166` **e** a diretiva `img-src` do CSP em `next.config.mjs:109`. Esquecer o
> segundo dá imagem quebrada sem erro de servidor, sem teste vermelho e sem falha de build — o
> próprio arquivo avisa disso em `:98-108`. Se o upload for para a Cloudinary (que é para onde o
> painel legado já manda imagem de produto), o host dela precisa estar nos dois.

- [ ] **Step 3: Provar que o build não caiu para dinâmico**

Run: `npm --prefix frontend run build`
Expected: `/[locale]` continua marcado como `●` (SSG) na lista de rotas, **não** `ƒ` (Dynamic).
Se virou `ƒ`, alguma API dinâmica entrou na home — pare e ache qual.

- [ ] **Step 4: A barra de aviso**

Mesmo tratamento em `Cabecalho.tsx`. Ela é o campo write-only mais barato de ligar: `GET /config` já
devolve `announcement_bar`, mas o cabeçalho lê o dicionário. Agora lê o banco, com o dicionário como
fallback.

- [ ] **Step 5: Rodar tudo e commitar**

```bash
npm --prefix frontend run test && npm --prefix backend test && npm --prefix frontend run build
```

---

## Como se sabe que a Onda 2 acabou

1. As três suítes passam, com contagem maior que a de hoje (1024 no frontend, 427 no backend).
2. `npm --prefix frontend run build` passa, e `/[locale]` continua **SSG**.
3. Um `UPDATE` direto em `canastra.vitrine_texto` muda o texto da home depois da revalidação.
4. **Apagar as duas tabelas inteiras deixa a home exatamente como está hoje** — é o teste do
   fallback, e é o mais importante dos quatro.
5. `/dashboard/vitrine` abre, mostra a prévia ao lado do editor, e salvar só o título não apaga o
   texto.
