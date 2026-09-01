-- O motor de promocao: promocao e cupom viram UMA entidade, com sete tabelas.
--
-- O PROBLEMA. Hoje o desconto vive em duas estruturas que nunca se falam.
-- `canastra.promocoes` (0005) e desconto de VITRINE, aplicado por produto em
-- `src/utils/preco.js:23` com um `Math.min` ingenuo entre todas as promocoes que
-- casam. `canastra.cupons` (0010) e desconto de CHECKOUT, sobre o subtotal. Elas
-- divergem em silencio — cupom tem minimo, limite de uso e janela opcional;
-- promocao nao tem minimo, nao tem limite — e uma das divergencias e uma
-- armadilha real: a promocao SO e aplicada com `inicio_em` E `fim_em`
-- preenchidos (`promotionsRepository.findActivePromotionsForCheckout`), embora
-- as duas colunas sejam nulaveis. Uma promocao salva com `ativa = true` e sem
-- datas nunca vale, sem aviso nenhum.
--
-- A UNIFICACAO. Shopify, Medusa e Saleor modelam isto como uma entidade com um
-- campo `metodo`: `automatico` aplica sozinho no carrinho, `codigo` exige o
-- cliente digitar. Mesma regra, porta de entrada diferente. Unificar da UMA
-- tela, UMA ordem de aplicacao e UM relatorio.
--
-- ESTA MIGRACAO NAO CALCULA NADA. A Onda 4 e quem escreve o motor. O criterio de
-- pronto aqui e outro: o banco ACEITA E RECUSA as coisas certas. Por isso quase
-- toda coluna nova carrega um CHECK — hoje `promocoes.tipo` e
-- `promocoes.aplica_a` sao `text` sem CHECK nenhum, e so o JavaScript de UM
-- caminho valida.
--
-- ---------------------------------------------------------------------------
-- A DECISAO DE NOME, E A MEDICAO QUE A SUSTENTA
-- ---------------------------------------------------------------------------
--
-- A tabela nova tambem se chama `promocoes`, e nao pode haver duas. As saidas
-- eram: a nova nasce com outro nome e o legado e absorvido depois; ou o legado e
-- renomeado AGORA e a nova assume o nome. Esta migracao faz a segunda, e o que
-- decidiu foi a contagem de quem nomeia a tabela hoje:
--
--   src/repositories/promotionsRepository.js .. 5 consultas, todas com a string
--                                               literal `canastra.promocoes`.
--                                               E o UNICO modulo da aplicacao.
--   src/utils/preco.js ........................ ZERO. Ele recebe as linhas
--                                               prontas de
--                                               `findActivePromotionsForCheckout`
--                                               e nao conhece coluna de banco.
--   frontend/ ................................. ZERO. Nao existe
--                                               `.from("promocoes")` em lugar
--                                               nenhum; o painel legado fala com
--                                               o Express, nao com o PostgREST.
--   test/ ..................................... f6_cupons, painel_repositorios e
--                                               rls, todos atualizados no MESMO
--                                               commit.
--
-- E o modo de falha de um ponto esquecido e ALTO, nao calado: a tabela nova nao
-- tem NENHUMA das colunas do contrato antigo (`titulo`, `tipo`, `aplica_a`,
-- `categoria`, `produto_id`, `ativa`, `criada_em`), e as cinco consultas citam
-- pelo menos uma delas cada. Um esquecimento vira 42703 na primeira chamada, e
-- nao uma leitura errada.
--
-- A JANELA DE DEPLOY, medida e nao suposta: `deploy/deploy.sh` roda as migracoes
-- ANTES de construir a imagem da API, entao existiria um intervalo com schema
-- novo e codigo velho. Ele nao morde aqui porque `deploy/stack.swarm.yml:78`
-- mantem `loja_api` em `replicas: 0` de proposito (o servico recusa subir sem as
-- credenciais do Mercado Pago) — nao ha consumidor de `canastra.promocoes`
-- servindo em producao. Quem religar a API antes de a imagem nova estar no ar
-- precisa saber disto, e por isso esta escrito aqui e nao so no relatorio.
--
-- ---------------------------------------------------------------------------
-- AS DUAS TABELAS ANTIGAS FICAM DE PE, e isso e deliberado
-- ---------------------------------------------------------------------------
--
-- `canastra.promocoes_legado` (a de 0005, renomeada) e `canastra.cupons` (0010)
-- continuam existindo, com seus dados, seus GRANTs e suas politicas. O checkout
-- de hoje ainda as le, e derruba-las agora quebraria a loja.
--
-- QUEM AS TIRA: `0036_aposentar_promocoes_e_cupons.sql`, na Onda 4 — a mesma que
-- troca `promotionsRepository`, `cuponsRepository` e `utils/cupom.js` para o
-- motor novo. A ordem la e a inversa da daqui, e e a ordem segura: o codigo novo
-- sobe PRIMEIRO (as tabelas novas ja existem desde 0032), e so depois as velhas
-- caem. E por isso que a 0036 pode dropar sem janela nenhuma, e esta aqui nao
-- poderia ter criado o motor sob outro nome sem empurrar a mesma janela para la.
--
-- ---------------------------------------------------------------------------
-- POR QUE 0032. A faixa 0017-0029 continua reservada pelo motivo que 0030 e 0031
-- registraram: `0017` esta triplamente disputado fora daqui (a worktree
-- `melhor-envio` tem um `0017_melhor_envio.sql`, a `whatsapp-bot` vai de `0017` a
-- `0021`), o runner (`db/migrar.js`) ABORTA em numero repetido, e a chave em
-- `canastra.migracoes` e o NOME COMPLETO do arquivo — migracao ja aplicada nao
-- pode ser renomeada sem rodar de novo.

/* ------------------------------------------------------------------------- *
 * 1. O legado sai do caminho
 * ------------------------------------------------------------------------- */

/**
 * O RENAME LEVA JUNTO GRANTs, POLITICAS E DADOS, e isso e o que se quer: a
 * `promocoes_legado` continua exatamente tao publica e tao editavel pela admin
 * quanto era, porque nada do checkout de hoje pode mudar de comportamento nesta
 * onda.
 *
 * A CONSTRAINT PRECISA SER RENOMEADA JUNTO, e este e o detalhe que faz a
 * migracao falhar se for esquecido. Nome de CONSTRAINT e por tabela, mas o
 * indice que sustenta uma PRIMARY KEY e um objeto de SCHEMA — e o `CREATE TABLE
 * canastra.promocoes` logo abaixo tentaria criar um indice `promocoes_pkey` que
 * ja existe, com 42P07. `RENAME CONSTRAINT` renomeia o indice junto.
 *
 * As politicas tambem sao renomeadas, so por legibilidade: `pg_policies` passa a
 * dizer `promocoes_legado.promocoes_legado_leitura_publica`, e quem for ler a
 * lista `PUBLICAS` de `test/rls.test.js` nao precisa adivinhar qual das duas
 * tabelas de promocao aquela linha descreve.
 */
ALTER TABLE canastra.promocoes RENAME TO promocoes_legado;
ALTER TABLE canastra.promocoes_legado
  RENAME CONSTRAINT promocoes_pkey TO promocoes_legado_pkey;
ALTER POLICY promocoes_leitura_publica ON canastra.promocoes_legado
  RENAME TO promocoes_legado_leitura_publica;
ALTER POLICY promocoes_admin_escreve ON canastra.promocoes_legado
  RENAME TO promocoes_legado_admin_escreve;

/* ------------------------------------------------------------------------- *
 * 2. `promocoes` — o cabecalho da regra
 * ------------------------------------------------------------------------- */

