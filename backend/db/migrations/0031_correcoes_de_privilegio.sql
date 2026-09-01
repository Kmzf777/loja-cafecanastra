-- Tres buracos de privilegio, achados pela pesquisa que antecede a reescrita do
-- painel (docs/pesquisa/2026-08-26-riscos-da-reescrita.md, secao 3).
--
-- O QUE OS TRES TEM EM COMUM, e e por isso que eles cabem numa migracao so:
-- nenhum deles e um erro de POLITICA. As politicas de 0006 e de 0014 dizem a
-- coisa certa sobre LINHA — o dono mexe na propria, o admin modera, o publico
-- le o que e publico. O que esta errado nos tres e o PRIVILEGIO por baixo, que
-- e mais largo do que a politica precisa. E a regra que 0006:282 ja tinha
-- escrito: GRANT decide TABELA e COLUNA, RLS decide LINHA — onde o recorte e de
-- coluna, ou de operacao inteira, ele nao tem como morar numa politica.
--
-- POR QUE 0031 E NAO 0017. A faixa 0017-0029 continua reservada pelo mesmo
-- motivo que 0030 registrou: `0017` esta triplamente disputado fora daqui (a
-- worktree `melhor-envio` tem um `0017_melhor_envio.sql`, a `whatsapp-bot` vai
-- de `0017` a `0021`), o runner (`db/migrar.js`) ABORTA em numero repetido, e a
-- chave de controle em `canastra.migracoes` e o NOME COMPLETO do arquivo —
-- migracao ja aplicada nao pode ser renomeada sem rodar de novo.
--
-- `service_role` NAO E TOCADO em lugar nenhum deste arquivo. Todo REVOKE aqui
-- nomeia `authenticated`, que e o papel do NAVEGADOR. O que o servico Node faz
-- pela `DATABASE_URL` (que conecta como dono do banco) e o que ele faz pelo
-- `service_role` seguem exatamente como estavam — e e disso que dependem os
-- consertos abaixo para nao virarem regressao.

/* ------------------------------------------------------------------------- *
 * 1. `clientes.cpf`: o UNIQUE que virou oraculo de enumeracao
 * ------------------------------------------------------------------------- */

/**
 * O PROBLEMA NAO E O CPF DA ANA, E O DE TODO MUNDO.
 *
 * `clientes_dono_atualiza` (0006:367) autoriza o cliente a dar UPDATE na
 * PROPRIA linha — e politica de RLS nao restringe coluna, entao "a propria
 * linha" inclui `cpf`. Junte a isso o `UNIQUE (cpf)` de 0002 e o endpoint passa
 * a responder duas coisas distinguiveis:
 *
 *   UPDATE ... SET cpf = <numero livre>  ->  sucesso
 *   UPDATE ... SET cpf = <numero alheio> ->  23505, unique_violation
 *
 * Isto e, "este CPF tem conta nesta loja?" respondido um por vez, sem limite,
 * por qualquer cliente, usando so a propria linha. Nenhum dado de terceiro
 * atravessa — o que vaza e a EXISTENCIA, que aqui e o dado. Numa loja, saber
 * que um CPF especifico e cliente ja e informacao vendavel; num vazamento de
 * base alheia, e o que transforma uma lista de CPFs em uma lista de clientes
 * desta loja.
 *
 * O CONSERTO E DE COLUNA PORQUE O PROBLEMA E DE COLUNA. A linha continua sendo
 * do dono (a politica nao muda); o que muda e o que "atualizar" quer dizer.
 * `nome` e `telefone` sao os dois campos que 0006:326 nomeou ao decidir manter o
 * UPDATE de `clientes` de pe ("porque o cliente corrige mesmo o proprio
 * telefone"), e sao os dois que sobram aqui.
 *
 * QUEM CONTINUA ESCREVENDO `cpf`, e sao os dois caminhos que ja o tratavam:
 *
 *   · `canastra.garantir_cliente` (0008), SECURITY DEFINER, no cadastro. Roda
 *     como o DONO das tabelas, entao este REVOKE nao a alcanca. Ela normaliza o
 *     numero (`nullif(btrim(...), '')`) e traduz o 23505 numa frase de loja em
 *     vez de devolver "clientes_cpf_key".
 *   · o servico Node (`src/utils/cpf.js`), no checkout e na adesao do Clube.
 *     Ele conecta pela `DATABASE_URL`, como dono, e tambem passa por cima.
 *
 * O QUE ESTE REVOKE **NAO** FECHA, dito aqui para ninguem ler o paragrafo acima
 * como "acabou": `garantir_cliente` continua distinguindo CPF ocupado de CPF
 * livre — e o codigo dela e o mesmo 23505. A diferenca e o CUSTO, e ele muda de
 * ordem de grandeza: la o INSERT tem `ON CONFLICT (user_id) DO NOTHING`, entao
 * quem JA e cliente nao chega a tocar o indice de CPF; sondar exige uma conta
 * nova, com e-mail confirmado, POR TENTATIVA. Fechar tambem aquela porta e
 * decisao de outra tarefa (ela mexe na mensagem que o cadastro mostra), e o
 * numero de tentativas por hora ali e assunto de rate limit, nao de DDL.
 *
 * Medido em test/rls.test.js: com um CPF que existe na loja, a recusa passa a
 * ser 42501 (privilegio, ANTES do indice) e nao mais 23505 (unicidade, DEPOIS
 * de o indice ter respondido). A troca de codigo E o conserto: 42501 e uma
 * porta fechada, 23505 e uma porta que conta quem esta do outro lado.
 */
