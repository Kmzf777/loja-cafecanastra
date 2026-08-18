-- A sacola montada deslogado, fundida na sacola da conta no login.
--
-- POR QUE ESTA MIGRACAO EXISTE
-- `frontend/lib/sacola/sacola.tsx` guarda a sacola de quem nao esta logado em
-- `localStorage["cart"]`, e hoje quem funde essa lista na sacola da conta e o
-- `signIn` do backend proprio. Com o GoTrue assumindo o login, essa costura
-- deixa de existir. Sem substituto, TODO cliente que monta a sacola deslogado e
-- depois entra PERDE os itens, em silencio — e a sacola e o caminho da receita.
-- A fusao passa a ser esta funcao, chamada pelo navegador logo depois do login.
--
-- O CONTRATO, QUE NAO E O DA VITRINE — LEIA ANTES DE LIGAR OS DOIS LADOS
-- As chaves do JSON aqui sao as COLUNAS de `canastra.carrinho_itens`, em
-- portugues: produto_id, quantidade, preco, nome, imagem, tamanho, moagem. O
-- `ItemDaSacola` do `localStorage` esta em ingles (product_id, quantity, price,
-- name, image, size) e so `moagem` coincide. Quem chamar TEM de traduzir; mandar
-- a lista crua faz `produto_id` vir nulo em todo item, e o efeito e a sacola
-- inteira ser descartada em silencio (ver o filtro adiante). O portugues foi
-- mantido porque o resto do schema e portugues e uma RPC que fala ingles so
-- deste lado seria a excecao que ninguem lembra.
--
-- A FUSAO NAO E IDEMPOTENTE, E NAO TEM COMO SER. A lista que chega nao carrega
-- identidade nenhuma, entao chamar duas vezes com a mesma sacola soma duas
-- vezes. `onAuthStateChange` do supabase-js dispara mais de uma vez por sessao
-- (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED): quem chamar em todas elas dobra
-- a sacola do cliente a cada evento. A unica defesa esta no navegador — apagar
-- `localStorage["cart"]` assim que a fusao responder, e so entao. Medido em
-- test/fundir_sacola.test.js.

/**
 * NAO E SECURITY DEFINER, e isso e a decisao mais importante do arquivo.
 *
 * O reflexo, numa funcao que escreve em tabela sob RLS, e marca-la DEFINER. Aqui
 * seria errado, e foi MEDIDO: como Ana (cliente da loja), o upsert em
 * `carrinhos` e o upsert em `carrinho_itens` passam sob as PROPRIAS politicas de
 * 0006 (`carrinhos_dono` e `carrinho_itens_dono`); como ESTRANHA — token de
 * outro projeto da instancia compartilhada, ausente de `canastra.clientes` — os
 * mesmos comandos levam 42501. Ou seja, a RLS ja faz exatamente o recorte certo
 * e nao falta privilegio nenhum a ser emprestado.
 *
 * O que DEFINER acrescentaria seria so o risco: dentro dela `auth.uid()`
 * continua sendo o do chamador, mas a RLS para de valer, e qualquer descuido
 * futuro no corpo (aceitar um `user_id` vindo do JSON, por exemplo) viraria
 * escrita na sacola alheia sem que politica nenhuma reclamasse — a superficie de
 * bypass que 0006 gasta o arquivo inteiro fechando. test/fundir_sacola.test.js
 * afirma `prosecdef = false` no catalogo para que ligar DEFINER aqui fique
 * vermelho no CI.
 *
 * `SET search_path` NAO e obrigatorio numa funcao INVOKER — ela roda com os
 * poderes de quem chama, entao nao ha privilegio a sequestrar. Vai mesmo assim,
 * e por um motivo pratico: PostgREST chama com o `search_path` que estiver
 * configurado na instancia COMPARTILHADA, que nao e desta loja e pode mudar sem
 * aviso. Todo nome no corpo ja esta qualificado; o SET so garante que continue
 * resolvendo igual se alguem esquecer de qualificar um nome novo.
 *
 * NAO E `STRICT`, de proposito. Com STRICT, `fundir_sacola(NULL)` devolveria
 * NULL sem entrar no corpo — sem a checagem de cliente e sem garantir a sacola
 * da conta. O caso nulo e tratado la dentro, onde da para decidir o que ele
 * significa.
 */
