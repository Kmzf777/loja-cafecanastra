-- O motivo de o bot ter se desligado sozinho -- e a correcao de uma promessa
-- que 0017 fez e nunca cumpriu.
--
-- SAO DUAS COISAS NO MESMO ARQUIVO porque so uma delas e DDL. A segunda mora em
-- codigo (services/notificacoes.js) e esta registrada AQUI porque e aqui que a
-- proxima pessoa vai procurar: migracao e forward-only nesta casa, 0017 nao se
-- edita, e um cabecalho que mente continua mentindo ate alguem escrever a
-- correcao em algum lugar que se leia.
--
/* ------------------------------------------------------------------------- *
 * 1. A promessa de 0017 sobre o consentimento passa a ser verdade
 * ------------------------------------------------------------------------- */
--
-- O cabecalho de 0017 afirma, com estas palavras, que "sem carimbo o bot nao
-- manda, que e a falha para o lado seguro". NAO ERA VERDADE. A consulta do
-- destinatario em `services/notificacoes.js` lia `nome`, `telefone`,
-- `whatsapp_wa_id` e `whatsapp_optout_em` -- e o carimbo `whatsapp_optin_em`
-- nunca. O envio barrava por opt-out e por destino ausente, e mais nada.
--
-- POR QUE ISSO IMPORTA HOJE, e nao so no papel: 0018 devolveu a `authenticated`
-- um `GRANT UPDATE` de LISTA sobre `clientes`, e `telefone` esta nessa lista
-- (tem de estar: e a tela de perfil). `whatsapp_optin_em` NAO esta -- carimbo de
-- consentimento que o titular escreve nao prova consentimento nenhum. O
-- resultado e um numero que entra por PATCH do PostgREST SEM prova nenhuma de
-- consentimento, para o qual o bot escrevia. O onus de provar que o
-- consentimento existiu e do controlador (LGPD, Art. 8 par. 2).
--
-- A CORRECAO E DE CODIGO, E NAO DE ESQUEMA: a consulta passou a projetar
-- `whatsapp_optin_em` e a recusar o envio sem ele, ANTES de resolver o destino
-- (o `whatsapp_wa_id` e um segundo caminho ate o mesmo aparelho, e uma guarda
-- presa ao ramo do telefone deixaria passar justamente quem ja respondeu ao
-- bot). `test/whatsapp_notificacoes.test.js` afirma os dois caminhos.
--
-- O QUE ESTA MIGRACAO **NAO** FAZ, de proposito: nao tira `telefone` da lista de
-- 0018. Seria a segunda tranca, e ela e defensavel -- fecharia o buraco na
-- origem, e nao so na saida --, mas quebraria a tela de perfil que ainda nao
-- existe, e essa e decisao do dono da loja. Fica registrado como opcao.

/* ------------------------------------------------------------------------- *
 * 2. Por que a integracao parou
 * ------------------------------------------------------------------------- */

-- SEPARADA de `whatsapp_mensagens.erro_texto` de proposito: aquela coluna diz
-- por que UMA mensagem falhou; esta diz por que a INTEGRACAO parou. Sem ela, o
-- gestor abre o painel, ve "desligado", e nao tem como saber se foi ele quem
-- desligou ou se a credencial morreu -- que sao duas conversas bem diferentes.
--
-- AS DUAS COLUNAS ANDAM JUNTAS, e nenhuma serve sozinha. `ultimo_erro` sem
-- `desligado_em` nao distingue "morreu agora" de "morreu em marco, alguem
-- religou e ninguem limpou"; `desligado_em` sem `ultimo_erro` e um carimbo sem
-- diagnostico. Quem religa pelo painel apaga as duas no mesmo gesto
-- (`WhatsappController.gravarConfig`) -- um motivo que sobrevive ao religamento
-- nao e um diagnostico velho, e um diagnostico ERRADO.
--
-- AS DUAS NASCEM NULAS, inclusive nas instalacoes que ja tem a linha 1: NULL
-- aqui significa "ninguem desistiu", que e a verdade sobre toda instalacao
-- existente. Um DEFAULT nao-nulo faria a tela anunciar um desligamento que
-- nunca houve.
--
-- TEXTO LIVRE, e nao codigo: quem le e uma pessoa, e a frase que a Meta devolve
-- e mais util que o numero sozinho. NUNCA RECEBE TOKEN NEM TELEFONE: quem
-- escreve e services/notificacoes.js, a partir do `message` de ErroDaMeta -- que
-- ja nasce sem credencial (services/whatsappClient.js:redigir) -- e passando
-- pela MESMA `semDadoPessoal()` que higieniza `erro_texto`, que troca qualquer
-- corrida de oito digitos ou mais por "[numero]" e corta em 500 caracteres. O
-- codigo de erro (seis digitos) sobrevive de proposito: e o que se procura na
-- documentacao da Meta.
--
-- NAO HA GRANT NEM POLITICA NOVOS: `whatsapp_config` nao tem GRANT nenhum para
-- `anon` nem `authenticated` (0017) e ja esta com RLS ligada sem politica. Uma
-- coluna nova numa tabela que o navegador nao alcanca nao muda o alcance dela.
ALTER TABLE canastra.whatsapp_config
  ADD COLUMN ultimo_erro  text,
  ADD COLUMN desligado_em timestamptz;
