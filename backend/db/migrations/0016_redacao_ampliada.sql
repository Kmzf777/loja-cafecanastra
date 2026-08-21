-- LGPD: a redação alcança TUDO que congela dado pessoal — pedidos,
-- assinaturas e avaliações.
--
-- POR QUE UMA MIGRACAO NOVA, E NAO UMA EDICAO DA 0013: migracao aplicada nao
-- se edita (regra da casa desde 0011), e ha um motivo tecnico alem da regra —
-- a 0013 roda ANTES de 0014/0015 na ordem do runner, entao a funcao dela nao
-- pode citar `avaliacoes` nem `assinaturas` (plpgsql resolve nomes na primeira
-- CHAMADA, e o teste chama; num banco parcialmente migrado seria 42P01). Esta
-- migracao, criada DEPOIS das duas, pode.
--
-- O ACHADO QUE ELA FECHA (revisao da onda 3H): as ondas irmas criaram DUAS
-- outras fotografias de dado pessoal que a redacao da 0013 nao alcancava:
--
--   `assinaturas.endereco_json` (0015) — endereco de entrega congelado na
--       adesao, NOT NULL, com user_id ON DELETE SET NULL: a exclusao da conta
--       deixaria o endereco orfao e irredigivel, o MESMO furo de `pedidos` que
--       a 0013 acabou de fechar;
--   `avaliacoes.nome_exibicao` (0014) — nome CONGELADO no INSERT e PUBLICO
--       (a PDP exibe; `anon` tem GRANT de SELECT na coluna): depois da
--       exclusao, o nome da pessoa continuaria estampado na vitrine.
--
-- E DEIXA REGISTRADO O QUE VIROU VERDADE NESTA ONDA: o comentario da 0015
-- ("uma assinatura orfa e cancelada no MP pelo fluxo de exclusao de conta")
-- descrevia um fluxo que NAO existia quando foi escrito. Ele passou a existir
-- aqui: `conta.routes.js` cancela no MP e marca `cancelada` TODA assinatura
-- viva do titular ANTES de redigir e de apagar a conta — e aborta a exclusao
-- se o MP recusar, pelo mesmo padrao da redacao (nunca apagar deixando um
-- preapproval vivo cobrando um cliente que ja nao existe).

-- O carimbo de auditoria/idempotencia das assinaturas — mesmo papel do
-- `pedidos.redigido_em` da 0013: NULL = nunca redigida; preenchida = quando.
ALTER TABLE canastra.assinaturas
  ADD COLUMN redigido_em timestamptz;

/**
 * A whitelist de endereco, agora com nome proprio.
 *
 * A 0013 tinha esta expressao inline; com DOIS consumidores (pedidos e
 * assinaturas) e um terceiro fora do banco (o SQL manual de orfaos em
 * docs/seguranca-dados-pessoais.md), a copia divergiria na primeira correcao.
 * A regra e a MESMA da 0013, chave a chave:
 *
 *   FICA   cidade/city e uf/estado/state ........ estatistica por regiao;
 *   VIRA PREFIXO  cep/zip_code/zipCode/postal_code -> 3 digitos + 'xxxxx'
 *          (CEP impresentavel degrada para 'xxxxx' — perde a estatistica,
 *          nunca vaza o dado);
 *   SAI    toda outra chave -> "[redigido]" — whitelist, nao denylist: chave
 *          que a redacao nao conhece cai para o lado seguro.
 *
 * Formas nao-objeto: SQL NULL -> NULL (STRICT), JSON null -> ele mesmo,
 * `{}` -> `{}` (o COALESCE — `jsonb_object_agg` de zero linhas e NULL),
 * escalar/lista -> "[redigido]" inteiro (nao ha como saber o que ha dentro).
 *
 * IMMUTABLE de verdade: so olha o argumento. E IDEMPOTENTE por construcao —
 * redigir o ja redigido devolve byte a byte o mesmo jsonb ('379xxxxx' vira
 * '379' + 'xxxxx' de novo) — mas a idempotencia OPERACIONAL de quem a usa vem
 * do carimbo `redigido_em`, que evita ate o UPDATE vazio.
 */
