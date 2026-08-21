-- Avaliacoes de produto: quem RECEBEU o cafe avalia; o resto le.
--
-- O DESENHO EM UMA FRASE: a fronteira e a RLS (a vitrine fala PostgREST
-- direto, sem servico no meio), e a pergunta "essa pessoa pode avaliar este
-- cafe?" e respondida pelo proprio banco — pedido `entregue` do chamador cujo
-- `itens` contem o SKU. Nenhum claim, nenhum campo vindo do navegador decide
-- nada alem de nota, titulo e texto.
--
-- POR QUE `sku` TEXTO, E NAO FK PARA `produtos`
-- A PDP agrupa por LINHA de cafe, e uma linha tem varios produtos no banco
-- (um por peso/pacote) casados com o catalogo editorial pelo `produtos.sku`
-- (`frontend/lib/catalogo/repositorio.ts`). O SKU e o vocabulario comum das
-- duas pontas — e, como no carrinho (0004) e no cupom do pedido (0010), a
-- avaliacao e uma fotografia: retirar um produto do catalogo nao pode apagar
-- as opinioes ja publicadas sobre ele.
--
-- POR QUE `nome_exibicao` CONGELADO NO INSERT
-- `user_id` e ON DELETE SET NULL (a avaliacao publicada sobrevive a exclusao
-- da conta, como o pedido em 0005). Exibir o nome via join com `clientes`
-- faria toda avaliacao de conta apagada aparecer sem autor — e um join da
-- vitrine com uma tabela de dado pessoal seria superficie a mais. A trigger
-- abaixo copia o nome UMA vez, no INSERT, e o navegador nao alcanca a coluna.

CREATE TABLE canastra.avaliacoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SET NULL, nunca CASCADE: apagar a conta nao apaga a prova social da loja.
  -- O que a LGPD manda apagar e o DADO PESSOAL — e o unico aqui e o nome, que
  -- o fluxo de exclusao pode redigir via service_role se o titular pedir.
  user_id       uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,

  -- Preenchida SEMPRE pela trigger `avaliacoes_congelar_nome`, nunca por quem
  -- insere (a coluna fica fora do GRANT de INSERT la embaixo): o cliente nao
  -- assina como outra pessoa, e o nome nao depende do vinculo continuar vivo.
  nome_exibicao text NOT NULL,

  sku           text NOT NULL,

  nota          integer NOT NULL
                  CONSTRAINT avaliacoes_nota_valida CHECK (nota BETWEEN 1 AND 5),

  -- Limites de tamanho no BANCO, nao so no formulario: o PostgREST aceita o
  -- que o GRANT deixar, e um texto de 2 MB numa coluna lida pela PDP inteira
  -- e um problema de todo mundo. 23514 citando a constraint e a recusa certa.
  --
  -- E O PISO TAMBEM: "nao informado" e NULL, nunca `''` nem `'   '`. A vitrine
  -- decide se renderiza o titulo/texto por VERACIDADE (`avaliacao.titulo ?`),
  -- e uma string de espacos e truthy — vira um <p> vazio empurrando o layout
  -- da PDP sem nada dentro. O formulario ja normaliza (`.trim() || null` em
  -- lib/avaliacoes/avaliacoes.ts), mas o formulario nao e a fronteira: o
  -- PostgREST aceita o INSERT que o GRANT permitir, de qualquer cliente. Aqui
  -- e onde a regra vale para todo mundo.
  --
  -- `~ '[^[:space:]]'` ("tem ao menos um caractere que nao e espaco") E NAO
  -- `btrim(x) <> ''`, e a diferenca importa: o `btrim` de um argumento so tira
  -- ESPACOS — `btrim(E' \n\t ')` devolve `E'\n\t'`, que nao e vazio e passaria
  -- pela constraint. Um texto de quebras de linha renderiza o mesmo paragrafo
  -- vazio que a regra existe para impedir. A classe POSIX cobre espaco, tab,
  -- nova linha, CR, FF e VT de uma vez, e diz em SQL a frase que se quer.
  titulo        text
                  CONSTRAINT avaliacoes_titulo_tamanho
                    CHECK (titulo IS NULL OR char_length(titulo) <= 80)
                  CONSTRAINT avaliacoes_titulo_nao_vazio
                    CHECK (titulo IS NULL OR titulo ~ '[^[:space:]]'),
  texto         text
                  CONSTRAINT avaliacoes_texto_tamanho
                    CHECK (texto IS NULL OR char_length(texto) <= 2000)
                  CONSTRAINT avaliacoes_texto_nao_vazio
                    CHECK (texto IS NULL OR texto ~ '[^[:space:]]'),

  -- `pendente` -> moderacao -> `aprovada` (publica) ou `oculta`. O DEFAULT e
  -- a UNICA porta de entrada: `status` esta fora do GRANT de INSERT, entao
  -- nenhuma avaliacao nasce publicada por conta propria.
  status        text NOT NULL DEFAULT 'pendente'
                  CONSTRAINT avaliacoes_status_valido
                    CHECK (status IN ('pendente', 'aprovada', 'oculta')),

  criado_em     timestamptz NOT NULL DEFAULT now(),
  -- Escrita pelo painel JUNTO com o status (nao ha trigger de moddatetime
  -- neste schema — a regra de 0005 vale aqui tambem).
  moderado_em   timestamptz,

  -- Uma avaliacao por cliente por cafe. Com `user_id` NULL (conta apagada) o
  -- indice trata cada ausencia como distinta (NULLS DISTINCT, o padrao), que
  -- e o desejado: duas contas apagadas nao colidem entre si.
  CONSTRAINT avaliacoes_uma_por_cafe UNIQUE (user_id, sku)
);

