-- O bloco fiscal de `produtos`, o estado do produto, e o snapshot de custo.
--
-- O ITEM QUE DECIDE A ACEITACAO DO CLIENTE. A loja hoje nunca CRIA produto no
-- Bling — `src/services/blingPedidos.js` so confere se o SKU ja existe la — e os
-- dois POST de emissao de NF-e vao SEM CORPO NENHUM: 100% da regra fiscal mora
-- na conta Bling, escrita a mao, produto por produto. As doze colunas abaixo sao
-- o que falta para a loja ser a fonte daquele cadastro.
--
-- O MODO DE FALHA QUE ELAS FECHAM E O PIOR QUE EXISTE, e vale escrever inteiro
-- porque e ele que justifica cada CHECK deste arquivo: um produto sem NCM PASSA
-- na sincronizacao, PASSA no cadastro, PASSA na venda — e so falha na
-- TRANSMISSAO A SEFAZ, com o pedido do cliente ja pago e parado esperando nota.
-- O erro e criado meses antes de aparecer, e aparece na unica hora em que nao da
-- para consertar com calma. Todo CHECK aqui existe para antecipar essa recusa
-- para o INSERT, onde ela custa uma mensagem de tela.
--
-- ESTA MIGRACAO NAO EMITE NADA. Quem monta o corpo do POST de emissao e a Onda 4.
--
-- ---------------------------------------------------------------------------
-- O QUE NAO SE TOCA: A COLUNA `peso`
-- ---------------------------------------------------------------------------
--
-- `canastra.produtos.peso` e `numeric(10,3) NOT NULL DEFAULT 0.3` desde 0003 e
-- serve ao FRETE: o `ShippingController` a le hoje para cotar com os Correios, e
-- ela esta na projecao de `produtos_publicos` e no GRANT de coluna de `anon`
-- (0006:232). Ela NAO e renomeada, NAO e reaproveitada como peso liquido e NAO
-- muda de default. `peso_liquido` e `peso_bruto` entram AO LADO porque sao
-- grandezas diferentes: a NF-e quer o peso do produto e o peso com embalagem, e
-- o frete quer o peso que vai na caixa. Confundir os tres e cotar frete errado
-- ou emitir nota errada — e o primeiro e silencioso.
--
-- ---------------------------------------------------------------------------
-- A DECISAO DO SNAPSHOT DE CUSTO: A CHAVE VAI NO JSONB DE `pedidos.itens`
-- ---------------------------------------------------------------------------
--
-- `produtos.custo` existe, mas custo muda: cafe cru sobe, o dolar mexe, o frete
-- de entrada muda. Recalcular a margem de uma venda de marco com o custo de hoje
-- MENTE sobre o passado, e essa mentira e sistematica (sempre a favor ou sempre
-- contra, conforme o custo subiu ou caiu). Congelar o custo do item no momento da
-- venda e o que faz o relatorio de margem existir.
--
-- AS DUAS SAIDAS ERAM: acrescentar a chave `custo_centavos` em cada item de
-- `pedidos.itens` (que e `jsonb`), ou criar uma tabela `pedido_itens` de verdade.
-- Esta migracao faz a PRIMEIRA, e o que decidiu foi o modo de falha de cada uma:
--
--   O JSONB JA E O LUGAR DA FOTOGRAFIA. 0005 chama `pedidos.itens` de "fotografia
--   congelada" e e exatamente isso que se quer aqui — nome, preco e agora custo,
--   como estavam no dia. A chave nova entra na mesma linha, na mesma transacao,
--   escrita pelo mesmo `INSERT` do checkout. Nao ha janela em que metade da venda
--   esteja gravada.
--
--   A REDACAO DE LGPD JA A COBRE, e isto foi VERIFICADO e nao suposto: a redacao
--   de `itens` em 0013/0016 e por DENYLIST — chave de PRODUTO passa intacta,
--   chave de PESSOA vira "[redigido]" — e aquele comentario explica que a
--   denylist foi escolhida justamente para "nao apagar o proximo campo de PRODUTO
--   que o checkout gravasse, destruindo registro fiscal". `custo_centavos` e
--   campo de produto. Medido em test/produto_fiscal.test.js: depois de
--   `redigir_dados_do_titular`, o custo e o nome do produto continuam la e o CPF
--   plantado no mesmo item sai.
--
--   E A TABELA NOVA TERIA UM FURO QUE ESTA ONDA NAO PODE FECHAR. `pedido_itens`
--   so vale se o checkout escrever nela, e o checkout e codigo de aplicacao — que
--   esta onda nao toca. A tabela nasceria VAZIA e continuaria vazia a cada venda
--   nova ate a Onda 4, enquanto `pedidos.itens` seguiria sendo a verdade. Duas
--   representacoes do mesmo item, uma delas silenciosamente incompleta, e um
--   relatorio que soma zero sem erro nenhum. Alem disso, a migracao de dados dos
--   pedidos existentes so poderia preencher o custo com NULL — o custo daquele
--   dia nao esta guardado em lugar nenhum —, entao nem o passado ela resolveria.
--
-- O PRECO DESTA ESCOLHA, escrito para nao se perder: o banco NAO consegue exigir
-- a chave. Um CHECK sobre `itens` que a tornasse obrigatoria recusaria todo
-- pedido que o checkout de hoje grava, isto e, derrubaria a loja — e um NOT VALID
-- so adiaria o mesmo estrago para o proximo INSERT. Entao a garantia aqui e de
-- CODIGO, na Onda 4, com teste; o que esta migracao entrega e a decisao escrita
-- no lugar onde ela vai ser procurada, e a prova de que a redacao a preserva.
-- `pedido_ajustes_desconto` (0032) ja aponta para o item por `alvo_ref` em texto,
-- pela mesma razao: hoje a identidade do item de pedido e a entrada do jsonb.
--
-- ---------------------------------------------------------------------------
-- POR QUE 0034. Mesma razao de 0030 a 0033: a faixa 0017-0029 esta disputada
-- fora daqui (worktrees `melhor-envio` e `whatsapp-bot`), o runner ABORTA em
-- numero repetido e a chave em `canastra.migracoes` e o nome completo do arquivo.

