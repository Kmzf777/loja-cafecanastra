-- Status de pedido com lista fechada, e o piso do frete gratis.
--
-- ESTA E A DECISAO QUE 0005 DEIXOU ADIADA DE PROPOSITO. La, `pedidos.status`
-- nasceu texto livre com o aviso explicito: "a tarefa que escrever as
-- transicoes de status e quem tem a lista dos valores validos e deve decidir
-- explicitamente entre um CHECK, um enum ou deixar livre". A tarefa chegou
-- (F4, plano mestre de 2026-08-20) e a decisao e um CHECK:
--
--   * CHECK, e nao enum: acrescentar valor num enum exige ALTER TYPE e, antes
--     do PG 12, truques de transacao; num CHECK e uma migracao trivial que
--     recria a constraint. O custo de consulta e o mesmo.
--   * portugues, e nao o vocabulario do Mercado Pago: o schema inteiro fala
--     portugues desde 0003, e o gateway e um DETALHE do pagamento — amanha um
--     Pix direto ou outro gateway nao deveria obrigar a loja a pensar em
--     "in_process". Quem traduz MP -> loja e o servico Node
--     (src/utils/statusDePedido.js), num unico lugar.
--
-- A lista e a fixada no plano mestre. `enviado` e `entregue` nao existem no
-- MP: sao passos LOGISTICOS, escritos pelo painel do admin.

-- Defensivo, e barato: se alguma linha tiver entrado com o vocabulario antigo
-- do MP (nao deveria existir nenhuma — o codigo que escrevia pedidos apontava
-- para a tabela `orders`, que nunca existiu, entao toda gravacao falhava),
-- traduz antes de trancar. Sem isto, UMA linha velha faria o ALTER TABLE
-- abaixo falhar com 23514 e derrubaria a migracao inteira.
UPDATE canastra.pedidos
   SET status = CASE status
                  WHEN 'pending'     THEN 'pendente'
                  WHEN 'approved'    THEN 'aprovado'
                  WHEN 'in_process'  THEN 'em_processamento'
                  WHEN 'authorized'  THEN 'autorizado'
                  WHEN 'sent'        THEN 'enviado'
                  WHEN 'delivered'   THEN 'entregue'
                  WHEN 'cancelled'   THEN 'cancelado'
                  WHEN 'rejected'    THEN 'rejeitado'
                  WHEN 'refunded'    THEN 'reembolsado'
                END,
       atualizado_em = now()
 WHERE status IN ('pending', 'approved', 'in_process', 'authorized', 'sent',
                  'delivered', 'cancelled', 'rejected', 'refunded');

-- O CHECK em si. Quem tratar o erro no servico deve esperar 23514 citando
-- `pedidos_status_valido` — e vale lembrar o modo de falha que ele fecha:
-- 'pendnete' gravado em texto livre nao levantava erro nenhum, so sumia de
-- todo filtro que procurasse 'pendente'.
ALTER TABLE canastra.pedidos
  ADD CONSTRAINT pedidos_status_valido CHECK (status IN (
    'pendente', 'aprovado', 'em_processamento', 'autorizado',
    'enviado', 'entregue', 'cancelado', 'rejeitado', 'reembolsado'
  ));

-- Frete gratis e REGRA DE SERVIDOR (decisao 3 do plano mestre), e por isso o
-- piso mora no banco e nao numa constante do frontend: o ShippingController
-- zera as opcoes quando o subtotal atinge o minimo, o `conferirFrete` do
-- checkout recota pela MESMA regra, e a vitrine apenas EXIBE o valor que
-- `GET /config` devolver. Um numero escrito no navegador nunca decide frete.
--
-- Em CENTAVOS e inteiro, como todo dinheiro que o frontend ja calcula
-- (frontend/lib/catalogo/repositorio.ts trabalha em centavos): numeric aqui
-- convidaria a aritmetica de ponto flutuante no caminho do dinheiro.
--
-- 14900 = R$ 149,00, o valor que a vitrine ja anuncia hoje no Cabecalho.
--
-- Sem GRANT novo: o SELECT de `config_loja` para `anon` (0005) e de TABELA,
-- entao a coluna nova ja nasce legivel pela vitrine — e o minimo de frete
-- gratis e informacao publica por natureza (esta escrito no topo da loja).
-- O UPDATE de `authenticated` (0006) tambem e de tabela, entao o painel do
-- admin ja consegue ajustar o valor pela politica `config_loja_admin_escreve`.
ALTER TABLE canastra.config_loja
  ADD COLUMN frete_gratis_minimo_centavos integer NOT NULL DEFAULT 14900
    CONSTRAINT config_frete_gratis_nao_negativo
      CHECK (frete_gratis_minimo_centavos >= 0);
