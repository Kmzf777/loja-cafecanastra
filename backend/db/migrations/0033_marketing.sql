-- Marketing: de onde veio cada venda, quanto custou, quem consentiu, o que foi
-- enviado e o que dispara sozinho.
--
-- O ITEM MAIS URGENTE DA SPEC, E O UNICO IRREVERSIVEL. As dez colunas de
-- atribuicao em `pedidos` sao dez colunas e uma tarde; o que nao existe e o
-- CAMINHO DE VOLTA. Nenhum relatorio reconstroi depois de onde veio um pedido de
-- tres meses atras: o Mercado Pago guarda o pagamento e nao a origem, e o Bling
-- guarda a nota e nao a origem. Cada dia sem estas colunas e um dia de venda que
-- nunca mais tera resposta para "o anuncio pagou?".
--
-- ESTA MIGRACAO NAO ENVIA NADA. A Onda 4 e quem escreve o disparador, o
-- descadastro por link e a tela de campanha. O criterio de pronto aqui e o mesmo
-- de 0032: o banco ACEITA E RECUSA as coisas certas.
--
-- ---------------------------------------------------------------------------
-- A DECISAO DE LGPD: `gclid` E `fbclid` ENTRAM NA REDACAO. `utm_*` NAO.
-- ---------------------------------------------------------------------------
--
-- As migracoes 0013 e 0016 criaram a redacao de dado pessoal desta loja
-- (`canastra.redigir_dados_do_titular`, `canastra.redigir_endereco`). A pergunta
-- que esta migracao tinha de responder e se as colunas novas entram nela. A
-- resposta e SIM para duas delas, e o criterio e o mesmo que 0013 usou para
-- decidir que cidade e UF FICAM e o resto do endereco SAI: a coluna identifica
-- uma PESSOA, ou descreve a VENDA?
--
--   SAI   `gclid` e `fbclid` — sao identificadores de CLIQUE. O Google e a Meta
--         resolvem os dois para o perfil de uma pessoa (e o proposito deles: e
--         assim que a conversao volta para a plataforma). Guardados aqui, ao
--         lado do nome, do CPF e do endereco do mesmo pedido, sao mais uma copia
--         de dado pessoal — exatamente a categoria que o cabecalho de 0013 nomeia
--         ao explicar por que "apagar o cliente" nunca foi apagar os dados da
--         pessoa. Depois de um pedido de exclusao (art. 18, IV/VI), um gclid
--         sobrevivente continuaria ligando aquele pedido a uma pessoa por uma
--         chave que a loja nem controla.
--
--   SAI   a QUERY STRING de `referrer` e `landing_page`, e esta e a parte que se
--         esquece: a landing page de um anuncio carrega o MESMO gclid por
--         construcao (`/cafes?utm_source=google&gclid=Cj0KAQ`). Redigir a coluna
--         `gclid` e deixar o identificador na URL ao lado seria teatro de
--         redacao. Sai tudo depois do primeiro `?` ou `#`; o esquema, o host e o
--         caminho ficam, que e o equivalente do "prefixo do CEP" de 0013 —
--         estatistica de origem, nunca a porta da casa.
--
--   FICA  `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`
--         e `canal`. Descrevem a CAMPANHA, nao a pessoa: 'google/cpc/blackfriday26'
--         e o mesmo valor para as mil pessoas que clicaram no mesmo anuncio, e
--         nao identifica nenhuma delas nem em conjunto com as outras colunas do
--         pedido redigido. Sao a estatistica de venda que 0005 preserva de
--         proposito, pelo mesmo argumento de "total, status e itens de produto
--         ficam". Apaga-las destruiria o unico registro de origem da venda sem
--         proteger ninguem.
--
--   SAI   `envios.destinatario_final`, pelo motivo direto: e o e-mail ou o
--         telefone da pessoa, congelado. A linha FICA (quantos envios, quantos
--         entregues, quantos falharam continua sendo estatistica), o endereco
--         vira '[redigido]'. Criar aqui uma fotografia de dado pessoal que a
--         redacao nao alcancasse seria repetir, na mesma casa, o achado que a
--         0016 existiu para fechar.
--
-- O QUE **NAO** ENTRA NA REDACAO, E ISSO E DECISAO E NAO ESQUECIMENTO:
-- `consentimentos`. Ela e a PROVA do opt-in, e a LGPD poe o onus dessa prova no
-- controlador (art. 8º, §2º). Apagar o e-mail da linha de consentimento e apagar
-- a resposta para "com que direito voces mandaram aquela mensagem em marco?" —
-- inclusive a favor da propria pessoa. Manter o endereco para sempre depois de
-- uma exclusao tambem nao se defende. As duas leituras sao legitimas e a escolha
-- depende de PRAZO DE RETENCAO, que e politica e nao DDL: fica registrada aqui
-- como pendencia explicita para a onda que construir o fluxo de consentimento, e
-- nao resolvida em silencio por um UPDATE escrito de passagem.
--
-- DIVIDA IRMA, REGISTRADA E NAO CONSERTADA (e codigo de aplicacao, fora do
-- escopo desta onda): `src/routes/lgpd.routes.js` diz, no proprio cabecalho, que
-- a lista de tabelas exportadas "e a lista de TODA tabela desta loja com dado da
-- pessoa, e quem criar a proxima tem de voltar aqui". `consentimentos` e `envios`
-- nascem fora dela, e a exportacao de `pedidos` nao projeta as colunas novas.
-- Quem for ligar o marketing precisa fechar isso no mesmo passo.
--
-- ---------------------------------------------------------------------------
-- RISCO REGISTRADO, NAO RESOLVIDO: a worktree `whatsapp-bot`
-- ---------------------------------------------------------------------------
--
-- Aquela branch ja tem `canastra.whatsapp_mensagens`, com forma parecida com
-- `envios`, e colunas de opt-in de WhatsApp em `canastra.clientes`. Esta migracao
-- NAO recria nada disso e nao toca em `clientes`. Se aquela branch entrar, as
-- duas estruturas vao existir ao mesmo tempo e a reconciliacao (fundir o log de
-- WhatsApp em `envios`, e o opt-in de `clientes` em `consentimentos`) e uma
-- migracao propria, posterior — nao um `IF NOT EXISTS` esperto aqui, que
-- esconderia a divergencia em vez de resolve-la.
--
-- ---------------------------------------------------------------------------
-- POR QUE 0033. A faixa 0017-0029 continua reservada pelo motivo que 0030, 0031
-- e 0032 registraram: `0017` esta triplamente disputado fora daqui (a worktree
-- `melhor-envio` tem um `0017_melhor_envio.sql`, a `whatsapp-bot` vai de `0017` a
-- `0021`), o runner (`db/migrar.js`) ABORTA em numero repetido, e a chave em
-- `canastra.migracoes` e o NOME COMPLETO do arquivo — migracao ja aplicada nunca
-- e renomeada.

