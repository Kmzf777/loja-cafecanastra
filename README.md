# Café Canastra — o site oficial e a loja

**Site oficial e loja do Café Canastra, na mesma aplicação e em três idiomas.**
Vitrine em Next 15, autenticação e dados no **Supabase** (GoTrue + PostgREST +
PostgreSQL) e um serviço Express para pagamento, webhook, frete, e-mail, ERP e
assinatura. Café de origem única da Serra da Canastra, em Minas Gerais.

> Até agosto de 2026 a marca tinha **dois sites**: este, que vendia e não
> contava a história, e `cafecanastra.com`, um Next separado que contava a
> história em português, inglês e espanhol e não vendia. Quem chegava pela
> marca não achava a loja; quem chegava pela loja não achava a marca; e quem
> chegava de fora do Brasil — para onde a família exporta desde 1996 — não lia
> nem uma coisa nem outra. **Os dois viraram um.** A história, a serra, a
> rastreabilidade, os termos e a política moram aqui, ao lado do catálogo.

### Os três idiomas, e a fronteira deles

Português, inglês e espanhol. **As URLs em português não mudaram**: `pt` é o
padrão e não aparece no endereço — o middleware faz um *rewrite* interno de
`/cafes` para `/pt/cafes`, então nenhum link, nenhum backlink e nenhuma entrada
de sitemap existente quebrou. `/en/cafes` e `/es/cafes` são reais e têm
`hreflang` completo e recíproco.

**Traduzido:** home, catálogo (PLP e PDP, com o editorial dos cinco cafés),
`/clube`, `/a-serra`, `/historia`, `/bio`, `/rastreabilidade`, termos,
privacidade, cabeçalho e rodapé.

**Não traduzido, e isto é decisão do cliente, não pendência:** sacola,
checkout, conta, `/pedido/[id]`, e-mails e painel. O frete é Melhor Envio (só
Brasil) e o pagamento é Mercado Pago BR — traduzir o checkout sem resolver esses
dois seria prometer uma compra que a loja não consegue entregar. Em `en` e `es`
uma faixa acima do conteúdo avisa isso antes, em vez de deixar a pessoa
descobrir no meio do pagamento. Essas rotas vivem fora do `[locale]`, em
`app/(transacional)/`, e por isso `/en/checkout` nem existe (é 308 para
`/checkout`).

> Este repositório nasceu de um fork do **Shopnaw Store** (loja de camisetas) e
> foi convertido. O painel já não fala de camiseta em tela nenhuma; o que sobrou
> daquele projeto são componentes da vitrine antiga dentro de `frontend/legacy/`
> que ninguém mais renderiza, mais comentários que registram a herança de
> propósito. A conversão está documentada em `docs/`.

> **A loja vende de ponta a ponta.** O catálogo da vitrine lê preço e estoque do
> banco, a sacola sobrevive ao login, o checkout fecha por Pix ou cartão, o
> pedido nasce em `canastra.pedidos` com chave de idempotência, o webhook do
> Mercado Pago é transacional e o cliente recebe e-mail a cada mudança de
> status. Nada disso depende de deploy para mudar preço.
>
> **Nada disso foi aplicado na VPS ainda**, e o que separa o repositório da loja
> aberta é credencial, acesso ao servidor e decisão comercial — a lista está em
> **`docs/go-live.md`**. O que ainda falta *em código* (o painel continua sendo a
> ilha legada, as imagens continuam no Cloudinary, não há trilha de auditoria)
> está em `docs/producao.md` §1.1 e §10.

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

### O que sobe desligado, e o que cada chave liga

**Toda integração externa nasce desligada.** Variável vazia nunca derruba a
subida do processo — o recurso apenas não aparece. É deliberado: dá para ir ao
ar com o essencial e ligar o resto em etapas. Cada arquivo `.env.example`
explica variável por variável; o resumo é este:

