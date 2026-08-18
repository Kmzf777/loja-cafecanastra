# Supabase F2 — Autenticação pelo GoTrue: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A loja passa a autenticar pelo GoTrue do Supabase, e o `bcrypt`/`jsonwebtoken` próprio sai do projeto.

**Architecture:** O navegador fala com o GoTrue via `supabase-js`; a sessão vive em cookie first-party gerido pelo `@supabase/ssr`. Ser cliente da loja continua sendo ter linha em `canastra.clientes`, criada por uma RPC própria. O Express deixa de emitir token e passa só a verificar o token do Supabase.

**Tech Stack:** `@supabase/supabase-js`, `@supabase/ssr`, Next 15 App Router, PostgreSQL 16, `node:test`, vitest.

**Spec:** `docs/superpowers/specs/2026-08-17-supabase-selfhosted-design.md` §4.

---

## Por que este plano não traz o código pronto

O plano da F1 trazia o código de cada passo escrito por extenso. Seis vezes esse
código estava **errado de um jeito que importava** — um `nullif` fora de lugar
que teria quebrado toda política de RLS, um comparador de `sort` que nunca roda
com um elemento só, um `sub: undefined` rodando anônimo, um trigger que travava
instalação nova, uma view que deixava qualquer token apagar o catálogo, um
`ON CONFLICT` que perdia a sacola no login. Todos foram achados por quem
implementou ou revisou, não por quem planejou.

A lição é sobre onde o plano agrega valor. Aqui ele especifica **intenção,
restrição e armadilha conhecida**, com precisão; quem implementa escreve o código
contra teste. Onde houver uma decisão já tomada, ela está escrita com o motivo —
não para ser copiada, para ser respeitada.

---

## O que já existe, e o que isso implica

| Fato | Implicação |
|---|---|
| `frontend/lib/conta/sessao.ts` exporta `entrar`, `recuperarSessao`, `sair`, `destinoDe`, `Usuario`, `Sessao`, `ErroDeLogin` e é consumido por 7 arquivos | Trocar o **interior** desse módulo, mantendo a interface, é metade da fase. Os consumidores não deveriam precisar mudar. |
| A vitrine tem `/account/login` mas **não tem tela de cadastro** | A loja hoje não consegue adquirir cliente pela vitrine. A F2 fecha isso. |
| `backend/src/middleware/isAuthenticated.js` já verifica HS256 com segredo | Token do Supabase também é HS256. Repontar é trocar o segredo e somar a checagem de vínculo — não reescrever. |
| A 0006 revogou `INSERT` em `canastra.clientes` de `authenticated` | O cadastro **precisa** de uma porta com nome. Decisão tomada: RPC `SECURITY DEFINER` (Task 1). |
| A 0007 já criou `canastra.fundir_sacola(jsonb)` | A F2 só precisa **chamá-la**, e no momento certo. |
| `frontend/legacy/contexts/loginContext/authContextProvider.jsx` (250 linhas) autentica o painel pelo mesmo Express | Sem repontá-lo, remover o auth do Express quebra o painel até a F6. Está no escopo. |
| `npm run verifica:rls` prova a fronteira contra um Supabase real | É o teste de aceitação desta fase, e precisa ganhar casos novos. |

**Contrato que a 0007 impõe ao front, e que já custou caro descobrir:** as chaves
do JSON de `fundir_sacola` são os nomes das colunas em português
(`produto_id`, `quantidade`, `preco`, `nome`, `imagem`, `tamanho`, `moagem`),
enquanto `ItemDaSacola` no `localStorage` é em inglês (`product_id`, `quantity`,
`price`, `name`, `image`, `size`). Só `moagem` coincide. Mandar a lista crua faz
todo `produto_id` virar nulo e **a sacola inteira ser descartada em silêncio**.

