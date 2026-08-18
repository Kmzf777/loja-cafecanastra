-- A porta pela qual uma conta do GoTrue vira cliente DESTA loja.
--
-- POR QUE ESTA MIGRACAO EXISTE, E POR QUE ELA E A MAIS DELICADA DA FASE
-- 0006 revogou `INSERT` em `canastra.clientes` de `authenticated`, e aquele
-- revoke e a peca central de seguranca de tudo o que veio antes: uma linha ali
-- fabrica `canastra.eh_cliente()`, e `eh_cliente()` e a metade que sustenta TODA
-- politica de dono do schema. Sem ele, qualquer token da instancia Supabase
-- compartilhada — que chega com assinatura valida e `auth.uid()` preenchido — se
-- auto-cadastraria e passaria a ter linhas aqui dentro.
--
-- So que o cadastro precisa criar exatamente essa linha. O `service_role` faria
-- isso, mas o cadastro desta loja acontece no NAVEGADOR, falando direto com o
-- GoTrue e o PostgREST; passar por um servico Node so para escrever uma linha
-- devolveria ao backend proprio a metade do fluxo que esta fase esta tirando de
-- la.
--
-- ENTAO ABRE-SE UMA PORTA, COM NOME E COM REGRA, em vez de destrancar a tabela.
-- O REVOKE de 0006 NAO e desfeito: `authenticated` continua sem INSERT em
-- `canastra.clientes`, e continua sem politica de INSERT. O unico caminho e esta
-- funcao, e ela obedece a tres regras que a tabela aberta nao teria como impor:
--
--   1. escreve `auth.uid()` e mais ninguem — NAO HA PARAMETRO DE UID;
--   2. so entra quem ja confirmou o e-mail, lido de `auth.users`;
--   3. nunca toca `canastra.admins`.
--
-- O QUE ESTA MIGRACAO NAO IMPEDE, E PRECISA ESTAR ESCRITO
-- Uma conta de OUTRO projeto da instancia, com e-mail confirmado, consegue
-- chamar esta RPC e virar cliente daqui. Isso nao e um furo: o cadastro desta
-- loja e aberto ao publico, entao a mesma pessoa viraria cliente pelo formulario
-- em dez segundos. O que continua fechado e o que importa — ninguem cria vinculo
-- para o uid ALHEIO, ninguem entra sem confirmar e-mail, ninguem vira
-- administrador, e as politicas de dono de 0006 seguem exigindo
-- `user_id = auth.uid()` para alcancar qualquer dado. Se um dia a loja quiser
-- cadastro fechado (convite, lista de espera), a regra entra AQUI, e o teste
-- "LIMITE CONHECIDO" de test/garantir_cliente.test.js e o que fica vermelho.