REVOKE UPDATE ON canastra.clientes FROM authenticated;
GRANT UPDATE (nome, telefone) ON canastra.clientes TO authenticated;

/* ------------------------------------------------------------------------- *
 * 2. `config_loja`: o DELETE que leva o token do Bling junto
 * ------------------------------------------------------------------------- */

/**
 * A OPERACAO QUE ESCAPOU DO RECORTE DE 0012.
 *
 * 0012 guardou o `bling_refresh_token` na linha unica de `config_loja` e o
 * protegeu com privilegio de COLUNA: `REVOKE SELECT/INSERT/UPDATE` e a lista
 * explicita de volta, todas as colunas MENOS o token. Nem a admin le, nem a
 * admin escreve o token pelo PostgREST — so o servico Node, que conecta como
 * dono.
 *
 * O DELETE ficou de fora daquele recorte, porque naquele momento ele nao era
 * uma forma de ler nem de escrever coluna nenhuma. E nao e mesmo: e a unica
 * operacao que LEVA a coluna sem nunca a ter tocado. `DELETE FROM config_loja`
 * apaga o token junto com o resto da configuracao, e o refresh token do Bling e
 * ROTATIVO (0012:75) — nao existe copia em lugar nenhum, e recuperar exige
 * refazer o OAuth a mao. A politica `config_loja_admin_escreve` (0006:438) e
 * `FOR ALL`, entao ela autoriza a linha; o privilegio de DELETE veio do GRANT
 * de tabela de 0006:271. Duas camadas concordando com um comando que ninguem
 * precisa dar.
 *
 * NINGUEM PRECISA DELE, e isso e verificavel e nao opinativo: a tabela e de UMA
 * linha (o CHECK de 0005), o caminho de mudar configuracao e UPDATE, e os dois
 * modulos do servico que escrevem ali (`src/repositories/configRepository.js` e
 * `src/services/blingClient.js`) fazem `INSERT ... ON CONFLICT (id) DO NOTHING`
 * e UPDATE — nenhum DELETE em `canastra.config_loja` existe no repositorio.
 *
 * POR QUE E REVOKE E NAO UMA POLITICA, pela regra do cabecalho: uma politica de
 * DELETE ausente ja recusaria, mas ausencia de politica e propriedade que um
 * `CREATE POLICY ... FOR ALL` distraido apaga sem querer — e `FOR ALL` e
 * exatamente o formato que esta tabela ja usa. O privilegio nao se perde assim.
 * E o mesmo argumento que 0006:301 usou para `clientes` e `pedidos`.
 *
 * `INSERT` NAO ENTRA NESTE REVOKE, e a distincao e proposital: o DELETE tira
 * algo que nao volta, o INSERT nao tira nada — o CHECK `id = 1` de 0005 ja
 * impede uma segunda linha, e um INSERT contra a linha existente bate na chave
 * primaria. Ele hoje nao tem chamador pelo navegador (quem cria a linha e o
 * servico, com `ON CONFLICT (id) DO NOTHING`, conectado como dono), entao
 * revoga-lo tambem seria defensavel — mas e uma decisao de outra tarefa, e
 * misturar "fechar um caminho destrutivo" com "podar privilegio sem uso" numa
 * migracao so tira a clareza do diff que fecha o buraco.
 */