/* ------------------------------------------------------------------------- *
 * 1. O bloco fiscal
 * ------------------------------------------------------------------------- */

/**
 * TODAS AS COLUNAS FISCAIS SAO NULAVEIS E NENHUMA TEM DEFAULT, e isso e uma
 * decisao, nao um esquecimento.
 *
 * A tentacao obvia era dar um NCM padrao de cafe torrado a todo mundo e acabar
 * com o problema numa linha. Ela esta recusada porque os dois erros nao sao
 * simetricos:
 *
 *   NCM VAZIO ..... a SEFAZ recusa a transmissao. Alto, imediato, com o nome do
 *                   campo na mensagem. Alguem conserta hoje.
 *   NCM ERRADO .... a SEFAZ ACEITA. A nota sai, o cliente recebe, e o imposto
 *                   recolhido esta errado por meses — ate uma fiscalizacao, uma
 *                   auditoria do contador ou uma malha. Sem sintoma nenhum.
 *
 * Classificacao fiscal e decisao do CONTADOR, nao do desenvolvedor — a propria
 * spec §7-C ja registra isso ao deixar "serie e natureza de operacao da NF-e"
 * como decisao que passa pelo contador. Este arquivo garante a FORMA (quantos
 * digitos, que faixa) e se recusa a inventar o CONTEUDO.
 *
 * `unidade` e a unica excecao, e por nao ser classificacao fiscal: e como o
 * produto se conta. Todo item do catalogo de hoje e vendido por unidade (sacos
 * de 250 g, caixas de 3), e um NULL ali derrubaria a nota por um fato que
 * ninguem disputa.
 */