/* ------------------------------------------------------------------------- *
 * 1. `pedidos` — a atribuicao, e o que ela nunca pode fazer
 * ------------------------------------------------------------------------- */

/**
 * DEZ COLUNAS DE TEXTO, NULAVEIS, SEM UM UNICO CHECK — e a ausencia dos CHECKs e
 * a decisao, nao a preguica.
 *
 * Todo o resto deste schema fecha vocabulario com CHECK, e 0032 e um arquivo
 * inteiro defendendo isso. Aqui a regra se inverte por um motivo que vale mais
 * que a consistencia: quem escreve estas colunas e o INSERT do checkout, na
 * mesma transacao que reserva estoque e cria a venda. Um CHECK que recusasse um
 * `utm_source` esquisito — maiusculo, com acento, com 300 caracteres, vindo de
 * um encurtador que ninguem previu — nao produziria um relatorio melhor:
 * produziria um PEDIDO PERDIDO, com o cliente ja no cartao. Atribuicao e enfeite
 * em cima de um pagamento, e enfeite nao derruba a casa.
 *
 * O QUE ELAS GUARDAM E O QUE CHEGOU, cru. A normalizacao (minusculo, aparar
 * espaco, cortar tamanho) e trabalho de quem ESCREVE, na Onda 4, e por isso ela
 * esta escrita tambem no comentario de `campanhas.utm_campaign` la embaixo — que
 * e o lado onde o CHECK cabe, porque la quem digita e a gestora e o custo de
 * recusar e uma mensagem de erro numa tela, nao uma venda.
 *
 * E NAO HA CHAVE ESTRANGEIRA de `pedidos.utm_campaign` para `campanhas`, pelo
 * mesmo motivo elevado ao quadrado: um pedido chegando com o utm de uma campanha
 * que ninguem cadastrou seria RECUSADO no checkout. O relatorio junta as duas por
 * igualdade de texto e mostra "sem campanha cadastrada" quando nao casa — que e o
 * desfecho certo.
 *
 * `canal` e a origem em UMA palavra ('pago', 'organico', 'direto', 'indicacao'),
 * que e a coluna que a tela de pedidos mostra sem obrigar ninguem a ler cinco
 * utms. Tambem texto livre, e pelo mesmo motivo dos outros nove.
 */
ALTER TABLE canastra.pedidos
  ADD COLUMN utm_source   text,
  ADD COLUMN utm_medium   text,
  ADD COLUMN utm_campaign text,
  ADD COLUMN utm_content  text,
  ADD COLUMN utm_term     text,
  ADD COLUMN canal        text,
  ADD COLUMN referrer     text,
  ADD COLUMN landing_page text,
  -- Os dois identificadores de clique. Ver a decisao de LGPD no cabecalho: sao
  -- as unicas duas colunas deste bloco que a redacao do titular apaga.
  ADD COLUMN gclid  text,
  ADD COLUMN fbclid text;

-- O relatorio de campanha e "as vendas desta campanha, no periodo". Parcial
-- porque a maior parte da tabela — todo pedido que veio de gente digitando o
-- endereco da loja — tem `utm_campaign` nulo, e nao ha pergunta que passe por
-- ali.
CREATE INDEX pedidos_atribuicao_idx
  ON canastra.pedidos (utm_campaign, criado_em DESC)
  WHERE utm_campaign IS NOT NULL;

/* ------------------------------------------------------------------------- *
 * 2. `campanhas` — sem custo de midia o relatorio e vaidade
 * ------------------------------------------------------------------------- */

