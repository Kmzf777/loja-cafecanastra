-- LGPD: redação dos dados do titular nos pedidos.
--
-- POR QUE ESTA MIGRACAO EXISTE
-- 0005 deixou a divida escrita no proprio cabecalho de `pedidos`: o ON DELETE
-- SET NULL preserva a VENDA quando o cliente e apagado (faturamento e registro
-- fiscal), mas `endereco_json` e uma fotografia congelada — nome, CPF, telefone
-- e endereco completo sobrevivem intactos no pedido orfao. "Apagar o cliente"
-- NUNCA foi apagar os dados da pessoa, e um pedido de exclusao de titular
-- (LGPD art. 18, IV/VI) nao era atendivel. Esta migracao cria o passo que
-- faltava: redigir o que identifica a pessoa, preservando o que a obrigacao
-- fiscal e a estatistica de vendas pedem.
--
-- O QUE FICA E O QUE SAI, E POR QUE A LINHA E ESSA
--   FICA  cidade + UF ........ estatistica de venda por regiao, nao identifica
--                              uma pessoa sozinha;
--   FICA  prefixo do CEP ..... 3 digitos + 'xxxxx': regiao de distribuicao,
--                              nunca a porta da casa (o CEP completo, junto do
--                              numero, e um endereco);
--   FICA  total/status/itens de produto ... a VENDA, que 0005 preserva de
--                              proposito — o que se vendeu, por quanto, quando;
--   SAI   todo o resto do endereco, por WHITELIST e nao por denylist: chave
--                              que a redacao nao conhece (um campo novo do
--                              checkout de amanha) vira "[redigido]" em vez de
--                              vazar por omissao. Denylist envelhece.
--
-- OS DOIS VOCABULARIOS SAO REAIS, nao paranoia: a vitrine atual grava chaves em
-- ingles (`zip_code`, `street`, `city` — frontend/lib/sacola/checkout.ts), e o
-- legado/loja anterior gravava em portugues (`nome`, `cpf`, `rua` — o exemplo
-- literal do cabecalho de 0005). A whitelist cobre os dois; o que nao esta nela
-- e redigido de qualquer forma.
--
-- O LIMITE CONHECIDO, ESCRITO PARA NAO SE PERDER: pedido JA orfao (user_id
-- NULL) e IRREDIGIVEL por titular — o vinculo se foi, nao ha como saber de quem
-- ele era. Por isso a redacao TEM de acontecer ANTES ou JUNTO da exclusao da
-- conta (conta.routes.js chama esta funcao antes do DELETE no GoTrue e aborta a
-- exclusao se ela falhar), e por isso o parametro NULL e ERRO e nao no-op — um
-- no-op silencioso naquele fluxo "redigiria" nada e fabricaria o orfao
-- irredigivel para sempre. Orfaos pre-existentes (criados antes desta migracao)
-- so tem redacao MANUAL, em massa: o SQL pronto esta em
-- docs/seguranca-dados-pessoais.md.

-- NULL = nunca redigido; preenchida = quando a redacao aconteceu. E o carimbo
-- de auditoria do atendimento ao titular (prova de que o pedido do art. 18 foi
-- atendido, e quando) e o que torna a funcao abaixo idempotente: so pedidos
-- com a coluna NULL sao alvo, entao repetir a chamada nao move o carimbo da
-- PRIMEIRA redacao.
ALTER TABLE canastra.pedidos
  ADD COLUMN redigido_em timestamptz;

