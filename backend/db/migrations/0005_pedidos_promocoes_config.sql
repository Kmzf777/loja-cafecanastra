-- Pedidos, promocoes e configuracao da loja.

-- ON DELETE SET NULL, e nao CASCADE — a UNICA excecao entre as chaves
-- estrangeiras que apontam para `clientes`. O que isto preserva e a VENDA:
-- apagada a linha do cliente, o pedido continua existindo com seu total, sua
-- data e seus itens, porque faturamento e contabilidade dependem dele. CASCADE
-- destruiria a venda; RESTRICT tornaria impossivel apagar o cliente.
--
-- ISTO NAO E, POR SI, UM CAMINHO DE APAGAMENTO DE DADOS PESSOAIS — e foi medido
-- que nao e. Depois de apagar o cliente, o pedido guarda:
--
--   endereco_json -> {"nome": "Ana Silva", "cpf": "...", "rua": "R. X 99", ...}
--   itens         -> o que a pessoa comprou
--
-- ou seja, nome, CPF e endereco sobrevivem intactos. Atender de verdade a um
-- pedido de exclusao (LGPD art. 18; ver docs/seguranca-dados-pessoais.md) exige
-- um passo A MAIS que este schema ainda nao tem: redigir `endereco_json` e
-- `itens`, preservando so o que a obrigacao fiscal manda guardar. Esse passo e
-- de uma tarefa posterior e esta anotado aqui para nao se perder — quem ler este
-- arquivo procurando "como a loja apaga os dados de alguem" precisa sair sabendo
-- que a resposta NAO e "apagando o cliente".
--
-- E por isso que `user_id` aqui e NULAVEL enquanto `enderecos.user_id` e NOT
-- NULL: o Postgres ACEITA declarar ON DELETE SET NULL numa coluna NOT NULL — o
-- DDL nao reclama —, e a incompatibilidade so aparece no DELETE do cliente, que
-- estoura com 23502 e deixa a exclusao impossivel. Ou seja, seria uma armadilha
-- que so dispara em producao, no dia do primeiro pedido de exclusao. As duas
-- colunas sao coerentes justamente por serem diferentes.
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
  -- TEXTO LIVRE, sem CHECK e sem enum, e isto e uma decisao ADIADA e nao tomada:
  -- 'pendnete' entra calado e some de todo filtro que procure 'pendente'. A
  -- tarefa que escrever as transicoes de status (0010) e quem tem a lista dos
  -- valores validos e deve decidir explicitamente entre um CHECK, um enum ou
  -- deixar livre de proposito. Nao herde este `text` por inercia.
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
  -- MANTIDA POR QUEM ESCREVE, nao por trigger. Nao existe trigger de
  -- `moddatetime` neste schema (o unico gatilho nao-interno e o
  -- `admins_nunca_zero` de 0002), entao esta coluna fica IGUAL a `criado_em` para
  -- sempre a menos que cada UPDATE inclua `atualizado_em = now()` — e um valor
  -- que parece uma data de alteracao e nao e engana mais do que ajuda.
  --
  -- Ficou assim de proposito, para nao introduzir uma funcao de trigger nova sem
  -- que a tarefa dona da escrita a tenha pedido. A regra, entao, e explicita:
  -- TODO UPDATE nesta tabela, no checkout, no webhook do MP e no painel, escreve
  -- `atualizado_em = now()` junto. Vale igual para `enderecos` e `carrinhos` em
  -- 0004 — a RPC de fusao da sacola (0007) e o caso mais obvio.
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

-- E a escrita fecha, pelo mesmo motivo detalhado em 0003 (bloco do REVOKE): o
-- `arwd` que 0001 concede por padrao a `authenticated` esta inerte hoje so porque
-- a RLS ainda nao tem politica, e a primeira politica ampla demais na migracao
-- seguinte o acorda. Aqui o dano seria banner e barra de aviso da loja
-- reescritos, ou promocao criada, por um token de outro projeto da instancia
-- compartilhada. Preco e promocao sao coisa do painel, que fala pelo
-- `service_role` — nenhum cliente tem o que escrever nestas duas.
REVOKE INSERT, UPDATE, DELETE ON canastra.promocoes, canastra.config_loja
  FROM authenticated;

-- Chave geral fechada, ainda sem politica nenhuma — mesmo motivo de 0002, e vale
-- inclusive para as duas publicas: GRANT e permissao de TABELA, a RLS decide a
-- LINHA, e ate a migracao de politicas chegar ela nega tudo. Um deploy que pare
-- no meio deixa a vitrine sem banner e sem promocao — visivel e inofensivo — em
-- vez de deixar `pedidos` servido pelo PostgREST a quem pedir.
ALTER TABLE canastra.pedidos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.config_loja ENABLE ROW LEVEL SECURITY;