-- A consulta da PDP: aprovadas de uma lista de SKUs, mais novas primeiro.
CREATE INDEX avaliacoes_aprovadas_idx
  ON canastra.avaliacoes (sku, criado_em DESC)
  WHERE status = 'aprovada';

/**
 * "Quem esta pedindo RECEBEU este cafe?"
 *
 * SECURITY DEFINER pelo mesmo motivo de `eh_cliente()`/`eh_admin()` (0006):
 * a funcao le `pedidos`, que esta sob RLS, e e chamada DE DENTRO de uma
 * politica — como INVOKER ela enxergaria so o que a politica de `pedidos`
 * mostra ao chamador (que aqui ate bastaria: o dono le os proprios pedidos),
 * mas herdaria em silencio qualquer estreitamento futuro daquela politica.
 * `SET row_security = off` tira a mudez do modo de falha com FORCE, como la.
 * `SET search_path` obrigatorio em DEFINER; `pg_temp` por ultimo; `auth.uid()`
 * qualificado porque `auth` nao esta no caminho.
 *
 * O FORMATO DE `itens` E O DO CHECKOUT (PaymentController.validatedItems):
 * `[{product_id, name, image, price, quantity, size, weight, ...}]` — NAO ha
 * chave `sku` nos itens. O SKU e resolvido pelo join com `canastra.produtos`
 * via `product_id`. O preco disso esta escrito: produto APAGADO do catalogo
 * deixa de ser avaliavel (o join nao casa mais), o que e aceitavel — a PDP
 * dele tambem ja nao existe.
 *
 * DEFESAS, as duas medidas em test/f7_avaliacoes.test.js:
 *   - `jsonb_typeof(...) = 'array'`: `itens` nulo ou um objeto legado nao
 *     pode estourar 22023 ("cannot extract elements from a scalar") dentro
 *     de TODO INSERT da tabela — vira simplesmente zero linhas.
 *   - `pr.produto_id::text = item->>'product_id'`: a comparacao e em texto
 *     para um `product_id` malformado num pedido antigo nao virar 22P02 de
 *     cast de uuid no meio da politica.
 *
 * `alvo_sku` NULL responde FALSE (o EXISTS nao casa), nunca erro — e por isso
 * a funcao nao e STRICT: STRICT devolveria NULL, que o WITH CHECK trata igual
 * a FALSE, mas um boolean honesto poupa o proximo leitor da tabela-verdade.
 */
CREATE FUNCTION canastra.pode_avaliar(alvo_sku text) RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = canastra, pg_temp
  SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM canastra.pedidos p
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(p.itens) = 'array' THEN p.itens
            ELSE '[]'::jsonb END
     ) AS item
      JOIN canastra.produtos pr
        ON pr.produto_id::text = item->>'product_id'
     WHERE p.user_id = auth.uid()
       AND p.status = 'entregue'
       AND pr.sku = alvo_sku
  )