CREATE TABLE canastra.promocoes (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome      text NOT NULL,
  descricao text,

  -- AS DUAS PORTAS DE ENTRADA. `automatico` aplica sozinho no carrinho;
  -- `codigo` exige o cliente digitar. Um terceiro valor nao seria uma porta
  -- nova: seria uma regra que nenhum caminho do motor encontra, salva com
  -- sucesso e invisivel para sempre — o mesmo modo de falha da promocao legada
  -- sem datas, que e justamente o que esta migracao existe para nao repetir.
  metodo text NOT NULL
           CONSTRAINT promocoes_metodo_valido
             CHECK (metodo IN ('automatico', 'codigo')),

  -- SOBRE O QUE o desconto incide. E o campo que hoje nao existe, e a ausencia
  -- dele e a razao de `promocoes` e `cupons` divergirem em silencio: uma
  -- desconta por produto e a outra sobre o subtotal, sem nada no schema dizendo
  -- qual e qual.
  classe text NOT NULL
           CONSTRAINT promocoes_classe_valida
             CHECK (classe IN ('produto', 'pedido', 'frete')),

  mecanica text NOT NULL
             CONSTRAINT promocoes_mecanica_valida
               CHECK (mecanica IN ('percentual', 'valor_fixo', 'preco_fixo',
                                   'leve_x_pague_y', 'progressivo', 'brinde',
                                   'frete_gratis')),

  -- A UNIDADE DE `valor` DEPENDE DA MECANICA, e isso e herdado de `cupons`
  -- (0010) de proposito, para o vocabulario do painel nao mudar de significado:
  --   percentual .......... pontos percentuais (10 = 10%)
  --   valor_fixo .......... REAIS abatidos
  --   preco_fixo .......... REAIS que o item passa a custar
  --   leve_x_pague_y ...... o X; o Y mora em `promocao_faixas`
  --   progressivo ......... nao usa: as faixas e que carregam os valores
  --   brinde / frete_gratis nao usam
  --
  -- Dinheiro de COMPARACAO continua em centavos e inteiro (`minimo_valor`,
  -- `teto_desconto_centavos`, `orcamento_centavos`), pela regra de 0009/0010:
  -- numeric na fronteira do "vale/nao vale" convida aritmetica de ponto
  -- flutuante exatamente onde ela custa caro.
  valor numeric(10,2)
          CONSTRAINT promocoes_valor_positivo
            CHECK (valor IS NULL OR valor > 0),

  -- O MESMO TETO DE 90% DE `cupons`, e agora tambem da promocao. La ele ja
  -- estava no banco porque "cupom e um segredo que circula fora da loja
  -- (anuncio, influencer) e o custo de um erro e maior" (0010:28). Na promocao
  -- ele so existia em `promotionsRepository.validarDesconto`, isto e, no
  -- JavaScript de UM caminho — quem escrevesse pelo PostgREST, por uma tela nova
  -- ou por um INSERT de emergencia passava direto. Um "100%" libera a loja de
  -- graca para quem abrir a pagina.
  --
  -- `valor_fixo` continua SEM teto, pelo mesmo motivo de 0010: o servico trava o
  -- desconto no subtotal do pedido, entao um fixo maior que a compra desconta a
  -- compra e para.
  CONSTRAINT promocoes_percentual_ate_90
    CHECK (mecanica <> 'percentual'
           OR (valor IS NOT NULL AND valor > 0 AND valor <= 90)),

  -- O TETO EM DINHEIRO, que e a outra metade da defesa. "20% de desconto" numa
  -- compra de R$ 3.000 sao R$ 600 que ninguem aprovou. NULL = sem teto.
  teto_desconto_centavos integer
    CONSTRAINT promocoes_teto_positivo
      CHECK (teto_desconto_centavos IS NULL OR teto_desconto_centavos > 0),

  -- O MINIMO E UM PAR, E O PAR TEM DE SER COERENTE. So tres formas sao validas,
  -- e as duas invalidas sao armadilhas caladas:
  --   'nenhum'   + valor NULL ... a regra nao tem piso
  --   'subtotal' + centavos ..... piso em dinheiro
  --   'quantidade' + unidades ... piso em itens
  --   'nenhum'   + 15000 ........ o gestor digitou o piso e depois trocou o tipo
  --                               para "nenhum"; a tela mostra R$ 150 e o motor
  --                               ignora. Ninguem descobre.
  --   'subtotal' + NULL ......... "acima de nada", isto e, vale sempre, com o
  --                               gestor achando que colocou um piso.
  minimo_tipo text NOT NULL DEFAULT 'nenhum'
                CONSTRAINT promocoes_minimo_tipo_valido
                  CHECK (minimo_tipo IN ('nenhum', 'subtotal', 'quantidade')),
  minimo_valor integer,
  CONSTRAINT promocoes_minimo_coerente CHECK (
    (minimo_tipo = 'nenhum' AND minimo_valor IS NULL)
    OR (minimo_tipo IN ('subtotal', 'quantidade')
        AND minimo_valor IS NOT NULL AND minimo_valor > 0)
  ),

  -- A ORDEM DE APLICACAO, que hoje e um `Math.min` ingenuo entre tudo que casa
  -- (`utils/preco.js:56`). Maior prioridade primeiro; empate desempata por
  -- `criada_em`, e isso e decisao do motor (Onda 4), nao do schema.
  prioridade integer NOT NULL DEFAULT 0,

  -- `exclusiva` diz "esta regra nao acumula". `grupo_exclusividade` diz COM QUEM
  -- ela nao acumula — duas promocoes de pagamento se excluem entre si e ainda
  -- assim somam com uma de frete. Um grupo preenchido numa regra que acumula e
  -- um campo que nao faz nada, e o CHECK impede que ele seja salvo.
  exclusiva boolean NOT NULL DEFAULT false,
  grupo_exclusividade text,
  CONSTRAINT promocoes_grupo_exige_exclusiva
    CHECK (grupo_exclusividade IS NULL OR exclusiva),

  -- O DESCONTO NO PIX, e a armadilha que ele quase trouxe junto. O que o
  -- checkout GRAVA em `pedidos.metodo_pagamento` e o `payment_method_id` do
  -- Mercado Pago (`PaymentController.js:815`), que e um vocabulario ABERTO:
  -- 'visa', 'master', 'elo', 'bolbradesco'... Uma regra escrita contra 'visa'
  -- simplesmente nao se aplicaria a um Mastercard, em silencio.
  --
  -- Entao a lista aqui e a da LOJA, fechada, e traduzir do Mercado Pago para ela
  -- e trabalho do motor na Onda 4 — num lugar so, testavel. Lista VAZIA e
  -- recusada porque nao quer dizer "todos": quer dizer "nenhum", e a regra
  -- nunca valeria (a mesma confusao que 0010 barrou em `limite_usos = 0`).
  meios_pagamento text[]
    CONSTRAINT promocoes_meios_pagamento_validos
      CHECK (meios_pagamento IS NULL
             OR (cardinality(meios_pagamento) > 0
                 AND meios_pagamento <@ ARRAY['pix', 'credito', 'debito', 'boleto'])),

  -- NULL = sem limite, nos tres. Zero e recusado pelo motivo de 0010: nao
  -- significa "ilimitado" nem "esgotado desde o inicio", significa que alguem
  -- confundiu os dois — e melhor descobrir no INSERT que no primeiro cliente
  -- recusado.
  --
  -- `limite_por_cliente` e por CPF, nao por e-mail, e o porque esta em
  -- `promocao_resgates`.
  limite_usos integer
    CONSTRAINT promocoes_limite_usos_positivo
      CHECK (limite_usos IS NULL OR limite_usos > 0),
  limite_por_cliente integer
    CONSTRAINT promocoes_limite_cliente_positivo
      CHECK (limite_por_cliente IS NULL OR limite_por_cliente > 0),
  orcamento_centavos integer
    CONSTRAINT promocoes_orcamento_positivo
      CHECK (orcamento_centavos IS NULL OR orcamento_centavos > 0),

  -- A JANELA, COM AS DUAS PONTAS OPCIONAIS — e esta e a correcao mais importante
  -- do arquivo. No legado as duas eram nulaveis E obrigatorias para valer, o que
  -- e uma contradicao que so aparece em producao. Aqui NULL quer dizer "sem
  -- limite deste lado", como em `cupons`, e o CHECK barra a unica combinacao que
  -- nunca poderia valer: uma campanha que termina antes de comecar.
  inicio_em timestamptz,
  fim_em    timestamptz,
  CONSTRAINT promocoes_janela_coerente
    CHECK (inicio_em IS NULL OR fim_em IS NULL OR inicio_em < fim_em),

  -- O KILL-SWITCH, SEPARADO DAS DATAS. `agendada`, `vigente` e `expirada` sao
  -- DERIVADOS de `inicio_em`/`fim_em`/`arquivada_em` e NAO existem como coluna —
  -- foi gravar status derivado que produziu a armadilha do painel legado, onde
  -- editar uma promocao fora da janela a desativava para sempre (o formulario
  -- devolvia o status que a tela tinha calculado). Aqui `habilitada` so muda
  -- quando alguem move o interruptor.
  habilitada boolean NOT NULL DEFAULT true,

  -- `arquivada_em` E NAO DELETE (R13). Promocao apagada quebra o relatorio do
  -- pedido que a usou, e `pedido_ajustes_desconto` aponta para ca. Hoje nao
  -- existe DELETE de promocao nem de cupom em lugar nenhum da pilha: o painel so
  -- oferece "desativar", e a lista so cresce. O REVOKE de DELETE la embaixo e o
  -- que faz esta coluna ser o unico caminho.
  arquivada_em timestamptz,

  criada_em     timestamptz NOT NULL DEFAULT now(),
  -- MANTIDA POR QUEM ESCREVE, como em 0004/0005/0010: nao ha trigger de
  -- moddatetime neste schema. Todo UPDATE escreve `atualizada_em = now()` junto,
  -- ou a coluna mente.
  atualizada_em timestamptz NOT NULL DEFAULT now()
);

