-- 0017_melhor_envio
--
-- O token que se renova sozinho, e as colunas da etiqueta.
--
-- POR QUE O TOKEN MORA NO BANCO E NAO NO .env: o access_token da Melhor Envio
-- vale 30 dias e o refresh_token, 45. Um token colado no .env para de funcionar
-- um mes depois de configurado — e frete que nao cota e checkout que nao fecha,
-- perda de venda silenciosa, descoberta por reclamacao de cliente. O servico
-- (src/services/melhorEnvioClient.js) renova antes do vencimento e grava aqui;
-- MELHOR_ENVIO_REFRESH_TOKEN no .env vira so a semente da primeira autorizacao.
--
-- E O PONTO DE SEGURANCA DESTA MIGRACAO JA ESTA RESOLVIDO PELA 0012: aquela
-- migracao trocou o GRANT de TABELA de `config_loja` por lista EXPLICITA de
-- colunas (porque o refresh token do Bling entrou pela mesma porta). Coluna nova
-- nesta tabela, portanto, NASCE SEM GRANT — nem `anon` nem `authenticated` a
-- leem pelo PostgREST, sem precisar de REVOKE nenhum aqui. NAO acrescente estas
-- duas a nenhum GRANT: o unico que as escreve e o servico Node, que conecta como
-- dono do banco e nao passa por GRANT.
-- SAO DOIS RELOGIOS, E O ALARME PRECISA DO SEGUNDO.
--
-- `melhor_envio_token_expira_em` e o relogio do ACCESS token: 30 dias, e a
-- propria resposta da renovacao diz quantos segundos faltam (`expires_in`). Esse
-- relogio nao preocupa ninguem — o servico o renova sozinho antes de vencer.
--
-- Quem MATA a integracao e o outro: o REFRESH token vale 45 dias, e quando ele
-- morre nao ha renovacao possivel, so reautorizacao manual no painel da Melhor
-- Envio. Uma loja que passe 45 dias sem despachar acorda sem frete. E por isso
-- que existe `melhor_envio_renovado_em`: sem ele, um painel que avisasse "o
-- token vence em X" leria o relogio do access token e mostraria uma data
-- tranquilizadora e FALSA enquanto a autorizacao sangra.
--
-- POR QUE A COLUNA GUARDA *QUANDO RENOVOU* E NAO A DATA DA MORTE JA CALCULADA:
-- os 45 dias sao constante documentada do lado da Melhor Envio, nao um valor que
-- a resposta nos entregue. Uma data derivada de constante vira mentira gravada
-- no dia em que eles mudarem a politica, e ninguem tem como perceber. O carimbo
-- do que de fato aconteceu continua verdadeiro para sempre; quem exibe deriva
-- "morre por volta de X" na hora, e pode dizer com essas palavras.
ALTER TABLE canastra.config_loja
  ADD COLUMN melhor_envio_refresh_token   text,
  ADD COLUMN melhor_envio_token_expira_em timestamptz,
  ADD COLUMN melhor_envio_renovado_em     timestamptz;

-- As colunas da etiqueta, no pedido.
--
-- `me_servico_id` fecha um buraco que so aparece na hora de comprar: o pedido
-- guardava `metodo_envio` (o NOME, "Correios PAC") e a Melhor Envio precisa do
-- id numerico do servico para inserir no carrinho. Sem ele, comprar a etiqueta
-- seria adivinhar o servico a partir de um texto — e adivinhar errado gasta
-- dinheiro de verdade.
--
-- `me_claim_em` existe separado de `me_situacao` pelo mesmo motivo de
-- `bling_claim_em` (0012): a situacao diz ONDE o trabalho parou, o claim diz
-- QUEM esta trabalhando agora. Claim velho pode ser retomado; situacao nao
-- expira.
ALTER TABLE canastra.pedidos
  ADD COLUMN me_servico_id  integer,
  ADD COLUMN me_order_id    text,
  ADD COLUMN me_protocolo   text,
  ADD COLUMN me_situacao    text,
  ADD COLUMN me_claim_em    timestamptz,
  ADD COLUMN me_comprada_em timestamptz;

-- NAO acrescente as colunas acima ao `GRANT UPDATE (status, codigo_rastreio,
-- metodo_envio, atualizado_em) ON canastra.pedidos TO authenticated` da 0006. O
-- aviso preso aquele GRANT vale igual aqui: a defesa inteira mora na lista de
-- colunas, e um cliente que pudesse escrever `me_situacao` conseguiria fingir
-- que a propria etiqueta ja foi paga.

-- A DEFESA NO BANCO, e nao na boa vontade do codigo: dois cliques simultaneos no
-- botao "Comprar etiqueta" produzem uma etiqueta so. Parcial porque quase todo
-- pedido vive com `me_order_id` nulo — mesmo formato de `pedidos_bling_id_idx`.
CREATE UNIQUE INDEX pedidos_me_order_id_idx
  ON canastra.pedidos (me_order_id)
  WHERE me_order_id IS NOT NULL;

-- Os pedidos que a tela de expedicao procura: aprovados e ainda sem etiqueta.
CREATE INDEX pedidos_sem_etiqueta_idx
  ON canastra.pedidos (criado_em DESC)
  WHERE me_order_id IS NULL;
