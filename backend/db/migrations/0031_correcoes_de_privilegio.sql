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