-- O indice que o motor vai varrer a cada carrinho: as automaticas que valem
-- agora. Parcial porque a maior parte da tabela, com o tempo, sera campanha
-- arquivada — e um indice total faria a leitura mais quente da loja passear por
-- ela.
CREATE INDEX promocoes_vigentes_idx
  ON canastra.promocoes (metodo, prioridade DESC, inicio_em, fim_em)
  WHERE habilitada AND arquivada_em IS NULL;

/* ------------------------------------------------------------------------- *
 * 3. `promocao_codigos` — uma regra, N codigos
 * ------------------------------------------------------------------------- */

/**
 * O QUE ISTO PERMITE E QUE HOJE NAO EXISTE: 500 codigos de influenciador
 * rastreaveis individualmente, com UM relatorio so. Em `cupons` seriam 500
 * linhas, cada uma com sua propria copia da regra (valor, minimo, janela),
 * divergindo na primeira correcao — e sem nenhuma forma de perguntar "quanto a
 * campanha inteira vendeu".
 */
CREATE TABLE canastra.promocao_codigos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE: o codigo e PARTE da regra, nao um registro do que aconteceu. Quem
  -- guarda o que aconteceu e `promocao_resgates`, e la a chave e RESTRICT.
  promocao_id uuid NOT NULL
                REFERENCES canastra.promocoes (id) ON DELETE CASCADE,

  -- O MESMO CHECK DE FORMATO DE `cupons` (0010:20), palavra por palavra, e pelo
  -- mesmo motivo: o codigo e salvo MAIUSCULO pelo servico (quem digita "cafe10"
  -- quis dizer "CAFE10") e a busca do checkout e por igualdade EXATA. Um codigo
  -- minusculo gravado por um caminho que nao passe pelo servico — um INSERT
  -- manual de emergencia — seria invisivel para sempre. A-Z e 0-9 apenas, 3 a 30
  -- caracteres: e o que cabe num anuncio e num campo de checkout sem ambiguidade
  -- de espaco, acento ou emoji.
  --
  -- O UNIQUE E DA LOJA INTEIRA, nao da promocao: dois donos para 'CAFE20'
  -- fariam o desconto que o cliente recebe depender da ordem de varredura do
  -- Postgres, e a segunda campanha nunca apareceria.
  codigo text NOT NULL UNIQUE
           CONSTRAINT promocao_codigos_formato
             CHECK (codigo ~ '^[A-Z0-9]{3,30}$'),

  -- Codigo de uso unico e o caso do "cupom de desculpas" mandado a UMA pessoa.
  -- Diferente de `limite_usos = 1` so na intencao, e a intencao e o que a tela
  -- mostra.
  uso_unico boolean NOT NULL DEFAULT false,

  -- Contador DENORMALIZADO, e ele existe sabendo que e denormalizado: quem tem a
  -- verdade e `promocao_resgates` (ver la). Este aqui e para o incremento
  -- atomico do checkout continuar sendo o mesmo desenho de `cuponsRepository`
  -- (`SET usos = usos + 1 WHERE ... usos < limite_usos`, dentro da transacao de
  -- reserva de estoque) — dois checkouts simultaneos no ultimo uso serializam e
  -- o segundo recebe "esgotado" ANTES de ser cobrado.
  usos integer NOT NULL DEFAULT 0
         CONSTRAINT promocao_codigos_usos_nao_negativo CHECK (usos >= 0),

  limite_usos integer
    CONSTRAINT promocao_codigos_limite_positivo
      CHECK (limite_usos IS NULL OR limite_usos > 0),

  ativo boolean NOT NULL DEFAULT true,

  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX promocao_codigos_promocao_idx
  ON canastra.promocao_codigos (promocao_id);

/* ------------------------------------------------------------------------- *
 * 4. `promocao_escopo` — o que a regra alcanca, e o que ela NAO alcanca
 * ------------------------------------------------------------------------- */

/**
 * O `incluir = false` E O PONTO DESTA TABELA. Ele e o que permite dizer
 * "10% na loja toda, MENOS o micro-lote" — uma frase que hoje nao tem como ser
 * escrita: o escopo legado sao tres colunas mutuamente exclusivas (`aplica_a`,
 * `categoria`, `produto_id`), com UM produto_id so e sem chave estrangeira.
 *
 * `alvo` E TEXTO E NAO FK, de proposito e pela licao do carrinho sem FK para
 * produtos (0004): ele guarda um SKU, um nome de categoria ou um uuid conforme
 * o `tipo`, e amarrar tres tipos diferentes a tres colunas FK devolveria
 * exatamente o desenho de tres colunas exclusivas que esta tabela substitui. O
 * troco e real e fica registrado: um SKU renomeado sai do escopo em silencio, e
 * a tela de promocao da Onda 4 precisa validar o alvo contra o catalogo na hora
 * de salvar.
 */