/**
 * POR QUE UMA FUNCAO NO BANCO, e nao SQL solto no Node: a redacao de todos os
 * pedidos de um titular precisa ser ATOMICA (redigir metade e falhar deixaria
 * um estado que nenhum retry entende) e precisa ser testavel isolada do
 * Express. Uma funcao e as duas coisas de graca.
 *
 * NAO E SECURITY DEFINER, e a decisao e a mesma medida em 0007: quem chama e o
 * pool do Express (o dono do banco, isento de RLS nas proprias tabelas) ou
 * `service_role` (BYPASSRLS + ALL em tabelas de `canastra`, default privileges
 * de 0001). Nao ha privilegio faltando a emprestar — DEFINER aqui so
 * acrescentaria a superficie de bypass que 0006 gasta o arquivo inteiro
 * fechando. O teste f7_lgpd.test.js afirma `prosecdef = false` no catalogo.
 *
 * `SET search_path` vai mesmo assim, pelo motivo pratico de 0007: todo nome no
 * corpo esta qualificado, e o SET garante que continue resolvendo igual se um
 * nome novo entrar sem qualificacao.
 *
 * NAO E STRICT, de proposito e com consequencia grave se mudar: STRICT faria
 * `redigir_dados_do_titular(NULL)` devolver NULL SEM ENTRAR NO CORPO — um
 * no-op silencioso exatamente no fluxo de exclusao de conta, que apagaria a
 * conta sem redigir nada. O caso NULL e tratado dentro, como ERRO.
 *
 * RETORNA a contagem de pedidos redigidos: o endpoint de atendimento a titular
 * responde com ela, e "0" depois de uma primeira chamada e a prova barata de
 * idempotencia nos testes.
 */
CREATE FUNCTION canastra.redigir_dados_do_titular(alvo_user_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path = canastra, pg_temp
AS $redigir$
DECLARE
  pedidos_redigidos integer;
BEGIN
  /**
   * NULL e ERRO, nunca "nenhum pedido". Ver o cabecalho: pedido orfao perdeu o
   * vinculo com o titular, entao nao existe "redigir os pedidos do titular
   * NULL" — existiria "redigir TODOS os orfaos da tabela", que e outra
   * operacao, manual e deliberada (docs/seguranca-dados-pessoais.md).
   *
   * ERRCODE 22004 (null_value_not_allowed): e o codigo que um STRICT
   * implicitamente "usaria" se recusasse em vez de calar — quem chama trata um
   * caso de contrato, nao um P0001 generico.
   */
  IF alvo_user_id IS NULL THEN
    RAISE EXCEPTION 'A redação exige um titular: pedido órfão não tem redação por titular.'
      USING ERRCODE = 'null_value_not_allowed',
            HINT = 'Redija ANTES ou JUNTO da exclusão da conta — depois dela o vínculo já se foi.';
  END IF;

  UPDATE canastra.pedidos p
     SET
       /**
        * O endereco, por WHITELIST. `jsonb_each` + `jsonb_object_agg` reescreve
        * o objeto chave a chave:
        *   - cidade/UF passam intactas (as duas grafias);
        *   - CEP vira prefixo: so os digitos, 3 primeiros, resto 'xxxxx'. Um
        *     CEP impresentavel (vazio, lixo) degrada para 'xxxxx' — perde a
        *     estatistica, nunca vaza o dado;
        *   - TODA outra chave vira "[redigido]", inclusive as que ainda nao
        *     existem.
        *
        * O COALESCE para '{}' nao e enfeite: `jsonb_object_agg` sobre um objeto
        * VAZIO agrega zero linhas e devolve NULL — e um endereco que era `{}`
        * viraria NULL, mudando de tipo aos olhos de quem le.
        *
        * Endereco NULL (ou JSON null) fica como esta: nao ha dado a redigir e
        * inventar um objeto onde nunca houve um mentiria sobre o pedido.
        * Endereco que nao e objeto (escalar gravado por algum caminho torto)
        * vira "[redigido]" inteiro: nao da para saber o que ha dentro de uma
        * string livre, entao ela sai por inteiro.
        */
       endereco_json = CASE
         WHEN p.endereco_json IS NULL OR jsonb_typeof(p.endereco_json) = 'null'
           THEN p.endereco_json
         WHEN jsonb_typeof(p.endereco_json) <> 'object'
           THEN to_jsonb('[redigido]'::text)
         ELSE (
           SELECT COALESCE(
             jsonb_object_agg(
               e.chave,
               CASE
                 WHEN lower(e.chave) IN ('cidade', 'city')          THEN e.valor
                 WHEN lower(e.chave) IN ('uf', 'estado', 'state')   THEN e.valor
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
           FROM jsonb_each(p.endereco_json) AS e(chave, valor)
         )
       END,
       /**
        * Os itens, por DENYLIST — e aqui a denylist e a escolha certa, nao a
        * preguicosa: o formato real gravado pelo checkout (validatedItems em
        * PaymentController) e SO produto — product_id, name (nome do PRODUTO,
        * que e registro fiscal do que se vendeu, nunca dado pessoal), image,
        * price, quantity, size e dimensoes. Uma whitelist congelaria essa
        * lista e apagaria o proximo campo de PRODUTO que o checkout gravasse —
        * destruindo registro fiscal, que e exatamente o que 0005 preserva. A
        * denylist aqui e defensiva contra formato historico/futuro que carregue
        * dado pessoal DENTRO do item; hoje ela nao encontra nada.
        *
        * So listas sao processadas: e o unico formato que algum caminho de
        * escrita da loja produz (JSON.stringify de um array, sempre). NULL e
        * nao-lista ficam como estao.
        */
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
               -- A ordem dos itens e parte do registro da venda; sem o ORDER BY
               -- a agregacao teria licenca para embaralha-la.
               ORDER BY item.ordem
             ),
             '[]'::jsonb
           )
           FROM jsonb_array_elements(p.itens) WITH ORDINALITY AS item(valor, ordem)
         )
       END,
       redigido_em = now(),
       -- Regra de 0005: nao ha trigger de moddatetime, quem escreve carimba.
       atualizado_em = now()
   WHERE p.user_id = alvo_user_id
     -- A idempotencia inteira esta neste predicado: pedido ja redigido nao e
     -- alvo de novo, entao repetir a chamada devolve 0 e o carimbo da PRIMEIRA
     -- redacao (a que atendeu o titular) fica intacto para a auditoria.
     AND p.redigido_em IS NULL;

  GET DIAGNOSTICS pedidos_redigidos = ROW_COUNT;
  RETURN pedidos_redigidos;