ALTER TABLE canastra.produtos
  -- NCM — Nomenclatura Comum do Mercosul, 8 digitos. O contador escreve com
  -- ponto ('0901.11.10') e a SEFAZ quer sem ('09011110'); e a mesma familia do
  -- CEP com hifen que esta loja ja teve (commit 7fe8d36). O CHECK nao normaliza:
  -- ele faz o caminho que esquecer de normalizar ERRAR, no INSERT, em vez de
  -- virar uma nota recusada meses depois.
  ADD COLUMN ncm text
    CONSTRAINT produtos_ncm_formato
      CHECK (ncm IS NULL OR ncm ~ '^[0-9]{8}$'),

  -- CEST — Codigo Especificador da Substituicao Tributaria, 7 digitos. Nulavel
  -- de verdade e nao por preguica: so produto sujeito a ST tem CEST, e cafe
  -- torrado em geral nao tem. Preencher por via das duvidas seria informar
  -- substituicao que nao existe.
  ADD COLUMN cest text
    CONSTRAINT produtos_cest_formato
      CHECK (cest IS NULL OR cest ~ '^[0-9]{7}$'),

  -- Origem da mercadoria, tabela da SEFAZ: 0 = nacional, 1 = importacao direta,
  -- ... 8 = nacional com conteudo de importacao superior a 70%. `smallint`
  -- porque e um digito e o tipo ja e metade da validacao; o CHECK fecha a faixa,
  -- porque `9` nao existe na tabela e nao seria recusado por tipo nenhum.
  ADD COLUMN origem_fiscal smallint
    CONSTRAINT produtos_origem_fiscal_valida
      CHECK (origem_fiscal IS NULL OR origem_fiscal BETWEEN 0 AND 8),

  -- GTIN (o antigo EAN): 8, 12, 13 ou 14 digitos, e mais nada. Os tamanhos sao
  -- os do padrao GS1 e nao uma faixa inventada — 9, 10 ou 11 digitos nao sao um
  -- GTIN "quase certo", sao um numero que a SEFAZ recusa.
  --
  -- E 'SEM GTIN' NAO E UM PLACEHOLDER NOSSO: e a string literal que a SEFAZ
  -- EXIGE no campo cEAN quando o produto nao tem codigo de barras. Deixar vazio
  -- e a causa mais comum de rejeicao de nota em loja pequena, e por isso o valor
  -- entra no CHECK em vez de virar convencao oral. Em maiuscula porque e assim
  -- que a norma escreve e a comparacao la e exata.
  ADD COLUMN gtin text
    CONSTRAINT produtos_gtin_formato
      CHECK (gtin IS NULL OR gtin = 'SEM GTIN'
             OR gtin ~ '^[0-9]{8}$' OR gtin ~ '^[0-9]{12,14}$'),

  -- O GTIN da CAIXA (cEANTrib/embalagem). Separado do de cima porque sao dois
  -- codigos diferentes para o mesmo produto, e a nota pede os dois.
  ADD COLUMN gtin_embalagem text
    CONSTRAINT produtos_gtin_embalagem_formato
      CHECK (gtin_embalagem IS NULL OR gtin_embalagem = 'SEM GTIN'
             OR gtin_embalagem ~ '^[0-9]{8}$' OR gtin_embalagem ~ '^[0-9]{12,14}$'),

  -- Unidade comercial. Ate 6 caracteres maiusculos, que e o que o layout da NF-e
  -- aceita ('UN', 'KG', 'CX', 'PC'). Ver o cabecalho para o porque do default.
  ADD COLUMN unidade text NOT NULL DEFAULT 'UN'
    CONSTRAINT produtos_unidade_formato
      CHECK (unidade ~ '^[A-Z]{1,6}$'),

  -- Tipo do item, tabela 4.1.1 do SPED — a mesma lista que o cadastro de produto
  -- do Bling oferece: 00 revenda, 01 materia-prima, 02 embalagem, 03 produto em
  -- processo, 04 produto acabado, 05 subproduto, 06 produto intermediario,
  -- 07 uso e consumo, 08 ativo imobilizado, 09 servicos, 10 outros insumos,
  -- 99 outras. Fechado porque um codigo fora da tabela e recusado no SPED, e la
  -- a recusa chega pelo contador, no mes seguinte.
  ADD COLUMN tipo_item text
    CONSTRAINT produtos_tipo_item_valido
      CHECK (tipo_item IS NULL
             OR tipo_item IN ('00','01','02','03','04','05','06','07','08','09',
                              '10','99')),

  -- CFOP padrao de venda, 4 digitos (5102 dentro do estado, 6102 fora). E o
  -- PADRAO do produto: o CFOP real da nota depende do destino, e quem decide
  -- isso e a emissao, nao o cadastro.
  ADD COLUMN cfop_padrao text
    CONSTRAINT produtos_cfop_formato
      CHECK (cfop_padrao IS NULL OR cfop_padrao ~ '^[0-9]{4}$'),

  -- CSOSN tem 3 digitos (101, 102, 500...) e e o campo de quem esta no Simples
  -- Nacional, que e o caso da loja hoje. O CHECK aceita 2 TAMBEM, de proposito:
  -- fora do Simples o campo equivalente e o CST de ICMS, com 2 digitos. Exigir 3
  -- transformaria uma mudanca de regime tributario — que ja e um mes tenso — numa
  -- migracao de banco de emergencia. A coluna guarda "o codigo de tributacao do
  -- ICMS deste produto"; qual dos dois vocabularios vale depende do regime, e o
  -- regime nao mora aqui.
  ADD COLUMN csosn text
    CONSTRAINT produtos_csosn_formato
      CHECK (csosn IS NULL OR csosn ~ '^[0-9]{2,3}$'),

  -- Os dois pesos da NF-e, na mesma precisao de `peso` (gramas, com tres casas).
  ADD COLUMN peso_liquido numeric(10,3)
    CONSTRAINT produtos_peso_liquido_positivo
      CHECK (peso_liquido IS NULL OR peso_liquido > 0),
  ADD COLUMN peso_bruto numeric(10,3)
    CONSTRAINT produtos_peso_bruto_positivo
      CHECK (peso_bruto IS NULL OR peso_bruto > 0),
  -- EMBALAGEM TEM MASSA. Bruto menor que liquido nao e um erro de digitacao
  -- inofensivo: e o par invertido, e ele viaja para a nota e para a etiqueta dos
  -- Correios sem nenhum outro sistema reclamar. Iguais sao aceitos (granel).
  ADD CONSTRAINT produtos_peso_bruto_nao_menor
    CHECK (peso_bruto IS NULL OR peso_liquido IS NULL OR peso_bruto >= peso_liquido),

  -- O ID DO PRODUTO NO BLING. Hoje a integracao encontra o produto BUSCANDO POR
  -- SKU (`blingPedidos.js:286-292`), o que quer dizer que renomear um SKU no
  -- Bling desliga a ligacao em silencio e o pedido passa a ir sem item
  -- reconhecido. Com o id guardado, a busca vira uma chave.
  --
  -- `text` e nao `integer` porque e um identificador de OUTRO sistema: ele nao se
  -- soma nem se ordena aqui, e o dia em que o Bling devolver um id com letra ou
  -- passar de 2^31 nao pode virar uma migracao.
  ADD COLUMN codigo_bling text
    CONSTRAINT produtos_codigo_bling_preenchido
      CHECK (codigo_bling IS NULL OR btrim(codigo_bling) <> ''),

  /**
   * `estado` — e por que ele nao e um DELETE.
   *
   * R13: nada e apagado de verdade. Produto apagado quebra o pedido historico
   * que aponta para ele — e `pedidos.itens` guarda `product_id` sem chave
   * estrangeira (0004/0005 decidiram assim de proposito), entao o estrago nao e
   * um erro de FK: e um pedido antigo cujo item nao existe mais em lugar nenhum.
   *
   * DEFAULT 'ativo' PARA AS LINHAS QUE JA EXISTEM, e essa e a unica escolha
   * possivel: qualquer outro default tiraria da loja, no instante do deploy, o
   * catalogo inteiro que esta vendendo.
   */
  ADD COLUMN estado text NOT NULL DEFAULT 'ativo'
    CONSTRAINT produtos_estado_valido
      CHECK (estado IN ('rascunho', 'ativo', 'arquivado'));