CREATE TABLE canastra.promocao_escopo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promocao_id uuid NOT NULL
                REFERENCES canastra.promocoes (id) ON DELETE CASCADE,

  tipo text NOT NULL
         CONSTRAINT promocao_escopo_tipo_valido
           CHECK (tipo IN ('produto', 'categoria', 'sku', 'todos', 'assinante')),

  alvo text,

  -- AS DUAS INCOERENCIAS QUE O CHECK IMPEDE, e as duas custam dinheiro:
  --   'todos' COM alvo ...... "todos os produtos, especificamente este". O motor
  --                           teria de escolher qual metade obedecer.
  --   'sku' SEM alvo ........ alcanca TUDO em vez de nada, que e o caro dos
  --                           dois: 10% na loja inteira por um campo em branco.
  -- 'assinante' nao tem alvo porque a pergunta e sim/nao (o Clube, 0015).
  CONSTRAINT promocao_escopo_alvo_coerente CHECK (
    (tipo IN ('todos', 'assinante') AND alvo IS NULL)
    OR (tipo IN ('produto', 'categoria', 'sku')
        AND alvo IS NOT NULL AND btrim(alvo) <> '')
  ),

  incluir boolean NOT NULL DEFAULT true,

  criado_em timestamptz NOT NULL DEFAULT now()
);

-- O MESMO ALVO DUAS VEZES NA MESMA PROMOCAO e o pior caso possivel: uma linha
-- dizendo "inclua o micro-lote" e outra dizendo "exclua", com o resultado
-- dependendo da ordem de leitura. O indice IGNORA `incluir` de proposito — e
-- assim que a contradicao deixa de ser representavel, em vez de ser detectada
-- depois. `coalesce(alvo, '')` porque NULL nao colide com NULL num indice unico,
-- e duas linhas 'todos' na mesma promocao seriam a mesma contradicao.
CREATE UNIQUE INDEX promocao_escopo_alvo_unico_idx
  ON canastra.promocao_escopo (promocao_id, tipo, coalesce(alvo, ''));

/* ------------------------------------------------------------------------- *
 * 5. `promocao_faixas` — progressivo e leve-3-pague-2, checaveis no banco
 * ------------------------------------------------------------------------- */

CREATE TABLE canastra.promocao_faixas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promocao_id uuid NOT NULL
                REFERENCES canastra.promocoes (id) ON DELETE CASCADE,

  quantidade_min integer NOT NULL
                   CONSTRAINT promocao_faixas_quantidade_positiva
                     CHECK (quantidade_min > 0),

  desconto_tipo text NOT NULL
                  CONSTRAINT promocao_faixas_tipo_valido
                    CHECK (desconto_tipo IN ('percentual', 'valor_fixo',
                                             'preco_fixo', 'pague_y')),

  desconto_valor numeric(10,2) NOT NULL
                   CONSTRAINT promocao_faixas_valor_positivo
                     CHECK (desconto_valor > 0),

  -- O TETO DE 90% VALE AQUI TAMBEM, e este e o lugar onde ele seria esquecido:
  -- numa promocao `progressivo` o percentual nao mora em `promocoes.valor`, mora
  -- aqui. Um teto so no cabecalho seria um teto com um buraco do tamanho da
  -- mecanica que mais usa faixas.
  CONSTRAINT promocao_faixas_percentual_ate_90
    CHECK (desconto_tipo <> 'percentual' OR desconto_valor <= 90),

  -- "leve 3 pague 3" nao e promocao, e "leve 3 pague 4" e um acrescimo escrito
  -- com cara de desconto. O Y tem de ser menor que o X.
  CONSTRAINT promocao_faixas_pague_menor_que_leve
    CHECK (desconto_tipo <> 'pague_y' OR desconto_valor < quantidade_min),

  criado_em timestamptz NOT NULL DEFAULT now(),

  -- Duas faixas com o mesmo piso e uma regra sem resposta: leve 6, pague 15% ou
  -- 20%? O motor escolheria pela ordem do heap. Isto fica no BANCO, com CHECK, e
  -- nao num jsonb solto que ninguem consegue validar — que era a alternativa.
  CONSTRAINT promocao_faixas_piso_unico UNIQUE (promocao_id, quantidade_min)
);

/* ------------------------------------------------------------------------- *
 * 6. `promocao_frete` — o item que sangra margem toda semana
 * ------------------------------------------------------------------------- */

/**
 * Hoje o frete gratis e UM NUMERO GLOBAL: `config_loja.frete_gratis_minimo_
 * centavos = 14900` (0009). A pesquisa foi direta: cafe tem frete comparavel ao
 * produto, e sem teto "frete gratis acima de R$ 149" significa bancar um SEDEX
 * de R$ 90 para o Acre, toda semana, saindo da margem.
 *
 * UMA CONFIGURACAO POR PROMOCAO — a chave primaria e o proprio `promocao_id`.
 * Duas linhas dariam dois tetos para a mesma regra, e nao ha desempate possivel.
 * Varias faixas de CEP se fazem com varias promocoes, cada uma com sua UF e seu
 * teto, que e como o gestor pensa o problema de qualquer forma ("Sudeste ate R$
 * 30, Nordeste ate R$ 50").
 */
