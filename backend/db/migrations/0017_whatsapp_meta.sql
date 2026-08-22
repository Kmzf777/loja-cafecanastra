-- WhatsApp Cloud API (Meta): a credencial, o rastro do que foi enviado, a
-- trava de idempotencia do webhook e o consentimento do cliente.
--
-- A integracao NASCE DESLIGADA (`ativo` default false, como BLING_ATIVO em
-- 0012): um banco sem WhatsApp nenhum e exatamente igual ao de ontem.
--
-- O QUE ESTA MIGRACAO DELIBERADAMENTE NAO FAZ: nao guarda telefone completo em
-- tabela nova. Guardar telefone fora de `clientes` abriria um SEGUNDO elo a
-- manter na redacao da LGPD (0013, 0016) para sempre. O painel se vira com os
-- quatro ultimos digitos.

/* ------------------------------------------------------------------------- *
 * A configuracao e a credencial
 * ------------------------------------------------------------------------- */

-- Tabela PROPRIA, e nao coluna em `config_loja`, por um motivo medido:
-- `config_loja` e publica por desenho -- GRANT SELECT para `anon` (0005),
-- politica `config_loja_leitura_publica` com USING (true) (0006) e a rota
-- `GET /config` (products.routes.js) respondendo sem autenticacao. O Bling
-- conseguiu guardar segredo la porque 0012 trancou por privilegio de COLUNA, e
-- funciona; mas cada segredo novo naquela tabela e mais um que depende de
-- ninguem escrever `select=*`. Uma tabela sem GRANT nenhum nao tem esse risco.
--
-- Linha unica pelo mesmo par de guardas de `config_loja` (0005): o CHECK pega o
-- INSERT com id explicito (23514) e a chave primaria pega o caminho comum, que
-- pega o DEFAULT 1 (23505).
CREATE TABLE canastra.whatsapp_config (
  id integer PRIMARY KEY DEFAULT 1
       CONSTRAINT whatsapp_config_linha_unica CHECK (id = 1),

  ativo boolean NOT NULL DEFAULT false,

  -- O token de System User da Meta NAO rotaciona -- a Meta nao devolve um
  -- substituto a cada uso, diferente do refresh token do Bling (0012). Ele
  -- mora aqui mesmo assim porque o painel e quem o grava, e a env vale como
  -- semente. O preco esta escrito no spec: segredo em tabela entra em pg_dump
  -- e continua legivel por quem tiver a service_role key.
  access_token    text,
  app_secret      text,
  verify_token    text,
  phone_number_id text,
  waba_id         text,

  -- Para onde vai quem apertar "Falar com alguem". Semente: LOJA_WHATSAPP, a
  -- mesma env que semeia `config_loja.whatsapp` (db/seed.js) -- o numero
  -- humano da loja e um so, mas ele e PUBLICO naquela tabela e aqui e destino
  -- de roteamento do bot; separar evita que mexer num mexa no outro.
  numero_suporte  text,

  -- Um interruptor por status, e nao um jsonb: o painel mapeia 1:1 e um valor
  -- invalido aqui seria um aviso que ninguem sabe explicar.
  aviso_pendente    boolean NOT NULL DEFAULT true,
  aviso_aprovado    boolean NOT NULL DEFAULT true,
  aviso_enviado     boolean NOT NULL DEFAULT true,
  aviso_entregue    boolean NOT NULL DEFAULT true,
  aviso_cancelado   boolean NOT NULL DEFAULT true,
  aviso_reembolsado boolean NOT NULL DEFAULT true,

  -- MANTIDA POR QUEM ESCREVE: nao ha trigger de moddatetime neste schema
  -- (regra de 0004/0005). Todo UPDATE do servico escreve now() junto.
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

/* ------------------------------------------------------------------------- *
 * O rastro do que saiu
 * ------------------------------------------------------------------------- */

CREATE TABLE canastra.whatsapp_mensagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE SET NULL como o resto do schema: o registro do que foi enviado
  -- nao desaparece com a exclusao LGPD do cliente; a linha perde o PEDIDO.
  pedido_id uuid REFERENCES canastra.pedidos (pedido_id) ON DELETE SET NULL,

  -- Sem FK, como o resto do schema faz com auth.users. E ISSO TEM UM TROCO QUE
  -- PRECISA ESTAR ESCRITO: sem FK nao ha cascata nem SET NULL, entao a exclusao
  -- da conta deixa aqui um uuid que nao resolve mais para pessoa nenhuma. Nao e
  -- furo -- o uuid sozinho, com `telefone_final` de quatro digitos ao lado, nao
  -- identifica ninguem depois que `auth.users` e `clientes` se foram --, mas
  -- quem for varrer dado pessoal um dia procura por FK e nao acha esta linha.
  user_id uuid,

  -- SO os quatro ultimos digitos. Ver o cabecalho: telefone completo mora em
  -- `clientes.telefone` e em lugar nenhum mais.
  telefone_final text,

  template text NOT NULL,

  -- Vocabulario PROPRIO, em portugues, traduzido do provedor pelo servico (a
  -- mesma disciplina de 0015 e de utils/statusDePedido.js).
  status text NOT NULL DEFAULT 'pendente'
           CONSTRAINT whatsapp_mensagens_status_valido
             CHECK (status IN ('pendente', 'enviada', 'entregue', 'lida', 'falhou')),

  -- Identificador OPACO do outro sistema: TEXTO, nunca inteiro -- a mesma
  -- lente de `bling_id` (0012) e de `pagamento_id_mp` (0005).
  wamid text,

  erro_codigo integer,
  erro_texto  text,

  criado_em     timestamptz NOT NULL DEFAULT now(),
  enviado_em    timestamptz,
  entregue_em   timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- PARCIAL como `pedidos_bling_id_idx` (0012): quase toda linha nasce com wamid
-- NULL, e um indice total indexaria a tabela inteira para proteger um punhado
-- de linhas.
--
-- O QUE ELE **NAO** FAZ: nao impede duas mensagens do mesmo template para o
-- mesmo pedido. Quem impede isso e a guarda de status igual no wrapper
-- (services/notificacoes.js) -- aqui embaixo so nao ha como o mesmo envio da
-- Meta virar duas linhas.
CREATE UNIQUE INDEX whatsapp_mensagens_wamid_idx
  ON canastra.whatsapp_mensagens (wamid)
  WHERE wamid IS NOT NULL;

CREATE INDEX whatsapp_mensagens_pedido_idx
  ON canastra.whatsapp_mensagens (pedido_id);

/* ------------------------------------------------------------------------- *
 * A trava de idempotencia do webhook
 * ------------------------------------------------------------------------- */

-- A Meta reentrega por ATE 7 DIAS diante de qualquer resposta diferente de 200,
-- e reentrega tambem quando o 200 se perde na volta. Nenhuma quantidade de
-- "responder 200 rapido" elimina a duplicata; so deduplicacao elimina.
--
-- A chave e o PAR wamid+status para status, e o wamid puro para entrada: o
-- mesmo wamid gera `sent`, `delivered` e `read`, entao deduplicar so por wamid
-- DESCARTARIA status legitimos. Quem monta a chave e o servico -- aqui embaixo
-- so existe a promessa de que a mesma chave nao entra duas vezes (23505).
CREATE TABLE canastra.whatsapp_eventos (
  dedupe_key  text PRIMARY KEY,
  recebido_em timestamptz NOT NULL DEFAULT now()
);

-- A limpeza corta por aqui. Retencao de 7 dias, alinhada a janela de
-- reentrega documentada -- TTL de "algumas horas" deixa passar a duplicata do
-- fim da janela, que e justamente a que ninguem esta olhando.
CREATE INDEX whatsapp_eventos_recebido_idx
  ON canastra.whatsapp_eventos (recebido_em);

/* ------------------------------------------------------------------------- *
 * RLS -- nada entra pelo navegador
 * ------------------------------------------------------------------------- */

-- Obrigatorio: a invariante de backend/test/schema.test.js reprova qualquer
-- tabela de `canastra` sem isto, sem precisar citar o nome dela.
ALTER TABLE canastra.whatsapp_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.whatsapp_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.whatsapp_eventos   ENABLE ROW LEVEL SECURITY;

-- NAO HA POLITICA, e a ausencia e o desenho: enviar e receber WhatsApp passa
-- pelo Express e pelo webhook, nunca por um INSERT de navegador. RLS ligada sem
-- politica ja nega; o REVOKE e a SEGUNDA TRANCA, pelo argumento de 0006 e 0011
-- -- a ausencia de politica se perde com um CREATE POLICY distraido de outro
-- dia; o privilegio de tabela nao. O pacote `arwd` que 0001 concede por default
-- a `authenticated` esta inerte hoje e sai inteiro para nao ser acordado
-- amanha.
--
-- `service_role` NAO e tocado: e credencial de servidor (0001), e e por ela que
-- o bot inteiro fala. Um REVOKE que o pegasse junto deixaria a suite verde e o
-- bot morto -- test/whatsapp_schema.test.js afirma os dois lados.
-- `anon` nao aparece porque nunca teve nada: 0001 o mantem fora do default, e
-- quem for publico leva GRANT proprio.
REVOKE ALL ON canastra.whatsapp_config    FROM authenticated;
REVOKE ALL ON canastra.whatsapp_mensagens FROM authenticated;
REVOKE ALL ON canastra.whatsapp_eventos   FROM authenticated;

/* ------------------------------------------------------------------------- *
 * O consentimento, no cliente
 * ------------------------------------------------------------------------- */

-- CARIMBO DE DATA, e nao booleano, nos tres consentimentos: o onus de provar
-- que o consentimento existiu e do controlador (LGPD Art. 8 par. 2), e um
-- `true` nao diz QUANDO a pessoa concordou.
--
-- AS CINCO COLUNAS MORAM EM `clientes` E ISSO AS COLOCA NO CAMINHO DA LGPD DE
-- GRACA: `clientes.user_id` referencia `auth.users (id) ON DELETE CASCADE`
-- (0002), entao o DELETE no GoTrue que a exclusao de conta dispara
-- (conta.routes.js) leva a linha inteira -- wa_id e os tres carimbos junto. Por
-- isso elas NAO aparecem em `redigir_dados_do_titular` (0013/0016): aquela
-- funcao redige FOTOGRAFIAS que SOBREVIVEM a exclusao (pedidos, assinaturas,
-- avaliacoes), e estas nao sobrevivem. Coluna nova AQUI nao pede nada da
-- redacao; coluna nova numa tabela que sobreviva, pede -- e e por isso que o
-- cabecalho recusa telefone completo em tabela nova.
ALTER TABLE canastra.clientes
  -- A CHAVE CANONICA. A doc da Meta diz, com estas palavras: "For Brazil and
  -- Mexico, the extra added prefix of the phone number may be modified by the
  -- Cloud API" -- o nono digito. Casar o `from` do webhook com o telefone do
  -- cadastro daria "cliente desconhecido" para metade do Brasil. O telefone
  -- digitado e a semente do PRIMEIRO envio; dai em diante manda o wa_id.
  ADD COLUMN whatsapp_wa_id text,

  -- Avisos de pedido: execucao de contrato (LGPD Art. 7 V), carimbado junto
  -- com o telefone no cadastro.
  ADD COLUMN whatsapp_optin_em timestamptz,

  -- Promocoes: consentimento (Art. 7 I), caixa a parte e desmarcada.
  ADD COLUMN whatsapp_promo_optin_em timestamptz,

  -- Nao existe STOP nativo: a Meta nao intercepta texto. Parar de mandar e
  -- inteiramente responsabilidade da loja, e e esta coluna.
  ADD COLUMN whatsapp_optout_em timestamptz,

  -- O relogio da janela de 24h. Fora dela a Meta responde 131047 e so template
  -- aprovado sai. E tambem o teto de "um menu por janela" do roteador.
  ADD COLUMN whatsapp_ultima_entrada_em timestamptz;

/**
 * `canastra.garantir_cliente` GANHA UMA LINHA, E SO UMA.
 *
 * A UNICA mudanca de comportamento e carimbar `whatsapp_optin_em` quando um
 * telefone e efetivamente gravado -- o consentimento de aviso de pedido e o ATO
 * de deixar o numero, e sem o carimbo nao ha como provar QUANDO ele foi dado.
 * O corpo abaixo e o de 0008, copiado; a unica diferenca esta marcada no lugar.
 *
 * MESMA ASSINATURA de 0008, de proposito: test/garantir_cliente.test.js afirma
 * a assinatura NO CATALOGO, e um quarto parametro criaria uma FUNCAO NOVA que
 * aquele teste nao veria -- ele continuaria verde sobre a funcao velha enquanto
 * o cadastro real passaria a chamar outra.
 *
 * CREATE OR REPLACE PRESERVA A ACL de 0008 (REVOKE EXECUTE de PUBLIC + GRANT
 * para `authenticated`): `proacl` fica na troca de corpo, e por isso ela nao e
 * repetida aqui -- mesmo raciocinio que 0016 usou ao substituir
 * `redigir_dados_do_titular`. O que ele NAO preserva sao os atributos
 * declarados, entao `SECURITY DEFINER` e `SET search_path` vem escritos de novo
 * abaixo, pelas MESMAS razoes de 0008: sem o DEFINER o INSERT morre no REVOKE
 * de 0006, e sem o search_path quem chama escolhe em que schema `clientes` sera
 * procurada.
 *
 * NAO HA RAMO DE CONFLITO PARA CARIMBAR, e a ausencia precisa estar escrita
 * porque e o primeiro lugar onde se vai procurar: o `ON CONFLICT (user_id)` de
 * 0008 e `DO NOTHING`, e quem ja e cliente sai antes disso, no RETURN
 * antecipado. Transformar aquilo num `DO UPDATE` para carimbar o optin
 * reabriria exatamente o que 0008 fechou -- o login de outro aparelho
 * sobrescrevendo o cadastro que a pessoa corrigiu no perfil.
 *
 * ENTAO ISTO E UM LIMITE CONHECIDO: quem se cadastra SEM telefone e o informa
 * depois, pela tela de perfil (a politica `clientes_dono_atualiza` de 0006), nao
 * passa por aqui e nao ganha carimbo nenhum. Quem escrever aquele UPDATE tem de
 * carimbar `whatsapp_optin_em` no mesmo gesto -- e sem carimbo o bot nao manda,
 * que e a falha para o lado seguro.
 */
CREATE OR REPLACE FUNCTION canastra.garantir_cliente(
  nome     text,
  telefone text DEFAULT NULL,
  cpf      text DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = canastra, pg_temp
AS $garantir_cliente$
DECLARE
  -- As copias locais existem para nao haver ambiguidade entre parametro e coluna
  -- dentro do INSERT. Com `variable_conflict` no padrao (`error`), uma referencia
  -- ambigua so apareceria em TEMPO DE EXECUCAO, no cadastro de alguem.
  id_do_usuario  uuid := auth.uid();
  confirmado_em  timestamptz;
  nome_limpo     text;
  telefone_limpo text;
  cpf_limpo      text;
BEGIN
  /**
   * Sessao sem identidade: ERRO, nunca resultado vazio.
   *
   * `anon` nao chega aqui (o REVOKE do fim do arquivo barra antes), entao este
   * ramo cobre o que resta: PostgREST mal configurado, um psql, um papel dono
   * chamando a mao. Sem ele, o INSERT tentaria gravar `user_id = NULL` e a recusa
   * viria da chave primaria como 23502 — uma mensagem sobre coluna nula, que
   * manda procurar erro no formulario quando o problema e a sessao.
   *
   * ERRCODE `insufficient_privilege` (42501) DE PROPOSITO IGUAL AO DO `anon`:
   * para quem chama, os dois casos sao a mesma coisa — "voce nao esta logado" — e
   * levam a mesma tela. Codigos diferentes obrigariam o cliente a tratar duas
   * vezes o mesmo desfecho. E 42501 e o codigo que a propria RLS usaria aqui, que
   * e a regra que 0002 e 0007 seguiram ao escolher ERRCODE.
   */
  IF id_do_usuario IS NULL THEN
    RAISE EXCEPTION 'Não há sessão autenticada nesta chamada.'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Entre na loja antes de criar o vínculo de cliente.';
  END IF;

  /**
   * QUEM JA E CLIENTE SAI AQUI, SEM ESCREVER NADA E SEM MAIS NENHUMA PERGUNTA.
   *
   * TRES coisas dependem deste retorno antecipado, e nenhuma e obvia:
   *
   *   1. O CADASTRO DA PESSOA NAO PODE SER REVERTIDO POR UM LOGIN. A cliente
   *      corrige o proprio nome no perfil (a politica `clientes_dono_atualiza` de
   *      0006 existe para isso) e entra noutro aparelho; um `DO UPDATE` aqui
   *      devolveria o nome que o formulario de cadastro guardou. Perda de dado
   *      silenciosa, disparada por um login. Vale igual para telefone e ainda
   *      mais para `cpf`, que e UNIQUE: sobrescrever levantaria 23505.
   *   2. A CHAMADA REPETIDA NAO PODE EXIGIR OS DADOS DE NOVO. A RPC roda em toda
   *      sessao autenticada, e nao so no cadastro — e assim que o vinculo aparece
   *      para quem confirma o e-mail dias depois. Sem esta saida, um
   *      `garantir_cliente(NULL)` de quem JA e cliente morreria no NOT NULL de
   *      `nome` (23502) antes de o ON CONFLICT ter chance de opinar: o NOT NULL e
   *      verificado na linha proposta, nao no desfecho do conflito. Ou seja,
   *      quebraria justamente o caso que a funcao existe para servir.
   *   3. POR QUE ELE VEM ANTES DA CHECAGEM DE E-MAIL, e nao depois — esta ordem e
   *      deliberada e ja esteve invertida. A confirmacao guarda o ato de VIRAR
   *      cliente; aplica-la a quem JA e cliente tranca do lado de fora alguem que
   *      ja entrou. Basta `email_confirmed_at` voltar a NULL por qualquer caminho
   *      — troca de e-mail em alguma versao do GoTrue, conta migrada a mao,
   *      restauracao parcial de backup — para um cliente antigo passar a receber
   *      28000 em TODA sessao; e se o front leu 28000 como "voce ainda nao tem
   *      vinculo", ele entra em laco pedindo a confirmacao de um link que a
   *      pessoa ja clicou. Quem ja e cliente nao precisa reprovar nada: a prova
   *      foi dada uma vez, e a linha e o recibo.
   *
   * O `ON CONFLICT` ABAIXO CONTINUA SENDO NECESSARIO, e nao e redundancia deste
   * IF: entre o EXISTS e o INSERT ha uma janela, e duas sessoes da mesma pessoa
   * (duas abas, `onAuthStateChange` disparando em paralelo) chegam nela. Sem o
   * ON CONFLICT, uma das duas leva 23505 na chave primaria no meio do login. O IF
   * cobre o caso comum sem escrever; o ON CONFLICT cobre a corrida.
   *
   * A LEITURA AQUI PASSA POR BAIXO DA RLS, por ser SECURITY DEFINER, e isso e o
   * que se quer: a politica `clientes_dono_le` de 0006 mostraria a mesma linha,
   * mas depender dela faria esta funcao quebrar em silencio se aquela politica
   * fosse estreitada um dia — e "quebrar em silencio" aqui significa tentar
   * inserir de novo.
   */
  IF EXISTS (SELECT 1 FROM canastra.clientes c WHERE c.user_id = id_do_usuario) THEN
    RETURN;
  END IF;

  /**
   * E-MAIL CONFIRMADO, LIDO DE `auth.users` E NAO DE CLAIM NO JWT.
   *
   * O que isto impede: alguem se cadastra com o e-mail de OUTRA pessoa e vira
   * cliente desta loja antes de provar que o endereco e dele. O dono de verdade
   * so descobre ao receber o link de confirmacao de uma conta que ja esta
   * comprando — e, se a loja um dia mandar qualquer coisa por e-mail, ela manda
   * para o endereco errado.
   *
   * POR QUE A TABELA E NAO O CLAIM, que seria mais barato: `email_verified` vem
   * dentro do JWT, e nesta instancia COMPARTILHADA quem emite o token nao e a
   * loja. Um claim e afirmacao de quem assina; `auth.users` e o registro do
   * GoTrue. Ler a tabela e o mesmo principio pelo qual administrador e linha em
   * `canastra.admins` e nunca claim (0002).
   *
   * `email_confirmed_at` E A COLUNA CERTA PARA ESTA LOJA, e o alcance exato
   * importa. Ela e preenchida pelo GoTrue quando o link e clicado e tambem
   * quando `GOTRUE_MAILER_AUTOCONFIRM` esta ligado (o caso de um self-hosted sem
   * SMTP, e o caso do `instalacao-completa.sql`, que ja a preenche a mao). ONDE
   * ELA E NULL EM CONTA LEGITIMA: cadastro por TELEFONE (ai quem enche e
   * `phone_confirmed_at`) e sessao ANONIMA do GoTrue (`is_anonymous`). Nenhum dos
   * dois existe nesta loja — o cadastro e e-mail e senha —, e por isso NAO se le
   * `confirmed_at` (que e `LEAST(email_confirmed_at, phone_confirmed_at)`, coluna
   * gerada e ausente em versoes antigas do GoTrue). Se um dia entrar login por
   * telefone, e ESTA linha que precisa mudar, e nao a tela de cadastro.
   *
   * ERRCODE `invalid_authorization_specification` (28000) E SEPARADO DO 42501 DE
   * PROPOSITO, e essa e a unica distincao que quem chama precisa fazer: 42501
   * quer dizer "nao esta logado" e leva a tela de login; 28000 quer dizer "esta
   * logado, falta confirmar" e leva ao "reenviar confirmacao". Um codigo so
   * obrigaria a tela a casar TEXTO de mensagem para decidir, que e a fragilidade
   * que test/ajuda/sessao.js documenta.
   */
  SELECT u.email_confirmed_at INTO confirmado_em
  FROM auth.users u
  WHERE u.id = id_do_usuario;

  /**
   * UID SEM LINHA EM `auth.users`: a RESPOSTA e a mesma do e-mail pendente, e o
   * DIAGNOSTICO vai para o log do servidor. As duas metades importam.
   *
   * A RESPOSTA E A MESMA de proposito. Dois SQLSTATEs distintos fariam desta RPC
   * um oraculo sobre o `auth.users` da instancia compartilhada. O argumento de
   * que "so da para perguntar sobre o proprio uid, porque e preciso ter o token
   * dele" e mais fraco do que parece: ele vale HOJE, com o PostgREST na frente,
   * e deixa de valer no dia em que qualquer outro caminho chamar esta funcao. Um
   * canal lateral fechado por acidente de topologia nao esta fechado.
   *
   * MAS OS DOIS CASOS TEM REMEDIOS OPOSTOS — "reenvie o link" contra "esta conta
   * nao existe mais, ou este token e de outra instancia" —, e quem for depurar
   * "esta pessoa nao consegue terminar o cadastro" recebia a orientacao errada.
   * O `RAISE LOG` atende os dois lados de uma vez: a verdade vai para o log do
   * servidor e NAO para o cliente. Com os defaults, `client_min_messages` e
   * NOTICE, que fica ACIMA de LOG na ordem do CLIENTE, entao a mensagem nao viaja
   * na resposta; e `log_min_messages` e WARNING, que fica ABAIXO de LOG na ordem
   * do SERVIDOR, entao ela e gravada. (As duas ordens sao diferentes, e essa
   * assimetria e justamente o que torna LOG util aqui.) A resposta ao cliente
   * fica byte a byte identica nos dois ramos — test/garantir_cliente.test.js
   * compara `code`, `message` e `hint` dos dois lado a lado para provar isso.
   *
   * `NOT FOUND`, e nao `confirmado_em IS NULL`: o segundo nao distingue "nao ha
   * linha" de "ha linha, com a coluna nula", que e exatamente a distincao que
   * este log existe para registrar.
   */
  IF NOT FOUND THEN
    RAISE LOG 'garantir_cliente: uid % sem linha em auth.users', id_do_usuario;
  END IF;

  IF confirmado_em IS NULL THEN
    RAISE EXCEPTION 'Confirme o e-mail desta conta antes de continuar.'
      USING ERRCODE = 'invalid_authorization_specification',
            HINT = 'O link de confirmação foi enviado no cadastro; reenvie-o se necessário.';
  END IF;

  /**
   * `nullif(btrim(...), '')` nos tres, e cada um resolve um problema diferente:
   *
   *   nome ...... "   " vindo de um formulario passa pelo NOT NULL de 0002 e cria
   *               um cliente que aparece em BRANCO no painel e no rotulo da
   *               encomenda, sem erro nenhum na hora. Virando NULL, ele cai no
   *               RAISE logo abaixo, no momento em que da para consertar.
   *   cpf ....... e UNIQUE. Duas pessoas que deixam o campo vazio mandariam '' as
   *               duas, e a SEGUNDA levaria 23505 — no cadastro dela, falando de
   *               um CPF que ela nao digitou. Com NULL, o indice trata cada
   *               ausencia como distinta (NULLS DISTINCT, o padrao), que e
   *               exatamente o que 0002 documentou querer.
   *   telefone .. sem UNIQUE nem NOT NULL, entra so para os tres campos guardarem
   *               a MESMA nocao de "nao informado" — um '' aqui e um NULL ali
   *               fariam a tela de perfil precisar testar as duas formas.
   *
   * OS TRES ESTAO MEDIDOS em test/garantir_cliente.test.js, inclusive o desfecho
   * do `cpf` com dois cadastros vazios na mesma transacao. Antes disso, este
   * paragrafo era a unica coisa segurando as tres linhas abaixo — e um paragrafo
   * nao fica vermelho quando alguem apaga a linha que ele defende.
   *
   * E DESDE 0017 `telefone_limpo` DECIDE TAMBEM O OPT-IN DE WHATSAPP (ver o
   * INSERT). Ou seja: apagar o `nullif` do telefone deixaria de ser um detalhe
   * de formulario e passaria a carimbar consentimento para quem mandou '' —
   * consentimento que nao existiu, sobre um numero que nao existe.
   */
  nome_limpo     := nullif(btrim(nome), '');
  telefone_limpo := nullif(btrim(telefone), '');
  cpf_limpo      := nullif(btrim(cpf), '');

  /**
   * NOME EM BRANCO: recusa CURADA, e nao a da coluna.
   *
   * Sem este RAISE a recusa acontece do mesmo jeito — o NOT NULL de 0002 barra —,
   * mas ela chega no navegador como "null value in column nome of relation
   * clientes violates not-null constraint", com nome de tabela e de coluna
   * dentro. ALTO e CURADO sao propriedades diferentes, e este arquivo gasta
   * dezenas de linhas defendendo a segunda: nao da para exigir que quem chama
   * ramifique por SQLSTATE escolhido e entregar cru justamente o erro de
   * formulario mais provavel de todos.
   *
   * O ERRCODE CONTINUA SENDO 23502, E ISSO E A ESCOLHA, nao a preguica: e o
   * codigo que a propria coluna usaria, entao quem chama trata UM caso, venha a
   * recusa daqui ou da tabela — inclusive se um dia este RAISE for removido por
   * engano. Dentro desta funcao 23502 nao e ambiguo: `user_id` ja foi garantido
   * nao-nulo la em cima, e `nome` e a unica outra coluna NOT NULL de `clientes`.
   */
  IF nome_limpo IS NULL THEN
    RAISE EXCEPTION 'O nome é obrigatório para criar o cadastro.'
      USING ERRCODE = 'not_null_violation',
            HINT = 'Preencha o nome de quem vai receber a encomenda.';
  END IF;

  /**
   * O uid vem de `auth.uid()` e de lugar nenhum mais — REGRA 1 DO CABECALHO.
   * Nao existe caminho de parametro ate esta coluna, e e por isso que a funcao
   * pode ser executavel por `authenticated` sem reabrir o que 0006 fechou.
   *
   * `canastra.admins` NAO APARECE NESTE ARQUIVO, e a ausencia e a regra 3 do
   * cabecalho: `admins` referencia `clientes`, entao esta funcao fabrica o
   * PRE-REQUISITO de administrador — e nao pode, nem por engano futuro, dar o
   * segundo passo. Virar administrador continua sendo escrita de `service_role`,
   * pelo servico, e o REVOKE de 0003 continua valendo.
   *
   * O `EXCEPTION` E O SEGUNDO ERRO DE FORMULARIO CURADO, pelo mesmo motivo do
   * nome em branco: um CPF ja cadastrado chegaria no navegador como 23505 com
   * `clientes_cpf_key` no corpo, e "clientes_cpf_key" nao e uma frase que se
   * mostre a alguem.
   *
   * O QUE TORNA A TRADUCAO CORRETA, e ela depende disto: depois do
   * `ON CONFLICT (user_id) DO NOTHING` a chave primaria NAO PODE MAIS levantar
   * 23505, e `UNIQUE (cpf)` e a unica outra restricao de unicidade de
   * `canastra.clientes` (0002). Logo todo `unique_violation` que chega neste
   * handler E o CPF. ACRESCENTAR OUTRO UNIQUE AQUELA TABELA QUEBRA A INFERENCIA —
   * e o sintoma seria uma mensagem confiante falando de CPF sobre um conflito que
   * nao e de CPF. Quem mexer em 0002 tem de reler isto. (0017 acrescentou cinco
   * colunas a `clientes`, nenhuma delas UNIQUE, justamente para nao quebrar isto:
   * `whatsapp_wa_id` seria o candidato natural a um indice unico, e ele nao tem.)
   *
   * NAO E UMA PRE-CHECAGEM, de proposito: um `SELECT ... WHERE cpf = ...` antes
   * do INSERT teria a mesma janela de corrida do EXISTS la em cima, e duas
   * sessoes simultaneas voltariam a produzir o 23505 cru que ele existe para
   * traduzir. O handler ve o desfecho, nao a intencao.
   *
   * NAO VAZA NADA DE NOVO: "este CPF ja esta cadastrado" ja era dedutivel do
   * 23505 cru e do nome da constraint. O que muda e so quem consegue ler a frase.
   *
   * ERRCODE `unique_violation` (23505) mantido pela mesma razao do 23502 acima: e
   * o codigo que o indice usaria, entao a tela trata um caso so.
   */
  BEGIN
    INSERT INTO canastra.clientes (user_id, nome, telefone, cpf, whatsapp_optin_em)
    VALUES (
      id_do_usuario, nome_limpo, telefone_limpo, cpf_limpo,
      -- A UNICA LINHA QUE 0017 ACRESCENTOU AO CORPO DE 0008. `CASE` sem `ELSE`
      -- devolve NULL, que e o que se quer: cadastro sem telefone nao carimba
      -- consentimento nenhum. Carimbar sempre transformaria a coluna num
      -- `criado_em` com outro nome e destruiria a unica coisa que ela prova.
      CASE WHEN telefone_limpo IS NOT NULL THEN now() END
    )
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Este CPF já está cadastrado em outra conta desta loja.'
      USING ERRCODE = 'unique_violation',
            HINT = 'Confira o número digitado, ou entre com a conta que já usa este CPF.';
  END;
END;
$garantir_cliente$;
