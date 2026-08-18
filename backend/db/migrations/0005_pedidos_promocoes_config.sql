-- Pedidos, promocoes e configuracao da loja.

-- ON DELETE SET NULL, e nao CASCADE — a UNICA excecao entre as chaves
-- estrangeiras que apontam para `clientes`. Apagar um cliente (pedido de
-- exclusao de dados, engano do operador) nao pode apagar a VENDA: faturamento e
-- contabilidade dependem dela.
--
-- E por isso que `user_id` aqui e NULAVEL enquanto `enderecos.user_id` e NOT
-- NULL: ON DELETE SET NULL contra uma coluna NOT NULL nao e configuracao valida
-- — o DELETE do cliente estouraria com 23502 e a exclusao ficaria impossivel.
-- As duas colunas sao coerentes justamente por serem diferentes.
--
-- O TROCO, que a migracao de politicas precisa saber: com `user_id` NULL, uma
-- politica de dono do tipo `USING (user_id = auth.uid())` avalia NULL, que nao e
-- TRUE. O pedido orfao fica invisivel para todo cliente — desfecho certo,
-- ninguem herda a compra de outro —, mas o painel do admin NAO pode depender
-- dessa mesma politica para listar o historico.
CREATE TABLE canastra.pedidos (
  pedido_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,
  total              numeric(10,2) NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'pendente',
  metodo_pagamento   text,
  pagamento_id_mp    text,
  -- Enviada pelo navegador no checkout. Duas tentativas do mesmo clique tem a
  -- mesma chave, entao a segunda esbarra no indice em vez de criar outro pedido.
  chave_idempotencia text,
  itens              jsonb,
  endereco_json      jsonb,
  frete              numeric(10,2) NOT NULL DEFAULT 0,
  metodo_envio       text,
  codigo_rastreio    text,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pedidos_cliente_idx ON canastra.pedidos (user_id);
CREATE INDEX pedidos_criado_idx  ON canastra.pedidos (criado_em DESC);

/**
 * As duas defesas de idempotencia, no banco e nao no codigo.
 *
 * A auditoria registrou dois furos: o webhook do MP nao era idempotente, e o MP
 * reenvia notificacao por desenho — reentrega podia inflar estoque; e a cobranca
 * acontecia antes de o pedido existir, sem chave, entao uma queda no meio
 * deixava pagamento sem pedido.
 *
 * Indices PARCIAIS (WHERE ... IS NOT NULL) porque o pedido nasce sem id do MP e
 * pedido antigo pode nao ter chave. Um indice total recusaria o segundo pedido
 * pendente da loja inteira.
 */
CREATE UNIQUE INDEX pedidos_pagamento_mp_idx
  ON canastra.pedidos (pagamento_id_mp)
  WHERE pagamento_id_mp IS NOT NULL;

CREATE UNIQUE INDEX pedidos_idempotencia_idx
  ON canastra.pedidos (chave_idempotencia)
  WHERE chave_idempotencia IS NOT NULL;

CREATE TABLE canastra.promocoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      text NOT NULL,
  descricao   text,
  tipo        text,
  valor       numeric(10,2),
  aplica_a    text,
  categoria   text,
  produto_id  uuid,
  inicio_em   timestamptz,
  fim_em      timestamptz,
  ativa       boolean NOT NULL DEFAULT true,
  criada_em   timestamptz NOT NULL DEFAULT now()
);

-- Tabela de uma linha so. O codigo antigo garantia isso por convencao
-- (`WHERE id = (SELECT id FROM store_config LIMIT 1)`); aqui o CHECK garante.
--
-- Sao DOIS guardas, por portas diferentes, e quem tratar o erro no painel
-- precisa esperar os dois SQLSTATEs: um INSERT com id explicito diferente de 1
-- bate no CHECK (23514, citando `config_loja_linha_unica`), e o caminho comum —
-- INSERT sem citar `id` — pega o DEFAULT 1, passa pelo CHECK e bate na chave
-- primaria (23505, citando `config_loja_pkey`). Medido em test/pedidos.test.js.
CREATE TABLE canastra.config_loja (
  id                integer PRIMARY KEY DEFAULT 1
                      CONSTRAINT config_loja_linha_unica CHECK (id = 1),
  banner_desktop    text,
  banner_mobile     text,
  titulo_site       text,
  whatsapp          text,
  barra_de_aviso    text,
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);

-- Regra de 0001: nada nasce legivel por `anon`, quem for publico leva GRANT
-- proprio. A vitrine mostra o banner e a barra de aviso (`config_loja`) e as
-- promocoes ativas antes de qualquer login, entao essas duas levam. `pedidos`
-- NAO entra aqui e nao pode entrar: guarda endereco de entrega e itens
-- comprados de cada cliente.
GRANT SELECT ON canastra.promocoes  TO anon;
GRANT SELECT ON canastra.config_loja TO anon;

-- Chave geral fechada, ainda sem politica nenhuma — mesmo motivo de 0002, e vale
-- inclusive para as duas publicas: GRANT e permissao de TABELA, a RLS decide a
-- LINHA, e ate a migracao de politicas chegar ela nega tudo. Um deploy que pare
-- no meio deixa a vitrine sem banner e sem promocao — visivel e inofensivo — em
-- vez de deixar `pedidos` servido pelo PostgREST a quem pedir.
ALTER TABLE canastra.pedidos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.config_loja ENABLE ROW LEVEL SECURITY;