CREATE TABLE canastra.promocao_frete (
  promocao_id uuid PRIMARY KEY
                REFERENCES canastra.promocoes (id) ON DELETE CASCADE,

  -- Acima deste valor a regra NAO vale, e o cliente paga o frete normal.
  teto_frete_centavos integer
    CONSTRAINT promocao_frete_teto_positivo
      CHECK (teto_frete_centavos IS NULL OR teto_frete_centavos > 0),

  -- Lista fechada nas 27 unidades da federacao. Um 'XX' gravado por engano nunca
  -- casaria com o estado de ninguem, e a regra ficaria salva e inerte. Lista
  -- VAZIA e recusada porque nao quer dizer "todas": quer dizer "nenhuma".
  ufs text[]
    CONSTRAINT promocao_frete_ufs_validas
      CHECK (ufs IS NULL
             OR (cardinality(ufs) > 0
                 AND ufs <@ ARRAY['AC','AL','AP','AM','BA','CE','DF','ES','GO',
                                  'MA','MT','MS','MG','PA','PB','PR','PE','PI',
                                  'RJ','RN','RS','RO','RR','SC','SP','SE','TO'])),

  -- SEM ELE O CLIENTE ESCOLHE SEDEX DE GRACA quando a loja queria bancar o PAC.
  -- Nao e detalhe: e a diferenca entre subsidiar R$ 25 e subsidiar R$ 90 na
  -- mesma venda.
  apenas_modalidade_mais_barata boolean NOT NULL DEFAULT false,

  -- O CEP ENTRA NORMALIZADO A DIGITOS, E O CHECK E QUEM GARANTE. Comparar
  -- '01310-100' com '01310100' e um bug que passa em todo teste escrito com o
  -- formato certo e falha em producao no primeiro cliente que digitar o hifen —
  -- e ESTA LOJA JA TEVE UM DESSA FAMILIA no CEP de origem (commit 7fe8d36). O
  -- CHECK nao normaliza: ele faz o caminho que esquecer de normalizar ERRAR.
  cep_inicio text
    CONSTRAINT promocao_frete_cep_inicio_formato
      CHECK (cep_inicio IS NULL OR cep_inicio ~ '^[0-9]{8}$'),
  cep_fim text
    CONSTRAINT promocao_frete_cep_fim_formato
      CHECK (cep_fim IS NULL OR cep_fim ~ '^[0-9]{8}$'),

  -- Meia faixa e faixa nenhuma: com so uma ponta, "de 30000000 em diante" e uma
  -- leitura, "ate 30000000" e outra, e o motor teria de adivinhar.
  CONSTRAINT promocao_frete_faixa_completa
    CHECK ((cep_inicio IS NULL) = (cep_fim IS NULL)),
  -- E a faixa invertida ('39999999' a '30000000') nao alcanca CEP nenhum: a
  -- regra e salva com sucesso e nunca vale. A comparacao e de TEXTO e isso
  -- basta, porque os dois lados tem exatamente 8 digitos pelo CHECK acima.
  CONSTRAINT promocao_frete_faixa_ordenada
    CHECK (cep_inicio IS NULL OR cep_inicio <= cep_fim),

  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

/* ------------------------------------------------------------------------- *
 * 7. `promocao_resgates` — a verdade do uso
 * ------------------------------------------------------------------------- */

/**
 * E ESTA TABELA, E NAO UM CONTADOR, QUE E A VERDADE. Duas razoes:
 *
 *   · pedido cancelado ou PIX expirado precisa DEVOLVER o uso, e um contador
 *     decrementado nao diz de quem era o uso devolvido;
 *   · e dela que sai o relatorio de campanha — quantas vendas, quanto de
 *     desconto, por qual codigo.
 *
 * A propria Shopify documenta que o contador denormalizado dela fica defasado.
 * `promocao_codigos.usos` continua existindo para o incremento atomico do
 * checkout, e sabendo que e uma copia.
 *
 * NINGUEM ESCREVE AQUI PELO NAVEGADOR — nem a admin. O resgate nasce na mesma
 * transacao que reserva estoque, no servico Node, exatamente como
 * `cuponsRepository.js:125-130` ja faz. O argumento e o de `pedidos` em 0006:
 * valor de venda escrito por quem nao passou pelo checkout foi o achado de
 * auditoria que aquela fase fechou.
 */
CREATE TABLE canastra.promocao_resgates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- RESTRICT, e nao CASCADE: o resgate e registro do que aconteceu, nao parte da
  -- regra. Uma promocao com resgate nao se apaga de jeito nenhum — nem pelo
  -- dono, nem por um script de limpeza distraido. A recusa e 23503, alta.
  promocao_id uuid NOT NULL
                REFERENCES canastra.promocoes (id) ON DELETE RESTRICT,

  -- Tambem RESTRICT, e pelo mesmo motivo: apagar o codigo de um influenciador ja
  -- usado deixaria o resgate orfao de campanha, e o relatorio dele passaria a
  -- mentir por omissao. Codigo NAO usado continua podendo ser removido.
  codigo_id uuid
              REFERENCES canastra.promocao_codigos (id) ON DELETE RESTRICT,

  pedido_id uuid NOT NULL
              REFERENCES canastra.pedidos (pedido_id) ON DELETE CASCADE,

  -- NULAVEL E `ON DELETE SET NULL`, PELA ARMADILHA DE 0005, que vale igual aqui:
  -- o Postgres ACEITA declarar SET NULL numa coluna NOT NULL — o DDL nao reclama
  -- — e a incompatibilidade so aparece no DELETE do cliente, que estoura com
  -- 23502 e deixa a exclusao de dados pessoais impossivel. Seria uma armadilha
  -- que so dispara no dia do primeiro pedido de exclusao (LGPD art. 18).
  user_id uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,

  -- SHA-256 DO CPF, NUNCA O CPF. E-mail e infinito e gratuito: cupom de primeira
  -- compra controlado por e-mail e cupom permanente, e por isso o limite por
  -- cliente e por CPF. Guardar o numero seria mais uma copia de dado pessoal, e
  -- as migracoes 0013 e 0016 desta loja ja pagaram esse preco uma vez.
  --
  -- O CHECK E O QUE TRANSFORMA "COMBINAMOS DE GUARDAR O HASH" NUMA GARANTIA: um
  -- CPF tem 11 digitos e um CPF formatado tem 14, e nenhum dos dois casa
  -- `^[0-9a-f]{64}$`. Quem esquecer o hash leva 23514 antes de escrever no
  -- disco, em vez de deixar um numero de documento numa tabela que ninguem mais
  -- vai reler. Hex MINUSCULO porque e o que `crypto.createHash(...).digest('hex')`
  -- do Node produz — aceitar as duas caixas faria dois hashes do mesmo CPF nao
  -- casarem no `WHERE`.
  --
  -- NULL e permitido: pedido de convidado sem CPF existe, e ali o limite por
  -- cliente simplesmente nao se aplica.
  documento_hash text
    CONSTRAINT promocao_resgates_hash_formato
      CHECK (documento_hash IS NULL OR documento_hash ~ '^[0-9a-f]{64}$'),

  valor_centavos integer NOT NULL
    CONSTRAINT promocao_resgates_valor_nao_negativo CHECK (valor_centavos >= 0),

  resgatado_em timestamptz NOT NULL DEFAULT now(),
  -- DEVOLVER O USO E ISTO, e nao DELETE: apagar a linha apagaria junto o
  -- registro de que a campanha foi tentada, que e metade do relatorio.
  estornado_em timestamptz,
  CONSTRAINT promocao_resgates_estorno_depois
    CHECK (estornado_em IS NULL OR estornado_em >= resgatado_em),

  -- O UNIQUE QUE SUSTENTA O CONTADOR. O Mercado Pago reenvia notificacao POR
  -- DESENHO (e por isso os indices parciais de idempotencia de 0005 existem):
  -- sem esta chave, uma reentrega de webhook gravaria o resgate de novo e o
  -- relatorio contaria duas vendas onde houve uma.
  CONSTRAINT promocao_resgates_uma_vez_por_pedido UNIQUE (promocao_id, pedido_id)
);

CREATE INDEX promocao_resgates_documento_idx
  ON canastra.promocao_resgates (promocao_id, documento_hash)
  WHERE documento_hash IS NOT NULL AND estornado_em IS NULL;

/* ------------------------------------------------------------------------- *
 * 8. `pedido_ajustes_desconto` — a fundacao silenciosa
 * ------------------------------------------------------------------------- */

/**
 * PARECE BUROCRACIA E NAO E. Sem uma linha por desconto aplicado nao existe:
 *
 *   · NF-e com desconto rateado POR ITEM — o Bling exige, e hoje os dois POST de
 *     emissao vao sem corpo nenhum;
 *   · estorno proporcional em devolucao parcial;
 *   · resposta para "por que este pedido saiu por R$ 137,40?".
 *
 * As tres saem da mesma tabela, e por isso ela entra nesta onda e nao na
 * seguinte: `pedidos.desconto` (0010) e UM numero agregado, e nao ha como
 * decompo-lo depois.
 */
CREATE TABLE canastra.pedido_ajustes_desconto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL
              REFERENCES canastra.pedidos (pedido_id) ON DELETE CASCADE,

  -- SET NULL, e nao RESTRICT como em `promocao_resgates`, e a diferenca e
  -- proposital: aqui a linha ja carrega `codigo` e `rotulo`, que sao a
  -- FOTOGRAFIA do que foi aplicado. E a mesma licao de `pedidos.cupom_codigo`
  -- ser texto e nao FK (0010:75): o pedido guarda o que foi usado na compra, e
  -- apagar ou renomear a campanha amanha nao pode tocar uma venda ja feita.
  promocao_id uuid REFERENCES canastra.promocoes (id) ON DELETE SET NULL,
  codigo text,

  alvo text NOT NULL
         CONSTRAINT pedido_ajustes_alvo_valido
           CHECK (alvo IN ('item', 'pedido', 'frete')),

  -- QUAL item. Um desconto de item sem dizer qual e um desconto que a NF-e nao
  -- consegue ratear — e o rateio por item e exatamente o que o Bling exige. O
  -- inverso ('pedido' COM alvo_ref) e um dado que contradiz o proprio alvo.
  alvo_ref text,
  CONSTRAINT pedido_ajustes_alvo_ref_coerente CHECK (
    (alvo = 'item' AND alvo_ref IS NOT NULL AND btrim(alvo_ref) <> '')
    OR (alvo IN ('pedido', 'frete') AND alvo_ref IS NULL)
  ),

  -- A ORDEM E PARTE DA RESPOSTA. Dois descontos com a mesma sequencia deixariam
  -- "por que R$ 137,40" com duas contas diferentes conforme a varredura — e a
  -- ordem importa de verdade quando um desconto e percentual sobre o que sobrou
  -- do anterior.
  sequencia integer NOT NULL
              CONSTRAINT pedido_ajustes_sequencia_positiva CHECK (sequencia > 0),

  valor_centavos integer NOT NULL
    CONSTRAINT pedido_ajustes_valor_positivo CHECK (valor_centavos > 0),

  -- O que a tela e a NF-e mostram. NOT NULL porque uma linha de desconto sem
  -- nome nao responde a pergunta que a tabela existe para responder.
  rotulo text NOT NULL,

  criado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pedido_ajustes_sequencia_unica UNIQUE (pedido_id, sequencia)
);

