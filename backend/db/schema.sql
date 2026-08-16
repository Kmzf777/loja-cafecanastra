-- Schema do banco da loja.
--
-- POR QUE ESTE ARQUIVO EXISTE
-- `estrutura.sql` sempre esteve no .gitignore e nunca veio no repositorio, o que
-- deixou o projeto sem forma de subir um banco a partir do que esta versionado.
-- docs/superpowers/plans/baseline-painel.md registra o efeito disso: sem banco
-- nao ha login, sem login nao ha sessao de admin, e as 8 rotas de /dashboard
-- nunca puderam ser verificadas com dado real — so como grafo de modulos.
--
-- Este DDL foi reconstruido a partir de duas fontes que existem no repositorio:
--   1. Todo SQL executado pelo backend (backend/src/repositories/*.js e
--      controllers/*.js) — define quais colunas precisam existir e com que tipo
--      sao usadas (inclusive os casts ::uuid e ::integer).
--   2. Os dumps CSV na raiz do repositorio — definem a ordem das colunas e os
--      valores reais de dominio (ex.: `role` e 'client'/'admin', nao 'user').
--
-- Onde as duas fontes divergem, o SQL do backend vence: `users.cpf` nao aparece
-- em usuarios.csv, mas loginRepository.js faz INSERT e SELECT nessa coluna — o
-- dump e mais antigo que o codigo.
--
-- Idempotente: pode rodar novamente sem derrubar dado (tudo IF NOT EXISTS).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Contas ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id            uuid PRIMARY KEY,
  name               text NOT NULL,
  cpf                text UNIQUE,
  phone              text,
  email              text NOT NULL UNIQUE,
  password           text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- 'client' | 'admin'. O guard do painel (legacy/routes/AdminRoutes.jsx)
  -- exige role === 'admin' para qualquer rota sob /dashboard.
  role               text NOT NULL DEFAULT 'client',
  is_verified        boolean NOT NULL DEFAULT false,
  verification_token text
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_id   uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token      text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_token_idx ON refresh_tokens (token);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token      text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_token_idx ON password_resets (token);

CREATE TABLE IF NOT EXISTS addresses (
  address_id   uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  zip_code     text,
  street       text,
  number       text,
  complement   text,
  neighborhood text,
  city         text,
  state        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS addresses_user_idx ON addresses (user_id);

-- ── Catalogo ────────────────────────────────────────────────────────────────
-- `quantity` e `price` sao numericos apesar de o codigo aplicar ::integer em
-- alguns pontos (PaymentController.js, OrderController.js). O cast e inofensivo
-- sobre a coluna ja tipada e mantem o codigo legado funcionando sem edicao.
CREATE TABLE IF NOT EXISTS products (
  product_id  uuid PRIMARY KEY,
  name        text NOT NULL,
  -- Na loja de camisetas `size` era P/M/G. Aqui carrega o formato do cafe
  -- ("250 g", "Caixa 3x250 g", "Display 10 un"), que e o eixo de variacao real.
  size        text,
  category    text,
  price       numeric(10,2) NOT NULL DEFAULT 0,
  image       text,
  -- Coluna usada pelos filtros "novidades"/"antigos" do painel e pelo ORDER BY
  -- da listagem. Nome infeliz (e palavra reservada em varios bancos), mas o
  -- backend le e escreve exatamente isto — renomear quebraria 6 consultas.
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  quantity    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  description text,
  weight      numeric(10,3) NOT NULL DEFAULT 0.3,
  width       numeric(10,2) NOT NULL DEFAULT 20,
  height      numeric(10,2) NOT NULL DEFAULT 5,
  length      numeric(10,2) NOT NULL DEFAULT 20
);

-- Chave de negocio estavel do SKU, igual a `sku` em data/catalogo-canastra.json.
--
-- E o que costura a vitrine ao banco: a vitrine guarda a parte EDITORIAL do
-- catalogo (linha, notas, torra, fotos, texto) num arquivo versionado, e o
-- banco guarda a parte COMERCIAL (preco e estoque), que o admin edita no painel.
-- Sem uma chave comum, casar os dois so daria por nome — que muda com qualquer
-- correcao de texto e quebra a ligacao em silencio.
--
-- Nulavel porque produto cadastrado pela mao no painel nao tem SKU do catalogo.
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku text;
CREATE UNIQUE INDEX IF NOT EXISTS products_sku_idx ON products (sku)
  WHERE sku IS NOT NULL;

-- A busca do painel (dashboardRepository.js) consulta `tsv @@ to_tsquery(...)`.
-- Sem esta coluna, digitar qualquer termo na busca de produtos derruba a rota
-- com "column tsv does not exist". Coluna gerada: nao ha trigger para manter.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'portuguese',
      coalesce(name, '') || ' ' || coalesce(category, '') || ' ' ||
      coalesce(size, '') || ' ' || coalesce(description, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS products_tsv_idx ON products USING gin (tsv);
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category);
CREATE INDEX IF NOT EXISTS products_timestamp_idx ON products ("timestamp" DESC);

-- Valores de filtro do painel: linhas ('size') e categorias ('category').
CREATE TABLE IF NOT EXISTS product_options (
  id    uuid PRIMARY KEY,
  type  text NOT NULL,
  value text NOT NULL,
  UNIQUE (type, value)
);

-- ── Carrinho ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carts (
  cart_id    uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carts_user_idx ON carts (user_id);

-- Sem FK para products: cartRepository.js compara product_id::text = p.product_id::text
-- num LEFT JOIN, ou seja, ja assume que o produto pode ter sido removido do
-- catalogo enquanto o item continua no carrinho. `name`/`price`/`image` sao
-- copias no momento da adicao, deliberadamente desnormalizadas.
CREATE TABLE IF NOT EXISTS cart_items (
  id         uuid PRIMARY KEY,
  cart_id    uuid NOT NULL REFERENCES carts(cart_id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  quantity   integer NOT NULL DEFAULT 1,
  price      numeric(10,2) NOT NULL DEFAULT 0,
  name       text,
  image      text,
  size       text
);
CREATE INDEX IF NOT EXISTS cart_items_cart_idx ON cart_items (cart_id);

-- ── Pedidos ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  order_id        uuid PRIMARY KEY,
  user_id         uuid REFERENCES users(user_id) ON DELETE CASCADE,
  total_amount    numeric(10,2) NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending',
  payment_method  text,
  payment_id_mp   text,
  items           jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  address_json    jsonb,
  shipping_cost   numeric(10,2) NOT NULL DEFAULT 0,
  shipping_method text,
  tracking_code   text
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_mp_idx ON orders (payment_id_mp);

-- ── Promocoes e configuracao da loja ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promotions (
  id          uuid PRIMARY KEY,
  title       text NOT NULL,
  description text,
  type        text,
  value       numeric(10,2),
  applies_to  text,
  category    text,
  product_id  uuid,
  start_date  timestamptz,
  end_date    timestamptz,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- configRepository.js atualiza "a" linha unica via
-- WHERE id = (SELECT id FROM store_config LIMIT 1) — e uma tabela de 1 linha.
-- store_config.csv mostra id = 1, entao a chave e inteira, nao uuid.
CREATE TABLE IF NOT EXISTS store_config (
  id               integer PRIMARY KEY,
  banner_desktop   text,
  banner_mobile    text,
  site_title       text,
  whatsapp_number  text,
  announcement_bar text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
