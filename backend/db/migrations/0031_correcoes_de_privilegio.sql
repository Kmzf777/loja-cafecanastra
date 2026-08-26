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