CREATE TABLE canastra.campanhas (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,

  -- ATENCAO: `canal` AQUI NAO E O `canal` DE `envios` NEM O DE `consentimentos`,
  -- e os tres tem o mesmo nome. Aqui e ONDE O DINHEIRO FOI GASTO (a plataforma
  -- de midia); la e COMO A MENSAGEM ALCANCA A PESSOA (a caixa de entrada). Uma
  -- campanha de 'google' manda e-mail; um envio de 'email' pertence a ela. Trocar
  -- os dois produz um relatorio que soma laranja com maca, e nenhum CHECK pega
  -- isso porque as duas listas sao validas nos seus lugares.
  canal text NOT NULL
          CONSTRAINT campanhas_canal_valido
            CHECK (canal IN ('google', 'meta', 'email', 'whatsapp', 'sms',
                             'organico', 'influenciador', 'outro')),

  -- A CHAVE QUE AMARRA A ATRIBUICAO, e o CHECK aqui e a metade que cabe no
  -- banco. `pedidos.utm_campaign` guarda o que chegou, cru, porque recusar la
  -- seria perder a venda; a juncao entre os dois e por IGUALDADE DE TEXTO, e
  -- 'BlackFriday' nunca casa com 'blackfriday'. E a mesma familia do bug de CEP
  -- que esta loja ja teve (commit 7fe8d36), com o mesmo desfecho: metade das
  -- vendas fora do relatorio, sem erro nenhum.
  --
  -- Entao o lado CADASTRADO — onde quem digita e a gestora e o custo de recusar e
  -- uma mensagem numa tela — so aceita a forma canonica: minuscula, sem espaco em
  -- branco. Quem escrever o formulario da Onda 4 normaliza antes de salvar, e o
  -- CHECK e o que faz "esqueci de normalizar" ERRAR em vez de vazar uma campanha
  -- que nunca casa com pedido nenhum.
  --
  -- Nulavel: campanha de radio, de feira ou de embalagem nao tem utm. O indice
  -- unico e PARCIAL por isso — ver abaixo.
  utm_campaign text
    CONSTRAINT campanhas_utm_canonico
      CHECK (utm_campaign IS NULL
             OR (utm_campaign = lower(utm_campaign)
                 AND utm_campaign !~ '\s'
                 AND length(utm_campaign) BETWEEN 1 AND 120)),

  -- O CUSTO DE MIDIA NAO E OPCIONAL COMO IDEIA, so como valor: sem ele nao ha
  -- como saber se a campanha deu lucro, e o "relatorio" vira uma lista de vendas
  -- que a loja teria feito de qualquer jeito. Em centavos e inteiro, pela regra
  -- de 0009/0010 — numeric na fronteira do "deu lucro?" convida aritmetica de
  -- ponto flutuante exatamente onde ela custa caro.
  --
  -- ZERO E PERMITIDO e negativo nao: campanha organica custou zero de midia, e
  -- isso e um fato; custo negativo e um sinal trocado que viraria margem
  -- inventada no relatorio.
  custo_centavos integer NOT NULL DEFAULT 0
    CONSTRAINT campanhas_custo_nao_negativo CHECK (custo_centavos >= 0),

  inicio_em timestamptz,
  fim_em    timestamptz,
  -- A mesma unica combinacao impossivel de 0032: campanha que termina antes de
  -- comecar. NULL continua querendo dizer "sem limite deste lado".
  CONSTRAINT campanhas_janela_coerente
    CHECK (inicio_em IS NULL OR fim_em IS NULL OR inicio_em < fim_em),

  ativa boolean NOT NULL DEFAULT true,

  criada_em     timestamptz NOT NULL DEFAULT now(),
  -- Mantida por quem escreve, como em 0004/0005/0010/0032: nao ha trigger de
  -- moddatetime neste schema.
  atualizada_em timestamptz NOT NULL DEFAULT now()
);

-- PARCIAL, no molde de `produtos_sku_idx` (0003): duas campanhas SEM utm podem
-- existir (radio e feira nao tem utm), duas com o mesmo utm nao — seriam dois
-- donos para a mesma origem de venda, e o relatorio teria de escolher um.
--
-- O TROCO DE SER PARCIAL, que morde quem escrever o upsert da Onda 4: um
-- `ON CONFLICT (utm_campaign)` NAO infere um indice parcial. Ou se repete a
-- clausula (`ON CONFLICT (utm_campaign) WHERE utm_campaign IS NOT NULL`), ou o
-- comando falha com 42P10. `produtos_sku_idx` tem exatamente a mesma forma e a
-- mesma pegadinha.
CREATE UNIQUE INDEX campanhas_utm_idx
  ON canastra.campanhas (utm_campaign)
  WHERE utm_campaign IS NOT NULL;

/* ------------------------------------------------------------------------- *
 * 3. `consentimentos` — um ESTADO COM PROCEDENCIA, nunca um booleano
 * ------------------------------------------------------------------------- */

/**
 * O QUE UM BOOLEANO NAO RESPONDE, e e por isso que esta tabela nao e uma coluna
 * em `clientes`:
 *
 *   · DE ONDE veio o "sim" (rodape, pop-up, checkout, atendimento)? E a
 *     procedencia que PROVA o consentimento depois — sem ela, "a pessoa aceitou"
 *     e a palavra da loja contra a da pessoa;
 *   · QUANDO? Consentimento tem data, e uma politica de privacidade que mudou
 *     depois nao se aplica retroativamente ao que foi aceito antes;
 *   · O QUE exatamente foi aceito (`texto_aceito`)? O texto muda; o que a pessoa
 *     leu naquele dia, nao;
 *   · e o HISTORICO: revogar nao apaga o "sim" anterior, ACRESCENTA um "nao". Um
 *     booleano sobrescrito perde a prova de que o envio de marco era legitimo.
 *
 * Por isso a tabela e APPEND-ONLY por desenho: o estado atual de um canal e a
 * linha mais recente daquele contato, e nunca um UPDATE. O indice abaixo existe
 * para essa pergunta.
 *
 * E ELE NUNCA NASCE PRE-MARCADO, em nenhuma regiao — isso e regra de tela e nao
 * de schema, mas fica escrito aqui porque e aqui que se vai procurar.
 */
CREATE TABLE canastra.consentimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SET NULL e nao CASCADE, pela armadilha de 0005 que 0032 tambem herdou: o
  -- Postgres ACEITA declarar SET NULL numa coluna NOT NULL e so estoura no
  -- DELETE do cliente, com 23502, deixando a exclusao de dados pessoais
  -- impossivel justamente no dia do primeiro pedido de exclusao.
  --
  -- E CASCADE seria pior de outro jeito: apagaria a prova de que a mensagem ja
  -- enviada era autorizada, exatamente quando ela passa a ser necessaria.
  user_id uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,

  -- Nulaveis os dois, e a tabela e por CONTATO e nao por conta: quem se inscreve
  -- no rodape nao tem cadastro, e o consentimento dela vale igual.
  email    text,
  telefone text,

  -- COMO A MENSAGEM ALCANCA A PESSOA. Nao confundir com `campanhas.canal`, que e
  -- onde o dinheiro foi gasto — ver o comentario la.
  canal text NOT NULL
          CONSTRAINT consentimentos_canal_valido
            CHECK (canal IN ('email', 'whatsapp', 'sms')),

  -- Duas palavras, e nao um booleano, pelo motivo do cabecalho: a revogacao e
  -- uma LINHA NOVA. Um terceiro valor ('pendente' para o double opt-in) seria
  -- tentador e esta de fora de proposito — quem ainda nao confirmou nao consentiu,
  -- e o lugar do "quase" e `newsletter_inscritos.confirmado_em`.
  estado text NOT NULL
           CONSTRAINT consentimentos_estado_valido
             CHECK (estado IN ('concedido', 'revogado')),

  -- NOT NULL E O CORACAO DA TABELA. Consentimento sem procedencia e um booleano
  -- com mais passos.
  origem text NOT NULL
           CONSTRAINT consentimentos_origem_preenchida
             CHECK (btrim(origem) <> ''),

  -- O texto que a pessoa leu naquele dia. Nulavel porque um consentimento
  -- importado de outro sistema pode nao ter, e mentir um texto seria pior.
  texto_aceito text,

  -- `inet` e nao `text`: o tipo valida sozinho, ocupa menos e permite consultar
  -- por faixa. E dado pessoal — ver a decisao de retencao no cabecalho.
  ip inet,

  criado_em timestamptz NOT NULL DEFAULT now(),

  -- UM CONSENTIMENTO QUE NAO IDENTIFICA NINGUEM NAO PROVA NADA SOBRE NINGUEM.
  -- Sem este CHECK, um formulario com o campo errado gravaria linhas validas,
  -- crescentes e inuteis — e a descoberta seria no dia da auditoria.
  CONSTRAINT consentimentos_identifica_alguem CHECK (
    user_id IS NOT NULL
    OR nullif(btrim(email), '') IS NOT NULL
    OR nullif(btrim(telefone), '') IS NOT NULL
  )
);