REVOKE DELETE ON canastra.config_loja FROM authenticated;

/* ------------------------------------------------------------------------- *
 * 3. `avaliacoes.user_id`: o vinculo pessoa-compra aberto para a instancia
 * ------------------------------------------------------------------------- */

/**
 * O QUE ESTAVA ABERTO. 0014:234 deu `GRANT SELECT` de TABELA a `authenticated`
 * — a tabela inteira, `user_id` incluso — e a politica
 * `avaliacoes_aprovadas_publicas` mostra toda avaliacao aprovada a qualquer
 * `authenticated`. Numa instancia compartilhada, "qualquer authenticated" quer
 * dizer tambem um token emitido para OUTRO projeto da VPS: ele lia, de uma vez,
 * o uuid de todos os avaliadores da loja.
 *
 * E O UUID E O DADO. Ele e a MESMA chave de `auth.users` da instancia inteira,
 * entao ele liga a avaliacao ("comprei este cafe, recebi em agosto") a qualquer
 * outra tabela de qualquer outro projeto que guarde o mesmo uuid. O texto da
 * avaliacao ja e publico de proposito; o vinculo com a PESSOA nao era para ser.
 *
 * O RECORTE E O MESMO QUE `anon` JA TINHA (0014:232), mais `moderado_em`. Nao e
 * arbitrario: sao exatamente as nove colunas que a tela de moderacao do painel
 * pede (`AvaliacoesManager.jsx`, constante `COLUNAS`), verificadas uma a uma —
 * ela nao le `user_id` em lugar nenhum, e modera por `id`
 * (`update(...).in("id", ids)`). O admin autentica como `authenticated` como
 * todo mundo, entao o GRANT dele e este mesmo.
 *
 * O QUE ISTO QUEBROU, E POR QUE A FUNCAO ABAIXO EXISTE. Privilegio de coluna
 * vale para a consulta INTEIRA, nao so para a projecao: `WHERE user_id = ...`
 * exige SELECT em `user_id` do mesmo jeito que `SELECT user_id` exigiria. E a
 * vitrine tinha exatamente essa consulta — `minhasAvaliacoes()`, em
 * `frontend/lib/avaliacoes/avaliacoes.ts`, fazia `.eq("user_id", uid)` para
 * saber quais cafes a pessoa JA avaliou. Medido: depois do REVOKE ela responde
 * 42501, e o modo de falha daquele modulo e devolver `[]` com um `console.warn`
 * — ou seja, a pagina do pedido voltaria a oferecer formulario para cafe ja
 * avaliado, em silencio, e o envio morreria em 23505.
 *
 * O MESMO VALE PARA ESCRITA, e isto morde o painel: um
 * `UPDATE avaliacoes SET status = ... WHERE user_id = ...` passa a responder
 * 42501 ATE para o admin, porque o `user_id` do WHERE e leitura. A tela real ja
 * modera por `id` (`update(...).in("id", ids)`), entao nada quebrou hoje — mas
 * quem escrever consulta nova de moderacao tem de chavear por `id`, nunca por
 * autor. Esta frase existe porque o sintoma (42501 numa tela de admin que
 * "sempre funcionou") manda procurar o erro na politica, e o erro nao esta la.
 *
 * NAO DA PARA RESOLVER ISSO COM POLITICA, e vale escrever por que para ninguem
 * tentar: politica corta LINHA, GRANT corta COLUNA, e o que se queria aqui era
 * "esta coluna, so nas linhas que sao suas" — um corte que o Postgres nao faz
 * em nenhuma das duas camadas. Por isso a pergunta muda de forma: em vez de o
 * navegador FILTRAR por `user_id`, ele PERGUNTA "quais sao as minhas", e quem
 * responde e uma funcao que ja sabe quem esta perguntando.
 */
REVOKE SELECT ON canastra.avaliacoes FROM authenticated;

GRANT SELECT (id, sku, nota, titulo, texto, nome_exibicao, status, criado_em,
              moderado_em)
  ON canastra.avaliacoes TO authenticated;