/**
 * PARCIAL, no molde de `produtos_sku_idx` (0003) e pelo mesmo motivo: a maior
 * parte do catalogo nao tem codigo do Bling hoje — a loja nunca criou produto
 * la —, e NULL nao colide com NULL num indice unico do Postgres de qualquer
 * forma.
 *
 * A PEGADINHA QUE VEM JUNTO, a mesma do SKU: `ON CONFLICT (codigo_bling)` NAO
 * infere um indice parcial. O upsert da sincronizacao da Onda 4 precisa repetir
 * a clausula (`ON CONFLICT (codigo_bling) WHERE codigo_bling IS NOT NULL`) ou
 * levar 42P10.
 */
CREATE UNIQUE INDEX produtos_codigo_bling_idx
  ON canastra.produtos (codigo_bling)
  WHERE codigo_bling IS NOT NULL;

/**
 * AVISO QUE PRECISA ESTAR PRESO A COLUNA `estado`, porque ela promete mais do
 * que entrega hoje: ELA NAO ESCONDE NADA AINDA.
 *
 * A vitrine le `canastra.produtos_publicos`, e aquela view NAO tem WHERE nenhum
 * (0003:140). Ou seja, um produto salvo como 'rascunho' hoje APARECE na loja,
 * exatamente como se estivesse ativo. Nao ha regressao — nada escreve 'rascunho'
 * ainda, e o DEFAULT e 'ativo' —, mas quem ligar a tela de produto da Onda 4 sem
 * mexer na view publica um rascunho no primeiro salvamento.
 *
 * O QUE FAZER LA, e os dois lados andam juntos por regra de 0006:228 — "coluna
 * que entrar na view sem entrar no GRANT quebra a vitrine com 42501, e coluna que
 * entrar no GRANT sem ser publica de verdade vaza": filtrar a view por
 * `estado = 'ativo'` e, se `estado` for projetado, acrescenta-lo ao
 * `GRANT SELECT (...)` de `anon`.
 *
 * E O QUE VERIFICAR ANTES DE FILTRAR, porque nao e obvio: `AvaliarPedido.tsx`
 * usa a MESMA view para mapear `product_id` -> `sku` e decidir o que a pessoa
 * pode avaliar. Um produto 'arquivado' invisivel ali tira o formulario de
 * avaliacao de quem ja comprou o cafe. A view publica tem dois leitores, nao um.
 *
 * Esta migracao nao filtra porque a Onda 3 e so schema e filtrar e mudar o que a
 * vitrine mostra. O aviso fica aqui, que e onde se vai procurar.
 */