-- "ESTA PESSOA CONSENTE COM ESTE CANAL, AGORA?" — a unica pergunta quente da
-- tabela, e a resposta e a linha mais recente. `lower(email)` porque
-- 'Bea@Ex.com' e 'bea@ex.com' sao a mesma caixa postal (a mesma normalizacao que
-- `newsletter.routes.js` ja faz), e um indice sensivel a caixa deixaria o
-- descadastro de uma nao alcancar a outra.
CREATE INDEX consentimentos_email_idx
  ON canastra.consentimentos (canal, lower(email), criado_em DESC)
  WHERE email IS NOT NULL;

CREATE INDEX consentimentos_titular_idx
  ON canastra.consentimentos (canal, user_id, criado_em DESC)
  WHERE user_id IS NOT NULL;

/* ------------------------------------------------------------------------- *
 * 4. `envios` — o log por destinatario, agnostico de canal
 * ------------------------------------------------------------------------- */

/**
 * AGNOSTICO DE CANAL DE PROPOSITO. Um log por canal (um para e-mail, outro para
 * WhatsApp) da dois relatorios que nunca somam, e a pergunta real e "quantas
 * mensagens esta campanha mandou, e quantas chegaram" — que atravessa os canais.
 *
 * E O QUE ELE PERMITE QUE HOJE NAO EXISTE: saber que um cliente recebeu tres
 * lembretes da mesma sacola. Hoje o unico marcador e
 * `carrinhos.lembrete_enviado_em` (0011), que e um booleano com data e responde
 * so "ja lembrei?" — de proposito, e aquele comentario diz que "historico de
 * campanhas e problema de outra tarefa". Esta e a tarefa.
 */
CREATE TABLE canastra.envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  canal text NOT NULL
          CONSTRAINT envios_canal_valido
            CHECK (canal IN ('email', 'whatsapp', 'sms')),

  -- RESTRICT, como `promocao_resgates.promocao_id` em 0032 e pelo mesmo
  -- argumento: o envio e registro do que aconteceu, nao parte da regra. Apagar
  -- uma campanha que ja mandou mensagem deixaria o log orfao e o relatorio dela
  -- passaria a mentir por omissao. A recusa e 23503, alta. Campanha que nunca
  -- enviou nada continua removivel — e mesmo essa so pelo servico, ver o REVOKE.
  campanha_id uuid REFERENCES canastra.campanhas (id) ON DELETE RESTRICT,

  user_id uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,

  -- O ENDERECO PARA ONDE A MENSAGEM FOI, CONGELADO. NOT NULL porque um envio sem
  -- destinatario nao e um envio. E dado pessoal: e a coluna que a redacao do
  -- titular troca por '[redigido]' (ver o cabecalho) — a linha fica, a
  -- estatistica fica, o endereco sai.
  destinatario_final text NOT NULL,

  template text,

  estado text NOT NULL DEFAULT 'pendente'
           CONSTRAINT envios_estado_valido
             CHECK (estado IN ('pendente', 'enviado', 'entregue', 'lido', 'falhou')),

  -- O id que o provedor devolveu (Resend, a API de WhatsApp). E a chave para
  -- casar o webhook de status com a linha certa.
  provedor_id text,

  erro_texto text,
  -- Texto de erro num envio que deu certo e um dado que contradiz o proprio
  -- estado — normalmente uma linha reaproveitada por um retry escrito as
  -- pressas. O CHECK impede a contradicao de existir.
  CONSTRAINT envios_erro_so_em_falha
    CHECK (erro_texto IS NULL OR estado = 'falhou'),

  criado_em   timestamptz NOT NULL DEFAULT now(),
  enviado_em  timestamptz,
  entregue_em timestamptz,
  -- Entregue sem ter sido enviado nao e um estado do mundo, e a ordem entre as
  -- duas datas e o que sustenta qualquer conta de tempo de entrega.
  CONSTRAINT envios_entrega_depois_do_envio
    CHECK (entregue_em IS NULL
           OR (enviado_em IS NOT NULL AND entregue_em >= enviado_em))
);

-- A REENTREGA DE WEBHOOK GRAVANDO DUAS VEZES E A FALHA CONHECIDA DESTA CASA: o
-- Mercado Pago reenvia notificacao POR DESENHO (os indices parciais de
-- idempotencia de 0005 e o UNIQUE de `promocao_resgates` em 0032 existem por
-- isso), e provedor de e-mail faz igual. Sem esta chave, um retry do provedor
-- viraria dois envios no relatorio onde houve um.
--
-- Por (canal, provedor_id) e nao por `provedor_id` sozinho: o id e unico DENTRO
-- do provedor, e nada impede a API de WhatsApp e a de e-mail escolherem a mesma
-- string algum dia.
CREATE UNIQUE INDEX envios_provedor_idx
  ON canastra.envios (canal, provedor_id)
  WHERE provedor_id IS NOT NULL;

CREATE INDEX envios_campanha_idx
  ON canastra.envios (campanha_id, estado)
  WHERE campanha_id IS NOT NULL;

