-- O rastro de WhatsApp entra na redacao da LGPD -- e a guarda de aviso
-- duplicado deixa de ser convencao e passa a ser regra do banco.
--
-- SAO DUAS COISAS NO MESMO ARQUIVO, pelo mesmo motivo de 0020: as duas sao
-- sobre `whatsapp_mensagens`, as duas custam uma linha ENQUANTO A TABELA ESTA
-- VAZIA (o bot esta inteiro e desligado, esperando o numero na Meta), e depois
-- da primeira mensagem real a primeira delas vira dado pessoal ja gravado.
--
/* ------------------------------------------------------------------------- *
 * 1. O `wamid` guarda o telefone, e sobrevivia ao pedido de exclusao
 * ------------------------------------------------------------------------- */
--
-- O MIOLO DO `wamid` EM BASE64 E O TELEFONE DO CLIENTE EM TEXTO CLARO. Este
-- repositorio ja afirma isso em quatro lugares -- o cabecalho de
-- `WhatsappController.js`, o comentario de `COLUNAS_DO_HISTORICO`, o do cron de
-- `index.js` e `docs/whatsapp.md` -- e e por isso que o wamid nao vai para log
-- nenhum, nao volta para o painel e nao entra na exportacao de titular.
--
-- SO QUE ELE FICAVA NA LINHA. `canastra.redigir_dados_do_titular` (0013, 0016)
-- alcanca `pedidos`, `assinaturas` e `avaliacoes` -- e nao `whatsapp_mensagens`.
-- O desfecho medido contra o banco com as vinte migracoes aplicadas: a titular
-- pede exclusao, `clientes` some pelo CASCADE de 0002, `pedidos.user_id` vira
-- NULL e `endereco_json` e redigido; e a linha de `whatsapp_mensagens` fica com
-- o `user_id` dela, o `telefone_final`, um `pedido_id` valido e o telefone
-- INTEIRO dentro do `wamid`. O elo pessoa <-> pedido que o `ON DELETE SET NULL`
-- de 0005 existe para cortar volta a ser reconstruivel com um SELECT.
--
-- NAO E VULNERABILIDADE, E RETENCAO INDEVIDA, e a distincao importa para quem
-- for avaliar a urgencia: `whatsapp_mensagens` tem RLS ligada sem politica e
-- `REVOKE ALL FROM authenticated` (0017), nenhum handler le `wamid`, e o painel
-- so alcanca a tabela com credencial de administrador. Ninguem de fora le esta
-- linha. O problema e que ela CONTINUA EXISTINDO depois de um pedido de
-- eliminacao -- LGPD Art. 18, VI --, e a propria 0017 promete o contrario duas
-- vezes ("nao guarda telefone completo em tabela nova", "so os quatro ultimos
-- digitos") e enuncia a regra que ela mesma viola ("coluna nova numa tabela que
-- sobreviva pede redacao").
--
-- O QUE SAI DA LINHA, E POR QUE SAO ESTES TRES:
--
--   `wamid` .......... o telefone completo, disfarcado de identificador opaco.
--   `telefone_final` . os quatro ultimos digitos. Sozinhos nao identificam
--                      ninguem; ao lado do `pedido_id` e do endereco redigido,
--                      sao mais um pedaco a menos que sobra de graca.
--   `user_id` ........ o elo com a pessoa. Ele nao tem FK (0017 escolheu assim,
--                      como o resto do schema faz com `auth.users`), entao nao
--                      ha cascata nem SET NULL que o alcance: quem tem de
--                      apaga-lo e esta funcao.
--
-- O QUE FICA, E FICA DE PROPOSITO: `pedido_id`, `template`, `status`, os
-- carimbos e o `erro_texto`. Sem `user_id` e sem `wamid`, a linha diz "este
-- pedido recebeu este aviso, e ele chegou" -- registro do que a LOJA fez, do
-- mesmo naipe do total e do status que 0013 preserva em `pedidos`. Apagar a
-- linha inteira destruiria a contagem de envio e a guarda de aviso repetido da
-- secao 2 deste arquivo, sem devolver privacidade nenhuma a mais.
--
-- SEM COLUNA DE CARIMBO NOVA, ao contrario de `pedidos.redigido_em` (0013) e
-- `assinaturas.redigido_em` (0016): aqui a idempotencia E O PROPRIO PREDICADO,
-- porque a redacao APAGA a coluna pela qual se procura. Com `user_id` nulo a
-- segunda passagem nao acha linha, e portanto nem UPDATE vazio acontece --
-- a mesma decisao que 0016 tomou para `avaliacoes.nome_exibicao`.
--
-- O TROCO, dito porque e onde a proxima pessoa vai procurar: depois da redacao
-- aquele rastro some da exportacao de titular (`lgpd.routes.js` filtra por
-- `user_id`). Na exclusao TOTAL isso e irrelevante -- a conta deixa de existir
-- no mesmo gesto. Na eliminacao PARCIAL (POST /lgpd/titulares/:id/redigir) e
-- uma perda real: a pessoa deixa de conseguir listar as mensagens que ja
-- recebeu. E o que "eliminar" significa, e o comentario daquela rota foi
-- corrigido junto com esta migracao para nao continuar prometendo o inverso.
--
/* ------------------------------------------------------------------------- *
 * 2. A guarda de aviso duplicado passa a ser do banco
 * ------------------------------------------------------------------------- */
--
-- `services/notificacoes.js:jaAvisado()` LE e depois ESCREVE: pergunta se este
-- pedido ja recebeu este template e, se nao, insere a linha. Entre a pergunta e
-- a resposta ha uma janela, e nada no banco a fechava -- o comentario do indice
-- de wamid em 0017 admite isso com todas as letras ("o que ele NAO faz: nao
-- impede duas mensagens do mesmo template para o mesmo pedido").
--
-- NAO E DEFEITO HOJE, e isso precisa estar escrito para ninguem "consertar" um
-- bug que nao existe: os cenarios concretos de corrida foram todos refutados --
-- o modal do painel desmonta antes do segundo clique, e o cron do Bling esta
-- desligado. O indice entra porque e barato e porque transforma "por convencao"
-- em "pelo banco": um processo a mais amanha (uma fila, um segundo worker, um
-- retry automatico) nao precisa reaprender a regra.
--
-- PARCIAL EM `status <> 'falhou'`, PELA MESMA RAZAO DE `jaAvisado()`: uma queda
-- da Meta nao pode trancar o aviso para sempre. Sem a exclusao, o primeiro
-- 131026 silenciaria aquele pedido em definitivo -- e o teste "o envio que
-- falhou pode ser tentado de novo" existe exatamente para cobrar isso.
--
-- `pedido_id` NULO NAO COLIDE, e o comportamento e o certo: no indice unico do
-- Postgres NULLs sao distintos entre si (o padrao `NULLS DISTINCT`). Linha sem
-- pedido e o que sobra depois do `ON DELETE SET NULL` de 0017 e depois da
-- redacao da secao 1; empilhar essas linhas numa unica chave `(NULL, template)`
-- faria a redacao de uma pessoa impedir o rastro de outra.
--
-- O PAR E PEDIDO + TEMPLATE, E NAO PEDIDO + STATUS, porque 'enviado' tem DOIS
-- templates (`pedido_enviado` e `pedido_enviado_sem_rastreio`): o pedido que sai
-- sem codigo e ganha o rastreio depois PRECISA do segundo aviso.
--
-- QUEM CHAMA TRATA 23505 COMO "JA AVISADO", e nao como erro: `notificacoes.js`
-- engole o codigo e sai calado, porque perder a corrida significa que a outra
-- ponta ja gravou o rastro -- o desfecho e exatamente o que a guarda queria.

/**
 * A redacao do titular, com o rastro de WhatsApp dentro.
 *
 * CREATE OR REPLACE sobre a assinatura EXATA de 0013/0016 -- mesmo nome, mesmo
 * parametro, mesmo retorno --, entao todo chamador existente (conta.routes.js,
 * lgpd.routes.js) continua valendo sem uma linha de mudanca.
 *
 * O CONTRATO DO RETORNO NAO MUDA, e e a terceira vez que isto precisa ser dito:
 * continua sendo a contagem de PEDIDOS redigidos. E o `pedidosRedigidos` que o
 * endpoint de titular responde e o "0 na segunda chamada" que prova a
 * idempotencia. Assinaturas, avaliacoes e agora `whatsapp_mensagens` sao
 * redigidas no MESMO gesto, sem numero proprio no retorno.
 *
 * O CORPO ABAIXO E O DE 0016, COPIADO, e a unica diferenca esta marcada no
 * lugar -- a mesma disciplina que 0017 usou ao reescrever `garantir_cliente`.
 * Reescrever a funcao para "melhorar" o que ja estava medido trocaria uma
 * correcao por uma reescrita, e `f7_lgpd.test.js` mede cada ramo dos que ja
 * existiam.
 *
 * CREATE OR REPLACE preserva a ACL de 0013 (REVOKE PUBLIC + GRANT
 * service_role), mas NAO preserva atributos declarados: SECURITY INVOKER
 * (default), o `SET search_path` e o nao-STRICT sao re-declarados aqui de
 * proposito, com as MESMAS razoes de 0013 -- INVOKER porque quem chama ja tem o
 * privilegio, nao-STRICT porque NULL tem de ser ERRO e nunca no-op silencioso
 * no fluxo de exclusao.
 */
CREATE OR REPLACE FUNCTION canastra.redigir_dados_do_titular(alvo_user_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path = canastra, pg_temp
AS $redigir$
DECLARE
  pedidos_redigidos integer;
BEGIN
  -- Identico a 0013: NULL e erro de contrato (22004), nunca "nenhum alvo" --
  -- um no-op silencioso no fluxo de exclusao fabricaria o orfao irredigivel.
  IF alvo_user_id IS NULL THEN
    RAISE EXCEPTION 'A redação exige um titular: pedido órfão não tem redação por titular.'
      USING ERRCODE = 'null_value_not_allowed',
            HINT = 'Redija ANTES ou JUNTO da exclusão da conta — depois dela o vínculo já se foi.';
  END IF;

  /**
   * PEDIDOS -- o comportamento da 0013, com o endereco delegado a
   * `redigir_endereco`. A denylist de itens continua aqui (e um formato de
   * ITEM, nao de endereco): o formato real do checkout so tem produto --
   * product_id, name (nome do PRODUTO, registro fiscal), price, quantity... --
   * e a denylist e defesa contra formato historico/futuro com dado pessoal
   * dentro do item. So listas sao processadas: e o unico formato que algum
   * caminho de escrita da loja produz.
   */
  UPDATE canastra.pedidos p
     SET
       endereco_json = CASE
         WHEN p.endereco_json IS NULL THEN p.endereco_json
         ELSE canastra.redigir_endereco(p.endereco_json)
       END,
       itens = CASE
         WHEN p.itens IS NULL OR jsonb_typeof(p.itens) <> 'array'
           THEN p.itens
         ELSE (
           SELECT COALESCE(
             jsonb_agg(
               CASE
                 WHEN jsonb_typeof(item.valor) <> 'object' THEN item.valor
                 ELSE (
                   SELECT COALESCE(
                     jsonb_object_agg(
                       i.chave,
                       CASE
                         WHEN lower(i.chave) IN (
                           'cpf', 'email', 'telefone', 'phone', 'celular',
                           'nome_cliente', 'destinatario', 'endereco', 'address'
                         ) THEN to_jsonb('[redigido]'::text)
                         ELSE i.valor
                       END
                     ),
                     '{}'::jsonb
                   )
                   FROM jsonb_each(item.valor) AS i(chave, valor)
                 )
               END
               -- A ordem dos itens e parte do registro da venda.
               ORDER BY item.ordem
             ),
             '[]'::jsonb
           )
           FROM jsonb_array_elements(p.itens) WITH ORDINALITY AS item(valor, ordem)
         )
       END,
       redigido_em = now(),
       -- Regra de 0005: sem trigger de moddatetime, quem escreve carimba.
       atualizado_em = now()
   WHERE p.user_id = alvo_user_id
     AND p.redigido_em IS NULL;

  GET DIAGNOSTICS pedidos_redigidos = ROW_COUNT;

  /**
   * ASSINATURAS -- so as canceladas (decisao 1 do cabecalho de 0016). O
   * `redigido_em` faz o mesmo servico do de pedidos: idempotencia + auditoria
   * da PRIMEIRA redacao.
   */
  UPDATE canastra.assinaturas a
     SET endereco_json = canastra.redigir_endereco(a.endereco_json),
         redigido_em   = now(),
         atualizado_em = now()
   WHERE a.user_id = alvo_user_id
     AND a.status = 'cancelada'
     AND a.redigido_em IS NULL;

  /**
   * AVALIACOES -- o nome publico sai; nota e texto ficam (decisao 2 de 0016). O
   * predicado E a idempotencia: 'Cliente Canastra' nao e alvo de novo.
   * `moderado_em` NAO e tocado -- redacao nao e moderacao.
   */
  UPDATE canastra.avaliacoes av
     SET nome_exibicao = 'Cliente Canastra'
   WHERE av.user_id = alvo_user_id
     AND av.nome_exibicao <> 'Cliente Canastra';

  /**
   * O RASTRO DE WHATSAPP -- A UNICA NOVIDADE DESTA MIGRACAO.
   *
   * As tres colunas do cabecalho, e a ordem em que se pensa nelas: `wamid`
   * porque o miolo dele em base64 e o telefone completo; `telefone_final`
   * porque sao quatro digitos que nao servem a nada depois que a pessoa se foi;
   * `user_id` porque e o elo, e porque nao ha FK que o apague sozinho.
   *
   * `atualizado_em` E CARIMBADO pela regra de 0005 (sem trigger de moddatetime,
   * quem escreve carimba) -- e ele e tambem a prova, em `f7_lgpd.test.js`, de
   * que a segunda chamada nao rodou UPDATE nenhum: com `user_id` ja nulo o
   * predicado nao acha linha, e o carimbo fica parado.
   *
   * O `wamid` VIRA NULL E NAO UM PLACEHOLDER, ao contrario de
   * `avaliacoes.nome_exibicao`: aquele e PUBLICO na vitrine e um colchete
   * tecnico no lugar do autor viraria curiosidade; este nao e mostrado a
   * ninguem. E o indice unico parcial de 0017 (`WHERE wamid IS NOT NULL`)
   * simplesmente deixa de indexar a linha, sem colisao possivel entre duas
   * linhas redigidas.
   */
  UPDATE canastra.whatsapp_mensagens m
     SET wamid          = NULL,
         telefone_final = NULL,
         user_id        = NULL,
         atualizado_em  = now()
   WHERE m.user_id = alvo_user_id;

  RETURN pedidos_redigidos;
END;
$redigir$;

/**
 * A guarda de aviso duplicado, agora sustentada pelo banco. Ver a secao 2 do
 * cabecalho para o porque, para o motivo de ser PARCIAL e para o motivo de
 * `pedido_id` nulo nao colidir.
 *
 * NOME EXPLICITO e nao gerado, pela regra da casa: um indice sem nome escolhido
 * vira `whatsapp_mensagens_pedido_id_template_idx` e ninguem consegue cita-lo
 * numa conversa nem procura-lo por ele num teste.
 *
 * SEM `CONCURRENTLY`: a tabela esta vazia (o bot nunca mandou uma mensagem), e
 * `CREATE INDEX CONCURRENTLY` nao pode rodar dentro de bloco de transacao --
 * que e exatamente onde `db/migrar.js` roda cada arquivo.
 */
CREATE UNIQUE INDEX whatsapp_mensagens_pedido_template_idx
  ON canastra.whatsapp_mensagens (pedido_id, template)
  WHERE status <> 'falhou';