/* ------------------------------------------------------------------------- *
 * 2. Privilegios: as colunas novas NAO entram no GRANT de `produtos`
 * ------------------------------------------------------------------------- */

/**
 * ESTE BLOCO E UMA AUSENCIA DELIBERADA, e por isso ele e um comentario com o
 * tamanho de uma decisao em vez de uma linha de GRANT.
 *
 * `canastra.produtos` e a relacao com privilegio de SELECT por COLUNA (0006:226):
 * `REVOKE SELECT ... FROM authenticated` tirou o acesso de tabela, e um
 * `GRANT SELECT (14 colunas) TO anon, authenticated` devolveu so a lista publica.
 * `custo`, `criado_em` e `tsv` ficaram de fora de proposito. Coluna nova
 * acrescentada por ALTER TABLE nao herda GRANT nenhum — ela nasce ilegivel para
 * `anon` e para `authenticated`, e legivel so pelo dono e pelo `service_role`.
 *
 * A PERGUNTA CERTA NAO E "COMO EVITAR O 42501", E "QUEM LE ESTAS COLUNAS". A
 * resposta foi medida no repositorio, nao suposta:
 *
 *   frontend/ ................. le `produtos_publicos`, a VIEW, em todo lugar
 *                               (catalogo, PDP, AvaliarPedido.tsx). Nao existe
 *                               `.from("produtos")` em lugar nenhum.
 *   o painel .................. le e escreve `canastra.produtos` pelo Express,
 *                               em `src/repositories/dashboardRepository.js`,
 *                               com o pool que conecta como DONO do banco — sem
 *                               RLS e sem privilegio de coluna no caminho. E o
 *                               que a spec §7-C decidiu tambem para `custo`:
 *                               "rota admin no Express, que conecta como dono".
 *   o contrato do painel ...... e uma lista explicita de colunas
 *                               (`COLUNAS_DO_CONTRATO`), nunca `SELECT *`. As
 *                               colunas novas nao mudam nenhuma resposta de API.
 *
 * Ou seja: nao existe leitor destas colunas pelo PostgREST, hoje. Dar
 * `GRANT SELECT` a `authenticated` seria entregar o cadastro fiscal do catalogo a
 * QUALQUER token da instancia Supabase compartilhada — inclusive de outro projeto
 * da mesma VPS — para servir um leitor que nao existe. E o inverso exato do que
 * 0032 recusou ao deixar `promocao_frete` sem GRANT: nao se abre porta sem
 * porteiro do outro lado.
 *
 * O QUE ACONTECE SE ALGUEM ESQUECER DISTO: uma tela nova escrita com supabase-js
 * contra `canastra.produtos` leva 42501 na primeira consulta — barulhento, na
 * hora, e com este paragrafo esperando. E o modo de falha que 0001 escolheu de
 * proposito para o schema inteiro ("o esquecimento vira 404 barulhento em vez de
 * vazamento calado"). O conserto, se um dia o painel migrar para o PostgREST, e
 * um `GRANT SELECT (lista) ON canastra.produtos TO authenticated` — de COLUNA,
 * nunca de tabela, senao `custo` vai junto.
 *
 * E `RETURNING *` CONTINUA RESPONDENDO 42501 nesta tabela, ate para a admin,
 * exatamente como 0006:197 mediu. As colunas novas nao pioram nem melhoram isso;
 * test/produto_fiscal.test.js afirma a propriedade para que ela nao se perca sem
 * aparecer no diff.
 *
 * A ESCRITA NAO MUDA: `GRANT INSERT, UPDATE, DELETE ON canastra.produtos TO
 * authenticated` (0006:269) e de TABELA e alcanca as colunas novas sozinho, com a
 * politica `produtos_admin_escreve` decidindo a linha. Nada a fazer aqui.
 *
 * E A RLS NAO MUDA TAMBEM: `canastra.produtos` ja tem RLS ligada desde 0002/0006,
 * com leitura publica e escrita de admin. Coluna nova nao pede politica nova —
 * politica corta LINHA, GRANT corta COLUNA, e o que mudou aqui foram colunas.
 */