CREATE INDEX envios_titular_idx
  ON canastra.envios (user_id, criado_em DESC)
  WHERE user_id IS NOT NULL;

/* ------------------------------------------------------------------------- *
 * 5. `automacoes` — gatilho, espera, condicao, acao
 * ------------------------------------------------------------------------- */

CREATE TABLE canastra.automacoes (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,

  -- VOCABULARIO FECHADO, E CADA VALOR APONTA PARA UM EVENTO QUE A LOJA
  -- REALMENTE PRODUZ HOJE — nao para uma lista de desejos:
  --   carrinho_abandonado ... o job de `src/jobs/carrinhoAbandonado.js`;
  --   pedido_aprovado / enviado / entregue ... tres dos nove status que o CHECK
  --                          `pedidos_status_valido` (0009) admite;
  --   cliente_novo .......... `canastra.garantir_cliente` (0008);
  --   newsletter_confirmada . o `confirmado_em` que esta migracao cria;
  --   assinatura_criada / cancelada ... o Clube (0015).
  --
  -- Um gatilho fora da lista nao seria uma automacao nova: seria uma automacao
  -- que NENHUM caminho do disparador encontra, salva com sucesso e inerte para
  -- sempre — o mesmo modo de falha da promocao legada sem datas, que 0032 existiu
  -- para nao repetir. Gatilho novo e uma migracao, junto do codigo que o emite.
  gatilho text NOT NULL
            CONSTRAINT automacoes_gatilho_valido
              CHECK (gatilho IN ('carrinho_abandonado', 'pedido_aprovado',
                                 'pedido_enviado', 'pedido_entregue',
                                 'cliente_novo', 'newsletter_confirmada',
                                 'assinatura_criada', 'assinatura_cancelada')),

  -- Zero = dispara junto com o evento. Negativo seria "mande antes do que
  -- aconteceu", que o disparador teria de interpretar de alguma forma.
  espera_minutos integer NOT NULL DEFAULT 0
    CONSTRAINT automacoes_espera_nao_negativa CHECK (espera_minutos >= 0),

  -- CONDICAO EM JSONB, E AQUI O JSONB E A ESCOLHA CERTA — ao contrario de
  -- `promocao_faixas`, que 0032 tirou de um jsonb solto de proposito. A diferenca
  -- e quem valida: la o banco consegue checar quantidade e percentual com CHECK,
  -- aqui a condicao e uma arvore aberta ("subtotal > 150 E categoria = cafe") que
  -- nenhum CHECK descreve sem virar uma linguagem. O que o banco garante e a
  -- FORMA: objeto, nunca escalar nem lista.
  --
  -- Nulavel: automacao sem condicao dispara para todo evento do gatilho, que e o
  -- caso mais comum.
  condicao jsonb
    CONSTRAINT automacoes_condicao_e_objeto
      CHECK (condicao IS NULL OR jsonb_typeof(condicao) = 'object'),

  -- A ACAO E OBRIGATORIA: automacao sem acao e um gatilho que nao faz nada, e
  -- ela ficaria na tela parecendo que faz.
  acao jsonb NOT NULL
         CONSTRAINT automacoes_acao_e_objeto
           CHECK (jsonb_typeof(acao) = 'object'),

  -- NASCE DESLIGADA, e este default e o contrario do de `promocoes.habilitada`
  -- (0032), de proposito. Uma promocao salva desconta dinheiro da propria loja;
  -- uma automacao salva MANDA MENSAGEM PARA CLIENTE DE VERDADE, e mensagem
  -- enviada nao volta. Entre "o gestor esqueceu de ligar" e "o gestor descobriu
  -- que ligou ao ver a reclamacao", o primeiro e o erro barato.
  ativa boolean NOT NULL DEFAULT false,

  criada_em     timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now()
);

-- O disparador pergunta "o que roda neste evento?" a cada evento. Parcial: as
-- desligadas nunca sao resposta, e sao elas que se acumulam com o tempo.
CREATE INDEX automacoes_gatilho_idx
  ON canastra.automacoes (gatilho)
  WHERE ativa;

/* ------------------------------------------------------------------------- *
 * 6. `newsletter_inscritos` — a saida da lista
 * ------------------------------------------------------------------------- */

/**
 * A CORRECAO DE UM FATO, porque a spec o descreve desatualizado: sair da lista
 * JA e possivel hoje — `POST /newsletter/descadastrar` existe
 * (`src/routes/newsletter.routes.js`) e apaga a inscricao por e-mail. O que NAO
 * existe e o que estas colunas trazem, e o proprio cabecalho daquela rota escreve
 * a pendencia com todas as letras: "o padrao de mercado e descadastro por LINK
 * ASSINADO no rodape de cada campanha (...) e o remedio e o MESMO trabalho: a
 * tarefa que ligar campanha tem de fazer double opt-in COM link assinado de
 * descadastro em todo envio — e e la que o token nasce". E aqui.
 *
 * O QUE MUDA COM AS TRES COLUNAS:
 *
 *   `token_descadastro` ... o link do rodape passa a valer para UMA inscricao. A
 *       rota de hoje aceita qualquer e-mail de qualquer pessoa — um script
 *       descadastra a lista inteira de quem ele conheca o endereco. Com token,
 *       so quem RECEBEU a mensagem sai.
 *   `optout_em` ........... a saida deixa de ser um DELETE. Apagar a linha perde
 *       a informacao de que aquele endereco PEDIU para nao receber mais, e o
 *       proximo import da mesma lista o reinscreve — a forma mais comum de
 *       reincidencia de spam que existe. Uma lista de saida e uma lista de
 *       supressao, e ela so funciona se guardar quem saiu.
 *   `confirmado_em` ....... o double opt-in. Hoje a inscricao e single opt-in (a
 *       Onda 2 assumiu isso por escrito), o que quer dizer que qualquer pessoa
 *       inscreve o e-mail de terceiro.
 *
 * A ROTA DE HOJE CONTINUA APAGANDO A LINHA, e isso e proposital: trocar o DELETE
 * por `optout_em` e mudanca de CODIGO, e esta onda e so schema. Enquanto a Onda 4
 * nao trocar, `optout_em` fica nulo em todas as linhas — e essa e a diferenca
 * entre uma coluna vazia e uma coluna mentindo.
 */