| Recurso | Liga com | Desligado |
|---|---|---|
| **Cartão de crédito** | `NEXT_PUBLIC_MP_PUBLIC_KEY` (frontend) | o checkout vende **só por Pix** e o radio "Cartão" nem aparece — sem a chave não há como tokenizar, e botão que não tokeniza é botão que não faz nada |
| **Bling (ERP e NF-e)** | `BLING_ATIVO=true` + `BLING_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN` | pedido aprovado não vira pedido de venda, nenhuma nota sai, e as rotas `/bling/*` do painel recusam agir |
| **NF-e automática** | `BLING_NFE_AUTO=true` | a nota sai pelo botão do painel, não junto da sincronização |
| **Rastreio de hora em hora** | `BLING_RASTREIO_CRON=true` (exige `BLING_ATIVO`) | o rastreio volta só quando alguém clica no painel |
| **Carrinho abandonado** | `ABANDONO_ATIVO=true` | ninguém recebe lembrete de sacola parada; sem a variável o `node-cron` nem é carregado |
| **Medição (GA4)** | `NEXT_PUBLIC_GA4_ID` | o `gtag.js` não entra na página. Mesmo com o ID, o script só carrega **depois** que o visitante aceita no banner de cookies |
| **WhatsApp** | `NEXT_PUBLIC_WHATSAPP` | nem o botão flutuante nem o link do rodapé aparecem |
| **Clube (assinatura)** | `WEBHOOK_URL` pública (reusa `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET`) | o preapproval nasce sem `notification_url` e a cobrança recorrente **não vira pedido** |

---

## Verificação

```bash
npm --prefix backend test   # 398 testes: pagamento, banco (RLS, migrações, RPCs),
                            # cupons, Bling, LGPD, avaliações e Clube.
                            # Sobe um PostgreSQL temporário POR ARQUIVO — sem
                            # disco livre o initdb falha e ~175 testes caem em
                            # bloco. É a máquina, não o código
npm test                    # 579 testes da vitrine (vitest, 42 arquivos)
npm run verifica:rls        # a fronteira de RLS contra uma instância Supabase real
npm run verifica            # 37 checagens num Chromium (exige tudo no ar)
```

`npm run verifica:rls` é o único que sai da máquina: ele prova o **caminho**
(GoTrue → Kong → PostgREST → política), e não só a política. Degrada sozinho —
sem contas de teste roda a metade anônima. Leia `docs/producao.md` §8.1 antes,
porque ele **escreve** no banco para o qual você apontá-lo.

`npm run verifica` é fumaça ponta a ponta contra a loja de verdade: guard do
painel, login pelo GoTrue, as rotas do painel, os 29 SKUs, PLP, PDP, sacola e
checkout. Exige backend, Next e banco no ar ao mesmo tempo, e o caminho do
Chromium está fixo no script (`frontend/scripts/verifica-fluxo.mjs`) — ajuste-o
para a sua máquina. Ele **não** cobre as superfícies mais novas: cupom, cartão,
Clube, avaliações e `/pedido/[id]` só têm cobertura nas suítes acima.

---

## Onde fica o quê