CREATE INDEX pedido_ajustes_promocao_idx
  ON canastra.pedido_ajustes_desconto (promocao_id)
  WHERE promocao_id IS NOT NULL;

/* ------------------------------------------------------------------------- *
 * 9. A migracao dos dados
 * ------------------------------------------------------------------------- */

/**
 * A GUARDA VEM ANTES, e ela recusa a migracao inteira em vez de perder uma
 * regra.
 *
 * `promocoes_legado.tipo` e `text` SEM CHECK (0005) e `valor` e nulavel: o teto
 * de 90% e o vocabulario `percent`/`fixed` so existem em
 * `promotionsRepository.validarDesconto`, isto e, no JavaScript de UM caminho. O
 * banco de producao pode ter linha que nenhuma `mecanica` nova representa.
 *
 * As saidas seriam tres, e duas sao ruins: PULAR a linha perde uma regra em
 * silencio (o oposto do que este schema existe para fazer); ADIVINHAR uma
 * mecanica muda o dinheiro que o cliente paga. Sobra PARAR, com a lista dos ids
 * e o comando que resolve. O runner aplica cada migracao numa transacao propria
 * (`db/migrar.js:266`), entao o banco fica exatamente como estava.
 *
 * Num banco limpo — os testes, o `instalacao-completa.sql`, qualquer instalacao
 * nova — as duas tabelas estao vazias e este bloco e um no-op.
 */
DO $migracao$
DECLARE
  intrusos text;
BEGIN
  SELECT string_agg(id::text, ', ')
    INTO intrusos
    FROM canastra.promocoes_legado
   WHERE (tipo IS DISTINCT FROM 'percent' AND tipo IS DISTINCT FROM 'fixed')
      OR valor IS NULL
      OR valor <= 0
      OR (tipo = 'percent' AND valor > 90);

  IF intrusos IS NOT NULL THEN
    RAISE EXCEPTION
      'Promocoes legadas que nenhuma mecanica nova representa: %. '
      'Corrija-as em canastra.promocoes_legado (tipo tem de ser percent ou '
      'fixed, valor > 0, e percent no maximo 90) e rode a migracao de novo. '
      'Ignora-las aqui apagaria uma regra de desconto em silencio.',
      intrusos;
  END IF;

  -- A SEGUNDA GUARDA COBRE A JANELA, e ela existe para trocar um erro mudo por
  -- um erro que se explica. Nem `promocoes` nem `cupons` tem CHECK de ordem nas
  -- datas, entao uma linha com `inicio_em >= fim_em` — que nunca valeu em
  -- instante nenhum — bateria no `promocoes_janela_coerente` la em cima e o
  -- operador leria so o nome de uma constraint que ele nunca viu.
  SELECT string_agg(origem || ' ' || id::text, ', ')
    INTO intrusos
    FROM (
      SELECT 'promocoes_legado' AS origem, id, inicio_em, fim_em
        FROM canastra.promocoes_legado
      UNION ALL
      SELECT 'cupons', id, inicio_em, fim_em FROM canastra.cupons
    ) j
   WHERE inicio_em IS NOT NULL AND fim_em IS NOT NULL AND inicio_em >= fim_em;

  IF intrusos IS NOT NULL THEN
    RAISE EXCEPTION
      'Regras legadas com janela que nunca vale (inicio_em >= fim_em): %. '
      'Corrija as datas na tabela de origem e rode a migracao de novo.',
      intrusos;
  END IF;
END
$migracao$;

/**
 * Os cupons viram promocoes de `metodo = 'codigo'`.
 *
 * `classe = 'pedido'` porque e o que o cupom SEMPRE foi: `utils/cupom.js`
 * desconta sobre o SUBTOTAL, nunca por item. Escrever isso no schema e metade da
 * unificacao — a outra metade e as promocoes legadas virarem `classe =
 * 'produto'`, que e o que `utils/preco.js` faz com elas.
 *
 * O `id` E REAPROVEITADO, e nao sorteado de novo: a linha nova fica rastreavel
 * ate o cupom que a originou sem uma coluna `origem_id` que so serviria para
 * isso. Colisao com um id de `promocoes_legado` e possivel em teoria e bateria
 * na chave primaria, alto — nao ha caminho silencioso.
 *
 * `minimo_centavos = 0` vira `'nenhum'` COM VALOR NULO, e nao `'subtotal'` com
 * zero: um piso de R$ 0,00 e um piso que nao e piso, e o CHECK de coerencia
 * existe justamente para essa forma nao existir.
 *
 * `usos` vai para o codigo e nao para a regra: um cupom com 37 usos de 200
 * voltaria a ter 200 disponiveis no dia da virada se o contador ficasse para
 * tras.
 */
INSERT INTO canastra.promocoes (
  id, nome, descricao, metodo, classe, mecanica, valor,
  minimo_tipo, minimo_valor, limite_usos,
  inicio_em, fim_em, habilitada, criada_em, atualizada_em
)
SELECT
  c.id,
  -- `nome` e NOT NULL e a descricao do cupom e opcional; o codigo e o que o
  -- gestor reconhece na lista quando nao ha descricao.
  coalesce(nullif(btrim(c.descricao), ''), c.codigo),
  c.descricao,
  'codigo',
  'pedido',
  CASE c.tipo WHEN 'percent' THEN 'percentual' ELSE 'valor_fixo' END,
  c.valor,
  CASE WHEN c.minimo_centavos > 0 THEN 'subtotal' ELSE 'nenhum' END,
  nullif(c.minimo_centavos, 0),
  c.limite_usos,
  c.inicio_em,
  c.fim_em,
  -- Cupom sem data SEMPRE valeu ("CAFE10 ate acabar", 0010:63), entao aqui
  -- `ativo` atravessa cru. Com as promocoes e diferente — ver abaixo.
  c.ativo,
  c.criado_em,
  c.atualizado_em
FROM canastra.cupons c;

INSERT INTO canastra.promocao_codigos (
  promocao_id, codigo, usos, limite_usos, ativo, criado_em, atualizado_em
)
SELECT c.id, c.codigo, c.usos, c.limite_usos, c.ativo, c.criado_em, c.atualizado_em
FROM canastra.cupons c;

/**
 * As promocoes legadas viram `metodo = 'automatico'`.
 *
 * `habilitada` NAO E `ativa`, E ESTA E A LINHA MAIS IMPORTANTE DO ARQUIVO.
 *
 * No modelo legado a promocao so entrava no checkout com `inicio_em <= now() AND
 * fim_em >= now()` — e NULL nao satisfaz nenhum dos dois. Uma promocao com
 * `ativa = true` e sem datas NUNCA valeu, em nenhum dia, e a loja pode ter
 * varias assim (o painel legado salva as datas vazias como NULL sem reclamar).
 *
 * No modelo novo, data nula quer dizer "sem limite deste lado", isto e, VALE
 * SEMPRE. Migrar `habilitada = ativa` cru LIGARIA, no dia da virada, um desconto
 * que nunca existiu — em producao, sem ninguem ter pedido, e sem nada no log
 * apontando para ca. O que atravessa, entao, e o comportamento EFETIVO e nao o
 * valor cru da coluna.
 *
 * O gestor que quiser reativar uma dessas preenche as datas e liga o
 * interruptor: duas acoes deliberadas, na tela, em vez de uma surpresa.
 */