/**
 * SECURITY DEFINER, E AQUI ISSO E PRIVILEGIO MESMO — nao e o caso de 0002/0006.
 *
 * Em `eh_cliente()` e `eh_admin()` o DEFINER esta la contra RECURSAO; em
 * `exigir_um_admin()`, contra a RLS de quem disparou a trigger. Aqui e o motivo
 * literal: `authenticated` NAO TEM `INSERT` em `canastra.clientes` (0006 revogou)
 * e nao ha politica de INSERT naquela tabela. A funcao roda como o DONO das
 * tabelas, que tem o privilegio e e isento de RLS, e por isso o INSERT passa.
 * Esta e a unica escrita em `clientes` disponivel a quem nao e `service_role`.
 *
 * `SET search_path` NAO E OPCIONAL, e e a diferenca entre uma porta e um
 * alcapao: sem ele quem chama escolhe em que schema `clientes` sera procurada e
 * executa o que quiser com os poderes do dono do banco. `pg_temp` vai por ULTIMO
 * de proposito — na frente, uma tabela temporaria do proprio chamador
 * sequestraria o nome. `auth.uid()` e `auth.users` vao qualificados justamente
 * porque `auth` nao esta no caminho.
 *
 * NAO LEVA `SET row_security = off`, e a ausencia e deliberada — 0006 usa e aqui
 * seria enfeite. La ele existe para tirar o SILENCIO de um modo de falha: com
 * `FORCE ROW LEVEL SECURITY` ligado, o `SELECT` de `eh_admin()` devolveria ZERO
 * linhas e a funcao passaria a responder `false` para todo mundo, calada. Aqui o
 * mesmo FORCE faria o INSERT MORRER — nenhuma politica de `clientes` e `TO`
 * dono, entao o WITH CHECK nao acha ninguem e a resposta e 42501 com a mensagem
 * "new row violates row-level security policy for table clientes", que ja nomeia
 * a tabela e a causa. Nao ha mudez a remover.
 *
 * NAO HA RECURSAO A TEMER com `eh_cliente()`, e vale registrar porque a pergunta
 * e natural: as duas funcoes leem a mesma tabela. Esta aqui NAO CHAMA
 * `eh_cliente()` — nem precisa, ja que a pergunta dela e "existe linha?", que ela
 * responde lendo direto — e, mesmo que chamasse, as duas rodam como o dono, que e
 * isento de RLS, entao nenhuma politica seria avaliada e nao ha ciclo. O aviso de
 * 0006 continua valendo para quem for depurar o caso quebrado: politica que le a
 * PROPRIA tabela direto da 42P17 ("infinite recursion detected in policy"), mas
 * com uma funcao no meio o detector do Postgres nao fecha o ciclo e a consulta
 * vai ate 54001 ("stack depth limit exceeded") — que e o codigo que ninguem
 * pensa em procurar.
 *
 * DE QUEM E A FUNCAO, E POR QUE ISSO PRECISA ESTAR ESCRITO: do papel que aplicou
 * a migracao — `postgres`, o dono do `DATABASE_URL` (docs/producao.md §5.1). E
 * ELE quem precisa ter `SELECT` em `auth.users`, nao quem chama; em Supabase
 * `postgres` e dono do schema `auth` (e por isso o `instalacao-completa.sql`
 * escreve la direto, enquanto o `service_role` leva 42501). Se um dia as
 * migracoes forem aplicadas por outro papel, e AQUI que aparece: a funcao passa a
 * responder 42501 falando de `auth.users` em toda chamada — no cadastro de todo
 * mundo, e sem relacao aparente com esta migracao.
 *
 * `LANGUAGE plpgsql` E NAO `sql`, e nao e so gosto: o corpo de uma funcao SQL e
 * analisado no CREATE, entao uma referencia a `auth.users` faria ESTA MIGRACAO
 * falhar num banco onde o GoTrue ainda nao tenha criado o schema. Em plpgsql a
 * referencia so e resolvida na primeira chamada — a instalacao continua
 * aplicavel, e o erro, se houver, aparece no lugar certo.
 *
 * SEM `STRICT`, pelo mesmo motivo de 0007: com STRICT,
 * `garantir_cliente('Ana', NULL, NULL)` devolveria NULL sem entrar no corpo, e o
 * cadastro de quem nao informa telefone — que e a maioria — nao criaria vinculo
 * nenhum, em silencio.
 *
 * A ASSINATURA NAO TEM `user_id`, E ISSO E A REGRA 1 DO CABECALHO. Um parametro
 * de uid transformaria esta funcao exatamente no furo que 0006 fechou: qualquer
 * sessao autenticada plantaria uma linha para o uid que quisesse — e uma linha em
 * `clientes` e o pre-requisito da chave estrangeira de `canastra.admins`.
 * test/garantir_cliente.test.js afirma a assinatura NO CATALOGO, e nao so o
 * comportamento, porque acrescentar um quarto parametro cria uma FUNCAO NOVA que
 * um teste de comportamento sobre a antiga nao veria.
 */
