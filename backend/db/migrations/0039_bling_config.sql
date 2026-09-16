-- Conexao com o Bling pelo painel: as credenciais do app e o liga/desliga saem
-- da variavel de ambiente e vao para o banco, ao lado do refresh token que ja
-- mora aqui desde a 0012.
--
-- POR QUE NAO HA `REVOKE` NESTA MIGRACAO. A 0012 revogou o SELECT de TABELA em
-- `config_loja` e devolveu uma LISTA EXPLICITA de colunas a anon/authenticated.
-- Privilegio de coluna no Postgres nao se estende a coluna nova: estas tres ja
-- nascem invisiveis ao PostgREST sem uma linha a mais. Repetir o REVOKE aqui
-- daria a impressao de que a protecao vem deste arquivo — ela vem da 0012, e
-- quem mexer la precisa saber que estas colunas dependem disso.
--
-- `bling_ativo` E NULLABLE, E O NULL QUER DIZER "NAO DECIDIDO — USE A ENV".
-- Com `NOT NULL DEFAULT false` o banco passaria a mandar em TODA instalacao no
-- instante da migracao, e um `BLING_ATIVO=true` no .env de alguem viraria letra
-- morta em silencio. Com NULL, quem nunca abrir a tela continua exatamente como
-- estava — e os 22 casos de f7_bling.test.js seguem passando sem alteracao.
-- E a mesma logica de precedencia que `carregarRefreshToken` ja usa: banco
-- quando ha resposta, env quando nao ha.
--
-- `bling_client_secret` e segredo de verdade (emite nota fiscal e mexe em
-- estoque). `bling_client_id` nao e segredo no sentido estrito, mas fica no
-- mesmo regime: nao ha caso de uso para a vitrine le-lo, e expor metade de um
-- par de credenciais so ajuda quem esta tentando adivinhar a outra metade.
ALTER TABLE canastra.config_loja
  ADD COLUMN bling_client_id     text,
  ADD COLUMN bling_client_secret text,
  ADD COLUMN bling_ativo         boolean;