INSERT INTO canastra.promocoes (
  id, nome, descricao, metodo, classe, mecanica, valor,
  inicio_em, fim_em, habilitada, criada_em, atualizada_em
)
SELECT
  p.id,
  p.titulo,
  p.descricao,
  'automatico',
  'produto',
  CASE p.tipo WHEN 'percent' THEN 'percentual' ELSE 'valor_fixo' END,
  p.valor,
  p.inicio_em,
  p.fim_em,
  p.ativa AND p.inicio_em IS NOT NULL AND p.fim_em IS NOT NULL,
  p.criada_em,
  p.criada_em
FROM canastra.promocoes_legado p;

/**
 * E o escopo, sem o qual "15% na categoria Cafe" viraria "15% na loja toda" — o
 * erro mais caro que esta migracao poderia cometer.
 *
 * A CLAUSULA WHERE NAO PERDE NADA, e vale demonstrar porque parece perder: as
 * combinacoes que ela deixa de fora sao exatamente as que `utils/preco.js` nunca
 * fez casar. `applies_to = 'category'` com `categoria` nula cai no
 * `if (promoCategory && ...)` e nunca bate; `'product'` com `produto_id` nulo
 * compara `"null"` com um uuid e nunca bate; um `applies_to` fora dos tres nao
 * entra em nenhum ramo. Ou seja, essas promocoes ja eram inertes, e sem linha de
 * escopo elas continuam inertes — que e o comportamento preservado, nao perdido.
 */
INSERT INTO canastra.promocao_escopo (promocao_id, tipo, alvo, incluir, criado_em)
SELECT
  p.id,
  CASE p.aplica_a WHEN 'all' THEN 'todos' WHEN 'category' THEN 'categoria'
                  ELSE 'produto' END,
  CASE p.aplica_a WHEN 'all' THEN NULL WHEN 'category' THEN btrim(p.categoria)
                  ELSE p.produto_id::text END,
  true,
  p.criada_em
FROM canastra.promocoes_legado p
WHERE p.aplica_a = 'all'
   OR (p.aplica_a = 'category' AND nullif(btrim(p.categoria), '') IS NOT NULL)
   OR (p.aplica_a = 'product'  AND p.produto_id IS NOT NULL);

/* ------------------------------------------------------------------------- *
 * 10. Privilegios
 * ------------------------------------------------------------------------- */

/**
 * O QUE `anon` LE, E SO ISSO: o cabecalho da regra, o escopo e as faixas. Sao os
 * tres de que a vitrine precisa para renderizar "de/por" e a regra de leve-mais
 * ANTES de qualquer login — e a spec §3.10 nomeia exatamente estes tres.
 *
 * 0001 inverteu o padrao de proposito (tabela nova NAO nasce legivel por `anon`,
 * para o esquecimento virar 404 barulhento em vez de vazamento calado), entao
 * quem e publico diz isso aqui, na propria migracao.
 *
 * `promocao_frete` FICA DE FORA, e a ausencia e uma decisao: a barra de frete
 * gratis da vitrine (`components/layout/BarraFreteGratis.tsx`) ainda le
 * `config_loja.frete_gratis_minimo_centavos`, e nenhum leitor desta tabela
 * existe hoje. Dar GRANT agora seria abrir uma porta sem porteiro do outro lado
 * — o inverso do campo write-only que 0030 foi consertar. Quem trocar aquela
 * barra na Onda 4 decide entre este GRANT e um endpoint no servidor.
 */
GRANT SELECT ON canastra.promocoes       TO anon;
GRANT SELECT ON canastra.promocao_escopo TO anon;
GRANT SELECT ON canastra.promocao_faixas TO anon;

/**
 * REDUNDANTE HOJE, ESCRITO ASSIM MESMO — o mesmo argumento de 0030:123. O
 * `ALTER DEFAULT PRIVILEGES` de 0001 ja da INSERT/UPDATE/DELETE a
 * `authenticated` em toda tabela nova de `canastra`, mas aquele default so
 * alcanca objeto criado pelo MESMO papel que rodou o ALTER. Uma destas tabelas
 * recriada por outro caminho (psql com outro usuario, Supabase Studio, restore
 * parcial) nasceria SEM privilegio de escrita, e o painel do admin passaria a
 * levar 42501 com toda a RLS correta.
 *
 * SO AS CINCO TABELAS DE REGRA. `promocao_resgates` e `pedido_ajustes_desconto`
 * sao registro do que ja aconteceu e ficam de fora — ver o REVOKE abaixo.
 */
GRANT INSERT, UPDATE, DELETE ON canastra.promocoes       TO authenticated;
GRANT INSERT, UPDATE, DELETE ON canastra.promocao_codigos TO authenticated;
GRANT INSERT, UPDATE, DELETE ON canastra.promocao_escopo TO authenticated;
GRANT INSERT, UPDATE, DELETE ON canastra.promocao_faixas TO authenticated;
GRANT INSERT, UPDATE, DELETE ON canastra.promocao_frete  TO authenticated;

/**
 * PROMOCAO NAO SE APAGA, E A TRAVA E DE PRIVILEGIO.
 *
 * A regra de 0031: onde o recorte e de COLUNA ou de OPERACAO INTEIRA, ele nao
 * tem como morar numa politica. Aqui a politica do admin e `FOR ALL` — o mesmo
 * formato de `config_loja`, e o mesmo que 0031 apontou como o que apaga uma
 * ausencia de politica sem querer. O privilegio nao se perde assim.
 *
 * O que se perde num DELETE aqui: `pedido_ajustes_desconto.promocao_id` aponta
 * para ca com SET NULL, entao a linha do pedido sobreviveria — mas o relatorio
 * de campanha, nao. E `promocao_resgates` aponta com RESTRICT, o que ja barraria
 * as promocoes JA USADAS; este REVOKE fecha tambem as que ainda nao foram, que
 * sao justamente as que alguem apagaria por engano ("essa nunca rodou, pode
 * tirar"). O caminho que existe e `arquivada_em`.
 *
 * As CINCO tabelas filhas mantem DELETE: tirar uma faixa de quantidade ou um
 * SKU do escopo e EDICAO da regra, nao apagamento de historico.
 */
REVOKE DELETE ON canastra.promocoes FROM authenticated;

/**
 * AS DUAS TABELAS DE REGISTRO SO O SERVICO ESCREVE.
 *
 * Nem cliente nem admin. O resgate nasce na transacao de reserva de estoque e o
 * ajuste e a fotografia do que foi cobrado — os dois pelo servico Node, que
 * conecta como dono do banco. E o mesmo desenho de `pedidos` em 0006, e pelo
 * mesmo motivo: numero que vira dinheiro nao vem do navegador.
 *
 * `SELECT` NAO ENTRA NO REVOKE, de proposito: o painel LE os dois (relatorio de
 * campanha, "por que R$ 137,40") e o cliente le os ajustes do proprio pedido.
 * Quem recorta a LINHA ali e a politica, que e o mecanismo certo para esse
 * recorte — diferente do DELETE acima, que e operacao inteira.
 */