```
data/catalogo-canastra.json   catálogo real, com procedência por SKU
                              — fonte única da vitrine E do seed do banco
data/catalogo-canastra.i18n.json   o editorial das cinco linhas em en e es,
                              indexado por slug. Preço, estoque e SKU NÃO
                              entram: são o mesmo número nos três idiomas

backend/
  db/migrations/              migrações versionadas do schema `canastra` (0001–0016)
  db/migrar.js                aplica as pendentes, em ordem e em transação
  db/seed.js                  popula catálogo, filtros, config e conta inicial
  db/instalacao-completa.sql  o mesmo banco de uma vez só, para o editor SQL
  scripts/verifica-rls.mjs    a fronteira de RLS sondada de fora, pela API
  src/controllers/            pagamento e webhook, pedidos, frete, config,
                              cupons, painel, Clube
  src/repositories/           acesso ao banco — todos falam `canastra.*` (F4)
  src/services/               cliente OAuth do Bling e a sincronização de
                              pedido de venda, NF-e e rastreio
  src/jobs/                   cron do carrinho abandonado (desligado por padrão)
  src/middleware/             verificação do token do GoTrue, vínculo, upload
  src/utils/                  status de pedido, cupom, estoque, CSV, e-mail

frontend/
  app/[locale]/(vitrine)/     a metade TRADUZIDA: home, cafés, PDP, clube,
                              a serra, história, bio, rastreabilidade, termos
                              e política. `[locale]` é pt | en | es
  app/(transacional)/         o caminho de compra, pt-BR nos três idiomas:
                              sacola, checkout, account, pedido/[id]. Fora do
                              `[locale]` de propósito — ver "os três idiomas"
  app/moldura-da-loja.tsx     cabeçalho, rodapé, grão e sacola. Componente, e
                              não layout, porque os dois grupos acima são
                              irmãos em níveis diferentes (a nota está lá)
  app/dashboard/              painel admin (ilha client-only sobre legacy/)
  app/sitemap.ts robots.ts    SEO técnico; ícones ficam ao lado. O sitemap sai
                              das MESMAS funções que geram o hreflang das
                              páginas — 42 URLs, rota × idioma
  lib/i18n/                   os três idiomas: tipos, o dicionário tipado (o
                              `pt` é a fonte do tipo, e o build quebra se
                              faltar chave em `en` ou `es`) e o `href()` por
                              onde TODO link da vitrine passa
  lib/supabase/               clientes do navegador e do servidor, tipos, ambiente
  lib/catalogo/               contrato do catálogo, a fusão do comercial ao vivo
                              e a fusão do editorial traduzido
  lib/sacola/                 sacola, checkout, cartão, cupom, idempotência e a
                              fusão da sacola no login
  lib/avaliacoes/             leitura, envio e moderação de avaliação
  lib/clube.ts                planos, frequências e preço do Clube
  lib/conta/                  sessão, cadastro e senha (GoTrue)
  lib/seo/                    JSON-LD de Product/Offer e aggregateRating
  components/layout/          moldura: cabeçalho, rodapé, seletor de idioma,
                              banner de cookies, newsletter
  components/catalogo/        card, painel de compra, selo SCA, ficha, avaliações
  components/blog/            a seção "Em breve" da home (casca desenhada e
                              vazia por decisão — não existe rota /blog)
  middleware.ts               o rewrite de idioma E a renovação da sessão do
                              GoTrue (NÃO guarda rota — quem protege a conta é
                              a RLS)
  legacy/                     código do projeto original, ainda em uso no painel

deploy/
  docker-compose.prod.yml     API + vitrine + nginx
  ecosystem.config.cjs        PM2 (instances: 1 — ver Bling, abaixo)
  nginx/loja.conf             vitrine e API na MESMA origem, sob /api/*
.github/workflows/ci.yml      as duas suítes + o build de produção, a cada push

scripts/
  backup-banco.sh             pg_dump com verificação do dump e retenção
  backup-banco.cron.exemplo   agendamento de exemplo
  reescrever-historico.sh     remove os CSVs de dado pessoal do histórico do Git
                              — pronto e NUNCA executado (docs/go-live.md §6)

docs/
  go-live.md                  o que ainda depende de gente, não de código —
                              inclusive a DECISÃO DE DOMÍNIO, que trava o mapa
                              de redirects dos dois sites antigos
  deploy.md                   subir na VPS do zero: Docker ou PM2, nginx, TLS
  bling.md                    runbook do ERP: app, escopos, SKUs, fiscal
  producao.md                 as armadilhas que quebram em silêncio
  performance-dev.md          por que `next dev` demora NESTA máquina: cada
                              hipótese medida, com o custo de corrigir e o que
                              não vale corrigir
  seguranca-dados-pessoais.md dado pessoal removido e o que falta fazer
  superpowers/                specs e planos das ondas de trabalho
estetica.md                   direção de arte e design system
```

### As duas metades do catálogo

O catálogo é dividido de propósito:

- **Editorial** — linha, notas, ponto de torra, fotos, textos. Vive em
  `data/catalogo-canastra.json`, versionado e revisado em pull request.
- **Comercial** — preço e estoque. Vive no banco e é editado pelo painel.

A costura é o `sku`, e ela **está ligada**: mudar o preço no painel muda a
vitrine em até um minuto, sem deploy. Se a API cair, a vitrine continua de pé
com o JSON — loja fechada é pior que preço de ontem, e o checkout reconfere
tudo no servidor antes de cobrar.

---

## Antes de ir para produção

Leia, nesta ordem:

1. **`docs/go-live.md`** — o que falta e quem faz. Credenciais, os passos
   manuais que falham sem erro nenhum, o catálogo que precisa de decisão
   comercial, o backup, a reescrita do histórico do Git e a **decisão de
   domínio** — se o site único atende em `cafecanastra.com` ou em
   `loja.cafecanastra.com`. O código é agnóstico, mas **o mapa de redirects
   301 dos dois sites antigos não pode ser escrito antes dessa decisão**, e
   sem ele a fusão custa a autoridade orgânica que a marca acumulou.
2. **`docs/deploy.md`** — como subir na VPS, do zero, por Docker ou por PM2.
3. **`docs/bling.md`** — o runbook do ERP, se for ligar a NF-e.
4. **`docs/producao.md`** — as armadilhas, seção por seção. É o que se lê às 2h
   da manhã, e tem uma tabela de sintoma → causa.

O que mais custa tempo, em resumo:

- `SUPABASE_JWT_SECRET` é **condicional**, e depende de como a instância assina.
  Instância em **HS256** (stack self-hosted padrão): a variável é obrigatória e
  precisa ser **idêntica** ao `JWT_SECRET` de lá — um caractere diferente e
  **todo** cliente recebe 403, com `[auth:assinatura-hs256] invalid signature` no
  log. Instância com **chaves de assinatura** ES256/RS256 (Supabase hospedado já
  migrado): deixe **vazia** — a chave pública vem do JWKS. Vazia **e** sem chave
  no JWKS, a API recusa subir. `docs/producao.md` §3.1.
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são obrigatórias. Em produção a
  API **recusa subir** sem elas.
- Troque `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` antes do seed.
- Faça os três ajustes do GoTrue (`docs/producao.md` §3.5) — sem eles o cadastro
  quebra em silêncio.
- Configure `MP_WEBHOOK_SECRET`: sem ele o webhook é recusado e nenhum pedido
  sai de "pendente".
- Verifique o domínio de e-mail no Resend, senão nenhum e-mail é entregue.
- **Um processo só.** O refresh token do Bling é rotativo e fica gravado no
  banco; duas instâncias renovando invalidam o token uma da outra. O
  `deploy/ecosystem.config.cjs` já fixa `instances: 1` (`docs/bling.md`).
- Resolva o histórico do Git (`docs/seguranca-dados-pessoais.md` e
  `docs/go-live.md` §6). O script existe e **nunca foi executado**.
- **Decida o domínio** e só então monte os redirects 301 (`docs/go-live.md`
  §10). É a decisão que trava mais coisa depois dela.

A instância Supabase é **compartilhada com outros projetos da VPS**, e
self-hosted não é multi-projeto: um `auth.users` e um segredo de JWT para todos.
O que separa esta loja é o schema `canastra` e a exigência de linha em
`canastra.clientes` em toda política — nunca um claim do token. Ser
administrador é linha em `canastra.admins`. Ver `docs/producao.md` §9.

---

## Stack

**Frontend** Next 15 · React 18 · Tailwind 4 · TypeScript · Vitest
**Dados e conta** Supabase self-hosted: PostgreSQL 16 · GoTrue · PostgREST · RLS
**Serviço Node** Express · Mercado Pago (checkout e preapproval) · Melhor Envio ·
Bling API v3 · Cloudinary · Resend
**Deploy** Docker Compose ou PM2, nginx de mesma origem, backup por `pg_dump`
