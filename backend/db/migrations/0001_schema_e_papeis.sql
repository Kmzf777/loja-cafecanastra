-- Schema proprio da loja.
--
-- POR QUE NAO `public`
-- Esta instancia Supabase e compartilhada com outros projetos. Em `public` a
-- loja disputaria nome de tabela com eles e qualquer GRANT amplo vazaria de um
-- lado para o outro. Com schema proprio, a permissao e concedida uma vez, aqui,
-- e nada fora dele e alcancavel por engano.

CREATE SCHEMA IF NOT EXISTS canastra;

-- Sem estes GRANTs o PostgREST responde 404 em toda rota da loja, mesmo com a
-- politica de RLS correta: o papel nao enxerga o schema para comecar.
GRANT USAGE ON SCHEMA canastra TO anon, authenticated, service_role;

-- Padrao para tabelas criadas nas migracoes seguintes. Note que isto concede
-- acesso de TABELA; quem decide o acesso de LINHA e a RLS de 0006. As duas
-- camadas sao necessarias: sem GRANT nao ha leitura nenhuma, sem RLS ha leitura
-- demais.
--
-- `anon` NAO ESTA AQUI, E E DE PROPOSITO
-- Um `GRANT SELECT ON TABLES TO anon` por padrao faz toda tabela das migracoes
-- seguintes nascer legivel por visitante anonimo — inclusive `clientes`,
-- `pedidos` e `enderecos`. Cada uma dessas precisaria de um REVOKE depois, e uma
-- escada de grant-e-revoga falha ABERTA: basta esquecer um REVOKE e o vazamento
-- e silencioso, sem erro em lugar nenhum. Invertido, o esquecimento vira 404 no
-- PostgREST — barulhento, achado no primeiro teste da vitrine, e nao em
-- producao. Entao quem for genuinamente publico (catalogo, por exemplo) leva
-- `GRANT SELECT ... TO anon` explicito na sua propria migracao.
--
-- ARMADILHA CONHECIDA, LEIA ANTES DE CRIAR TABELA FORA DAQUI
-- ALTER DEFAULT PRIVILEGES so alcanca objetos criados pelo MESMO papel que
-- rodou este comando (o default e `FOR ROLE current_user`). Aqui isso da certo
-- porque quem roda as migracoes e quem cria as tabelas e sempre o dono do
-- DATABASE_URL, o mesmo papel nas duas pontas. Uma tabela criada por outro
-- caminho — psql com outro usuario, Supabase Studio, script de manutencao —
-- nasce SEM nenhum destes GRANTs, e o sintoma e 404 no PostgREST com a RLS toda
-- certa. Nesse caso o conserto e um GRANT explicito na propria tabela, nao
-- mexer aqui.
ALTER DEFAULT PRIVILEGES IN SCHEMA canastra
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA canastra
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA canastra
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