/**
 * "Quais avaliacoes sao minhas?" — a substituta do `.eq("user_id", uid)`.
 *
 * SECURITY DEFINER, e aqui e PRIVILEGIO MESMO (o caso de 0008, nao o de
 * 0006/0014): ela roda como o dono justamente para poder ler a coluna que o
 * REVOKE acima acabou de tirar de quem chama. `user_id` entra no WHERE e NAO
 * na projecao — o chamador recebe as proprias avaliacoes sem receber de volta o
 * proprio uuid, que ele ja tem, e sem que a funcao vire um jeito indireto de
 * ler a coluna.
 *
 * SEM ARGUMENTO, pelo motivo de `eh_admin()` em 0006:96: uma
 * `minhas_avaliacoes(uid uuid)` executavel por `authenticated` seria o mesmo
 * vazamento por outra porta — qualquer token da instancia varreria uuids e leria
 * as avaliacoes de quem quisesse. Lendo so `auth.uid()`, ela nao responde nada
 * sobre terceiros. Este e o ponto do arquivo inteiro e nao pode ser "melhorado"
 * depois por conveniencia de tela.
 *
 * `auth.uid()` NULO (sessao `anon`, ou claim vazio) casa `user_id = NULL`, que e
 * NULL e nunca TRUE: zero linhas, sem erro. E o desfecho certo — e o mesmo que a
 * pessoa sem avaliacao nenhuma recebe.
 *
 * `canastra.eh_cliente()` NA FRENTE e a Regra 2 de 0006. Aqui ela e quase
 * redundante (quem nao e cliente nunca conseguiu INSERIR uma avaliacao, entao
 * nao teria linha para achar), e entra assim mesmo por duas razoes: a regra vale
 * por si, sem depender de a politica de INSERT continuar exigindo cadastro; e
 * ela torna a resposta a um token estrangeiro uma DECISAO ("voce nao e cliente
 * desta loja") em vez de um acidente ("por acaso nao ha linhas suas").
 *
 * `SET search_path` e obrigatorio em DEFINER, com `pg_temp` por ultimo, e
 * `auth.uid()` qualificado porque `auth` nao esta no caminho — as tres pelo que
 * 0006:88 explica.
 *
 * `SET row_security = off` PELO MOTIVO DE 0006/0014, e ele morde exatamente
 * aqui: se um dia ligarem `FORCE ROW LEVEL SECURITY` em `avaliacoes`, o dono
 * deixa de ser isento, nenhuma politica daquela tabela e `TO` dono, o SELECT
 * volta ZERO LINHAS — e a tela do pedido diria "voce ainda nao avaliou nada"
 * para todo mundo, sem erro nenhum, que e a mesma mudez que 0006 documentou.
 * Com o SET, a mesma situacao responde 42501 nomeando a tabela.
 *
 * ORDER BY DENTRO DA FUNCAO: a ordenacao faz parte da resposta, e nao um
 * detalhe do chamador. Um `.order()` do supabase-js sobre o retorno de uma RPC
 * nao vira ORDER BY nenhum — sem isto aqui, a lista chegaria na ordem que o
 * Postgres quisesse e a tela mais nova/mais velha mudaria sozinha.
 */
CREATE FUNCTION canastra.minhas_avaliacoes()
  RETURNS TABLE (
    id        uuid,
    sku       text,
    nota      integer,
    titulo    text,
    texto     text,
    status    text,
    criado_em timestamptz
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = canastra, pg_temp
  SET row_security = off
AS $$
  SELECT a.id, a.sku, a.nota, a.titulo, a.texto, a.status, a.criado_em
    FROM canastra.avaliacoes a
   WHERE canastra.eh_cliente()
     AND a.user_id = auth.uid()
   ORDER BY a.criado_em DESC
$$;

-- `proacl` nasce nulo (EXECUTE para PUBLIC), o que numa funcao SECURITY DEFINER
-- e higiene mal feita mesmo quando inofensivo: REVOKE primeiro, lista explicita
-- depois — 0006, 0008 e 0014 fazem igual.
--
-- SO `authenticated`, e a lista curta e a mesma de `garantir_cliente` (0008),
-- nao a de `pode_avaliar` (0014). O criterio e o que a funcao responde: esta
-- so fala sobre `auth.uid()`, entao para `anon` ela devolveria sempre zero
-- linhas (fingir resposta) e para `service_role` nao ha uid nenhum na sessao.
-- Nenhuma politica deste schema a chama, entao nao ha o caso de 0006:136 — o
-- 42501 que `anon` recebe e a frase correta: "entre na sua conta".
REVOKE EXECUTE ON FUNCTION canastra.minhas_avaliacoes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canastra.minhas_avaliacoes() TO authenticated;