END;
$redigir$;

/**
 * `proacl` nasce nulo = EXECUTE para PUBLIC, e PUBLIC inclui `anon`. O REVOKE
 * primeiro e a lista explicita depois deixam escrito quem chama.
 *
 * SO `service_role`, e a ausencia dos outros dois e deliberada:
 *   · `authenticated` NAO executa: redacao e gesto de SERVIDOR — o fluxo de
 *     exclusao de conta e o atendimento a titular pelo admin, ambos no Express
 *     (que conecta como dono do banco e nem precisa de GRANT). Dar EXECUTE a
 *     `authenticated` deixaria qualquer token da instancia COMPARTILHADA
 *     disparar redacao... de nada (a funcao so alcanca pedidos do proprio
 *     user_id se combinada com RLS? NAO — ela e INVOKER mas recebe o alvo por
 *     PARAMETRO, entao um token qualquer apontaria para o user_id que quisesse
 *     e apagaria dados de endereco de pedidos ALHEIOS. E destruicao de dado
 *     como servico, e fica fechada).
 *   · `anon` idem, com menos cerimonia ainda.
 *
 * NOTA: o pool do Express conecta como o DONO do banco (docs/producao.md §5.1),
 * que executa a propria funcao sem GRANT nenhum — o GRANT a `service_role`
 * existe para o caminho PostgREST/scripts de operacao, nao para o Express.
 */
REVOKE EXECUTE ON FUNCTION canastra.redigir_dados_do_titular(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canastra.redigir_dados_do_titular(uuid) TO service_role;
