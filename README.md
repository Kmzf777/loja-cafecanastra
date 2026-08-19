# Café Canastra — loja

Loja do Café Canastra: vitrine em Next 15, autenticação e dados no **Supabase**
(GoTrue + PostgREST + PostgreSQL) e um serviço Express para pagamento, webhook,
frete e e-mail. Café de origem única da Serra da Canastra, em Minas Gerais.

> Este repositório nasceu de um fork do **Shopnaw Store** (loja de camisetas) e
> foi convertido. Onde o código ainda fala de camiseta, é herança daquele
> projeto — a conversão é progressiva e está documentada em `docs/`.

> **A migração para o Supabase está no meio do caminho.** F1 (schema) e F2
> (autenticação) estão prontas; o catálogo do painel e a sacola ainda não leem o
> banco novo, então **a vitrine mostra preço e estoque do JSON versionado e o
> painel entra e não mostra dado nenhum**. Isso é esperado, está explicado em
> `docs/producao.md` §1.1, e fecha na F4.

---

## Como subir

Precisa de Node 22+ e de uma instância Supabase (self-hosted ou hospedada) —
não basta um PostgreSQL solto: o cadastro, o login e a confirmação de e-mail são
do GoTrue.

```bash
# 1. dependências
npm --prefix backend install
npm --prefix frontend install

# 2. configuração — os DOIS lados
cp backend/src/.env.example backend/src/.env      # DATABASE_URL, SUPABASE_*
cp frontend/.env.example   frontend/.env.local    # NEXT_PUBLIC_SUPABASE_*

# 3. banco: aplica as migrações e popula o catálogo real
npm run db:setup

# 4. os dois processos, em terminais separados
npm run dev:api    # Express  em :3333
npm run dev:web    # Next     em :3000
```

Entre em <http://localhost:3000>. O painel fica em `/dashboard`; entre com a
conta de `SEED_ADMIN_EMAIL`, que o `db:seed` cria **no GoTrue** já confirmada e
liga à loja com uma linha em `canastra.clientes` e outra em `canastra.admins`.
Ela vem em branco no `.env.example` de propósito — escolha as suas.

**Antes do primeiro cadastro pelo formulário**, três ajustes no painel do
Supabase que nada em código faz e cuja falta é muda: allow-list de
redirecionamento, modelos de e-mail com `{{ .TokenHash }}` e SMTP. Estão em
`docs/producao.md` §3.5, com o sintoma de cada um.

**Precisa do schema exposto ao PostgREST:** `PGRST_DB_SCHEMAS` tem de incluir
`canastra`, senão toda rota da loja responde 404 com o banco perfeitamente
instalado (`docs/producao.md` §3.3).

---

## Verificação

```bash
npm test                    # 185 testes da vitrine (vitest)
npm --prefix backend test   # 174 testes: pagamento + banco (RLS, migrações, RPCs)
npm run verifica:rls        # a fronteira de RLS contra uma instância Supabase real
```

`npm run verifica:rls` é o único que sai da máquina: ele prova o **caminho**
(GoTrue → Kong → PostgREST → política), e não só a política. Degrada sozinho —
sem contas de teste roda a metade anônima. Leia `docs/producao.md` §8.1 antes,
porque ele **escreve** no banco para o qual você apontá-lo.

`npm run verifica` (37 checagens num Chromium) cobre a loja **antiga** e boa
parte dele já não vale: ele exerce o login do Express e as rotas de carrinho,
que a F2 apagou. Volta a valer na F7, quando for reescrito.

---

## Onde fica o quê

```
data/catalogo-canastra.json   catálogo real, com procedência por SKU
                              — fonte única da vitrine E do seed do banco

backend/
  db/migrations/              migrações versionadas do schema `canastra`
  db/migrar.js                aplica as pendentes, em ordem e em transação
  db/seed.js                  popula catálogo, filtros, config e conta inicial
  scripts/verifica-rls.mjs    a fronteira de RLS sondada de fora, pela API
  src/controllers/            pagamento, pedidos, frete, config
  src/repositories/           acesso ao banco — MORTOS: consultam as tabelas
                              antigas em inglês, que as migrações não criam (F4)
  src/middleware/             verificação do token do GoTrue, vínculo, upload

frontend/
  app/(vitrine)/              a loja: home, cafés, PDP, sacola, checkout, conta
  app/dashboard/              painel admin (ilha client-only sobre legacy/)
  lib/supabase/               clientes do navegador e do servidor, tipos, ambiente
  lib/catalogo/               contrato do catálogo e leitura de preço/estoque
  lib/sacola/                 sacola, checkout e a fusão da sacola no login
  lib/conta/                  sessão (GoTrue)
  middleware.ts               renova a sessão do GoTrue (NÃO guarda rota — quem
                              protege a conta é a RLS)
  legacy/                     código do projeto original, ainda em uso no painel

docs/
  producao.md                 como colocar no ar, e o que está em aberto
  seguranca-dados-pessoais.md dado pessoal removido e o que falta fazer
estetica.md                   direção de arte e design system
```

### As duas metades do catálogo

O catálogo é dividido de propósito:

- **Editorial** — linha, notas, ponto de torra, fotos, textos. Vive em
  `data/catalogo-canastra.json`, versionado e revisado em pull request.
- **Comercial** — preço e estoque. Vive no banco e é editado pelo painel.

A costura é o `sku`. Quando as duas metades estão ligadas, mudar o preço no
painel muda a vitrine em até um minuto, sem deploy. Se a API cair, a vitrine
continua de pé com o JSON — loja fechada é pior que preço de ontem, e o checkout
reconfere tudo no servidor antes de cobrar.

**Hoje elas NÃO estão ligadas**, e é a degradação acima que está no ar: o
endpoint que traz preço e estoque do banco consulta tabelas que as migrações não
criam, então a vitrine mostra o JSON. Vale para o painel também. Fecha na F4 —
`docs/producao.md` §1.1.

---

## Antes de ir para produção

Leia **`docs/producao.md`**. Em resumo:

- `SUPABASE_JWT_SECRET` precisa ser **idêntico** ao `JWT_SECRET` da instância —
  é com ele que o GoTrue assina. Um caractere diferente e **todo** cliente recebe
  403, com nada no log além de `invalid signature`.
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são obrigatórias. Em produção a
  API **recusa subir** sem elas.
- Troque `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` antes do seed.
- Faça os três ajustes do GoTrue (`docs/producao.md` §3.5) — sem eles o cadastro
  quebra em silêncio.
- Configure `MP_WEBHOOK_SECRET`: sem ele o webhook é recusado e nenhum pedido
  sai de "pendente".
- Verifique o domínio de e-mail no Resend, senão nenhum e-mail é entregue.
- Resolva o histórico do Git (`docs/seguranca-dados-pessoais.md`).

A instância Supabase é **compartilhada com outros projetos da VPS**, e
self-hosted não é multi-projeto: um `auth.users` e um segredo de JWT para todos.
O que separa esta loja é o schema `canastra` e a exigência de linha em
`canastra.clientes` em toda política — nunca um claim do token. Ser
administrador é linha em `canastra.admins`. Ver `docs/producao.md` §9.

---

## Stack

**Frontend** Next 15 · React 18 · Tailwind 4 · TypeScript · Vitest
**Dados e conta** Supabase self-hosted: PostgreSQL 16 · GoTrue · PostgREST · RLS
**Serviço Node** Express · Mercado Pago · Melhor Envio · Cloudinary · Resend