CREATE FUNCTION canastra.garantir_cliente(
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
   * UID SEM LINHA EM `auth.users` CAI AQUI TAMBEM, com a MESMA recusa — conta
   * apagada, ou token de uma instancia que nao e esta. `confirmado_em` fica NULL
   * quando o SELECT nao acha nada, e o ramo e o mesmo. Isso e deliberado: dois
   * codigos distintos fariam desta RPC um oraculo sobre `auth.users` — quem
   * chamasse saberia se um uid existe na instancia compartilhada. Que hoje isso
   * exija ja possuir um token daquele uid nao torna o vazamento aceitavel; e o
   * mesmo argumento pelo qual `eh_admin()` de 0006 nao recebe parametro.
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

  IF confirmado_em IS NULL THEN
    RAISE EXCEPTION 'Confirme o e-mail desta conta antes de continuar.'
      USING ERRCODE = 'invalid_authorization_specification',
            HINT = 'O link de confirmação foi enviado no cadastro; reenvie-o se necessário.';
  END IF;

  /**
   * QUEM JA E CLIENTE SAI AQUI, SEM ESCREVER NADA.
   *
   * Duas coisas dependem deste retorno antecipado, e nenhuma e obvia:
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
   * `nullif(btrim(...), '')` nos tres, e cada um resolve um problema diferente:
   *
   *   nome ...... "   " vindo de um formulario passa pelo NOT NULL de 0002 e cria
   *               um cliente que aparece em BRANCO no painel e no rotulo da
   *               encomenda, sem erro nenhum na hora. Virando NULL, a propria
   *               coluna recusa com 23502, no momento em que da para consertar.
   *   cpf ....... e UNIQUE. Duas pessoas que deixam o campo vazio mandariam '' as
   *               duas, e a SEGUNDA levaria 23505 — no cadastro dela, falando de
   *               um CPF que ela nao digitou. Com NULL, o indice trata cada
   *               ausencia como distinta (NULLS DISTINCT, o padrao), que e
   *               exatamente o que 0002 documentou querer.
   *   telefone .. sem UNIQUE nem NOT NULL, entra so para os tres campos guardarem
   *               a MESMA nocao de "nao informado" — um '' aqui e um NULL ali
   *               fariam a tela de perfil precisar testar as duas formas.
   */
  nome_limpo     := nullif(btrim(nome), '');
  telefone_limpo := nullif(btrim(telefone), '');
  cpf_limpo      := nullif(btrim(cpf), '');

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
   */
  INSERT INTO canastra.clientes (user_id, nome, telefone, cpf)
  VALUES (id_do_usuario, nome_limpo, telefone_limpo, cpf_limpo)
  ON CONFLICT (user_id) DO NOTHING;
END;
$garantir_cliente$;

/**
 * `proacl` nasce nulo, o que significa EXECUTE para PUBLIC — e numa funcao
 * SECURITY DEFINER que escreve em `canastra.clientes` isso seria a tabela aberta
 * de volta, so que com um nome mais simpatico. O REVOKE primeiro, e a lista
 * explicita depois, deixam escrito quem chama.
 *
 * SO `authenticated`, e a ausencia dos outros dois e escolhida:
 *   · `anon` NAO ENTRA de proposito. Sem `auth.uid()` ele so entraria para ser
 *     jogado fora la dentro pelo primeiro RAISE; negar no privilegio e a camada
 *     de baixo negando primeiro, que e o padrao estabelecido em 0001 e repetido
 *     em 0007. Os dois caminhos respondem 42501, entao quem chama nao precisa
 *     saber qual camada recusou.
 *   · `service_role` nao chama: ele tem BYPASSRLS e o privilegio de INSERT que
 *     0006 deixou intacto para ele, entao escreve direto na tabela. Um EXECUTE
 *     aqui seria privilegio sem uso — e a RPC ainda o faria escrever pelo
 *     `auth.uid()` da requisicao, que num servico e nulo.
 *
 * NOTA PARA A CONFIGURACAO DO POSTGREST, a mesma de 0007: uma RPC so aparece em
 * /rest/v1/rpc/ se o schema estiver em `PGRST_DB_SCHEMAS`. Se `canastra` nao
 * estiver la, esta funcao responde 404 com a migracao perfeitamente aplicada.
 */
REVOKE EXECUTE ON FUNCTION canastra.garantir_cliente(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canastra.garantir_cliente(text, text, text) TO authenticated;
