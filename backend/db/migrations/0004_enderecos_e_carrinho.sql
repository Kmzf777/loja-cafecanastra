-- Enderecos e carrinho.

CREATE TABLE canastra.enderecos (
  endereco_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES canastra.clientes (user_id) ON DELETE CASCADE,
  cep          text,
  rua          text,
  numero       text,
  complemento  text,
  bairro       text,
  cidade       text,
  estado       text,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enderecos_cliente_idx ON canastra.enderecos (user_id);

-- Um carrinho por cliente. O UNIQUE e o que permite `ON CONFLICT (user_id)` na
-- RPC de fusao (migracao 0007) sem precisar ler antes de escrever.
CREATE TABLE canastra.carrinhos (
  carrinho_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES canastra.clientes (user_id) ON DELETE CASCADE,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Sem FK para produtos, de proposito: `nome`, `preco` e `imagem` sao copias do
-- momento em que o item entrou na sacola. Um produto retirado do catalogo nao
-- pode fazer o carrinho de ninguem desaparecer nem quebrar a listagem.
--
-- O preco guardado aqui e para EXIBIR. Quem cobra e o checkout, que rele preco e
-- estoque do banco antes de gerar o pagamento.
--
-- LIMITE CONHECIDO DO UNIQUE ABAIXO, aceito nesta fase e nao esquecido: no
-- Postgres cada NULL e distinto dos outros num indice unico (NULLS DISTINCT, o
-- padrao), entao a chave (carrinho_id, produto_id, NULL) nunca colide com ela
-- mesma. Dois "adicionar" no mesmo produto SEM moagem viram duas linhas na
-- sacola em vez de somar quantidade, e o ON CONFLICT da RPC de 0007 nao dispara
-- nesse caso. Passa porque a vitrine sempre manda moagem para cafe, o unico
-- produto com essa variacao. Se um dia entrar item sem moagem nenhuma (caneca,
-- assinatura), isto vira duplicata visivel na sacola; a correcao seria
-- `UNIQUE NULLS NOT DISTINCT` (PG 15+) ou um default 'padrao' na coluna — e as
-- DUAS mexem no alvo do ON CONFLICT de 0007, que depende exatamente desta lista
-- de colunas. Nao mude uma sem a outra. Medido em test/carrinho.test.js.
CREATE TABLE canastra.carrinho_itens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrinho_id uuid NOT NULL REFERENCES canastra.carrinhos (carrinho_id) ON DELETE CASCADE,
  produto_id  uuid NOT NULL,
  quantidade  integer NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  preco       numeric(10,2) NOT NULL DEFAULT 0,
  nome        text,
  imagem      text,
  tamanho     text,
  moagem      text,
  UNIQUE (carrinho_id, produto_id, moagem)
);
CREATE INDEX carrinho_itens_carrinho_idx ON canastra.carrinho_itens (carrinho_id);

-- Chave geral fechada, ainda sem politica nenhuma — mesmo motivo de 0002.
--
-- Nada aqui e publico, entao nao ha GRANT para `anon` nesta migracao: endereco e
-- sacola sao dados pessoais e a Regra de 0001 ja os deixa de fora por padrao. As
-- duas camadas negam, que e como tem de ser.
ALTER TABLE canastra.enderecos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.carrinhos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.carrinho_itens ENABLE ROW LEVEL SECURITY;