ALTER TABLE canastra.newsletter_inscritos
  ADD COLUMN confirmado_em timestamptz,
  ADD COLUMN optout_em     timestamptz,
  -- O CHECK NAO GARANTE ALEATORIEDADE — nada no banco garante —, ele garante que
  -- o token nao seja CURTO. E a diferenca pratica: 32 caracteres do alfabeto
  -- URL-safe sao ~190 bits se sorteados, e um `Math.random()` de seis digitos
  -- escrito com pressa ERRA aqui, no INSERT, em vez de virar um link que qualquer
  -- um adivinha e usa para descadastrar terceiro. O teto de 128 existe para o
  -- token caber numa URL de e-mail sem ser quebrado por cliente de e-mail antigo.
  ADD COLUMN token_descadastro text
    CONSTRAINT newsletter_token_formato
      CHECK (token_descadastro IS NULL
             OR token_descadastro ~ '^[A-Za-z0-9_-]{32,128}$');

-- PARCIAL pelo motivo de sempre (`produtos_sku_idx`, 0003): NULL nao colide com
-- NULL num indice unico do Postgres, entao a diferenca pratica e so o tamanho do
-- indice — mas a mesma pegadinha do `ON CONFLICT` vale, e a linha explicita e o
-- que faz a decisao aparecer.
CREATE UNIQUE INDEX newsletter_token_idx
  ON canastra.newsletter_inscritos (token_descadastro)
  WHERE token_descadastro IS NOT NULL;

/* ------------------------------------------------------------------------- *
 * 7. `carrinhos.token_retomada` — metade do e-mail de sacola abandonada
 * ------------------------------------------------------------------------- */

/**
 * A OUTRA METADE JA EXISTE: `src/jobs/carrinhoAbandonado.js` acha a sacola parada
 * e `carrinhos.lembrete_enviado_em` (0011) garante um lembrete por episodio. O
 * que falta e o LINK devolver a pessoa ao carrinho CHEIO — e um link de e-mail
 * nao carrega sessao.
 *
 * QUEM SORTEIA E O SERVICO, e o token e uma credencial ao portador: quem tem o
 * link tem a sacola daquela pessoa. Por isso o CHECK de tamanho — o mesmo
 * argumento de `token_descadastro`, e aqui vale mais, porque a sacola tem nome de
 * produto e o carrinho leva ao checkout.
 *
 * O QUE ESTA COLUNA **NAO** MUDA, e vale escrever porque parece que muda: o dono
 * continua sendo o unico que ve a propria linha (`carrinhos_dono`, 0006). Ele
 * enxerga e reescreve o proprio token, e isso e inofensivo — reescrever o proprio
 * token so invalida o proprio link. Tentar plantar o token de outra pessoa esbarra
 * no indice unico com 23505; o oraculo que isso abre e teorico (confirmaria a
 * existencia de um token que a pessoa ja teria de ter adivinhado inteiro), e o
 * piso de 32 caracteres e o que o mantem teorico.
 */
ALTER TABLE canastra.carrinhos
  ADD COLUMN token_retomada text
    CONSTRAINT carrinhos_token_formato
      CHECK (token_retomada IS NULL
             OR token_retomada ~ '^[A-Za-z0-9_-]{32,128}$');

CREATE UNIQUE INDEX carrinhos_token_retomada_idx
  ON canastra.carrinhos (token_retomada)
  WHERE token_retomada IS NOT NULL;

/* ------------------------------------------------------------------------- *
 * 8. A redacao de LGPD alcanca o que esta migracao criou
 * ------------------------------------------------------------------------- */

/**
 * Tira tudo depois do primeiro `?` ou `#` de uma URL.
 *
 * POR QUE UMA FUNCAO COM NOME, e nao a expressao inline: sao DOIS consumidores
 * (`referrer` e `landing_page`) na mesma UPDATE, e o argumento de 0016 ao extrair
 * `redigir_endereco` vale igual — duas copias divergem na primeira correcao.
 *
 * O QUE ELA PRESERVA e o que 0013 chama de estatistica: esquema, host e caminho
 * ('https://cafecanastra.com/cafes') dizem de que pagina a venda saiu e nao
 * identificam ninguem. O que ela tira e a query string, que e onde o `gclid`
 * viaja por construcao, junto de qualquer coisa que uma plataforma de anuncio
 * resolva ter pendurado ali amanha — e por isso o corte e por POSICAO (tudo
 * depois do `?`) e nao por lista de parametros conhecidos: lista de parametros e
 * denylist, e denylist envelhece.
 *
 * FORMAS QUE NAO SAO URL: o que nao tem `?` nem `#` volta inteiro, inclusive
 * texto solto — `split_part` devolve a string toda quando o separador nao
 * aparece. NULL vira NULL pelo STRICT, e string vazia continua vazia. Nenhuma
 * delas derruba a redacao, que e o requisito que 0013 ja tinha ("formas
 * inesperadas de endereço: nenhuma derruba a redação").
 *
 * IMMUTABLE de verdade: so olha o argumento. E idempotente por construcao —
 * redigir o ja redigido nao acha `?` nenhum e devolve o mesmo texto.
 */
CREATE FUNCTION canastra.redigir_url(url text) RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path = canastra, pg_temp
AS $redigir_url$
  SELECT split_part(split_part(url, '#', 1), '?', 1)
$redigir_url$;