REVOKE INSERT, UPDATE, DELETE ON canastra.promocao_resgates       FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON canastra.pedido_ajustes_desconto FROM authenticated;

/* ------------------------------------------------------------------------- *
 * 11. RLS
 * ------------------------------------------------------------------------- */

ALTER TABLE canastra.promocoes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocao_codigos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocao_escopo         ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocao_faixas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocao_frete          ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocao_resgates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.pedido_ajustes_desconto ENABLE ROW LEVEL SECURITY;

/**
 * A LEITURA PUBLICA NAO E `USING (true)`, E ESSA E UMA DECISAO E NAO UM DETALHE.
 *
 * `test/rls.test.js` mantem a lista `PUBLICAS` — as relacoes onde um
 * `FOR SELECT USING (true)` e aceito. Acrescentar um nome ali e afirmar, no
 * diff, que aquela relacao inteira pode ser lida por quem nao tem conta. Para
 * `promocoes` isso seria falso, e de tres formas:
 *
 *   · a campanha AGENDADA e o calendario comercial da loja; com `true`, um
 *     concorrente le as promocoes das proximas semanas com um GET;
 *   · a promocao de CODIGO carrega o valor do cupom que circula em anuncio e com
 *     influenciador — quem valida codigo e `POST /cupons/validar`, que responde
 *     so sobre O codigo perguntado (0010:91);
 *   · expirada, desabilitada e arquivada nao valem hoje e nao interessam a
 *     ninguem de fora.
 *
 * Entao o recorte desce para o PREDICADO, onde ele se le. O troco e que esta
 * migracao NAO acrescenta nenhum nome a `PUBLICAS`, e a invariante daquele
 * arquivo continua valendo intocada.
 *
 * `now()` NUMA POLITICA e legitimo (a funcao e STABLE e vale o instante da
 * transacao), e e o mesmo instante que o motor vai usar — o status derivado da
 * spec, escrito uma vez, no banco, em vez de repetido em cada consulta da
 * vitrine.
 */
CREATE POLICY promocoes_vigentes_publicas ON canastra.promocoes
  FOR SELECT TO anon, authenticated
  USING (
    metodo = 'automatico'
    AND habilitada
    AND arquivada_em IS NULL
    AND (inicio_em IS NULL OR inicio_em <= now())
    AND (fim_em    IS NULL OR fim_em    >= now())
  );

/**
 * O escopo e as faixas seguem o PAI, e o mecanismo tem uma dependencia que
 * precisa estar escrita: `canastra.promocoes` esta sob RLS, e a subconsulta de
 * uma politica roda como o INVOCADOR, nao como dono. Ou seja, este EXISTS
 * enxerga exatamente as promocoes que a politica acima deixa a pessoa enxergar.
 *
 * Aqui isso da certo por construcao — a vitrine so precisa do escopo das regras
 * que ela ja pode ver —, e e a mesma engrenagem que `carrinho_itens_dono` usa em
 * 0006:497. O acoplamento e igualmente real e igualmente silencioso: se um dia
 * `promocoes_vigentes_publicas` for estreitada, o escopo e as faixas somem da
 * vitrine SEM ERRO, e o preco "de/por" volta a ser so "de". Quem mexer naquela
 * politica tem de reler estas duas.
 */
CREATE POLICY promocao_escopo_publico_le ON canastra.promocao_escopo
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM canastra.promocoes p
      WHERE p.id = promocao_escopo.promocao_id
    )
  );

CREATE POLICY promocao_faixas_publico_le ON canastra.promocao_faixas
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM canastra.promocoes p
      WHERE p.id = promocao_faixas.promocao_id
    )
  );

/**
 * A escrita, nas cinco tabelas de regra: so `canastra.eh_admin()`.
 *
 * A funcao le `canastra.admins` e NUNCA um claim do JWT — a instancia do
 * Supabase e compartilhada com outros projetos do mesmo dono, e um token emitido
 * para outro projeto chega aqui com assinatura valida, papel `authenticated` e
 * `auth.uid()` preenchido. Ele carrega no `user_metadata` o que quiser.
 *
 * O `TO authenticated` NAO E ENFEITE: sem clausula TO a politica nasce
 * `TO public`, e `public` alcanca tambem o DONO das tabelas — de quem
 * `eh_admin()` depende para ler `admins` por baixo da RLS. Foi assim que 0030
 * descobriu, do jeito dificil.
 *
 * `FOR ALL` cobre SELECT junto, o que aqui e util e nao perigoso: e o que faz a
 * admin enxergar a campanha agendada, a expirada e a arquivada, que a vitrine
 * nao ve. As politicas permissivas se somam com OR.
 */
CREATE POLICY promocoes_admin_escreve ON canastra.promocoes
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

CREATE POLICY promocao_codigos_admin ON canastra.promocao_codigos
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

CREATE POLICY promocao_escopo_admin ON canastra.promocao_escopo
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

CREATE POLICY promocao_faixas_admin ON canastra.promocao_faixas
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

CREATE POLICY promocao_frete_admin ON canastra.promocao_frete
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

/**
 * `promocao_codigos` NAO TEM POLITICA PUBLICA, e a ausencia e o ponto: a lista
 * de codigos e o mapa de descontos da loja, e um GET nela entregaria os 500
 * codigos de influenciador de uma vez. Alem de nao ter GRANT para `anon`, ela
 * nao tem politica que alcance quem nao e admin — as duas camadas negam, como em
 * `cupons` (0010:86).
 *
 * `promocao_frete` idem: sem leitor publico hoje, sem politica publica.
 */

/**
 * `promocao_resgates` — leitura so da admin.
 *
 * NEM O PROPRIO CLIENTE LE OS SEUS: ali mora `documento_hash`, e devolver ao
 * navegador um dado derivado do CPF seria dar de volta um dado pessoal que nao
 * precisa sair do servidor. O que o cliente tem direito de ver — quanto foi
 * descontado e por que — esta em `pedido_ajustes_desconto`, sem vinculo com
 * documento nenhum.
 */
CREATE POLICY promocao_resgates_admin_le ON canastra.promocao_resgates
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());

/**
 * `pedido_ajustes_desconto` — o dono do pedido e a admin.
 *
 * "Por que este pedido saiu por R$ 137,40?" e uma pergunta que o CLIENTE faz, na
 * pagina do proprio pedido. `eh_cliente() AND` na frente e a Regra 2 de 0006: a
 * igualdade prova que a pessoa e dona daquela linha, mas nao cobre o caminho
 * para VIRAR dona de uma — e esta tabela nao tem chave estrangeira para
 * `clientes`, a ligacao passa por `pedidos`.
 *
 * O MESMO ACOPLAMENTO DO ESCOPO, e vale repetir porque o modo de falha e mudo: o
 * EXISTS roda como o invocador e enxerga so os pedidos que `pedidos_dono_le`
 * mostra. Se aquela politica for estreitada, esta tela esvazia sem erro.
 *
 * A politica da admin vai SEPARADA pelo motivo que 0006:530 registrou para
 * `pedidos`: a chave e `ON DELETE SET NULL`, entao o pedido de um cliente
 * apagado fica com `user_id IS NULL`, e contra ele a igualdade avalia NULL. O
 * historico do painel nao pode sumir junto.
 */
CREATE POLICY pedido_ajustes_dono_le ON canastra.pedido_ajustes_desconto
  FOR SELECT TO authenticated
  USING (
    canastra.eh_cliente()
    AND EXISTS (
      SELECT 1 FROM canastra.pedidos p
      WHERE p.pedido_id = pedido_ajustes_desconto.pedido_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY pedido_ajustes_admin_le ON canastra.pedido_ajustes_desconto
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());
