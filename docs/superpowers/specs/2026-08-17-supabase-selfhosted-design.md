# Migrar a loja para Supabase self-hosted

**Data:** 2026-08-17
**Estado:** aprovado
**Branch:** `feat/supabase-selfhosted`

Este documento descreve o estado final: a loja do Café Canastra rodando inteira
numa VPS, com Postgres, autenticação e arquivos servidos por uma instância
Supabase self-hosted já existente, um serviço Node enxuto ao lado, e o painel
administrativo reescrito.

---

## 1. Ponto de partida

Hoje a loja é:

| Peça | O que é | Tamanho |
|---|---|---|
| Vitrine | Next 15 App Router, `app/(vitrine)` | — |
| Painel | React + `react-router` + styled-components, ilha client-only em `app/dashboard` | 13.759 linhas em `frontend/legacy/` |
| API | Express 4 CommonJS, SQL cru via `pg` | 4.399 linhas em `backend/` |
| Banco | PostgreSQL 16, 11 tabelas em `public`, `schema.sql` só cria | — |
| Auth | Própria: `bcrypt` + `jsonwebtoken`, tabelas `refresh_tokens` e `password_resets` | 757 linhas em `loginRepository.js` |
| Arquivos | Cloudinary via `multer-storage-cloudinary` | — |

Nada está em produção. Não há dado real a migrar, nem janela de virada a
planejar. É o que torna uma reescrita desta dimensão aceitável.

Externos que o Supabase não substitui e continuam: Mercado Pago, Melhor Envio,
Resend.

---

## 2. Estado final

### 2.1 Topologia

```
                    proxy reverso (VPS)
                              │
      ┌───────────────────────┼────────────────────────┐
      │                       │                        │
 <domínio-loja>         <domínio-loja>/api/*    <domínio-supabase>
      │                       │                    (já existe)
      ▼                       ▼                        ▼
 Next 15 (Node)         serviço Node            Kong → PostgREST
 vitrine + painel       MP · webhook            GoTrue · Storage
                        frete · e-mail                  │
      │                       │                         ▼
      └───── supabase-js ─────┴──────────────────►  Postgres
                 anon key      service_role     (instância compartilhada)
```

Três decisões:

1. **Vitrine e API no mesmo domínio**, a API sob `/api/*` no proxy reverso.
   `docs/producao.md:16-18` registra que vitrine e API em domínios diferentes é
   o que obriga `SameSite=None; Secure` e é onde o deploy quebra em silêncio.
   Mesma origem, cookie first-party, `SameSite=Lax`: a classe de bug some.
2. **O navegador fala com o Supabase direto** para catálogo, carrinho,
   endereços e painel, via `supabase-js` com a `anon key` e RLS. É header
   `Authorization`, não cookie — o Supabase estar em outro subdomínio não cria
   problema de CORS de credencial.
3. **O serviço Node é a única peça com `service_role key`** e com os segredos de
   Mercado Pago, Melhor Envio e Resend. É a fronteira de confiança.

O domínio da loja e o proxy reverso em uso (nginx, Caddy ou Traefik) são
parâmetros de deploy, preenchidos no runbook — não afetam o desenho.

### 2.2 Instância compartilhada: risco aceito e mitigações

A instância Supabase da VPS já serve outros projetos. **Supabase self-hosted não
é multi-projeto:** um stack tem um `auth.users` e um `JWT_SECRET`. Um token
emitido para outro projeto é aceito pelo PostgREST da loja, com assinatura
válida e `auth.uid()` preenchido.

Foi apresentada a alternativa de subir um segundo stack na mesma VPS (~1,5–2 GB
de RAM, isolamento real). **A decisão foi compartilhar a instância existente.**

Quatro travas contêm usuário legítimo de outro projeto:

| Trava | O quê |
|---|---|
| Schema `canastra` | Nenhuma tabela da loja em `public`. Evita colisão de nome e permite conceder permissão por schema. |
| `canastra.clientes` | Uma linha por cliente da loja (`user_id` → `auth.users.id`), criada **só** no cadastro da loja. |
| `canastra.admins` | Papel de administrador nunca vem de claim no JWT — vem de linha nesta tabela. |
| Bucket `canastra-produtos` | Storage isolado, escrita só por `service_role`. |