-- Mesma higiene de 0013/0016: `proacl` nasce nulo (EXECUTE para PUBLIC), o
-- REVOKE primeiro e a lista explicita depois deixam escrito quem chama.
-- `service_role` entra pelo mesmo motivo de `redigir_endereco`: o SQL manual de
-- orfaos do runbook.
REVOKE EXECUTE ON FUNCTION canastra.redigir_url(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canastra.redigir_url(text) TO service_role;

/**
 * A redacao do titular, versao com atribuicao.
 *
 * CREATE OR REPLACE sobre a assinatura EXATA de 0013/0016 — mesmo nome, mesmo
 * parametro, mesmo retorno —, entao todo chamador existente (`conta.routes.js`,
 * `lgpd.routes.js`) continua valendo, e o contrato do retorno nao muda: continua
 * sendo a contagem de PEDIDOS redigidos.
 *
 * POR QUE UMA COPIA DO CORPO INTEIRO, e nao uma edicao de 0016: migracao
 * aplicada nao se edita (regra da casa desde 0011), e ha o motivo tecnico que
 * 0016 ja registrou — plpgsql resolve nomes na PRIMEIRA CHAMADA, entao a funcao
 * de 0016 nao poderia citar colunas que so existem a partir daqui. Esta versao,
 * escrita depois do ALTER TABLE la em cima, pode.
 *
 * O QUE MUDA EM RELACAO A 0016, e so isto:
 *   · `gclid` e `fbclid` viram NULL;
 *   · `referrer` e `landing_page` perdem a query string;
 *   · `envios.destinatario_final` vira '[redigido]'.
 * Pedidos (endereco e itens), assinaturas e avaliacoes seguem palavra por palavra
 * como estavam — inclusive a denylist de itens, que continua sendo denylist pelo
 * motivo de 0013 (whitelist congelaria a lista e apagaria o proximo campo de
 * PRODUTO que o checkout gravasse, destruindo registro fiscal).
 *
 * CREATE OR REPLACE preserva a ACL (REVOKE PUBLIC + GRANT service_role) mas NAO
 * preserva atributos declarados: SECURITY INVOKER (default), o `SET search_path`
 * e o nao-STRICT sao re-declarados aqui de proposito, com as MESMAS razoes de
 * 0013 — INVOKER porque quem chama ja tem o privilegio, nao-STRICT porque NULL
 * tem de ser ERRO e nunca no-op silencioso no fluxo de exclusao de conta.
 */
CREATE OR REPLACE FUNCTION canastra.redigir_dados_do_titular(alvo_user_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path = canastra, pg_temp
AS $redigir$
DECLARE
  pedidos_redigidos integer;
BEGIN
  -- Identico a 0013/0016: NULL e erro de contrato (22004), nunca "nenhum alvo" —
  -- um no-op silencioso no fluxo de exclusao fabricaria o orfao irredigivel.
  IF alvo_user_id IS NULL THEN
    RAISE EXCEPTION 'A redação exige um titular: pedido órfão não tem redação por titular.'
      USING ERRCODE = 'null_value_not_allowed',
            HINT = 'Redija ANTES ou JUNTO da exclusão da conta — depois dela o vínculo já se foi.';
  END IF;

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
       -- A ATRIBUICAO, pelo criterio do cabecalho: identificador de clique sai,
       -- campanha fica. As `utm_*` e `canal` nao aparecem nesta lista de
       -- proposito — sao a estatistica de venda, o equivalente de cidade e UF em
       -- 0013.
       gclid  = NULL,
       fbclid = NULL,
       referrer     = canastra.redigir_url(p.referrer),
       landing_page = canastra.redigir_url(p.landing_page),
       redigido_em = now(),
       -- Regra de 0005: sem trigger de moddatetime, quem escreve carimba.
       atualizado_em = now()
   WHERE p.user_id = alvo_user_id
     AND p.redigido_em IS NULL;

  GET DIAGNOSTICS pedidos_redigidos = ROW_COUNT;

  -- ASSINATURAS — so as canceladas, pela decisao 1 de 0016 (enquanto a entrega
  -- recorrente existe, o endereco congelado e necessario a execucao do contrato).
  UPDATE canastra.assinaturas a
     SET endereco_json = canastra.redigir_endereco(a.endereco_json),
         redigido_em   = now(),
         atualizado_em = now()
   WHERE a.user_id = alvo_user_id
     AND a.status = 'cancelada'
     AND a.redigido_em IS NULL;

  -- AVALIACOES — o nome publico sai; nota e texto ficam (decisao 2 de 0016).
  UPDATE canastra.avaliacoes av
     SET nome_exibicao = 'Cliente Canastra'
   WHERE av.user_id = alvo_user_id
     AND av.nome_exibicao <> 'Cliente Canastra';

  /**
   * ENVIOS — o endereco sai, a linha fica.
   *
   * Sem coluna de carimbo nova: a idempotencia E o predicado, como nas
   * avaliacoes de 0016 — '[redigido]' nao e alvo de novo, e o segundo UPDATE nao
   * acha linha. O carimbo de auditoria da redacao continua sendo
   * `pedidos.redigido_em`, que e o que o endpoint do titular responde.
   *
   * LIMITE CONHECIDO, o mesmo dos pedidos orfaos de 0013: envio com `user_id`
   * nulo — mensagem para quem nunca teve conta, ou linha que sobreviveu a um
   * SET NULL — nao tem redacao por titular, porque o vinculo nao existe mais.
   * Por isso a redacao acontece ANTES da exclusao da conta, e nao depois.
   */
  UPDATE canastra.envios e
     SET destinatario_final = '[redigido]'
   WHERE e.user_id = alvo_user_id
     AND e.destinatario_final <> '[redigido]';

  RETURN pedidos_redigidos;
END;
$redigir$;

/* ------------------------------------------------------------------------- *
 * 9. Privilegios
 * ------------------------------------------------------------------------- */

/**
 * `anon` NAO RECEBE NADA AQUI, e as quatro ausencias sao a decisao.
 *
 * 0001 inverteu o padrao de proposito — tabela nova NAO nasce legivel por `anon`
 * —, entao nao ha REVOKE a escrever: o que falta e o GRANT, e ele nao vem.
 * Tabela a tabela:
 *
 *   `consentimentos` e `envios` .. carregam vinculo com pessoa (e-mail, telefone,
 *       IP). A spec §3.10 as nomeia junto de `promocao_resgates` e `admin_log`.
 *   `campanhas` .................. carrega o CUSTO DE MIDIA. E o calendario
 *       comercial e o orcamento da loja num GET — o mesmo argumento que 0032 usou
 *       para recusar `USING (true)` em `promocoes`, aqui com dinheiro dentro.
 *   `automacoes` ................. a condicao e a acao descrevem as regras de
 *       relacionamento da loja, e nenhuma vitrine precisa le-las.
 *
 * E as colunas de atribuicao de `pedidos` seguem a tabela: `anon` nunca teve
 * GRANT nenhum ali, entao um `SELECT gclid FROM canastra.pedidos` como anonimo
 * responde 42501 — medido em test/marketing.test.js.
 */

/**
 * REDUNDANTE HOJE, ESCRITO ASSIM MESMO — o mesmo argumento de 0030:123 e
 * 0032:877. O `ALTER DEFAULT PRIVILEGES` de 0001 ja da INSERT/UPDATE/DELETE a
 * `authenticated` em toda tabela nova de `canastra`, mas aquele default so
 * alcanca objeto criado pelo MESMO papel que rodou o ALTER. Uma destas tabelas
 * recriada por outro caminho (psql com outro usuario, Supabase Studio, restore
 * parcial) nasceria SEM privilegio de escrita, e o painel levaria 42501 com toda
 * a RLS correta.
 *
 * SO AS DUAS TABELAS DE REGRA. `consentimentos` e `envios` sao registro do que ja
 * aconteceu e ficam de fora — ver o REVOKE abaixo.
 */
GRANT INSERT, UPDATE, DELETE ON canastra.campanhas  TO authenticated;
GRANT INSERT, UPDATE, DELETE ON canastra.automacoes TO authenticated;

/**
 * CAMPANHA NAO SE APAGA, E A TRAVA E DE PRIVILEGIO — o desenho de `promocoes` em
 * 0032, pelo mesmo motivo elevado: aqui o que se perde no DELETE e o CUSTO DE
 * MIDIA, que e a metade da conta de lucro e nao existe em lugar nenhum fora desta
 * linha. Os pedidos guardam o `utm_campaign` em texto e sobrevivem; o quanto se
 * gastou para consegui-los, nao.
 *
 * `envios.campanha_id` aponta para ca com RESTRICT, o que ja barraria as
 * campanhas QUE JA ENVIARAM. Este REVOKE fecha tambem as que ainda nao enviaram —
 * que sao justamente as que alguem apaga por engano ("essa nunca rodou, pode
 * tirar"), e que ja podem ter custado dinheiro em anuncio.
 *
 * O caminho que existe e `ativa = false`. `automacoes` MANTEM o DELETE: apagar
 * uma automacao e edicao de regra, e o que ela ja mandou esta em `envios`.
 */
REVOKE DELETE ON canastra.campanhas FROM authenticated;

/**
 * AS DUAS TABELAS DE REGISTRO SO O SERVICO ESCREVE. Nem cliente nem admin.
 *
 * E o mesmo desenho de `promocao_resgates` e `pedido_ajustes_desconto` em 0032, e
 * a razao e a mesma com outro conteudo: consentimento e envio nascem no gesto que
 * os produziu — a pessoa marcando a caixa, o provedor confirmando a entrega —,
 * dentro da transacao do servico. Um consentimento inserido pelo painel seria a
 * loja escrevendo, com a propria mao, a prova de que a pessoa autorizou. E um
 * envio inserido a mao e um relatorio de entrega que nao veio de entrega nenhuma.
 *
 * `SELECT` NAO ENTRA NO REVOKE, de proposito: o painel LE os dois (a tela de
 * marketing, o historico de mensagens de um cliente). Quem recorta a LINHA ali e
 * a politica, que e o mecanismo certo para esse recorte — diferente do DELETE
 * acima, que e operacao inteira.
 */
REVOKE INSERT, UPDATE, DELETE ON canastra.consentimentos FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON canastra.envios         FROM authenticated;

/* ------------------------------------------------------------------------- *
 * 10. RLS
 * ------------------------------------------------------------------------- */

ALTER TABLE canastra.campanhas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.consentimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.envios         ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.automacoes     ENABLE ROW LEVEL SECURITY;

/**
 * NENHUMA POLITICA PUBLICA, EM NENHUMA DAS QUATRO. `test/rls.test.js` mantem a
 * lista chumbada `PUBLICAS` — as relacoes onde um `FOR SELECT USING (true)` e
 * aceito —, e acrescentar um nome ali e afirmar, no diff, que aquela relacao
 * inteira pode ser lida por quem nao tem conta. Para estas quatro isso seria
 * falso, entao esta migracao NAO acrescenta nome nenhum aquela lista — como 0032
 * tambem nao acrescentou.
 *
 * O `TO authenticated` NAO E ENFEITE, e esta e a licao que 0030 descobriu do jeito
 * dificil: sem clausula TO a politica nasce `TO public`, e `public` alcanca
 * tambem o DONO das tabelas — de quem `eh_admin()` depende para ler `admins` por
 * baixo da RLS.
 *
 * `FOR ALL` com `eh_admin()` cobre SELECT junto, o que aqui e util e nao
 * perigoso: as politicas permissivas se somam com OR e nao ha nenhuma outra que
 * alcance quem nao e admin.
 */
CREATE POLICY campanhas_admin ON canastra.campanhas
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

CREATE POLICY automacoes_admin ON canastra.automacoes
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

/**
 * `consentimentos` e `envios` — leitura so da admin, e SO leitura.
 *
 * `FOR SELECT` e nao `FOR ALL`, e a diferenca importa mesmo com o REVOKE de
 * escrita ja no lugar: e a mesma disciplina de 0031 — o privilegio e a tranca de
 * producao, a politica e a que aparece no diff. Uma politica `FOR ALL` aqui
 * ficaria esperando o dia em que alguem devolvesse o GRANT de escrita "so para
 * testar".
 *
 * NEM O PROPRIO CLIENTE LE OS SEUS, e a decisao e a de `promocao_resgates` em
 * 0032: o direito de acesso do titular (art. 18, II) e servido pela rota de
 * exportacao do Express, que roda como dono e monta a resposta inteira — nao por
 * um SELECT do navegador numa tabela que tambem guarda o IP e o texto aceito de
 * outras pessoas. (Que aquela rota ainda NAO inclui estas duas tabelas esta
 * registrado no cabecalho como divida de codigo, fora do escopo desta onda.)
 */
CREATE POLICY consentimentos_admin_le ON canastra.consentimentos
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());

CREATE POLICY envios_admin_le ON canastra.envios
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());
