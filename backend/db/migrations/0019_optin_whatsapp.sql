-- A porta pela qual o TITULAR registra o proprio WhatsApp depois do cadastro.
--
-- POR QUE ELA PRECISA EXISTIR, E POR QUE NAO DA PARA RESOLVER COM UM UPDATE
-- 0008 abriu `garantir_cliente`, e 0017 a fez carimbar `whatsapp_optin_em`
-- quando um telefone e gravado. Isso cobre UM caminho: o cadastro que ja nasce
-- com sessao. Sobram dois, e sao os dois mais comuns desta loja:
--
--   1. QUEM CONFIRMA O E-MAIL DEPOIS. Com confirmacao ligada — a configuracao
--      desta loja — o `signUp` nao devolve sessao, entao `garantir_cliente` nao
--      roda no formulario. Quem cria o vinculo e `montarUsuario()`, dias depois,
--      e ele so sabe o NOME: telefone nao viaja em `user_metadata` de proposito
--      (o JWT desta instancia compartilhada acompanha a pessoa para outros
--      projetos). O numero digitado no cadastro se perde no caminho.
--   2. QUEM JA TINHA CONTA. Toda linha de `clientes` anterior a esta fase tem
--      `telefone` nulo — a loja nunca coletou telefone de ninguem. Sem um
--      caminho de correcao, o bot inteiro so alcanca cadastro novo.
--
-- E O UPDATE DIRETO NAO RESOLVE, por duas razoes que se somam:
--
--   · `whatsapp_promo_optin_em` NAO E GRAVAVEL PELO NAVEGADOR. 0018 revogou o
--     UPDATE de tabela de `authenticated` e devolveu a lista
--     `(user_id, nome, cpf, telefone, criado_em, whatsapp_optout_em)`, porque
--     carimbo de consentimento que o titular escreve nao prova consentimento
--     nenhum — e o onus da prova e do controlador (LGPD Art. 8 par. 2). Um
--     UPDATE do PostgREST que toque aquela coluna recusa o comando INTEIRO com
--     42501.
--   · `telefone` E GRAVAVEL, E ESCREVE-LO SOZINHO E PIOR DO QUE NAO PODER.
--     `whatsapp_optin_em` esta na lista fechada; o navegador gravaria o numero
--     SEM o carimbo. E `notificacoes.js` manda para quem tem `telefone` e nao
--     tem `whatsapp_optout_em` — nao consulta o carimbo. Ou seja: a loja
--     passaria a escrever para um numero sobre o qual nao tem prova nenhuma de
--     consentimento. Este e exatamente o "LIMITE CONHECIDO" que o cabecalho de
--     0017 registrou ("quem escrever aquele UPDATE tem de carimbar
--     `whatsapp_optin_em` no mesmo gesto"); esta migracao e o gesto.
--
-- ENTAO ABRE-SE UMA PORTA, COM NOME E COM REGRA, como 0008 fez — e nao se
-- destranca a tabela. O REVOKE de 0018 NAO e desfeito: `authenticated` continua
-- sem UPDATE nas quatro colunas fechadas, e a unica escrita nelas disponivel a
-- quem nao e `service_role` passa a ser esta funcao, que escreve o
-- `auth.uid()` da sessao e mais ninguem.
--
-- AS DUAS METADES SAO SEPARADAS DENTRO DA MESMA FUNCAO, e a separacao e o
-- requisito legal, nao arrumacao:
--
--   AVISO DE PEDIDO ... execucao de contrato (Art. 7 V). Nao depende de
--       consentimento: a pessoa pediu aquilo quando comprou. O carimbo existe
--       para provar QUANDO ela deixou o numero, e o ato de deixar o numero E o
--       opt-in — dai `whatsapp_optin_em` andar junto com `telefone` e nunca
--       sozinho.
--   PROMOCAO ......... consentimento (Art. 7 I). Caixa a parte, DESMARCADA por
--       padrao, e revogavel por procedimento gratuito e facilitado
--       (Art. 8 par. 5). Dai `promocoes` ser TRES ESTADOS e nao dois — ver o
--       comentario do parametro.
--
-- Uma funcao so, e nao duas, porque a tela da area da conta grava as duas
-- coisas no mesmo botao: duas RPCs ali seriam duas idas ao banco e uma janela
-- em que o numero entrou e a preferencia nao. Os dois parametros sao
-- independentes de verdade — cada um so mexe nas colunas dele —, e e isso que
-- test/whatsapp_optin.test.js afirma um por um.
--
-- O QUE ESTA MIGRACAO **NAO** FAZ, e precisa estar escrito porque e onde a
-- proxima pessoa vai procurar:
--
--   1. NAO LIMPA `whatsapp_optout_em`. Quem pediu para parar continua parado,
--      mesmo trocando o numero por aqui. E deliberado: religar o canal como
--      efeito colateral de outra acao e o oposto do que a coluna significa, e o
--      silencio e o lado seguro do erro. Religar continua sendo um UPDATE que o
--      proprio titular pode fazer (0018 deixou aquela coluna aberta para ele).
--   2. NAO CRIA LINHA em `clientes`. Quem cria e `garantir_cliente`, e so ela —
--      um INSERT aqui reabriria o furo que 0006 fechou por um segundo caminho.
--      Sem linha, a funcao RECUSA (P0002) em vez de escrever no vazio.
--   3. NAO VALIDA O FORMATO DO TELEFONE. Quem valida e a tela
--      (`frontend/lib/conta/telefone.ts`) e quem normaliza para E.164 tambem. A
--      funcao limpa espaco e recusa vazio, e nada mais: uma regra de formato
--      escrita aqui seria a TERCEIRA copia da mesma coisa (a quarta com
--      `backend/src/utils/telefone.js`), e a que ninguem lembraria de atualizar.
--   4. NAO CONFERE E-MAIL CONFIRMADO. Quem chega aqui ja e cliente, e ser
--      cliente ja exigiu a confirmacao la em 0008. Repetir a checagem trancaria
--      do lado de fora, na hora de mudar o telefone, alguem cujo
--      `email_confirmed_at` tenha voltado a NULL por qualquer caminho — o
--      mesmo raciocinio pelo qual o RETURN antecipado de 0008 vem ANTES da
--      checagem de e-mail.

/**
 * SECURITY DEFINER, E AQUI E PRIVILEGIO MESMO — a mesma leitura de 0008.
 *
 * `authenticated` NAO TEM UPDATE em `whatsapp_optin_em` nem em
 * `whatsapp_promo_optin_em` (0018 revogou). A funcao roda como o DONO das
 * tabelas, que tem o privilegio e e isento de RLS, e por isso o UPDATE passa.
 *
 * `SET search_path` NAO E OPCIONAL, pelo motivo de sempre: sem ele quem chama
 * escolhe em que schema `clientes` sera procurada e executa o que quiser com os
 * poderes do dono do banco. `pg_temp` vai por ULTIMO de proposito — na frente,
 * uma tabela temporaria do proprio chamador sequestraria o nome. `auth.uid()`
 * vai qualificado justamente porque `auth` nao esta no caminho.
 *
 * A ASSINATURA NAO TEM `user_id`, E ESSA E A REGRA. Um parametro de uid faria
 * desta funcao um jeito de carimbar consentimento no nome de outra pessoa — e
 * de apontar o WhatsApp dela para um numero escolhido por quem chamou. Nao ha
 * caminho de parametro ate `user_id`, e e por isso que ela pode ser executavel
 * por `authenticated` sem reabrir o que 0018 fechou.
 *
 * SEM `STRICT`, pelo mesmo motivo de 0008: com STRICT,
 * `registrar_optin_whatsapp(NULL, true)` devolveria NULL sem entrar no corpo, e
 * marcar a caixa de promocoes sem trocar de numero — que e o caso comum na area
 * da conta — nao gravaria nada, em silencio.
 *
 * `LANGUAGE plpgsql` porque ha ramo, GET DIAGNOSTICS e RAISE. Nada aqui
 * referencia `auth.users`, entao o argumento de 0008 sobre a analise do corpo
 * no CREATE nao se aplica — mas o resto do arquivo e plpgsql, e uma funcao SQL
 * solitaria no meio so pediria a pergunta.
 */
CREATE FUNCTION canastra.registrar_optin_whatsapp(
  telefone  text    DEFAULT NULL,
  /**
   * TRES ESTADOS, e os tres sao usados:
   *   NULL .. "nao mexa". E o que o cadastro manda quando so quer gravar o
   *           numero, e o que a tela manda quando so quer trocar o telefone.
   *   true .. consentiu. Carimba, se ainda nao houver carimbo.
   *   false . REVOGOU. Apaga o carimbo, e e este ramo que faz a revogacao ser
   *           "gratuita e facilitada" (Art. 8 par. 5) de verdade — um `boolean`
   *           de dois estados obrigaria a tela a inventar outro caminho para
   *           desmarcar, e "outro caminho" costuma virar "e-mail para o
   *           suporte".
   */
  promocoes boolean DEFAULT NULL
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = canastra, pg_temp
AS $registrar_optin_whatsapp$
DECLARE
  -- Copia local pelo motivo de 0008: sem ela, `telefone` dentro do UPDATE seria
  -- ambiguo entre parametro e coluna, e com `variable_conflict` no padrao
  -- (`error`) isso so apareceria em TEMPO DE EXECUCAO, no gesto de alguem.
  id_do_usuario  uuid := auth.uid();
  telefone_limpo text;
  atualizadas    integer;
BEGIN
  /**
   * Sessao sem identidade: ERRO, nunca resultado vazio — e o mesmo 42501 de
   * 0008, pela mesma razao. `anon` nao chega aqui (o REVOKE do fim do arquivo
   * barra antes); este ramo cobre o resto (PostgREST mal configurado, um psql,
   * um papel dono chamando a mao). Sem ele, o UPDATE simplesmente nao acharia
   * linha e a funcao voltaria calada, dizendo por omissao que gravou.
   */
  IF id_do_usuario IS NULL THEN
    RAISE EXCEPTION 'Não há sessão autenticada nesta chamada.'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'Entre na loja antes de registrar o WhatsApp.';
  END IF;

  -- `nullif(btrim(...), '')` pela razao de 0008: um '' aqui e um NULL ali
  -- fariam a tela precisar testar as duas formas de "nao informado".
  telefone_limpo := nullif(btrim(telefone), '');

  /**
   * NADA A FAZER: sai sem escrever, e sem erro.
   *
   * Nao e cortesia — e o que impede a chamada vazia de MEXER NO QUE JA EXISTE.
   * Sem este ramo, `registrar_optin_whatsapp()` sem argumento nenhum rodaria o
   * UPDATE abaixo, que e todo COALESCE/CASE e portanto reescreveria cada coluna
   * com o proprio valor. Inofensivo hoje; deixa de ser no dia em que houver
   * trigger de `atualizado_em` naquela tabela, e ai um GET que virou POST por
   * engano passa a "atualizar" o cadastro de todo mundo que abrir a tela.
   */
  IF telefone_limpo IS NULL AND promocoes IS NULL THEN
    RETURN;
  END IF;

  /**
   * UM UPDATE SO, E CADA CASE MEXE APENAS NA METADE DELE.
   *
   * `whatsapp_optin_em := now()` QUANDO HA TELEFONE, e nao
   * `COALESCE(whatsapp_optin_em, now())`: o carimbo tem de descrever o numero
   * que esta gravado AGORA. Preservar o carimbo antigo ao trocar de numero
   * produziria a prova errada — "consentiu em janeiro" sobre um numero que
   * entrou em agosto —, que e pior do que nao ter prova, porque parece prova.
   * O ato de deixar o numero E o opt-in, e o ultimo ato e o que vale.
   *
   * `whatsapp_promo_optin_em`, ao contrario, e `COALESCE(...)` no ramo `true`:
   * ali o gesto nao muda de destino: remarcar uma caixa que ja estava marcada
   * nao e um consentimento novo, e adiantar o carimbo apagaria a data em que a
   * pessoa de fato consentiu — que e a unica coisa que a coluna existe para
   * guardar.
   *
   * `whatsapp_wa_id` NAO E TOCADO, e a omissao e deliberada: ele e a chave
   * canonica que o webhook grava depois da primeira resposta do cliente. Um
   * numero novo aqui NAO invalida o wa_id — pode ser o mesmo aparelho com o
   * telefone digitado de outro jeito, e limpar o wa_id faria a loja voltar a
   * adivinhar o nono digito para um cliente sobre o qual ja tinha a resposta.
   * Se um dia a troca de numero precisar limpar o wa_id, e AQUI, com um teste
   * que descreva por que o caso do "mesmo aparelho" nao se aplica mais.
   */
  UPDATE canastra.clientes c
     SET telefone = COALESCE(telefone_limpo, c.telefone),
         whatsapp_optin_em = CASE
           WHEN telefone_limpo IS NOT NULL THEN now()
           ELSE c.whatsapp_optin_em
         END,
         whatsapp_promo_optin_em = CASE
           WHEN promocoes IS TRUE  THEN COALESCE(c.whatsapp_promo_optin_em, now())
           WHEN promocoes IS FALSE THEN NULL
           ELSE c.whatsapp_promo_optin_em
         END
   WHERE c.user_id = id_do_usuario;

  /**
   * ZERO LINHAS E ERRO, e este e o ramo que mais importa depois do 42501.
   *
   * Ha sessao, mas nao ha linha em `clientes` — a conta e do GoTrue e o vinculo
   * com a loja nao existe (confirmou o e-mail agora, ou entrou por outro
   * projeto da instancia compartilhada). Voltar calado seria dizer "gravei" a
   * uma tela que mostraria "pronto" sobre um consentimento que nao existe em
   * lugar nenhum. E consentimento fantasma e exatamente o que o Art. 8 par. 2
   * poe a cargo da loja provar.
   *
   * ERRCODE `no_data_found` (P0002) SEPARADO DO 42501 de proposito, pela mesma
   * regra de 0008: os dois desfechos levam a telas diferentes. 42501 diz "voce
   * nao esta logado" e leva ao login; P0002 diz "voce esta logado e o cadastro
   * nao terminou" e leva a recarregar / entrar de novo, que e o que dispara
   * `montarUsuario()` e cria o vinculo. Mandar quem ja esta logado para o login
   * e o laco que 0008 gastou paragrafos evitando.
   */
  GET DIAGNOSTICS atualizadas = ROW_COUNT;
  IF atualizadas = 0 THEN
    RAISE EXCEPTION 'Esta conta ainda não tem cadastro nesta loja.'
      USING ERRCODE = 'no_data_found',
            HINT = 'Recarregue a página; se continuar, saia e entre de novo.';
  END IF;
END;
$registrar_optin_whatsapp$;

/**
 * `proacl` nasce nulo, o que significa EXECUTE para PUBLIC — e numa funcao
 * SECURITY DEFINER que escreve carimbo de consentimento isso seria a coluna
 * fechada de volta ao alcance de todos, so que por um nome mais simpatico. O
 * REVOKE primeiro, e a lista explicita depois, deixam escrito quem chama.
 *
 * SO `authenticated`, e a ausencia dos outros dois e escolhida, exatamente como
 * em 0008:
 *   · `anon` NAO ENTRA. Sem `auth.uid()` ele so entraria para ser jogado fora
 *     pelo primeiro RAISE; negar no privilegio e a camada de baixo negando
 *     primeiro. Os dois caminhos respondem 42501.
 *   · `service_role` nao chama: tem BYPASSRLS e o UPDATE que 0018 deixou
 *     intacto para ele, entao escreve direto na tabela — e a RPC ainda o faria
 *     escrever pelo `auth.uid()` da requisicao, que num servico e nulo.
 *
 * NOTA PARA A CONFIGURACAO DO POSTGREST, a mesma de 0008: uma RPC so aparece em
 * /rest/v1/rpc/ se o schema estiver em `PGRST_DB_SCHEMAS`. Se `canastra` nao
 * estiver la, esta funcao responde 404 com a migracao perfeitamente aplicada —
 * e o sintoma no navegador e PGRST202, que `lib/conta/cadastro.ts` ja traduz.
 */
REVOKE EXECUTE ON FUNCTION canastra.registrar_optin_whatsapp(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canastra.registrar_optin_whatsapp(text, boolean) TO authenticated;
