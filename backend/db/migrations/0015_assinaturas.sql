-- Clube da Canastra — assinaturas recorrentes (Onda 3J do plano mestre).
--
-- Uma linha = uma assinatura de UM cafe, com TUDO que a cobranca recorrente
-- precisa CONGELADO na adesao: sku, quantidade, preco e endereco. O Mercado
-- Pago (preapproval) cobra um valor fixo por ciclo e nao ha checkout a cada
-- envio, entao o pedido que cada cobranca gera nao pode depender do catalogo
-- do dia — depende desta fotografia. Reajustar o preco no painel muda as
-- assinaturas NOVAS; as vivas seguem no valor da adesao, que e o que os
-- termos de uso prometem ("preco travado").

CREATE TABLE canastra.assinaturas (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE SET NULL, como em `pedidos` (0005) e pela mesma razao: a
  -- assinatura e historico comercial e a cobranca pode ja ter acontecido —
  -- apagar o cliente (LGPD) nao pode apagar o registro do que foi vendido.
  -- Uma assinatura orfa e cancelada no MP pelo fluxo de exclusao de conta;
  -- aqui ela apenas perde o dono.
  user_id  uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,

  -- O SKU do produto no catalogo (`canastra.produtos.sku`), TEXTO e nao FK —
  -- a mesma licao do carrinho (0004) e do cupom no pedido (0010): fotografia
  -- nao herda o ciclo de vida do catalogo. Um produto descontinuado nao pode
  -- derrubar a assinatura de quem ja assina; quem decide encerra-la e o
  -- gestor, cancelando no painel/MP.
  sku      text NOT NULL,

  quantidade integer NOT NULL DEFAULT 1
             CONSTRAINT assinaturas_quantidade_positiva CHECK (quantidade > 0),

  -- As tres frequencias que a loja vende (estetica.md §7.4). CHECK fechado de
  -- proposito: o preapproval e criado com `frequency` = este numero, e um 20
  -- gravado por engano viraria uma cobranca que nenhuma tela oferece.
  frequencia_dias integer NOT NULL
             CONSTRAINT assinaturas_frequencia_valida
               CHECK (frequencia_dias IN (15, 30, 45)),

  -- O valor de CADA cobranca, em CENTAVOS e inteiro (regra da casa para
  -- dinheiro de decisao — 0009/0010), JA com os 10% do Clube:
  -- Math.round(preco_reais * 0.9 * 100) * quantidade, calculado no SERVIDOR
  -- na adesao. E o `transaction_amount` do preapproval e o `total` de cada
  -- pedido gerado. Nunca recalculado a partir do catalogo.
  preco_centavos integer NOT NULL
             CONSTRAINT assinaturas_preco_positivo CHECK (preco_centavos > 0),

  -- Entrega recorrente exige endereco proprio: o de `canastra.enderecos` e o
  -- "endereco atual" do cliente e muda com a proxima compra avulsa — a
  -- assinatura entrega onde foi contratada ate o cliente dizer o contrario.
  -- Mesmo formato do `endereco_json` de pedidos (zip_code, street, ...).
  endereco_json jsonb NOT NULL,

  -- O id do preapproval no Mercado Pago. NULL enquanto a ida ao MP nao
  -- respondeu (a linha nasce antes, para o `external_reference` existir);
  -- UNIQUE porque e por ele que o webhook de assinaturas acha a linha, e duas
  -- linhas com o mesmo preapproval seriam dois pedidos por cobranca.
  preapproval_id text UNIQUE,

  -- Vocabulario proprio, em portugues, traduzido do MP pelo servico:
  --   pending -> pendente (criada, cliente ainda nao autorizou no MP)
  --   authorized -> ativa | paused -> pausada | cancelled -> cancelada
  status   text NOT NULL DEFAULT 'pendente'
             CONSTRAINT assinaturas_status_valido
               CHECK (status IN ('pendente', 'ativa', 'pausada', 'cancelada')),

  criado_em     timestamptz NOT NULL DEFAULT now(),
  -- MANTIDA POR QUEM ESCREVE, como em 0004/0005/0010: nao ha trigger de
  -- moddatetime neste schema. Todo UPDATE do servico escreve now() junto.
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  cancelada_em  timestamptz
);

-- A consulta da conta do cliente ("minhas assinaturas") e a do webhook (por
-- preapproval_id, ja coberto pelo UNIQUE).
CREATE INDEX assinaturas_cliente_idx ON canastra.assinaturas (user_id);

/* --------------------------------------------------------------------------
 * RLS — dono le as proprias, admin le todas, SO o servico escreve
 * -------------------------------------------------------------------------- */

ALTER TABLE canastra.assinaturas ENABLE ROW LEVEL SECURITY;

-- Regra 2 de 0006: dono e `eh_cliente() AND user_id = auth.uid()`, nunca a
-- igualdade sozinha — um token de outro projeto da instancia compartilhada
-- nao pode virar "dono" de nada aqui dentro.
CREATE POLICY assinaturas_dono_le ON canastra.assinaturas
  FOR SELECT TO authenticated
  USING (canastra.eh_cliente() AND user_id = auth.uid());

CREATE POLICY assinaturas_admin_le ON canastra.assinaturas
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());

-- NAO HA POLITICA DE ESCRITA, e a ausencia e o desenho: criar assinatura passa
-- pelo Express (que valida o preco no servidor e fala com o MP), e transicao
-- de status vem do webhook — nada disso e um INSERT/UPDATE de navegador. RLS
-- ligada sem politica ja nega; o REVOKE abaixo e a segunda tranca, pelo mesmo
-- argumento de `clientes`/`pedidos` em 0006: a ausencia de politica se perde
-- com um CREATE POLICY distraido de outro dia, o privilegio de tabela nao.
-- (O default de 0001 deu `arwd` a `authenticated` nesta tabela recem-nascida;
-- fica so o SELECT, que e o que as politicas acima governam.)
REVOKE INSERT, UPDATE, DELETE ON canastra.assinaturas FROM authenticated;