CREATE FUNCTION canastra.fundir_sacola(itens jsonb) RETURNS void
  LANGUAGE plpgsql
  SET search_path = canastra, pg_temp
AS $fundir_sacola$
DECLARE
  /**
   * Teto de quantidade por item, e a unica razao dele e aritmetica.
   *
   * `quantidade` e `integer`. Uma sacola com quantidades absurdas — lixo em
   * `localStorage`, ou um item somado muitas vezes por chamadas repetidas —
   * chegaria em 2^31 e a fusao morreria com 22003 ("integer out of range") no
   * login. O teto e generoso o bastante para nunca alcancar cliente nenhum de
   * uma torrefacao e baixo o bastante para a soma jamais transbordar.
   */
  TETO_DE_QUANTIDADE constant integer := 999999;

  lista jsonb;
  id_do_carrinho uuid;
BEGIN
  /**
   * A checagem explicita de cliente NAO e redundante com a RLS, e nao esta aqui
   * por seguranca — a seguranca ja e das politicas de 0006, que recusam sozinhas.
   * Esta aqui pela MENSAGEM: sem ela, quem nao e cliente desta loja recebe um
   * 42501 falando de politica de linha numa tabela chamada `carrinhos`, e o
   * problema real e nao ter cadastro na loja.
   *
   * ERRCODE explicito, e nao o P0001 que o RAISE daria de graca, pela mesma
   * licao de 0002: P0001 e o codigo de QUALQUER RAISE do banco, entao quem chama
   * teria de casar TEXTO de mensagem para reconhecer esta recusa.
   * `insufficient_privilege` (42501) e o codigo que a propria RLS usaria neste
   * caso — os dois caminhos passam a responder a mesma coisa, que e o que quem
   * chama precisa tratar.
   */
  IF NOT canastra.eh_cliente() THEN
    RAISE EXCEPTION 'Quem chamou não é cliente desta loja.'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'A sacola só existe para quem tem cadastro nesta loja.';
  END IF;

  /**
   * O ENVELOPE E EXIGIDO; O CONTEUDO E MELHOR ESFORCO. A linha entre tolerar e
   * recusar esta aqui, e ela foi escolhida, nao herdada.
   *
   * TOLERADO — ausencia de sacola, nas tres formas que o navegador produz: SQL
   * NULL, o JSON `null` e a lista vazia. Nenhuma pode virar excecao: a fusao roda
   * no INSTANTE do login, e derrubar o login de quem tem a sacola vazia troca um
   * problema nenhum por um problema grande.
   *
   * RECUSADO — qualquer outra coisa no lugar da lista (objeto, numero, string,
   * booleano). Isso nao e dado velho de cliente: o `lerLocal()` da vitrine ja
   * devolve `[]` para o que nao for array, entao esta forma so chega aqui por bug
   * de quem chama. Tolerar em silencio significaria a sacola sumir no login sem
   * uma linha de log — exatamente a falha que esta migracao existe para impedir.
   *
   * Sem este guarda o proprio `jsonb_array_elements` recusaria, com o mesmo
   * SQLSTATE e uma mensagem que fala de "cannot extract elements from a scalar";
   * o que se ganha aqui e um texto que diz o que mandar.
   */
  IF itens IS NULL OR jsonb_typeof(itens) = 'null' THEN
    lista := '[]'::jsonb;
  ELSIF jsonb_typeof(itens) <> 'array' THEN
    RAISE EXCEPTION 'A sacola precisa ser uma lista JSON, e veio %.', jsonb_typeof(itens)
      USING ERRCODE = 'invalid_parameter_value',
            HINT = 'Mande [] quando não houver nada a fundir.';
  ELSE
    lista := itens;
  END IF;

  /**
   * A sacola da conta, criada se ainda nao houver — e o `ON CONFLICT` so e
   * possivel por causa do UNIQUE em `carrinhos.user_id` que 0004 criou para isto.
   *
   * `DO UPDATE`, e nao `DO NOTHING`, por DUAS razoes independentes:
   *
   *   1. `RETURNING` num upsert devolve a linha nos ramos INSERT e DO UPDATE, mas
   *      NAO no DO NOTHING — com DO NOTHING, `id_do_carrinho` ficaria NULL toda
   *      vez que a sacola ja existisse, e o INSERT de itens logo abaixo morreria
   *      com NOT NULL em `carrinho_id`. Ou seja, funcionaria no primeiro login de
   *      cada pessoa e quebraria em todos os seguintes.
   *   2. `atualizado_em` nao tem gatilho nenhum neste schema (0004 registra isso:
   *      manter a coluna e trabalho de quem escreve, e esta RPC e uma das
   *      escritoras). Sem o `now()` aqui, a data de alteracao da sacola fica igual
   *      a de criacao para sempre.
   *
   * `carrinho_itens` NAO tem `atualizado_em` — a coluna nao existe naquela tabela
   * —, entao nao ha carimbo a manter do lado dos itens.
   */
  INSERT INTO canastra.carrinhos (user_id)
  VALUES (auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET atualizado_em = now()
  RETURNING carrinho_id INTO id_do_carrinho;

  /**
   * A fusao propriamente dita, em duas etapas com nomes.
   *
   * `validos` — o filtro. Cada predicado descarta um item, nunca a sacola inteira:
   *   · `jsonb_typeof(item) = 'object'` tira null, numero, string e lista soltos
   *     na lista; sem ele, `item ->> 'produto_id'` num escalar levanta 22023.
   *   · o regex de uuid substitui um `::uuid` que levantaria 22P02 em qualquer
   *     `produto_id` torto — e um item sem produto nao e um item.
   *   · o regex de quantidade e o mais estreito de todos porque quantidade e a
   *     unica coisa aqui que vira dinheiro: so inteiro de 1 a 999999 passa. Zero e
   *     negativo cairiam no CHECK (quantidade > 0) de 0004 e derrubariam a fusao
   *     inteira por causa de um item; fracionado e texto levantariam 22P02.
   *
   * MATERIALIZED nao e enfeite: ele obriga o filtro a rodar como um passo
   * proprio, antes de qualquer conversao da etapa seguinte. Sem a barreira, a
   * garantia de que o `::uuid` so ve linha ja filtrada passa a depender do plano
   * que o Postgres escolher — e um plano nao e um contrato.
   *
   * `somados` — a soma DENTRO da propria lista, e ela conserta uma armadilha real
   * do ON CONFLICT: um unico INSERT nao pode tocar a MESMA linha duas vezes. Com
   * duas entradas de mesmo produto e mesma moagem na lista, o comando morre com
   * 21000 ("ON CONFLICT DO UPDATE command cannot affect row a second time") — no
   * login, na cara do cliente, com a sacola inteira perdida. E `localStorage`
   * chega assim com facilidade: basta um resto de uma versao do site que juntasse
   * itens por outra chave.
   *
   * `min()` nas colunas de exibicao e escolha arbitraria assumida: sao copias do
   * mesmo produto, e o que se precisa e de UM valor determinista, nao do "certo".
   * O preco vale a mesma coisa e um pouco mais: ele e COPIA DE EXIBICAO, quem
   * cobra e o checkout, que rele preco e estoque do banco antes de gerar o
   * pagamento. Por isso um preco impresentavel vira 0 em vez de descartar o
   * item — mostrar "R$ 0,00" ate a vitrine reler o catalogo e reversivel; perder
   * o item nao e.
   */
  WITH validos AS MATERIALIZED (
    SELECT item
    FROM jsonb_array_elements(lista) AS item
    WHERE jsonb_typeof(item) = 'object'
      AND item ->> 'produto_id' ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND item ->> 'quantidade' ~ '^[1-9][0-9]{0,5}$'
  ),
  somados AS (
    SELECT
      (item ->> 'produto_id')::uuid AS produto_id,
      item ->> 'moagem'             AS moagem,
      least(sum((item ->> 'quantidade')::integer), TETO_DE_QUANTIDADE)::integer
                                    AS quantidade,
      min(
        CASE
          WHEN item ->> 'preco' ~ '^[0-9]{1,8}(\.[0-9]+)?$'
          THEN (item ->> 'preco')::numeric
          ELSE 0
        END
      )                             AS preco,
      min(item ->> 'nome')          AS nome,
      min(item ->> 'imagem')        AS imagem,
      min(item ->> 'tamanho')       AS tamanho
    FROM validos
    GROUP BY 1, 2
  )
  INSERT INTO canastra.carrinho_itens AS destino
    (carrinho_id, produto_id, quantidade, preco, nome, imagem, tamanho, moagem)
  SELECT id_do_carrinho, produto_id, quantidade, preco, nome, imagem, tamanho, moagem
  FROM somados
  /**
   * LIMITE CONHECIDO, herdado de 0004 e NAO esquecido: no Postgres cada NULL e
   * distinto dos outros num indice unico (NULLS DISTINCT, o padrao), entao a
   * chave (carrinho_id, produto_id, NULL) nunca colide com ela mesma e este
   * ON CONFLICT NAO DISPARA para item sem moagem — ele duplica na sacola em vez
   * de somar.
   *
   * A RPC NAO conserta isso por conta propria, e a decisao e deliberada: um
   * `coalesce(moagem, 'padrao')` aqui gravaria uma moagem que a vitrine nunca
   * escreve quando insere direto pelo PostgREST, e as duas metades da sacola
   * passariam a nao casar NUNCA MAIS — trocaria uma duplicata visivel por uma
   * divergencia permanente entre dois caminhos de escrita. Passa porque a vitrine
   * sempre manda moagem para cafe, o unico produto com essa variacao. O conserto
   * de verdade e `UNIQUE NULLS NOT DISTINCT` (PG 15+) ou um default na coluna, e
   * as DUAS mexem no alvo deste ON CONFLICT. Nao mude uma sem a outra.
   *
   * O `::bigint` no meio da soma existe para o mesmo transbordo que o teto: a
   * linha que ja esta na conta pode ter sido escrita direto pelo PostgREST, sem
   * passar por este teto, e `int + int` estoura antes de o `least` opinar.
   */
  ON CONFLICT (carrinho_id, produto_id, moagem) DO UPDATE
    SET quantidade =
      least(destino.quantidade::bigint + EXCLUDED.quantidade, TETO_DE_QUANTIDADE)::integer;
END;
$fundir_sacola$;

/**
 * `proacl` nasce nulo, o que significa EXECUTE para PUBLIC — e PUBLIC inclui
 * `anon`. O REVOKE primeiro e a lista explicita depois deixam escrito quem chama.
 *
 * SO `authenticated`, e a ausencia dos outros dois e deliberada:
 *   · `anon` nao tem `auth.uid()`, entao so entraria na funcao para ser barrado
 *     la dentro pelo `eh_cliente()`. Negar no privilegio e a camada de baixo
 *     negando primeiro — o principio das duas camadas de 0001.
 *   · `service_role` nao chama: a fusao e um gesto do NAVEGADOR de quem acabou de
 *     entrar, e o servico Node, quando precisar mexer em sacola, tem BYPASSRLS e
 *     escreve direto nas tabelas.
 *
 * NOTA PARA A CONFIGURACAO DO POSTGREST: uma RPC so aparece em /rest/v1/rpc/ se o
 * schema estiver em `PGRST_DB_SCHEMAS`. Se `canastra` nao estiver la, esta funcao
 * responde 404 com a migracao perfeitamente aplicada.
 */
REVOKE EXECUTE ON FUNCTION canastra.fundir_sacola(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canastra.fundir_sacola(jsonb) TO authenticated;
