-- Cupons de desconto, e o rastro deles no pedido.
--
-- O DESENHO INTEIRO PARTE DE UMA REGRA DA F4: numero que vira dinheiro nunca
-- vem do navegador. O cupom segue a mesma linha — o cliente manda so o CODIGO;
-- quem le esta tabela, calcula o desconto sobre os precos do BANCO e decide se
-- o cupom vale e o servico Node (utils/cupom.js + PaymentController), sempre no
-- servidor. O `descontoCentavos` que o navegador exibe e cortesia de interface.

CREATE TABLE canastra.cupons (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- O codigo e salvo MAIUSCULO pelo servico (quem digita "cafe10" quis dizer
  -- "CAFE10"), e o CHECK tranca o formato no banco para o caminho que nao
  -- passar pelo servico — um INSERT manual de emergencia, por exemplo — nao
  -- criar um cupom que a validacao nunca encontra: a busca e por igualdade
  -- exata, e um codigo minusculo gravado aqui seria invisivel para sempre.
  -- A-Z e 0-9 apenas, 3 a 30 caracteres: e o que cabe num anuncio e num campo
  -- de checkout sem ambiguidade de espaco, acento ou emoji.
  codigo   text NOT NULL UNIQUE
             CONSTRAINT cupons_codigo_formato CHECK (codigo ~ '^[A-Z0-9]{3,30}$'),

  -- percent desconta proporcao do subtotal; fixed desconta valor em reais.
  tipo     text NOT NULL
             CONSTRAINT cupons_tipo_valido CHECK (tipo IN ('percent', 'fixed')),

  -- O MESMO teto de 90% das promocoes (promotionsRepository.validarDesconto),
  -- pelo MESMO motivo: acima disso e quase certamente engano, e um "100%"
  -- liberaria a loja de graca para quem soubesse o codigo. So que la o teto e
  -- so do servico; aqui vai tambem no banco, porque cupom e um segredo que
  -- circula fora da loja (anuncio, influencer) e o custo de um erro e maior.
  -- `fixed` nao tem teto no banco: o servico trava o desconto no subtotal do
  -- pedido, entao um fixed maior que a compra desconta a compra e para.
  valor    numeric(10,2) NOT NULL
             CONSTRAINT cupons_valor_valido
               CHECK (valor > 0 AND (tipo <> 'percent' OR valor <= 90)),

  descricao text,

  -- Pedido minimo em CENTAVOS e inteiro, como todo dinheiro de comparacao
  -- neste schema (frete_gratis_minimo_centavos, 0009): numeric aqui convidaria
  -- aritmetica de ponto flutuante exatamente na fronteira do "vale/nao vale".
  minimo_centavos integer NOT NULL DEFAULT 0
             CONSTRAINT cupons_minimo_nao_negativo CHECK (minimo_centavos >= 0),

  -- NULL = sem limite. O CHECK barra o `limite_usos = 0`, que nao significa
  -- "ilimitado" nem "esgotado desde o inicio" — significa que alguem confundiu
  -- os dois, e melhor descobrir no INSERT que no primeiro cliente recusado.
  limite_usos integer
             CONSTRAINT cupons_limite_positivo
               CHECK (limite_usos IS NULL OR limite_usos > 0),

  -- Incrementado ATOMICAMENTE pelo checkout (`SET usos = usos + 1 WHERE ...
  -- usos < limite_usos`), dentro da transacao de reserva de estoque — e o
  -- mesmo desenho do FOR UPDATE dos produtos: dois checkouts simultaneos no
  -- ultimo uso serializam e o segundo recebe "Cupom esgotado" ANTES de ser
  -- cobrado. O CHECK de nao-negativo protege a compensacao (falha de gateway
  -- devolve o uso): um decremento a mais viraria erro visivel, nao -1.
  usos     integer NOT NULL DEFAULT 0
             CONSTRAINT cupons_usos_nao_negativo CHECK (usos >= 0),

  ativo    boolean NOT NULL DEFAULT true,

  -- Janela de validade, as duas pontas opcionais — diferente das promocoes,
  -- onde as duas datas sao obrigatorias para valer (semantica herdada do
  -- painel legado). Cupom sem data e o caso comum ("CAFE10 ate acabar").
  inicio_em timestamptz,
  fim_em    timestamptz,

  criado_em     timestamptz NOT NULL DEFAULT now(),
  -- MANTIDA POR QUEM ESCREVE, como em 0004/0005: nao ha trigger de moddatetime
  -- neste schema. Todo UPDATE do servico escreve `atualizado_em = now()` junto.
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- O rastro no pedido. `cupom_codigo` e TEXTO, nao FK, pela mesma licao do
-- carrinho sem FK para produtos (0004): o pedido guarda a fotografia do que
-- foi usado na compra, e apagar ou renomear o cupom amanha nao pode tocar uma
-- venda ja feita — faturamento nao herda o ciclo de vida de uma campanha.
-- `desconto` em reais com 2 casas, como `total` e `frete` da mesma tabela:
-- os tres somam juntos na conferencia de um pedido.
ALTER TABLE canastra.pedidos
  ADD COLUMN cupom_codigo text,
  ADD COLUMN desconto numeric(10,2) NOT NULL DEFAULT 0
    CONSTRAINT pedidos_desconto_nao_negativo CHECK (desconto >= 0);

-- Chave geral fechada, SEM politica nenhuma — e aqui isso e o estado FINAL,
-- nao um adiamento como foi em 0002/0004: cupom so e lido e escrito pelo
-- servico Node, que conecta como dono do banco e nao passa por RLS. O
-- PostgREST nao serve esta tabela a ninguem: a lista de cupons e o mapa de
-- descontos da loja, e a validacao publica ja existe do jeito certo
-- (POST /cupons/validar, que responde so sobre O codigo perguntado).
ALTER TABLE canastra.cupons ENABLE ROW LEVEL SECURITY;

-- Os ALTER DEFAULT PRIVILEGES de 0001 deram a `authenticated` o pacote arwd
-- nesta tabela recem-nascida. Hoje ele esta inerte (RLS sem politica nega
-- tudo), mas a licao de 0003 vale: a primeira politica ampla escrita daqui a
-- seis meses acordaria o GRANT esquecido. Como nenhuma politica e planejada
-- para cupons — o painel fala com o Express, nao com o PostgREST — revogar
-- custa uma linha e fecha a porta nas DUAS camadas. `service_role` fica, como
-- sempre: e credencial de servidor.
REVOKE ALL ON canastra.cupons FROM authenticated;