**Regra inviolável de RLS:** nenhuma política usa `auth.uid() IS NOT NULL`
sozinho. Toda política de dono é
`EXISTS (SELECT 1 FROM canastra.clientes c WHERE c.user_id = auth.uid())` **e**
dono da linha. Um token de outro projeto autentica, mas não é cliente, e não
enxerga nada.

**Risco que permanece, aceito e registrado:** quem obtiver o `JWT_SECRET` ou a
`service_role key` da instância — por qualquer um dos projetos que a dividem —
compromete a loja junto. As travas contêm usuário; não contêm vazamento de
chave. Isto vai para `docs/producao.md` §4.

---

## 3. Dados

### 3.1 Migrações versionadas

`schema.sql` deixa de existir como arquivo único que só cria. Passa a
`backend/db/migrations/NNNN_descricao.sql`, aplicados por
`backend/db/migrar.js`: lê os arquivos em ordem, pula os já registrados em
`canastra.migracoes`, aplica cada um dentro de uma transação e registra.

Fecha o achado de `docs/producao.md:144` ("sem migrações versionadas: a próxima
mudança de coluna vai ser manual e sem histórico").

### 3.2 Destino de cada tabela

| Hoje (`public`) | Depois | RLS |
|---|---|---|
| `users` | `auth.users` (credencial, GoTrue) + `canastra.clientes` (perfil: nome, telefone, CPF) | dono lê/escreve o próprio |
| `refresh_tokens` | removida — GoTrue assume | — |
| `password_resets` | removida — GoTrue assume | — |
| — | `canastra.admins` (nova) | leitura só para quem já é admin |
| `products` | `canastra.produtos` | `SELECT` para `anon`; escrita para admin (via `canastra.admins`) e `service_role` |
| `product_options` | `canastra.produto_opcoes` | idem |
| `addresses` | `canastra.enderecos` | dono, via `clientes` |
| `carts` / `cart_items` | `canastra.carrinhos` / `canastra.carrinho_itens` | dono, via `clientes` |
| `orders` | `canastra.pedidos` | dono lê o próprio; admin lê todos e altera **só** `status`; criação e baixa de estoque só `service_role` |
| `promotions` | `canastra.promocoes` | `SELECT` público; escrita para admin e `service_role` |
| `store_config` | `canastra.config_loja` | `SELECT` público; escrita para admin e `service_role` |

O `SELECT` público de `produtos` expõe só as colunas do catálogo. Custo, margem
e qualquer campo interno ficam fora da política de `anon` — uma view
`canastra.produtos_publicos` define o recorte, e é ela que a `anon key` enxerga.

A separação em `pedidos` é deliberada: o painel muda status, mas quem cria
pedido e mexe em estoque é o serviço Node, dentro de transação (§7). Deixar o
painel criar pedido por PostgREST reabriria exatamente o achado de idempotência
que este trabalho fecha.

Os índices atuais são preservados, incluindo o `products_tsv_idx` (GIN sobre
`tsv`) que sustenta a busca.

### 3.3 Seed

`backend/db/seed.js` continua idempotente e continua casando produtos por UUID
v5 derivado do SKU. Duas mudanças:

- A conta inicial deixa de ser `INSERT` em `users`. Passa a ser: criar usuário
  pela Admin API do GoTrue (`POST /auth/v1/admin/users`, com `service_role`, já
  confirmado), depois inserir em `canastra.clientes` e `canastra.admins`.
- As URLs de imagem passam a apontar para o bucket do Storage, e `LOJA_URL`
  deixa de ser necessária para montar URL absoluta
  (`backend/src/.env.example:76-78`).

As travas de `ambiente.js` sobre `SEED_ADMIN_PASSWORD` (mínimo 12 caracteres,
recusa valores de exemplo) continuam valendo.

---

## 4. Autenticação

GoTrue assume e-mail+senha, confirmação de cadastro e recuperação de senha, com
SMTP apontando para o Resend, que o projeto já usa. A sessão no Next vem do
`@supabase/ssr`, em cookie first-party no domínio da loja.

**Morrem:** `loginRepository.js` (757 linhas), `resetPassword.routes.js`,
`login.routes.js`, `isAuthenticated.js`, `optionalAuthenticate.js`,
`validateAuth.js`, a dependência `bcrypt`, e as variáveis `JWT_SECRET` e
`JWT_SECRET_REFRESH` próprias.

Duas regras existentes não sobrevivem à troca sozinhas:

**Fusão da sacola no login.** `frontend/lib/sacola/sacola.tsx` guarda a sacola
anônima em `localStorage["cart"]`, e hoje o `signIn` do backend funde essa
sacola com a da conta. Sem esse `signIn`, a fusão passa a acontecer no cliente:
`onAuthStateChange` dispara a RPC `canastra.fundir_sacola(itens jsonb)`. Sem
isso, todo cliente que monta a sacola deslogado e depois entra perde os itens,
em silêncio — e a sacola é o caminho para a receita.

**Nunca ficar sem administrador.** Hoje é regra de aplicação
(`docs/producao.md:211`). Vira trigger `BEFORE DELETE` em `canastra.admins` que
recusa remover a última linha. Regra de banco não depende de qual cliente fez a
chamada.

---

## 5. Arquivos

Cloudinary sai. Bucket `canastra-produtos`: leitura pública, escrita só por
`service_role`.

O upload do painel passa pelo serviço Node, que valida tipo MIME e tamanho antes
de gravar. `multer` e `multer-storage-cloudinary` saem, e as variáveis
`CLOUDINARY_*` somem do `.env`.

As URLs em `canastra.produtos.image` passam a apontar para o Storage.

---

## 6. Catálogo na vitrine

O desenho de duas metades permanece intacto
(`frontend/lib/catalogo/repositorio.ts:4-20`):

- **Editorial** — linha, notas, torra, fotos, textos — em
  `data/catalogo-canastra.json`, versionado, revisado em pull request.
- **Comercial** — preço e estoque — no banco, editado pelo painel.

Só muda a origem do lado comercial: em vez de `GET /dashboard?limit=200` no
Express, é `supabase-js` com a `anon key`, chamado server-side, mantendo
`revalidate: 60`.

**O fallback para o JSON quando o banco não responde é requisito, não
detalhe.** É o que mantém a loja vendendo com preço de ontem em vez de não
abrir, e o checkout reconfere preço e estoque no servidor antes de cobrar.

---

## 7. O serviço Node

De ~4.400 para ~900 linhas. Fica só o que precisa de segredo ou de transação:

| Fica | Linhas | Por quê |
|---|---|---|
| `PaymentController.js` | 631 | `MP_ACCESS_TOKEN`, webhook, baixa de estoque |
| `ShippingController.js` | 116 | token da Melhor Envio; o navegador não pode ditar frete |
| `emailSender` + `mailer` + `remetente` | ~225 | e-mail de pedido e de status |
| `ambiente.js` | 141 | adaptado às variáveis novas |
| `index.js` | 217 | helmet, rate limit, `/health` |

**Sai:** `loginRepository`, os repositories e controllers de carrinho, endereço,
opções, promoções, config e dashboard, as rotas de login e reset, os middlewares
de autenticação, e o `multer`.

**Cinco endpoints:**

| Endpoint | Autenticação |
|---|---|
| `POST /api/checkout` | JWT do Supabase + `canastra.clientes` |
| `POST /api/webhook/mercadopago` | assinatura HMAC do MP (público por desenho) |
| `POST /api/frete` | opcional; recalcula sempre no servidor |
| `POST /api/admin/produtos/imagem` | JWT do Supabase + `canastra.admins` |
| `GET /health` | público |

**Acesso ao banco:** `pg` direto, não PostgREST. PostgREST não faz transação
multi-statement, e os dois achados mais urgentes da auditoria
(`docs/producao.md:137-141` — webhook sem transação nem idempotência, e cobrança
acontecendo antes de o pedido existir) só se resolvem com `BEGIN…COMMIT` e chave
de idempotência. `supabase-js` com `service_role` fica só para o Storage.

**Verificação de quem chama:** valida a assinatura do JWT do Supabase **e**
confere `canastra.clientes` / `canastra.admins`. Nunca confia só no `sub` do
token, pela razão da §2.2.

**Correções de auditoria incluídas neste serviço:**

- Webhook do MP passa a rodar dentro de transação, com idempotência por
  `payment_id_mp`, para que reentrega do MP não infle o estoque.
- O pedido passa a existir no banco **antes** da cobrança, com chave de
  idempotência, para que uma queda entre as duas coisas não deixe pagamento sem
  pedido.
- `PUT /promotions/:id` e `PUT /config` saíam com NULL nos campos ausentes e
  respondiam 200 sem checar `rowCount`. Esses endpoints deixam de existir: viram
  escrita via PostgREST com RLS de admin, onde `PATCH` é parcial por natureza.

**Dependências que saem:** `csurf` (arquivado; a API passa a exigir
`Authorization: Bearer` e a **recusar** autenticação por cookie, então CSRF
deixa de se aplicar), `axios` (advisory; `ShippingController` passa a `fetch`
nativo do Node), `bcrypt`, `multer`, `multer-storage-cloudinary`, `cloudinary`,
`cookie-parser`, `node-cron` (já não usado).

`jsonwebtoken` **fica**, mas muda de papel: deixa de emitir token e passa só a
verificar a assinatura dos tokens do GoTrue, com `algorithms` fixo — a mesma
trava já comentada em `isAuthenticated.js:8`.

---

## 8. O painel

**Descoberta que define o tamanho da obra:** dos 13.759 linhas em
`frontend/legacy/`, apenas **4.628 são o painel vivo**. O resto — Home, Cart,
Checkout, ProductPage, Login, SignUp, institucionais, Header, Footer, Banner —
é a vitrine antiga, já substituída pelo Next e inalcançável: `PainelApp.jsx`
monta exatamente 8 rotas e nada mais entra no grafo.

São **~4,6 mil linhas a reescrever e ~9,1 mil a apagar**.

As 8 telas, na ordem em que existem hoje:

| Rota atual | Tela |
|---|---|
| `/dashboard` | resumo |
| `/dashboard/products/addProduct` | cadastrar produto |
| `/dashboard/products/addedProducts` | produtos cadastrados |
| `/dashboard/orders` | pedidos |
| `/dashboard/clients/registeredClients` | clientes |
| `/dashboard/settings/updateShopInfo` | dados da loja |
| `/dashboard/settings/manageCategories` | categorias |
| `/dashboard/settings/offers` | ofertas e cupons |

O painel novo vive em `app/dashboard`, App Router, com os tokens de
`estetica.md`, sem styled-components, sem `react-router` e sem `react-toastify`.
Fala direto com o Supabase (`supabase-js` + RLS + `canastra.admins`). Só o
upload de imagem passa pelo serviço Node.

**Duas dívidas que morrem junto:**

- **O CSP fecha.** `unsafe-inline` e `unsafe-eval` no `script-src` existem só
  por causa do styled-components do painel legado — está escrito no comentário
  de `frontend/next.config.mjs`. Sem ele, o `script-src` fecha; `style-src`
  mantém `unsafe-inline` apenas se o Next exigir.
- **O guard vira server-side.** Hoje o bundle do painel é entregue a qualquer
  visitante e o guard é de cliente (`docs/producao.md:192`). No App Router o
  layout confere a sessão no servidor antes de renderizar.

---

## 9. Erros e degradação

| Falha | Comportamento exigido |
|---|---|
| Postgres fora | Vitrine serve o catálogo do JSON versionado, com preço possivelmente desatualizado, e continua vendendo. `/health` responde 503. |
| PostgREST fora | Igual ao acima. O painel mostra erro explícito, não tela em branco. |
| GoTrue fora | Vitrine navega anônima; login mostra erro explícito. Sacola anônima em `localStorage` continua funcionando. |
| Storage fora | Cards caem para imagem de placeholder; o cadastro de produto recusa upload com mensagem, sem perder o formulário. |
| Melhor Envio fora | O checkout **recusa fechar pedido**. Comportamento atual, mantido de propósito: sem reconferir frete, o valor viria do navegador. |
| Mercado Pago fora | Pedido fica registrado como pendente; o cliente vê erro e pode tentar de novo com a mesma chave de idempotência. |
| Webhook reentregue | Sem efeito: idempotência por `payment_id_mp` dentro da transação. |

---

## 10. Testes

O que existe hoje e precisa continuar valendo:

- `npm test` — 52 testes da vitrine (vitest).
- `npm --prefix backend test` — 15 testes das regras de pagamento (`node:test`).
- `npm run verifica` — 37 checagens num Chromium real
  (`frontend/scripts/verifica-fluxo.mjs`).

O que muda:

- **Testes de RLS são novos e obrigatórios.** Cada política ganha um teste que
  conecta via `pg`, faz `SET LOCAL ROLE authenticated` e
  `SET LOCAL "request.jwt.claims"`, e verifica o caso positivo e o negativo. O
  caso negativo que não pode faltar: **um `sub` válido que não está em
  `canastra.clientes` não enxerga nada.** É a trava da §2.2, e se ela falhar em
  silêncio o isolamento entre projetos desaparece.
- Os 15 testes de pagamento continuam, somando cobertura para transação e
  idempotência do webhook.
- Os testes que cobriam login/refresh/reset saem com o código que testavam; o
  fluxo passa a ser coberto pelo `verifica-fluxo.mjs` contra o GoTrue real.
- `verifica-fluxo.mjs` é atualizado: as 8 rotas administrativas passam a ser
  verificadas contra o painel novo, e o guard passa a ser verificado
  server-side (resposta HTTP, não estado de cliente).

---

## 11. Operação

- **Backup é responsabilidade nossa.** Supabase self-hosted não tem backup
  automático nem PITR. O runbook define `pg_dump` agendado com retenção, mais
  cópia do volume do Storage. Sem isso, a loja está a um disco de distância de
  perder tudo.
- **Variáveis do serviço Node:** entram `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`; saem `JWT_SECRET`,
  `JWT_SECRET_REFRESH`, `CLOUDINARY_*`, `LOJA_URL`. `ambiente.js` é atualizado
  para exigir as novas em produção com a mesma severidade.
- **Variáveis da vitrine:** entram `NEXT_PUBLIC_SUPABASE_URL` e
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `NEXT_PUBLIC_API_URL` passa a ser `/api`
  (mesma origem). A `service_role key` **nunca** entra no bundle.
- **`docs/producao.md` é reescrito** para a topologia nova, mantendo a seção
  "Em aberto" com o que sobrar.

---

## 12. Faseamento

Cada fase entrega valor sozinha e deixa a loja funcionando.

| Fase | Escopo | Fecha |
|---|---|---|
| **F1** | Schema `canastra`, runner de migrações, RLS, `clientes`/`admins`, seed adaptado, testes de RLS | migrações versionadas |
| **F2** | GoTrue: cadastro, login, confirmação, reset; `@supabase/ssr`; RPC `fundir_sacola`; remoção do auth próprio | — |
| **F3** | Bucket `canastra-produtos`, upload pelo serviço Node, saída do Cloudinary | — |
| **F4** | Vitrine e painel lendo catálogo direto do Supabase; `GET /dashboard` morre | — |
| **F5** | Serviço Node enxuto: 5 endpoints, transação e idempotência no webhook, saída de `csurf` e `axios` | 4 achados de auditoria |
| **F6** | Painel novo em App Router, 8 telas; apagar `frontend/legacy/`; fechar o CSP | 2 achados de auditoria |
| **F7** | Proxy reverso, backup, runbook, `verifica-fluxo.mjs` atualizado | — |

---

## 13. Fora de escopo

Declarado explicitamente para não voltar como surpresa:

- **Reescrita do histórico do Git.** Os dumps CSV saíram do repositório mas
  continuam recuperáveis em commits antigos (`docs/seguranca-dados-pessoais.md`).
  Exige `git filter-repo`, `push --force` e rotação de segredos — decisão de
  quem administra o repositório, não deste trabalho.
- **Pagamento com cartão.** O checkout continua só com Pix. Falta a camada de
  tokenização no navegador (`docs/producao.md:154-159`).
- **Trilha de auditoria** de quem mudou preço, estoque ou status de pedido.
- **Produção fotográfica** (`estetica.md` §8) e conferência dos preços marcados
  como `pesquisa-web`/`inferido` em `data/catalogo-canastra.json`.
- **Política de Privacidade e Termos de Uso**, que ainda atribuem a loja à
  Shopnaw.
- **Segundo stack Supabase para isolamento real.** Avaliado e recusado; o risco
  está registrado na §2.2.