$$;

-- `proacl` nasce nulo (EXECUTE para PUBLIC): o REVOKE primeiro e a lista
-- explicita depois, como em 0006/0008. `anon` ENTRA na lista pela regra de
-- 0006 — hoje nenhuma politica que ele alcance chama a funcao (a leitura
-- publica e `status = 'aprovada'` puro), mas o dia em que uma chamar, a falta
-- de EXECUTE seria 42501 na vitrine parecendo recusa de politica.
REVOKE EXECUTE ON FUNCTION canastra.pode_avaliar(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canastra.pode_avaliar(text)
  TO anon, authenticated, service_role;

/**
 * Congela o nome no INSERT — SEMPRE, sobrescrevendo qualquer valor que tenha
 * chegado (o GRANT ja impede o navegador de mandar a coluna; a trigger cobre
 * os caminhos que nao passam pelo GRANT, como o service_role e o proprio
 * dono do banco num INSERT de manutencao).
 *
 * SECURITY DEFINER porque le `canastra.clientes`, que esta sob RLS, e o
 * insersor comum (authenticated) so enxerga a PROPRIA linha — o que ate
 * bastaria (a politica de INSERT exige `user_id = auth.uid()`), mas o DEFINER
 * desacopla a trigger da politica de leitura de `clientes`, que e a mesma
 * licao do `pode_avaliar` acima. `search_path` fixo, como manda 0006.
 *
 * O RAISE de 42501 cobre o insersor privilegiado que aponta para um uid sem
 * cadastro: sem ele o sintoma seria 23502 na coluna `nome_exibicao`, uma
 * mensagem sobre NOT NULL que manda procurar o erro no lugar errado. Para o
 * `authenticated` este ramo e inalcancavel — o WITH CHECK com `eh_cliente()`
 * ja teria recusado com o MESMO codigo.
 *
 * `SET row_security = off` PELO MOTIVO DE 0006, e nao por enfeite: e
 * exatamente o RAISE acima que cria a mudez. Com `FORCE ROW LEVEL SECURITY`
 * ligado em `clientes`, o dono deixa de ser isento, nenhuma politica daquela
 * tabela e `TO` dono, o SELECT volta ZERO linhas — e toda avaliacao da loja,
 * de qualquer cliente cadastrado, passa a ser recusada com "So quem tem
 * cadastro nesta loja pode avaliar.". Uma frase que mente com confianca e
 * manda procurar o erro no cadastro do cliente. Com o SET, a mesma situacao
 * responde 42501 "query would be affected by row-level security policy for
 * table clientes", que nomeia a tabela e a causa. No caminho saudavel e um
 * no-op (o dono ja e isento). E o contrario de 0008, onde a ausencia e
 * deliberada porque la o FORCE ja falharia sozinho, alto e nomeando a tabela.
 */
CREATE FUNCTION canastra.avaliacoes_congelar_nome() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = canastra, pg_temp
  SET row_security = off
AS $congelar_nome$
DECLARE
  nome_do_cliente text;
BEGIN
  SELECT c.nome INTO nome_do_cliente
    FROM canastra.clientes c
   WHERE c.user_id = NEW.user_id;

  IF nome_do_cliente IS NULL THEN
    RAISE EXCEPTION 'Só quem tem cadastro nesta loja pode avaliar.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  NEW.nome_exibicao := nome_do_cliente;
  RETURN NEW;
END;
$congelar_nome$;

REVOKE EXECUTE ON FUNCTION canastra.avaliacoes_congelar_nome() FROM PUBLIC;

CREATE TRIGGER avaliacoes_congela_nome
  BEFORE INSERT ON canastra.avaliacoes
  FOR EACH ROW
  EXECUTE FUNCTION canastra.avaliacoes_congelar_nome();

/* ------------------------------------------------------------------------- *
 * Privilegios: REVOKE do pacote de 0001, GRANTs por coluna
 * ------------------------------------------------------------------------- */

-- 0001 deu `arwd` de tabela a `authenticated` por default. Aqui o recorte e
-- por COLUNA nas tres operacoes, entao o pacote sai inteiro e volta so o que
-- cada papel precisa. `service_role` nao e tocado: credencial de servidor.
REVOKE ALL ON canastra.avaliacoes FROM anon, authenticated;

-- LEITURA. `anon` NAO recebe `user_id` nem `moderado_em`: o visitante nao tem
-- por que saber o uuid de quem avaliou (linkabilidade gratuita entre a
-- avaliacao e as outras tabelas da instancia) nem o carimbo interno de
-- moderacao. O preco e o mesmo do `custo` em 0006: um `select=*` de `anon`
-- responde 42501 em vez de dados — barulhento, nunca vazado — e a vitrine
-- lista colunas explicitas. `authenticated` le a tabela inteira: o dono
-- filtra as SUAS por `user_id`, e o painel do admin modera com tudo a vista.
GRANT SELECT (id, sku, nota, titulo, texto, nome_exibicao, status, criado_em)
  ON canastra.avaliacoes TO anon;
GRANT SELECT ON canastra.avaliacoes TO authenticated;

-- ESCRITA DO CLIENTE: so o que e dele. Fora da lista, e de proposito:
--   `status` ........ nasceria 'aprovada' por auto-servico;
--   `nome_exibicao` .. assinatura e da trigger;
--   `id`/`criado_em` . defaults;
--   `moderado_em` .... carimbo do painel.
GRANT INSERT (user_id, sku, nota, titulo, texto)
  ON canastra.avaliacoes TO authenticated;

-- MODERACAO: o mesmo desenho de `pedidos` em 0006 — a politica diz QUAL linha
-- (eh_admin), o GRANT diz QUAIS colunas. O dono NAO edita a avaliacao depois
-- de criada (decisao de simplicidade da onda 3I): nao ha politica de UPDATE
-- de dono, entao este GRANT so ganha vida nas maos de um admin.
GRANT UPDATE (status, moderado_em) ON canastra.avaliacoes TO authenticated;

-- DELETE fica sem GRANT e sem politica: remover avaliacao e gesto de
-- atendimento (service_role, que tem BYPASSRLS e o ALL de 0001), nao um
-- clique de navegador — nem do admin, que OCULTA em vez de apagar.

/* ------------------------------------------------------------------------- *
 * Politicas
 * ------------------------------------------------------------------------- */

ALTER TABLE canastra.avaliacoes ENABLE ROW LEVEL SECURITY;

-- A vitrine (logada ou nao) le o que passou pela moderacao. ATENCAO no
-- consumidor logado: as politicas se somam com OR, entao um cliente ve tambem
-- as proprias pendentes — a listagem publica da PDP FILTRA `status=eq.aprovada`
-- na consulta para nao misturar as duas coisas.
CREATE POLICY avaliacoes_aprovadas_publicas ON canastra.avaliacoes
  FOR SELECT TO anon, authenticated
  USING (status = 'aprovada');

-- Regra 2 de 0006: dono e `eh_cliente() AND user_id = auth.uid()`, nunca a
-- igualdade sozinha. E assim que a pessoa acompanha a propria avaliacao
-- enquanto pendente (e ve que uma foi ocultada, em vez de "sumiu").
CREATE POLICY avaliacoes_dono_le ON canastra.avaliacoes
  FOR SELECT TO authenticated
  USING (canastra.eh_cliente() AND user_id = auth.uid());

CREATE POLICY avaliacoes_admin_le ON canastra.avaliacoes
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());

-- A porta de entrada, com as tres condicoes somadas:
--   eh_cliente() ......... token estrangeiro da instancia compartilhada nao
--                          planta linha aqui (Regra 2 de 0006);
--   user_id = auth.uid() . ninguem avalia EM NOME de outro uid;
--   pode_avaliar(sku) .... so quem tem pedido `entregue` com o cafe.
CREATE POLICY avaliacoes_cliente_envia ON canastra.avaliacoes
  FOR INSERT TO authenticated
  WITH CHECK (
    canastra.eh_cliente()
    AND user_id = auth.uid()
    AND canastra.pode_avaliar(sku)
  );

-- Moderar e mudar linha inteira? NAO — o GRANT de coluna acima ja recorta
-- para (status, moderado_em). As duas camadas juntas sao a regra completa,
-- exatamente como `pedidos_admin_atualiza` + GRANT de coluna em 0006.
CREATE POLICY avaliacoes_admin_modera ON canastra.avaliacoes
  FOR UPDATE TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());