**E a fusão não é idempotente, por construção.** `onAuthStateChange` dispara mais
de uma vez por sessão (`INITIAL_SESSION`, `SIGNED_IN`, `TOKEN_REFRESHED`);
chamar a cada evento dobra a sacola do cliente. A única defesa é limpar
`localStorage["cart"]` **depois** que a RPC retornar, e só então.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/db/migrations/0008_garantir_cliente.sql` | A RPC que cria o vínculo do cliente. |
| `backend/test/garantir_cliente.test.js` | Casos positivos e negativos da RPC. |
| `frontend/lib/supabase/cliente.ts` | Cliente `supabase-js` do navegador (singleton). |
| `frontend/lib/supabase/servidor.ts` | Cliente para Server Components e Route Handlers, via `@supabase/ssr`. |
| `frontend/lib/conta/sessao.ts` | **Reescrito por dentro**, mesma interface exportada. |
| `frontend/lib/conta/cadastro.ts` | `cadastrar()` — signUp no GoTrue + `garantir_cliente`. |
| `frontend/app/(vitrine)/account/cadastro/page.tsx` | Tela de cadastro (nova). |
| `frontend/lib/sacola/fusao.ts` | Traduz `ItemDaSacola` → payload da RPC e chama uma vez só. |
| `backend/src/middleware/isAuthenticated.js` | Passa a verificar o token do Supabase e o vínculo. |
| `backend/src/routes/conta.routes.js` | Só o que o GoTrue não faz: excluir a própria conta. |
| `frontend/legacy/contexts/loginContext/authContextProvider.jsx` | Repontado para o GoTrue. |

**Removidos ao final:** `backend/src/repositories/loginRepository.js` (757),
`backend/src/routes/login.routes.js`, `backend/src/routes/resetPassword.routes.js`,
`backend/src/middleware/validateAuth.js`, `backend/src/middleware/optionalAuthenticate.js`,
e as dependências `bcrypt` e `csurf`.

---

## Task 1 — Migração 0008: a RPC de vínculo

**Files:** criar `backend/db/migrations/0008_garantir_cliente.sql` e `backend/test/garantir_cliente.test.js`. TDD.

`canastra.garantir_cliente(nome text, telefone text DEFAULT NULL, cpf text DEFAULT NULL) RETURNS void`.

Requisitos, e o motivo de cada um:

- **`SECURITY DEFINER` com `SET search_path = canastra, pg_temp`.** É o que permite escrever numa tabela que `authenticated` não pode escrever. Sem o `search_path` fixo, uma função `SECURITY DEFINER` do dono do banco é o vetor clássico de escalação.
- **Insere `auth.uid()` e mais ninguém.** A função não aceita `user_id` como parâmetro. Se aceitasse, viraria exatamente o buraco que a 0006 fechou: qualquer autenticado plantaria linha para qualquer uid.
- **Idempotente** (`ON CONFLICT (user_id) DO NOTHING`). Ela é chamada em toda sessão autenticada, não só no cadastro — é assim que o vínculo aparece para quem confirmou o e-mail dias depois.
- **Recusa quem não confirmou o e-mail.** `auth.jwt() ->> 'email'` existe sempre; a confirmação está em `auth.users.email_confirmed_at`. Consulte a tabela, não o claim. Sem essa trava, um cadastro com e-mail alheio vira cliente antes de provar posse do endereço.
- **Recusa `auth.uid()` nulo** com erro claro, não com resultado vazio.
- **`REVOKE EXECUTE FROM PUBLIC`**, depois `GRANT EXECUTE TO authenticated`. `anon` não entra: sem `auth.uid()` ela só entraria para ser expulsa.
- **Não toca `canastra.admins`.** Virar administrador continua sendo só por `service_role`.

Testes obrigatórios: cria o vínculo; chamar duas vezes não duplica; não sobrescreve nome de quem já existe; recusa e-mail não confirmado; recusa `anon`; um cliente não consegue criar vínculo para outro uid (prove que não há parâmetro que permita); depois da RPC, as políticas de `enderecos`/`carrinhos` passam a valer para aquele usuário.

Ao final: `node backend/db/gerar-instalacao.js` (o arquivo colável precisa incluir a 0008) e conferir que `backend/test/instalacao.test.js` continua verde.

---

## Task 2 — Cliente Supabase no front

**Files:** criar `frontend/lib/supabase/cliente.ts` e `frontend/lib/supabase/servidor.ts`. Modificar `frontend/package.json`.

Instalar `@supabase/supabase-js` e `@supabase/ssr`.

- **Navegador:** `createBrowserClient` com `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`, **singleton** — duas instâncias criam dois ouvintes de `onAuthStateChange` e a sacola funde duas vezes.
- **Servidor:** `createServerClient` do `@supabase/ssr`, lendo e escrevendo os cookies do Next. Cookie first-party no domínio da loja; `SameSite=Lax` basta, e é por isso que a topologia de domínio único foi escolhida (spec §2.1).
- **`db: { schema: "canastra" }`** na configuração. Sem isso toda consulta procura em `public` e responde 404 — a falha nº 1 de deploy, já medida no servidor de teste.
- A `service_role` **nunca** entra em nada com prefixo `NEXT_PUBLIC_`: essa variável vai inteira para o navegador.
- Se as duas variáveis faltarem, falhe alto na primeira chamada, com mensagem dizendo qual falta. O precedente é `conferirApiBase()` no `sessao.ts` atual.

---

## Task 3 — `sessao.ts` reescrito contra o GoTrue

**Files:** reescrever `frontend/lib/conta/sessao.ts`; criar `frontend/lib/conta/cadastro.ts`.

**A interface exportada não muda** — `entrar`, `recuperarSessao`, `sair`,
`destinoDe`, `destinoSeguro`, `Usuario`, `Sessao`, `ErroDeLogin`. Sete arquivos
dependem dela e não deveriam precisar de edição. Se algum precisar, isso é sinal
de que a interface mudou sem querer: pare e relate.

Por dentro:

- `entrar` → `signInWithPassword`. Traduza os erros do GoTrue para mensagens de
  loja: `Invalid login credentials` não é o que se mostra a um cliente. Distinga
  credencial errada de **e-mail não confirmado** — são ações diferentes para quem
  está na tela.
- `recuperarSessao` → `getSession`, e a partir dela monta `Usuario`. O papel de
  administrador **não vem do JWT**: vem de consultar `canastra.admins`, que a RLS
  só entrega a quem é admin. Um claim de papel seria forjável por outro projeto
  na instância compartilhada.
- `sair` → `signOut`.
- `API_BASE` e `conferirApiBase()` continuam existindo: o serviço Node não morre
  nesta fase, e o alerta de `localhost` em produção continua valendo.
- `cadastro.ts`: `signUp` com `emailRedirectTo` apontando para
  `/account/verify-email`, seguido de `garantir_cliente`. Trate o caso em que o
  GoTrue exige confirmação e **não** devolve sessão — aí o vínculo só pode ser
  criado quando a pessoa voltar confirmada, e a tela precisa dizer isso.

---

## Task 4 — Fusão da sacola, uma vez e só uma

**Files:** criar `frontend/lib/sacola/fusao.ts`; modificar `frontend/lib/sacola/sacola.tsx`.

Leia o cabeçalho de `sacola.tsx` antes: ele descreve as duas camadas de propósito.

- `fusao.ts` traduz `ItemDaSacola` (inglês) para as chaves da RPC (português) —
  ver o contrato acima. Um item sem `product_id` deve ser descartado no cliente,
  com aviso no console, e não mandado para o banco virar nulo.
- Chamar `canastra.fundir_sacola` **uma vez por sessão**: guarde a marca de "já
  fundi" fora do React (o provider remonta), e limpe `localStorage["cart"]`
  **apenas depois** de a RPC retornar sem erro. Falhou? Mantenha a sacola local e
  tente de novo na próxima — perder a sacola do cliente é pior que fundir tarde.
- Testes (vitest) para a tradução e para o "uma vez só": são lógica pura e não
  precisam de rede.

---

## Task 5 — O Express para de emitir token e passa a verificar

**Files:** modificar `backend/src/middleware/isAuthenticated.js`, `backend/src/index.js`; criar `backend/src/routes/conta.routes.js`; remover `login.routes.js`, `resetPassword.routes.js`, `loginRepository.js`, `validateAuth.js`, `optionalAuthenticate.js`.

- `isAuthenticated` passa a verificar com `SUPABASE_JWT_SECRET`, mantendo
  `algorithms: ["HS256"]` fixo (o comentário atual explica por que, e continua
  valendo). Depois da assinatura, **confira o vínculo**: `canastra.clientes` para
  cliente, `canastra.admins` para admin. Assinatura válida não é pertencimento —
  é a premissa da instância compartilhada inteira.
- `isAdmin` passa a ler `canastra.admins`, nunca um claim.
- `conta.routes.js` fica só com o que o GoTrue não faz: **excluir a própria
  conta**, que precisa da Admin API com `service_role`. Mantenha a trava
  existente de não deixar a loja sem administrador — agora ela também é trigger
  no banco, mas a mensagem de erro do endpoint é o que a pessoa lê.
- `csurf` sai: a API passa a exigir `Authorization: Bearer` e a **recusar**
  autenticação por cookie. Sem cookie de sessão na API, CSRF deixa de se aplicar.
  Fica registrado que essa é a razão — não "removemos porque estava obsoleto".
- `ambiente.js`: entram `SUPABASE_URL`, `SUPABASE_JWT_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY` como obrigatórias em produção; saem `JWT_SECRET` e
  `JWT_SECRET_REFRESH`. Mantenha a severidade: recusar subir é o comportamento.
- `bcrypt` sai do `package.json`.

Os 15 testes de pagamento não podem quebrar.

---

## Task 6 — O painel legado repontado

**Files:** modificar `frontend/legacy/contexts/loginContext/authContextProvider.jsx`, `frontend/legacy/components/LoginForm/LoginForm.jsx`, `frontend/legacy/pages/Account/ForgotPassword.jsx`, `frontend/legacy/api.js`.

O painel morre na F6, mas até lá precisa funcionar — e sem isto a Task 5 o
derruba. O trabalho é de repontar, não de reescrever:

- O contexto passa a obter sessão do `supabase-js` em vez de
  `/auth/refresh-token`. O `localStorage["has_refresh"]` some junto com o
  esquema que ele servia.
- `api.js` passa a mandar `Authorization: Bearer <access_token>` e para de
  buscar `/csrf-token`.
- O guard de admin passa a consultar `canastra.admins`.
- **Não** melhore o painel legado. Ele será apagado. Toque só no que quebraria.

---

## Task 7 — Aceitação, documentação e limpeza

**Files:** modificar `backend/scripts/verifica-rls.mjs`, `docs/producao.md`, `backend/src/.env.example`, `frontend/.env.example` (criar se não houver).

- `verifica:rls` ganha os casos da fase: cadastro pela RPC cria vínculo;
  quem não confirmou e-mail não vira cliente; depois do vínculo o cliente lê os
  próprios endereços; a sacola funde uma vez e não duas.
- `docs/producao.md`: a seção de variáveis troca `JWT_SECRET`/`JWT_SECRET_REFRESH`
  por `SUPABASE_JWT_SECRET`; a tabela sintoma→causa ganha as falhas novas —
  "login responde `Database error querying schema`" (campos de token em NULL,
  já documentado) e "cliente entra mas não vê nada" (vínculo em
  `canastra.clientes` ausente).
- O `.env.example` do backend perde `JWT_SECRET*` e ganha `SUPABASE_JWT_SECRET`
  com a indicação de onde achar (Settings → API → JWT Settings).

---

## Ao final da F2

O cliente se cadastra, confirma e-mail, entra, recupera senha e mantém a sacola —
tudo pelo GoTrue. `bcrypt` e os segredos de JWT próprios saem do projeto. O
painel legado continua de pé, autenticando pelo mesmo GoTrue.

**Não muda nesta fase:** o catálogo ainda é lido pelo Express (`GET /dashboard`),
as imagens ainda estão no Cloudinary, e os pedidos ainda passam pelos endpoints
antigos. São F3, F4 e F5.

**Passo manual do operador:** aplicar a 0008 (ou recolar o
`instalacao-completa.sql` num banco limpo) e conferir, no painel do Supabase, que
a confirmação de e-mail está ligada e o SMTP configurado — sem provedor de
e-mail, cadastro e recuperação de senha param, e o erro só aparece no log do
GoTrue.

---

## Descoberta que reordena as fases restantes

Durante a Task 4 apareceu, e foi confirmado de três formas independentes, que
**o serviço Express inteiro está morto contra o banco migrado.** Não é o
carrinho: são os oito repositories.

| Repository | Tabelas que consulta |
|---|---|
| `addressRepository` | `addresses` |
| `cartRepository` | `carts`, `cart_items`, `products` |
| `configRepository` | `store_config` |
| `dashboardRepository` | `orders`, `products`, `users` |
| `optionsRepository` | `product_options`, `products` |
| `ordersRepository` | `orders`, `users` |
| `promotionsRepository` | `promotions` |

Nenhuma existe: as migrações só criam `canastra.*`, em português. `GET /cart`
responde 500 (`42P01`), e a vitrine engole. `GET /dashboard` idem — por isso a
loja mostra preço do JSON versionado em vez do banco, que é a degradação
graciosa funcionando, e não um bug.

Isso invalida a premissa do faseamento original, que assumia o Express de pé até
a F5. **Decisão do usuário: antecipar a F4.** Depois da F2, a vitrine e a sacola
passam a ler e escrever direto no PostgREST, e o Express fica só com pagamento,
webhook, frete e e-mail — o destino final dele de qualquer forma. Consertar os
oito repositories seria editar ~1.000 linhas de SQL que as fases seguintes
apagam.

**Consequência para a Task 5:** as rotas de carrinho não são repontadas, são
removidas. E o ramo de hidratação por `GET /cart` em `sacola.tsx:145` sai junto —
o revisor mostrou que ele vira uma máquina de dobrar sacola no instante em que
aquele endpoint voltar a responder, porque a sacola da conta chegaria pelo
`localStorage` e seria lida como sacola anônima pendente.