CREATE FUNCTION canastra.redigir_endereco(endereco jsonb) RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path = canastra, pg_temp
AS $redigir_endereco$
  SELECT CASE
    WHEN jsonb_typeof(endereco) = 'null' THEN endereco
    WHEN jsonb_typeof(endereco) <> 'object' THEN to_jsonb('[redigido]'::text)
    ELSE (
      SELECT COALESCE(
        jsonb_object_agg(
          e.chave,
          CASE
            WHEN lower(e.chave) IN ('cidade', 'city')        THEN e.valor
            WHEN lower(e.chave) IN ('uf', 'estado', 'state') THEN e.valor
            WHEN lower(e.chave) IN ('cep', 'zip_code', 'zipcode', 'postal_code')
              THEN to_jsonb(
                left(regexp_replace(COALESCE(e.valor #>> '{}', ''), '\D', '', 'g'), 3)
                || 'xxxxx'
              )
            ELSE to_jsonb('[redigido]'::text)
          END
        ),
        '{}'::jsonb
      )
      FROM jsonb_each(endereco) AS e(chave, valor)
    )
  END
$redigir_endereco$;

-- Funcao pura sobre o proprio argumento — nao le tabela nenhuma —, mas a
-- lista explicita e o padrao da casa (0007/0008/0013): quem chama fica
-- escrito. `service_role` entra por causa do SQL manual de orfaos do runbook.
REVOKE EXECUTE ON FUNCTION canastra.redigir_endereco(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canastra.redigir_endereco(jsonb) TO service_role;

/**
 * A redacao do titular, versao completa. CREATE OR REPLACE sobre a assinatura
 * EXATA da 0013 — mesmo nome, mesmo parametro, mesmo retorno — entao todo
 * chamador existente (conta.routes.js, lgpd.routes.js) continua valendo.
 *
 * O CONTRATO DO RETORNO NAO MUDA: continua sendo a contagem de PEDIDOS
 * redigidos (e o `pedidosRedigidos` que o endpoint de titular responde, e o
 * "0 na segunda chamada" que prova a idempotencia). Assinaturas e avaliacoes
 * sao redigidas no MESMO gesto, sem numero proprio no retorno — quem precisar
 * de contagem por tabela le os carimbos.
 *
 * TRES DECISOES NOVAS, escritas aqui porque e aqui que se vai procurar:
 *
 * 1. ASSINATURA VIVA NAO E REDIGIDA — so as `cancelada`. Enquanto a entrega
 *    recorrente existe, o endereco congelado e NECESSARIO a execucao do
 *    contrato (LGPD art. 7º, V; art. 16, I): redigi-lo destruiria a entrega
 *    de quem continua assinante — e o endpoint de eliminacao PARCIAL
 *    (POST /lgpd/titulares/:id/redigir) roda exatamente nesse cenario. Na
 *    exclusao TOTAL nada escapa por aqui: conta.routes.js cancela TODAS as
 *    assinaturas vivas ANTES de chamar esta funcao, entao elas ja chegam
 *    `cancelada`. Assinatura cancelada DEPOIS de uma redacao parcial fica com
 *    o endereco ate a proxima redacao — limite conhecido, documentado tambem
 *    no runbook.
 *
 * 2. `avaliacoes.nome_exibicao` VIRA 'Cliente Canastra', nao "[redigido]": a
 *    coluna e PUBLICA na PDP, e um colchete tecnico no lugar do autor viraria
 *    curiosidade de vitrine. O placeholder diz a unica coisa que importa —
 *    foi um cliente de verdade (a RLS de 0014 so deixa avaliar quem recebeu o
 *    cafe). Nota e texto ficam: sao a prova social, e a 0014 ja decidiu que
 *    sobrevivem a exclusao; o dado PESSOAL da tabela e o nome. A idempotencia
 *    aqui e o proprio predicado (`<> 'Cliente Canastra'`), sem coluna nova —
 *    o segundo UPDATE nao acha linha.
 *
 * 3. `pedidos` continua identico a 0013 (denylist de itens inclusive), agora
 *    escrito via `redigir_endereco` — comportamento medido antes e depois
 *    pelo MESMO teste (f7_lgpd.test.js, casos das formas inesperadas).
 *
 * CREATE OR REPLACE preserva a ACL da 0013 (REVOKE PUBLIC + GRANT
 * service_role — proacl fica na troca de corpo), mas NAO preserva atributos
 * declarados: SECURITY INVOKER (default), o `SET search_path` e o nao-STRICT
 * sao re-declarados aqui de proposito, com as MESMAS razoes da 0013 — INVOKER
 * porque quem chama ja tem o privilegio (DEFINER so acrescentaria superficie
 * de bypass), nao-STRICT porque NULL tem de ser ERRO e nunca no-op silencioso
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
  -- Identico a 0013: NULL e erro de contrato (22004), nunca "nenhum alvo" —
  -- um no-op silencioso no fluxo de exclusao fabricaria o orfao irredigivel.
  IF alvo_user_id IS NULL THEN
    RAISE EXCEPTION 'A redação exige um titular: pedido órfão não tem redação por titular.'
      USING ERRCODE = 'null_value_not_allowed',
            HINT = 'Redija ANTES ou JUNTO da exclusão da conta — depois dela o vínculo já se foi.';
  END IF;

  /**
   * PEDIDOS — o comportamento da 0013, com o endereco delegado a
   * `redigir_endereco`. A denylist de itens continua aqui (e um formato de
   * ITEM, nao de endereco): o formato real do checkout so tem produto —
   * product_id, name (nome do PRODUTO, registro fiscal), price, quantity... —
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
   * ASSINATURAS — so as canceladas (decisao 1 do cabecalho). O `redigido_em`
   * novo faz o mesmo servico do de pedidos: idempotencia + auditoria da
   * PRIMEIRA redacao.
   */
  UPDATE canastra.assinaturas a
     SET endereco_json = canastra.redigir_endereco(a.endereco_json),
         redigido_em   = now(),
         atualizado_em = now()
   WHERE a.user_id = alvo_user_id
     AND a.status = 'cancelada'
     AND a.redigido_em IS NULL;

  /**
   * AVALIACOES — o nome publico sai; nota e texto ficam (decisao 2). O
   * predicado E a idempotencia: 'Cliente Canastra' nao e alvo de novo.
   * `moderado_em` NAO e tocado — redacao nao e moderacao.
   */
  UPDATE canastra.avaliacoes av
     SET nome_exibicao = 'Cliente Canastra'
   WHERE av.user_id = alvo_user_id
     AND av.nome_exibicao <> 'Cliente Canastra';

  RETURN pedidos_redigidos;
END;
$redigir$;
