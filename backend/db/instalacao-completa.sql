-- ============================================================================
-- Loja do Café Canastra — instalação completa do banco
--
-- ARQUIVO GERADO. Não edite à mão.
--   Fonte:  backend/db/migrations/*.sql  +  backend/db/seed.js
--   Gerador: node backend/db/gerar-instalacao.js
--
-- Uma edição feita aqui é perdida na próxima geração, e — pior — cria um banco
-- diferente do que `npm run db:migrar` produz. O teste
-- backend/test/instalacao.test.js compara os dois e reprova a divergência.
--
-- PARA QUE SERVE
-- Levantar a loja inteira num Supabase novo ou de teste, colando um arquivo só
-- no editor SQL. Inclui: schema, tabelas, RLS, RPC, catálogo com 29 SKUs e duas
-- contas de teste já confirmadas.
--
-- QUANDO NÃO USAR
-- Numa instalação que já rodou. Este arquivo pressupõe que `canastra` não
-- existe e aborta se existir. Para aplicar só o que falta, use
-- `npm run db:migrar`, que roda cada migração uma vez e registra a versão.
--
-- COMO RODAR DE NOVO DO ZERO
-- `backend/db/reset.sql` primeiro, depois este arquivo.
--
-- !! CONTAS DE TESTE COM SENHA PUBLICADA NESTE REPOSITORIO:
--   administrador  admin@canastra.teste  /  canastra-teste-admin
--   cliente comum   cliente@canastra.teste  /  canastra-teste-cliente
--
-- Não aplique este arquivo em produção. Lá a conta inicial nasce pelo GoTrue,
-- via `npm run db:seed`, com senha gerada.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. Guarda: este arquivo é para instalação limpa
-- ----------------------------------------------------------------------------

DO $guarda$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'canastra') THEN
    RAISE EXCEPTION
      'O schema "canastra" já existe neste banco.'
      USING HINT =
        'Para reinstalar do zero: rode backend/db/reset.sql e cole este arquivo de novo. '
        'Para aplicar apenas migrações novas: use npm run db:migrar.';
  END IF;
END $guarda$;

-- pgcrypto: `crypt()` e `gen_salt()` criam o hash das senhas de teste mais
-- abaixo. Em Supabase gerenciado ja vem instalada; num self-hosted enxuto, nao.
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ----------------------------------------------------------------------------
-- 1. Estrutura: as 16 migrações, na ordem do runner
-- ----------------------------------------------------------------------------

-- Identico ao BOOTSTRAP de db/migrar.js — inclusive os REVOKE em
-- canastra.migracoes, que mantem o livro-caixa das migracoes fora do PostgREST.
CREATE SCHEMA IF NOT EXISTS canastra;
  CREATE TABLE IF NOT EXISTS canastra.migracoes (
    versao      text PRIMARY KEY,
    aplicada_em timestamptz NOT NULL DEFAULT now()
  );
  DO $bootstrap$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON canastra.migracoes FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL ON canastra.migracoes FROM authenticated;
    END IF;
  END $bootstrap$;

-- ----------------------------------------------------------------------------
-- 1.0001_schema_e_papeis
-- ----------------------------------------------------------------------------

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

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0001_schema_e_papeis')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0002_clientes_e_admins
-- ----------------------------------------------------------------------------

-- Vinculo entre a loja e o GoTrue.
--
-- POR QUE ESTA TABELA EXISTE, E POR QUE ELA E A PECA DE SEGURANCA
-- A instancia Supabase e compartilhada com outros projetos. `auth.users` e
-- unico por instancia, e o JWT_SECRET tambem: um token emitido para OUTRO
-- projeto chega no PostgREST da loja com assinatura valida e `auth.uid()`
-- preenchido.
--
-- Por isso nenhuma politica de RLS pode usar `auth.uid() IS NOT NULL`. Ser
-- cliente da loja e ter LINHA AQUI — e esta linha so e criada no cadastro feito
-- pela loja. Um usuario de outro projeto autentica, mas nao e cliente, e nao
-- enxerga nada.

CREATE TABLE canastra.clientes (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  nome       text NOT NULL,
  -- UNIQUE aqui NAO obriga ninguem a ter CPF: no Postgres cada NULL e distinto
  -- dos outros (o indice nasce com NULLS DISTINCT, que e o padrao), entao
  -- quantos clientes se quiser podem ficar sem CPF e mesmo assim dois clientes
  -- nunca compartilham o mesmo numero. E o que a loja precisa — CPF so entra no
  -- checkout com nota, e exigi-lo no cadastro barraria a criacao da conta.
  cpf        text UNIQUE,
  telefone   text,
  criado_em  timestamptz NOT NULL DEFAULT now()
);

-- Papel de administrador NUNCA vem de claim no JWT: outro projeto da instancia
-- poderia emitir um token com o claim que quisesse. Vem de linha nesta tabela,
-- que so `service_role` escreve.
--
-- A referencia e para `canastra.clientes`, e nao direto para `auth.users`, de
-- proposito: admin da loja e, antes disso, cliente da loja. Sem esse salto um
-- usuario de outro projeto da instancia poderia ser promovido a admin daqui sem
-- nunca ter passado pelo cadastro.
CREATE TABLE canastra.admins (
  user_id   uuid PRIMARY KEY REFERENCES canastra.clientes (user_id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now()
);

/**
 * A loja nao pode ficar sem quem a administre.
 *
 * Isto era regra de aplicacao e dependia de o painel lembrar de checar. Como
 * trigger, vale para qualquer DELETE, por qualquer caminho — painel, psql,
 * PostgREST ou script. TRUNCATE e a excecao, ver LIMITE CONHECIDO abaixo.
 *
 * AFTER DELETE ... FOR EACH STATEMENT, e nao FOR EACH ROW: um `DELETE FROM
 * canastra.admins` sem WHERE apaga tudo, e a checagem por linha veria sempre
 * "ainda ha outras" ate a ultima, tarde demais numa trigger BEFORE. Depois do
 * comando inteiro, a conta e exata.
 *
 * O `REFERENCING OLD TABLE` NAO E ENFEITE. Trigger de statement dispara mesmo
 * quando o DELETE nao casa linha nenhuma — medido: com a tabela vazia, um
 * `DELETE FROM canastra.admins` recusava com "sem administrador", e o mesmo
 * acontecia na cascata vinda de `clientes` quando o cliente apagado nao era
 * admin (a cascata roda um DELETE de zero linhas aqui). Ou seja, sem a tabela de
 * transicao a trava quebrava dois cenarios corriqueiros que nao tiram admin
 * nenhum da loja, inclusive a criacao do primeiro admin numa instalacao nova.
 * Com ela a regra fica exatamente a pretendida: um DELETE que REALMENTE apagou
 * alguma coisa nao pode deixar a tabela em zero.
 *
 * ERRCODE explicito, e nao o P0001 padrao do RAISE: P0001 e o mesmo codigo de
 * qualquer outro RAISE do banco, entao quem chama teria de casar TEXTO de
 * mensagem para reconhecer esta recusa — a fragilidade que test/ajuda/sessao.js
 * ja documentou. `restrict_violation` (23001) e o codigo que o proprio Postgres
 * usa quando uma restricao barra uma remocao, e nenhuma chave estrangeira deste
 * schema usa ON DELETE RESTRICT, entao o codigo nao colide com nada.
 *
 * LIMITE CONHECIDO: TRUNCATE nao dispara trigger de DELETE, entao
 * `TRUNCATE canastra.admins` zera a tabela sem passar por aqui — conferido. Quem
 * pode fazer isso e o dono do banco e o `service_role` (que recebe ALL em 0001,
 * e ALL inclui TRUNCATE). Os dois ja sao credenciais totalmente confiaveis do
 * lado servidor; a trava existe contra engano operacional, nao contra elas.
 *
 * SECURITY DEFINER PORQUE A CONTAGEM NAO PODE PASSAR PELA RLS. Como SECURITY
 * INVOKER, o `SELECT ... FROM canastra.admins` daqui rodaria sob as politicas do
 * papel que disparou o DELETE, e a trava passava a recusar remocao legitima.
 * Medido, com RLS ligada em `admins`, uma politica de DELETE
 * `USING (user_id = auth.uid())` e nenhuma politica ampla de SELECT: Ana, admin,
 * roda `DELETE FROM canastra.admins` SEM WHERE; o Postgres apaga so a linha dela
 * e Bruno continua admin, mas a funcao nao enxerga Bruno e recusa com 23001. A
 * forma sem WHERE e o que torna o caso alcancavel — com WHERE, as politicas de
 * SELECT tambem se aplicam, a linha nem e casada e `apagados` fica vazia.
 *
 * Nao adianta contar com a politica futura ser generosa: quem escreve a RLS nao
 * tem como saber que uma trigger depende dela, e um comentario nao impede nada.
 * Contar admin e decisao do banco, nao do papel que apaga.
 *
 * `SET search_path` NAO E OPCIONAL numa funcao SECURITY DEFINER: sem ele, quem
 * chama escolhe em que schema `admins` sera procurada e executa o que quiser com
 * os privilegios do dono da funcao — que aqui e o dono do banco. Com o caminho
 * fixo, so `canastra` e o `pg_temp` obrigatorio (que vai por ultimo de proposito:
 * na frente, uma tabela temporaria do proprio chamador sequestraria o nome).
 *
 * O REVOKE e higiene. `proacl` nasce nulo, o que significa EXECUTE para PUBLIC.
 * Chamar a funcao fora de uma trigger ja falha sozinho, entao nao ha exploracao
 * hoje; nao ha tambem razao para deixar EXECUTE aberto numa funcao SECURITY
 * DEFINER do dono do banco.
 */
CREATE FUNCTION canastra.exigir_um_admin() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = canastra, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM apagados)
     AND NOT EXISTS (SELECT 1 FROM canastra.admins) THEN
    RAISE EXCEPTION 'A loja não pode ficar sem administrador.'
      USING ERRCODE = 'restrict_violation',
            HINT = 'Cadastre outro administrador antes de remover este.';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION canastra.exigir_um_admin() FROM PUBLIC;

CREATE TRIGGER admins_nunca_zero
  AFTER DELETE ON canastra.admins
  REFERENCING OLD TABLE AS apagados
  FOR EACH STATEMENT
  EXECUTE FUNCTION canastra.exigir_um_admin();

-- Chave geral fechada, ainda sem politica nenhuma.
--
-- Sem esta linha as duas tabelas ficam legiveis por qualquer papel entre o
-- COMMIT desta migracao e o da migracao que liga a RLS de verdade — e como cada
-- migracao commita na propria transacao, a janela existe mesmo dentro de uma
-- unica execucao do runner. Pior: se a migracao da RLS falhar, o deploy PARA
-- exatamente ai, com `nome`, `cpf` e `telefone` servidos pelo PostgREST a quem
-- pedir. Medido: como `anon`, `SELECT count(*) FROM canastra.clientes` devolvia
-- linhas.
--
-- ENABLE sem policy nao e politica de acesso, e o contrario disso: sem policy
-- nenhuma linha passa, para ninguem alem do dono da tabela e de quem tem
-- BYPASSRLS (o `service_role`). Ou seja, a sequencia de migracoes passa a falhar
-- FECHADA. A migracao que escreve as politicas repete o ENABLE, que e
-- idempotente.
ALTER TABLE canastra.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.admins   ENABLE ROW LEVEL SECURITY;

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0002_clientes_e_admins')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0003_catalogo
-- ----------------------------------------------------------------------------

-- Catalogo.
--
-- Colunas renomeadas do ingles para o portugues junto com a migracao: o codigo
-- que lia os nomes antigos esta sendo substituido nesta mesma obra, entao o
-- custo de renomear e zero e o ganho e um schema legivel por quem administra a
-- loja.
--
-- `uuid-ossp` NAO e criada: o schema antigo declarava a extensao, mas nenhuma
-- coluna usava `uuid_generate_v4()` — os UUIDs vem do pacote `uuid` em JS. Onde
-- um default e util aqui, `gen_random_uuid()` do proprio Postgres resolve sem
-- extensao nenhuma.

CREATE TABLE canastra.produtos (
  produto_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome         text NOT NULL,
  -- Na loja de camisetas de origem isto era P/M/G. Aqui carrega o formato do
  -- cafe ("250 g", "Caixa 3x250 g"), que e o eixo de variacao real.
  tamanho      text,
  categoria    text,
  preco        numeric(10,2) NOT NULL DEFAULT 0,
  -- Interno: nunca sai na view publica.
  custo        numeric(10,2) NOT NULL DEFAULT 0,
  imagem       text,
  quantidade   integer NOT NULL DEFAULT 0,
  descricao    text,
  peso         numeric(10,3) NOT NULL DEFAULT 0.3,
  largura      numeric(10,2) NOT NULL DEFAULT 20,
  altura       numeric(10,2) NOT NULL DEFAULT 5,
  comprimento  numeric(10,2) NOT NULL DEFAULT 20,
  -- Ordenacao "novidades"/"antigos" do painel. Coluna propria porque o admin
  -- pode querer destacar um produto sem mexer na data de criacao.
  destacado_em timestamptz NOT NULL DEFAULT now(),
  criado_em    timestamptz NOT NULL DEFAULT now(),
  sku          text
);

-- Chave de negocio que costura a vitrine ao banco: a metade EDITORIAL do
-- catalogo vive em data/catalogo-canastra.json (versionada, revisada em PR) e a
-- metade COMERCIAL vive aqui. Sem uma chave comum, casar os dois so daria por
-- nome — que muda com qualquer correcao de texto e quebra a ligacao em silencio.
-- Nulavel: produto cadastrado a mao no painel nao tem SKU do catalogo.
CREATE UNIQUE INDEX produtos_sku_idx ON canastra.produtos (sku)
  WHERE sku IS NOT NULL;

-- Busca do painel. Coluna gerada: nao ha trigger para manter em dia.
--
-- A configuracao vai EXPLICITA ('portuguese') e nao pode virar a forma de um
-- argumento so: `to_tsvector(text)` usa o GUC `default_text_search_config`, e
-- por depender dele e apenas STABLE — o Postgres recusa a coluna gerada com
-- 42P17. A forma de dois argumentos e IMMUTABLE e por isso serve. O efeito
-- colateral bom e que a indexacao para de depender da configuracao do servidor.
ALTER TABLE canastra.produtos
  ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'portuguese',
      coalesce(nome, '') || ' ' || coalesce(categoria, '') || ' ' ||
      coalesce(tamanho, '') || ' ' || coalesce(descricao, '')
    )
  ) STORED;

CREATE INDEX produtos_tsv_idx ON canastra.produtos USING gin (tsv);
CREATE INDEX produtos_categoria_idx ON canastra.produtos (categoria);
CREATE INDEX produtos_destaque_idx ON canastra.produtos (destacado_em DESC);

-- Valores de filtro do painel: linhas ('tamanho') e categorias ('categoria').
CREATE TABLE canastra.produto_opcoes (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo  text NOT NULL,
  valor text NOT NULL,
  UNIQUE (tipo, valor)
);

/**
 * O recorte que a `anon key` enxerga.
 *
 * LEIA ISTO ANTES DO RESTO DO BLOCO: A MIGRACAO 0006 INVERTEU O
 * `security_invoker` DESTA VIEW PARA TRUE. O texto abaixo descreve o arranjo
 * ORIGINAL e continua aqui porque explica de onde a loja veio e o que foi
 * medido — mas ele NAO descreve o banco de hoje, e a decisao de hoje esta em
 * 0006, que e onde um leitor futuro deve procurar. Em resumo do que mudou: a
 * vitrine deixou de depender da isencao de RLS do dono da view e passou a ler
 * `canastra.produtos` com os privilegios de quem chama, via GRANT de COLUNA
 * mais a politica `produtos_leitura_publica`. O que se ganhou foi o fim do modo
 * de falha silencioso do FORCE RLS descrito adiante.
 *
 * A DDL desta view NAO foi reescrita de proposito: migracao aplicada nao roda de
 * novo, entao editar o `WITH (...)` daqui so valeria para instalacao nova e as
 * duas populacoes divergiriam em silencio. A troca e feita por ALTER em 0006.
 *
 * A vitrine le o catalogo com a chave anonima, que e publica por definicao —
 * ela viaja no bundle. Dar SELECT na tabela inteira publicaria `custo` junto
 * com o preco. A view define exatamente o que e publico — e, desde 0006, o
 * GRANT de coluna na tabela base repete essa mesma lista.
 *
 * security_invoker = FALSE, de proposito e ao contrario do reflexo habitual.
 * A view roda com os poderes de quem a criou, ignorando a RLS da tabela base —
 * e aqui isso e a intencao, nao um descuido: o catalogo E publico, e a view e o
 * proprio controle de acesso, definindo por projecao o que sai. Com
 * security_invoker = true, `anon` precisaria de privilegio na tabela base, que
 * ele nao tem, e toda a vitrine responderia "permission denied".
 *
 * DE QUE ISENCAO SE TRATA, exatamente, ja que este e o arranjo que sustenta a
 * loja inteira: a view roda como seu DONO, que aqui e tambem o dono de
 * `canastra.produtos` (as duas coisas sao criadas por esta migracao, pelo mesmo
 * papel), e dono de tabela e isento de RLS enquanto ninguem ligar FORCE ROW
 * LEVEL SECURITY nela. E por isso que o ENABLE ROW LEVEL SECURITY do fim deste
 * arquivo NAO cega a vitrine.
 *
 * Medido com um dono NAO-superusuario — assim a isencao medida e mesmo a do
 * DONO, e nao um efeito colateral do superusuario que o harness usa:
 *   RLS ligada, sem policy .......... anon le o catalogo normalmente
 *   + FORCE ROW LEVEL SECURITY ...... anon le ZERO linhas, sem erro nenhum
 *   + security_invoker = true ....... 42501, permission denied for table produtos
 *
 * As tres coisas que quebravam isto, no arranjo original: ligar FORCE RLS em
 * `produtos`, virar o `security_invoker` para true, e a view passar a pertencer
 * a outro papel (ALTER VIEW ... OWNER TO, ou recriar a view por outro usuario).
 * Repare no modo de falha do FORCE: vitrine VAZIA, sem erro, sem log — o pior
 * dos tres, e a razao pela qual 0006 desfez este arranjo. Depois de 0006 a lista
 * e outra: quem quebra a vitrine e virar o `security_invoker` de volta para
 * false, ou mexer no GRANT de coluna da tabela base. Por isso
 * test/catalogo.test.js confere `relforcerowsecurity` e o `security_invoker` no
 * catalogo do Postgres, e nao so o comportamento: no harness o dono e
 * superusuario, e superusuario ignora ate o FORCE, entao um teste apenas
 * comportamental passaria verde com a producao quebrada. (O valor esperado do
 * `security_invoker` naquele teste e `true` desde 0006.)
 *
 * NAO ESTA APURADO se o dono em PRODUCAO e superusuario, e a frase acima nao
 * afirma que e. Na imagem oficial do Supabase self-hosted o papel `postgres` E
 * superusuario; se for esse o papel do DATABASE_URL neste VPS, o harness ja
 * espelha a producao e o risco do FORCE e teorico la. Mas isso depende do papel
 * configurado na instancia, que nao foi inspecionado daqui. As asercoes de
 * catalogo cobrem os dois mundos sem custo nenhum, entao a duvida nao precisa
 * ser resolvida para o schema estar correto — precisa e nao ser esquecida.
 *
 * O preco disso: quem alterar esta view esta alterando uma fronteira de
 * seguranca. Nenhuma coluna nova entra aqui sem ser publica de verdade.
 */
CREATE VIEW canastra.produtos_publicos
  WITH (security_invoker = false)
AS
  SELECT produto_id, nome, tamanho, categoria, preco, imagem, quantidade,
         descricao, peso, largura, altura, comprimento, destacado_em, sku
  FROM canastra.produtos;

GRANT SELECT ON canastra.produtos_publicos TO anon, authenticated;

/**
 * A view e uma janela de LEITURA. Fechar a escrita nao e higiene, e conserto.
 *
 * Os ALTER DEFAULT PRIVILEGES de 0001 valem tambem para VIEWS — "TABLES" ali
 * abrange tabela, view e foreign table —, entao `produtos_publicos` nasce com
 * INSERT/UPDATE/DELETE concedidos a `authenticated`. E ela e AUTO-ATUALIZAVEL:
 * projecao simples de uma unica tabela, sem DISTINCT, GROUP BY, agregado ou
 * juncao, e o Postgres aceita escrita atraves dela.
 *
 * Junte isso ao `security_invoker = false` acima e o resultado, medido antes
 * deste REVOKE existir: qualquer sessao `authenticated` — inclusive um token de
 * OUTRO projeto da instancia compartilhada, que nem cliente da loja e — inseria,
 * mudava preco e apagava produtos, com os poderes do dono e passando por cima da
 * RLS de `produtos`. A mesma propriedade que faz a leitura publica funcionar
 * entregava a escrita de brinde.
 *
 * O REVOKE e o unico ponto onde isso se fecha: a RLS da tabela base nao alcanca
 * (e justamente ela que a view ignora) e nao ha politica possivel sobre uma
 * view. `service_role` fica de fora do REVOKE de proposito — e credencial de
 * servidor, ja tem BYPASSRLS, e o painel escreve por ela.
 */
REVOKE INSERT, UPDATE, DELETE ON canastra.produtos_publicos FROM authenticated;

-- `produto_opcoes` alimenta os filtros da vitrine, entao e genuinamente publica
-- e leva o GRANT explicito que a Regra de 0001 exige (nada nasce legivel por
-- `anon`). So SELECT: escrever nos filtros e coisa do painel.
GRANT SELECT ON canastra.produto_opcoes TO anon;

/**
 * O MESMO FURO, pela porta da frente: `authenticated` escreve nas TABELAS.
 *
 * O REVOKE acima fecha a view. Mas os ALTER DEFAULT PRIVILEGES de 0001 dao
 * INSERT/UPDATE/DELETE a `authenticated` em toda tabela criada nas migracoes, e
 * `produtos` e `produto_opcoes` estao nesse pacote. Hoje isso e inerte so porque
 * a RLS esta ligada e nao ha politica nenhuma — ou seja, a protecao inteira do
 * catalogo depende de NINGUEM escrever uma politica ampla demais.
 *
 * Nao e um risco imaginario, e o erro NATURAL de quem escrever a migracao de
 * politicas. "Os filtros do catalogo sao publicos" escrito do jeito obvio:
 *
 *   CREATE POLICY tudo ON canastra.produto_opcoes FOR ALL USING (true) WITH CHECK (true);
 *
 * e a partir dai um token de OUTRO projeto da instancia compartilhada APAGA os
 * filtros do catalogo. Escrito FOR SELECT, o mesmo intruso leva 42501. Uma
 * palavra separa o certo do vazamento, e a palavra esta noutro arquivo, escrito
 * por outra pessoa, noutro dia.
 *
 * Com o REVOKE, a politica ampla deixa de ser suficiente para causar dano: falta
 * o privilegio de tabela, que e a camada de baixo. Volta a valer o principio de
 * 0001 — as duas camadas negam.
 *
 * ISTO NAO CONTRADIZ A RECUSA DA ESCADA GRANT-E-REVOGA DE 0001, e a diferenca
 * importa. La o problema era uma regra ILIMITADA: `anon` recebendo SELECT em toda
 * tabela FUTURA, com um REVOKE devido por tabela para sempre — esquecer um vira
 * vazamento silencioso, e a lista nunca fecha. Aqui o conjunto e FECHADO e
 * ENUMERAVEL (relacoes em que cliente nenhum tem o que escrever) e esta afirmado
 * em test/catalogo.test.js e test/pedidos.test.js, entao um esquecimento futuro
 * fica vermelho no CI em vez de silencioso.
 *
 * O CONSERTO ESTRUTURALMENTE MELHOR seria outro: estreitar 0001 para
 * `GRANT SELECT ON TABLES TO authenticated` e conceder escrita tabela a tabela,
 * na migracao de cada uma. Isso mata a classe inteira em vez destes casos.
 * Deliberadamente NAO feito aqui porque mexeria numa migracao ja revisada e ja
 * aplicada — e migracao aplicada nao roda de novo, entao a alteracao valeria so
 * para instalacoes novas e as duas populacoes divergiriam em silencio, que e o
 * pior desfecho possivel para uma correcao de seguranca. Fica registrado como a
 * direcao certa para quando houver uma migracao propria para isso.
 *
 * ESTE REVOKE FOI DESFEITO EM 0006, de propria vontade e com o troco pago: o
 * painel do admin fala DIRETO com o Supabase por supabase-js, e administrador
 * autentica como `authenticated` igual a todo mundo — sem estes privilegios ele
 * nao cadastra produto nenhum. A segunda tranca so pode ser aberta porque a
 * primeira finalmente existe: 0006 poe no lugar dela politicas estreitas
 * (`canastra.eh_admin()`) e test/rls.test.js afirma, como invariante sobre
 * `pg_policies`, que nenhuma politica de escrita deste schema e `USING (true)` —
 * exatamente a distracao que este bloco previu. O REVOKE de `admins`, logo
 * abaixo, NAO foi desfeito e nao deve ser.
 */
REVOKE INSERT, UPDATE, DELETE ON canastra.produtos, canastra.produto_opcoes
  FROM authenticated;

/**
 * `admins` entra aqui, e nao numa migracao de catalogo por afinidade de assunto.
 *
 * Ela nasce em 0002 com o mesmo `arwd` para `authenticated` herdado de 0001, e e
 * a tabela onde o estrago e maior de longe: uma unica politica permissiva de
 * INSERT em `admins` e um token de outro projeto da instancia se PROMOVE a
 * administrador desta loja — exatamente o ataque que 0002 inteira existe para
 * impedir quando fez `admins` referenciar `clientes` em vez de `auth.users`.
 *
 * Por que neste arquivo, e nao dentro de 0002, ao lado da tabela: porque quem
 * escreve uma migracao nao pode saber onde ela ja rodou. Hoje nada desta fase
 * foi aplicado em lugar nenhum, entao emendar 0002 daria no mesmo — mas essa
 * informacao vale so hoje, e migracao e permanente. Assim que 0002 tocar
 * qualquer banco, o runner nunca mais a reexecuta, e um conserto feito la
 * fecharia o furo apenas em instalacao nova, deixando a que ja rodou aberta,
 * com as duas populacoes divergindo sem aviso. Corrigir privilegio numa
 * migracao NOVA e a forma que continua certa nos dois mundos, e 0003 e a mais
 * cedo que roda depois de `admins` existir — o criterio certo para janela de
 * exposicao. A arrumacao por assunto perde para isso.
 *
 * `clientes` NAO leva REVOKE aqui, e nem `enderecos`, `carrinhos`,
 * `carrinho_itens` (0004) ou `pedidos` (0005): nessas o cliente logado escreve
 * de verdade, e quem tem de fazer o recorte e a politica de RLS, que sabe
 * distinguir a linha do dono da linha do vizinho; o privilegio de tabela nao
 * sabe.
 *
 * DUAS DAS QUATRO JUSTIFICATIVAS ORIGINAIS DESTA FRASE ERAM FALSAS, e o registro
 * fica porque a correcao importa mais que a redacao limpa. Diziam-se quatro
 * escritas do cliente logado: "cria a propria conta", "salva endereco", "mexe na
 * sacola", "fecha pedido". A primeira e a ultima nunca foram dele — cadastro e
 * checkout rodam pelo `service_role`, no servico Node —, e 0006 tornou isso
 * explicito ao NAO criar politica de INSERT em `clientes` nem em `pedidos`. As
 * duas do meio continuam certas e sao as unicas que sustentam este paragrafo.
 *
 * Em consequencia, 0006 REVOGA `INSERT` e `DELETE` de `authenticated` nessas
 * duas tabelas: onde o cliente nao escreve, o privilegio nao serve para nada e
 * so espera uma politica distraida para virar furo. `enderecos`, `carrinhos` e
 * `carrinho_itens` seguem sem REVOKE, agora pelo motivo certo e apenas ele.
 */
REVOKE INSERT, UPDATE, DELETE ON canastra.admins FROM authenticated;

-- Chave geral fechada, ainda sem politica nenhuma — mesmo motivo de 0002: entre
-- o COMMIT desta migracao e o da que escreve as politicas ha uma janela real, e
-- um deploy que pare no meio tem de parar FECHADO.
--
-- Ligar a RLS em `produtos` NAO cegava a vitrine NESTE ARRANJO: ela lia pela
-- view, que rodava como dono e por isso nao passava pela RLS (ver o bloco da
-- view acima). Ja `produto_opcoes` e lida DIRETO por `anon` e, ate a migracao de
-- politicas chegar, responde vazio — os filtros da vitrine somem, e nada mais.
-- Perder filtro e visivel e inofensivo; o contrario, um `pedidos` aberto por
-- esquecimento, nao seria nem uma coisa nem outra.
--
-- DEPOIS DE 0006 as duas ficam no mesmo caso: a view virou `security_invoker =
-- true`, entao `produtos` tambem passa a ser lida sob a RLS, e quem deixa a
-- vitrine passar e a politica `produtos_leitura_publica`. A janela entre esta
-- migracao e a de politicas continua fechada do mesmo jeito — o que muda e que
-- agora ela apaga o catalogo tambem, e nao so os filtros. Continua sendo o lado
-- certo de falhar.
ALTER TABLE canastra.produtos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.produto_opcoes ENABLE ROW LEVEL SECURITY;

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0003_catalogo')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0004_enderecos_e_carrinho
-- ----------------------------------------------------------------------------

-- Enderecos e carrinho.
--
-- `atualizado_em` NAS DUAS PRIMEIRAS TABELAS E MANTIDA POR QUEM ESCREVE, e nao
-- por trigger: nao ha `moddatetime` neste schema (o unico gatilho nao-interno e
-- o `admins_nunca_zero` de 0002), entao a coluna fica igual a `criado_em` para
-- sempre a menos que cada UPDATE inclua `atualizado_em = now()`. Uma data de
-- alteracao que nao alterou engana mais do que ajuda. Nao foi criada trigger
-- aqui para nao introduzir funcao nova sem a tarefa dona da escrita pedir; em
-- troca a regra fica explicita, e quem mais precisa dela e a RPC de fusao da
-- sacola (0007), que toca `carrinhos` a cada login.

CREATE TABLE canastra.enderecos (
  endereco_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES canastra.clientes (user_id) ON DELETE CASCADE,
  cep          text,
  rua          text,
  numero       text,
  complemento  text,
  bairro       text,
  cidade       text,
  estado       text,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enderecos_cliente_idx ON canastra.enderecos (user_id);

-- Um carrinho por cliente. O UNIQUE e o que permite `ON CONFLICT (user_id)` na
-- RPC de fusao (migracao 0007) sem precisar ler antes de escrever.
CREATE TABLE canastra.carrinhos (
  carrinho_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL UNIQUE REFERENCES canastra.clientes (user_id) ON DELETE CASCADE,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Sem FK para produtos, de proposito: `nome`, `preco` e `imagem` sao copias do
-- momento em que o item entrou na sacola. Um produto retirado do catalogo nao
-- pode fazer o carrinho de ninguem desaparecer nem quebrar a listagem.
--
-- O preco guardado aqui e para EXIBIR. Quem cobra e o checkout, que rele preco e
-- estoque do banco antes de gerar o pagamento.
--
-- LIMITE CONHECIDO DO UNIQUE ABAIXO, aceito nesta fase e nao esquecido: no
-- Postgres cada NULL e distinto dos outros num indice unico (NULLS DISTINCT, o
-- padrao), entao a chave (carrinho_id, produto_id, NULL) nunca colide com ela
-- mesma. Dois "adicionar" no mesmo produto SEM moagem viram duas linhas na
-- sacola em vez de somar quantidade, e o ON CONFLICT da RPC de 0007 nao dispara
-- nesse caso. Passa porque a vitrine sempre manda moagem para cafe, o unico
-- produto com essa variacao. Se um dia entrar item sem moagem nenhuma (caneca,
-- assinatura), isto vira duplicata visivel na sacola; a correcao seria
-- `UNIQUE NULLS NOT DISTINCT` (PG 15+) ou um default 'padrao' na coluna — e as
-- DUAS mexem no alvo do ON CONFLICT de 0007, que depende exatamente desta lista
-- de colunas. Nao mude uma sem a outra. Medido em test/carrinho.test.js.
CREATE TABLE canastra.carrinho_itens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrinho_id uuid NOT NULL REFERENCES canastra.carrinhos (carrinho_id) ON DELETE CASCADE,
  produto_id  uuid NOT NULL,
  quantidade  integer NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  preco       numeric(10,2) NOT NULL DEFAULT 0,
  nome        text,
  imagem      text,
  tamanho     text,
  moagem      text,
  UNIQUE (carrinho_id, produto_id, moagem)
);
CREATE INDEX carrinho_itens_carrinho_idx ON canastra.carrinho_itens (carrinho_id);

-- Chave geral fechada, ainda sem politica nenhuma — mesmo motivo de 0002.
--
-- Nada aqui e publico, entao nao ha GRANT para `anon` nesta migracao: endereco e
-- sacola sao dados pessoais e a Regra de 0001 ja os deixa de fora por padrao. As
-- duas camadas negam, que e como tem de ser.
ALTER TABLE canastra.enderecos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.carrinhos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.carrinho_itens ENABLE ROW LEVEL SECURITY;

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0004_enderecos_e_carrinho')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0005_pedidos_promocoes_config
-- ----------------------------------------------------------------------------

-- Pedidos, promocoes e configuracao da loja.

-- ON DELETE SET NULL, e nao CASCADE — a UNICA excecao entre as chaves
-- estrangeiras que apontam para `clientes`. O que isto preserva e a VENDA:
-- apagada a linha do cliente, o pedido continua existindo com seu total, sua
-- data e seus itens, porque faturamento e contabilidade dependem dele. CASCADE
-- destruiria a venda; RESTRICT tornaria impossivel apagar o cliente.
--
-- ISTO NAO E, POR SI, UM CAMINHO DE APAGAMENTO DE DADOS PESSOAIS — e foi medido
-- que nao e. Depois de apagar o cliente, o pedido guarda:
--
--   endereco_json -> {"nome": "Ana Silva", "cpf": "...", "rua": "R. X 99", ...}
--   itens         -> o que a pessoa comprou
--
-- ou seja, nome, CPF e endereco sobrevivem intactos. Atender de verdade a um
-- pedido de exclusao (LGPD art. 18; ver docs/seguranca-dados-pessoais.md) exige
-- um passo A MAIS que este schema ainda nao tem: redigir `endereco_json` e
-- `itens`, preservando so o que a obrigacao fiscal manda guardar. Esse passo e
-- de uma tarefa posterior e esta anotado aqui para nao se perder — quem ler este
-- arquivo procurando "como a loja apaga os dados de alguem" precisa sair sabendo
-- que a resposta NAO e "apagando o cliente".
--
-- E por isso que `user_id` aqui e NULAVEL enquanto `enderecos.user_id` e NOT
-- NULL: o Postgres ACEITA declarar ON DELETE SET NULL numa coluna NOT NULL — o
-- DDL nao reclama —, e a incompatibilidade so aparece no DELETE do cliente, que
-- estoura com 23502 e deixa a exclusao impossivel. Ou seja, seria uma armadilha
-- que so dispara em producao, no dia do primeiro pedido de exclusao. As duas
-- colunas sao coerentes justamente por serem diferentes.
--
-- O TROCO, que a migracao de politicas precisa saber: com `user_id` NULL, uma
-- politica de dono do tipo `USING (user_id = auth.uid())` avalia NULL, que nao e
-- TRUE. O pedido orfao fica invisivel para todo cliente — desfecho certo,
-- ninguem herda a compra de outro —, mas o painel do admin NAO pode depender
-- dessa mesma politica para listar o historico.
CREATE TABLE canastra.pedidos (
  pedido_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,
  total              numeric(10,2) NOT NULL DEFAULT 0,
  -- TEXTO LIVRE, sem CHECK e sem enum, e isto e uma decisao ADIADA e nao tomada:
  -- 'pendnete' entra calado e some de todo filtro que procure 'pendente'. A
  -- tarefa que escrever as transicoes de status (0010) e quem tem a lista dos
  -- valores validos e deve decidir explicitamente entre um CHECK, um enum ou
  -- deixar livre de proposito. Nao herde este `text` por inercia.
  status             text NOT NULL DEFAULT 'pendente',
  metodo_pagamento   text,
  pagamento_id_mp    text,
  -- Enviada pelo navegador no checkout. Duas tentativas do mesmo clique tem a
  -- mesma chave, entao a segunda esbarra no indice em vez de criar outro pedido.
  chave_idempotencia text,
  itens              jsonb,
  endereco_json      jsonb,
  frete              numeric(10,2) NOT NULL DEFAULT 0,
  metodo_envio       text,
  codigo_rastreio    text,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  -- MANTIDA POR QUEM ESCREVE, nao por trigger. Nao existe trigger de
  -- `moddatetime` neste schema (o unico gatilho nao-interno e o
  -- `admins_nunca_zero` de 0002), entao esta coluna fica IGUAL a `criado_em` para
  -- sempre a menos que cada UPDATE inclua `atualizado_em = now()` — e um valor
  -- que parece uma data de alteracao e nao e engana mais do que ajuda.
  --
  -- Ficou assim de proposito, para nao introduzir uma funcao de trigger nova sem
  -- que a tarefa dona da escrita a tenha pedido. A regra, entao, e explicita:
  -- TODO UPDATE nesta tabela, no checkout, no webhook do MP e no painel, escreve
  -- `atualizado_em = now()` junto. Vale igual para `enderecos` e `carrinhos` em
  -- 0004 — a RPC de fusao da sacola (0007) e o caso mais obvio.
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pedidos_cliente_idx ON canastra.pedidos (user_id);
CREATE INDEX pedidos_criado_idx  ON canastra.pedidos (criado_em DESC);

/**
 * As duas defesas de idempotencia, no banco e nao no codigo.
 *
 * A auditoria registrou dois furos: o webhook do MP nao era idempotente, e o MP
 * reenvia notificacao por desenho — reentrega podia inflar estoque; e a cobranca
 * acontecia antes de o pedido existir, sem chave, entao uma queda no meio
 * deixava pagamento sem pedido.
 *
 * Indices PARCIAIS (WHERE ... IS NOT NULL) porque o pedido nasce sem id do MP e
 * pedido antigo pode nao ter chave. Um indice total recusaria o segundo pedido
 * pendente da loja inteira.
 */
CREATE UNIQUE INDEX pedidos_pagamento_mp_idx
  ON canastra.pedidos (pagamento_id_mp)
  WHERE pagamento_id_mp IS NOT NULL;

CREATE UNIQUE INDEX pedidos_idempotencia_idx
  ON canastra.pedidos (chave_idempotencia)
  WHERE chave_idempotencia IS NOT NULL;

CREATE TABLE canastra.promocoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo      text NOT NULL,
  descricao   text,
  tipo        text,
  valor       numeric(10,2),
  aplica_a    text,
  categoria   text,
  produto_id  uuid,
  inicio_em   timestamptz,
  fim_em      timestamptz,
  ativa       boolean NOT NULL DEFAULT true,
  criada_em   timestamptz NOT NULL DEFAULT now()
);

-- Tabela de uma linha so. O codigo antigo garantia isso por convencao
-- (`WHERE id = (SELECT id FROM store_config LIMIT 1)`); aqui o CHECK garante.
--
-- Sao DOIS guardas, por portas diferentes, e quem tratar o erro no painel
-- precisa esperar os dois SQLSTATEs: um INSERT com id explicito diferente de 1
-- bate no CHECK (23514, citando `config_loja_linha_unica`), e o caminho comum —
-- INSERT sem citar `id` — pega o DEFAULT 1, passa pelo CHECK e bate na chave
-- primaria (23505, citando `config_loja_pkey`). Medido em test/pedidos.test.js.
CREATE TABLE canastra.config_loja (
  id                integer PRIMARY KEY DEFAULT 1
                      CONSTRAINT config_loja_linha_unica CHECK (id = 1),
  banner_desktop    text,
  banner_mobile     text,
  titulo_site       text,
  whatsapp          text,
  barra_de_aviso    text,
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);

-- Regra de 0001: nada nasce legivel por `anon`, quem for publico leva GRANT
-- proprio. A vitrine mostra o banner e a barra de aviso (`config_loja`) e as
-- promocoes ativas antes de qualquer login, entao essas duas levam. `pedidos`
-- NAO entra aqui e nao pode entrar: guarda endereco de entrega e itens
-- comprados de cada cliente.
GRANT SELECT ON canastra.promocoes  TO anon;
GRANT SELECT ON canastra.config_loja TO anon;

-- E a escrita fecha, pelo mesmo motivo detalhado em 0003 (bloco do REVOKE): o
-- `arwd` que 0001 concede por padrao a `authenticated` esta inerte hoje so porque
-- a RLS ainda nao tem politica, e a primeira politica ampla demais na migracao
-- seguinte o acorda. Aqui o dano seria banner e barra de aviso da loja
-- reescritos, ou promocao criada, por um token de outro projeto da instancia
-- compartilhada.
--
-- DUAS COISAS DESTE PARAGRAFO MUDARAM EM 0006, e o comentario fica registrando
-- as duas em vez de virar mentira. A primeira: o REVOKE foi DESFEITO para estas
-- duas tabelas, porque o painel do admin fala DIRETO com o Supabase e admin
-- autentica como `authenticated` — a segunda tranca foi trocada pela politica
-- `canastra.eh_admin()`, que so passou a existir la. A segunda: nao e verdade
-- que "o painel fala pelo `service_role`"; pelo servico Node passa apenas o
-- upload de imagem, e o resto do painel vai por PostgREST com RLS. Continua
-- valendo que nenhum CLIENTE tem o que escrever nestas duas.
REVOKE INSERT, UPDATE, DELETE ON canastra.promocoes, canastra.config_loja
  FROM authenticated;

-- Chave geral fechada, ainda sem politica nenhuma — mesmo motivo de 0002, e vale
-- inclusive para as duas publicas: GRANT e permissao de TABELA, a RLS decide a
-- LINHA, e ate a migracao de politicas chegar ela nega tudo. Um deploy que pare
-- no meio deixa a vitrine sem banner e sem promocao — visivel e inofensivo — em
-- vez de deixar `pedidos` servido pelo PostgREST a quem pedir.
ALTER TABLE canastra.pedidos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocoes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.config_loja ENABLE ROW LEVEL SECURITY;

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0005_pedidos_promocoes_config')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0006_politicas_rls
-- ----------------------------------------------------------------------------

-- As politicas de RLS. Esta e a migracao que decide quem enxerga o que.
--
-- O PROBLEMA QUE ELA RESOLVE, e que nao e o problema normal de uma loja
-- Esta instancia Supabase e SELF-HOSTED e COMPARTILHADA com outros projetos do
-- mesmo dono. Self-hosted nao e multi-projeto: `auth.users` e o `JWT_SECRET` sao
-- unicos por instancia. Entao um JWT emitido para OUTRO projeto chega no
-- PostgREST desta loja com assinatura valida, papel `authenticated` e
-- `auth.uid()` PREENCHIDO. Ele nao e um invasor no sentido classico — e um
-- usuario legitimo, de outro lugar.
--
-- POR ISSO, DUAS REGRAS QUE VALEM PARA TODO ESTE ARQUIVO E PARA O QUE VIER
-- DEPOIS:
--
--   1. Nenhuma politica usa `auth.uid() IS NOT NULL`. Estar autenticado nesta
--      instancia nao diz nada sobre esta loja.
--   2. Nenhuma politica de dono usa `user_id = auth.uid()` SOZINHO. Ela tambem
--      exige `canastra.eh_cliente()`, isto e, LINHA em `canastra.clientes`.
--
-- A regra 2 parece redundante e nao e. `user_id = auth.uid()` prova que a pessoa
-- e dona DAQUELA linha; o que ela nao cobre e o caminho para VIRAR dona de uma
-- linha. Sem o teste de cliente, bastaria um INSERT com o proprio uid — em
-- `enderecos`, em `carrinhos` — para o usuario de outro projeto passar a ter
-- linhas suas aqui dentro, e a partir dai toda politica de dono passa a
-- concordar com ele. Ser cliente desta loja e ter passado pelo cadastro desta
-- loja, e essa e a unica pergunta que fecha a porta.
--
-- A UNICA EXCECAO A REGRA 2 esta em `canastra.clientes`, e esta provada no
-- comentario daquela secao: la as duas condicoes sao literalmente a mesma.

/* ------------------------------------------------------------------------- *
 * As duas perguntas que as politicas fazem
 * ------------------------------------------------------------------------- */

/**
 * "Quem esta pedindo e cliente DESTA loja?"
 *
 * SECURITY DEFINER NAO E OPCIONAL, e o motivo nao e privilegio, e RECURSAO.
 * Estas funcoes leem `clientes` e `admins`, que sao justamente tabelas com
 * politica. Como SECURITY INVOKER, avaliar a politica de `admins` exigiria
 * chamar `eh_admin()`, que leria `admins`, que avaliaria a politica de novo.
 * Como SECURITY DEFINER, a funcao roda como o DONO das tabelas, e dono de tabela
 * e isento de RLS: a leitura acontece por baixo das politicas e o ciclo nao
 * existe.
 *
 * MEDIDO, e o resultado da versao quebrada NAO e o erro que se espera:
 *
 *   eh_admin() SECURITY INVOKER, politica de `admins` chamando-a
 *     -> 54001, "stack depth limit exceeded"
 *   politica de `admins` lendo `canastra.admins` direto, sem funcao no meio
 *     -> 42P17, "infinite recursion detected in policy for relation admins"
 *
 * O detector de recursao do Postgres so enxerga a referencia DIRETA a propria
 * tabela; com uma funcao no meio ele nao fecha o ciclo e a consulta vai ate
 * estourar a pilha. Quem for depurar isto um dia procuraria por 42P17 e nao
 * acharia — e por isso o codigo medido esta escrito aqui.
 *
 * DO QUE ESSA ISENCAO DEPENDE, porque e ela que sustenta o arquivo inteiro:
 * do dono NAO ter `FORCE ROW LEVEL SECURITY` ligado nas tabelas. Medido, com
 * dono nao-superusuario, para nao confundir a isencao do dono com a do
 * superusuario que o harness usa:
 *
 *   sem FORCE ....... eh_admin() enxerga `admins`, as politicas funcionam
 *   com FORCE ....... eh_admin() roda sob as politicas de `admins`, que sao
 *                     `TO authenticated` e portanto NAO se aplicam ao dono;
 *                     nenhuma politica casa, a leitura devolve ZERO linhas e
 *                     eh_admin() passa a responder FALSE PARA TODO MUNDO
 *
 * Repare no modo de falha: nao seria erro, e sim o painel do admin morrendo em
 * silencio e o cliente deixando de ver o proprio endereco. Por isso
 * test/rls.test.js afirma, como invariante e nao como lista, que nenhuma tabela
 * de `canastra` tem FORCE ligado.
 *
 * E POR ISSO TAMBEM O `SET row_security = off` ABAIXO, que e o unico jeito de
 * tirar o SILENCIO dessa falha. Com ele, uma consulta que SERIA afetada por RLS
 * nao devolve menos linhas: ela ERRA. Medido, com dono nao-superusuario:
 *
 *                                  sem FORCE   com FORCE em `admins`
 *   eh_admin() ..................  true        false, calado
 *   eh_admin() + row_security=off  true        42501, "query would be affected
 *                                              by row-level security policy for
 *                                              table admins"
 *
 * Ou seja: no caminho saudavel e um no-op (o dono ja esta isento, entao nenhuma
 * consulta e "afetada"), e no caminho quebrado troca "a loja inteira responde
 * nao" por uma mensagem que se explica sozinha e cita a tabela. Ele NAO remove a
 * dependencia da isencao do dono — nada remove —, remove a mudez.
 *
 * `SET search_path` e obrigatorio em funcao SECURITY DEFINER: sem ele quem chama
 * escolhe em que schema `clientes` sera procurada e executa o que quiser com os
 * poderes do dono. `pg_temp` vai por ultimo de proposito — na frente, uma tabela
 * temporaria do proprio chamador sequestraria o nome. `auth.uid()` vai
 * qualificado justamente porque `auth` nao esta no caminho.
 *
 * SEM ARGUMENTO, de proposito. Uma `eh_admin(uid uuid)` executavel por
 * `authenticated` viraria um oraculo: qualquer token da instancia
 * compartilhada poderia varrer uuids e descobrir quem administra a loja. Lendo
 * so `auth.uid()`, a funcao nao responde nada sobre terceiros.
 */
CREATE FUNCTION canastra.eh_cliente() RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = canastra, pg_temp
  SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM canastra.clientes WHERE user_id = auth.uid()
  )
$$;

/**
 * "Quem esta pedindo administra ESTA loja?"
 *
 * O papel de administrador NUNCA vem de claim no JWT — outro projeto da
 * instancia emitiria o claim que quisesse. Vem de linha em `canastra.admins`,
 * que so o `service_role` escreve (o REVOKE de 0003 continua valendo e NAO e
 * desfeito aqui; ver o bloco de privilegios abaixo). Essa e a porta que impede
 * um token estrangeiro de se promover a administrador.
 */
CREATE FUNCTION canastra.eh_admin() RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = canastra, pg_temp
  SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM canastra.admins WHERE user_id = auth.uid()
  )
$$;

-- `proacl` nasce nulo, o que significa EXECUTE para PUBLIC. Numa funcao
-- SECURITY DEFINER isso e higiene mal feita mesmo quando inofensivo: o REVOKE
-- primeiro, e a lista explicita depois, deixa escrito quem precisa chamar.
--
-- `anon` PRECISA estar na lista. Hoje nenhuma politica que `anon` alcance chama
-- estas funcoes (as publicas sao `USING (true)`), mas o dia em que uma chamar, a
-- falta de EXECUTE apareceria como 42501 na vitrine — recusa que parece de
-- politica e nao e.
REVOKE EXECUTE ON FUNCTION canastra.eh_cliente() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION canastra.eh_admin()   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canastra.eh_cliente() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION canastra.eh_admin()   TO anon, authenticated, service_role;

/* ------------------------------------------------------------------------- *
 * Privilegios: o que muda de 0003/0005 para ca, e por que
 * ------------------------------------------------------------------------- */

/**
 * A VITRINE DEIXA DE DEPENDER DA ISENCAO DE RLS DO DONO DA VIEW.
 *
 * 0003 criou `produtos_publicos` com `security_invoker = false`. Funcionava: a
 * view roda como seu dono, que e isento de RLS, e o recorte de colunas fazia o
 * controle de acesso. O problema nao era o resultado, eram as duas propriedades
 * que vinham junto:
 *
 *   - ligar FORCE ROW LEVEL SECURITY em `canastra.produtos` esvaziava a vitrine
 *     EM SILENCIO, sem erro e sem log (medido em 0003);
 *   - a escrita atraves da view — que e auto-atualizavel — so era barrada por um
 *     REVOKE, isto e, por uma linha que nenhuma regra estrutural regenera.
 *
 * Com `security_invoker = true` a view passa a rodar com os privilegios de quem
 * chama, e a leitura publica passa a ser feita da forma normal: GRANT de coluna
 * na tabela base + politica de SELECT. Medido, depois da virada:
 *
 *   anon le o catalogo inteiro pela view ......... sim, 14 colunas
 *   authenticated (cliente, admin ou intruso) .... o mesmo, 14 colunas
 *   anon le `custo` pela view .................... a coluna nem existe la
 *   anon le `custo` direto na tabela ............. 42501
 *   authenticated le `custo` direto na tabela .... 42501
 *   anon com `SELECT *` direto na tabela ......... 42501
 *   escrita pela view, por QUALQUER authenticated  42501 (o REVOKE de 0003
 *                                                  continua valendo, inclusive
 *                                                  para o admin — o painel
 *                                                  escreve na TABELA)
 *
 * O PRECO, e ele e real: `canastra.produtos` vira uma relacao visivel para
 * `anon` no PostgREST, e um `select=*` cru responde 42501 em vez de 404. Isso e
 * barulhento, nunca vazado — o oposto exato do modo de falha que se estava
 * trocando.
 *
 * O SEGUNDO PRECO, que nao estava no plano e precisa estar escrito: com
 * `REVOKE SELECT ... FROM authenticated` abaixo, o painel do admin tambem perde
 * a LEITURA de `custo`, `criado_em` e `tsv` pelo PostgREST, porque privilegio de
 * coluna e por PAPEL e admin autentica como `authenticated` igual a todo mundo.
 * Ele continua ESCREVENDO `custo` (o GRANT de escrita e de tabela; medido:
 * INSERT e UPDATE com `custo` passam). Ler custo no painel vai exigir ou o
 * `service_role` pelo servico Node, ou uma funcao SECURITY DEFINER com
 * `eh_admin()` na frente — decisao da tarefa que construir o painel, nao desta.
 * A alternativa era deixar `custo` legivel por qualquer token da instancia
 * compartilhada, o que e pior.
 *
 * O TROCO DISSO NO PAINEL, e ele morde cedo: em `canastra.produtos`, e SO nela,
 * `RETURNING *` passa a falhar com 42501 — inclusive para o admin. Medido, e o
 * alcance exato importa porque a correcao e barata quando se sabe onde aplicar:
 *
 *   INSERT/UPDATE/DELETE em `produtos` ... RETURNING *  ....... 42501
 *   INSERT em `produtos` ............... RETURNING produto_id . passa
 *   INSERT em `promocoes`, `produto_opcoes`, UPDATE em
 *     `config_loja` e em `pedidos` ..... RETURNING *  ......... passa
 *   cliente: INSERT em `enderecos` e `carrinho_itens`
 *                                        RETURNING *  ......... passa
 *   vitrine: SELECT * em `produtos_publicos` ................. passa
 *
 * `produtos` e a UNICA relacao do schema com privilegio de SELECT por COLUNA, e
 * por isso a unica em que `*` alcanca uma coluna sem permissao. Ou seja, o que
 * precisa listar colunas e o CRUD de produto do painel, uma tela — nao o app.
 *
 * E isso alcanca o supabase-js sem ninguem escrever `RETURNING`: um
 * `.insert(x).select()` vira `select=*` no PostgREST, que vira `RETURNING *`.
 * Naquela tela, `.select('produto_id, nome, preco, ...')`. O modo de falha e
 * barulhento (erro na hora, nao dado errado), mas nao e autoexplicativo, entao
 * fica registrado aqui.
 *
 * O REVOKE de escrita na view (0003) FICA. Com `security_invoker = true` ele
 * deixou de ser a unica tranca — a escrita pela view agora tambem passa pela
 * politica da tabela base — mas duas trancas continuam melhores que uma.
 */
ALTER VIEW canastra.produtos_publicos SET (security_invoker = true);

-- O REVOKE aqui e o que faz o GRANT de coluna seguinte significar alguma coisa.
-- Sem ele, `authenticated` continuaria com SELECT de TABELA vindo do default de
-- 0001 — e a politica de catalogo publico logo abaixo, que e `USING (true)`,
-- entregaria `custo` a qualquer token da instancia compartilhada. Isto e, a
-- politica que abre a vitrine abriria a margem de lucro junto.
REVOKE SELECT ON canastra.produtos FROM authenticated;

-- A lista publica, identica a projecao da view — e as duas tem de andar juntas:
-- coluna que entrar na view sem entrar aqui quebra a vitrine com 42501, e coluna
-- que entrar aqui sem ser publica de verdade vaza. `custo`, `criado_em` e `tsv`
-- ficam de fora de proposito.
GRANT SELECT (produto_id, nome, tamanho, categoria, preco, imagem, quantidade,
              descricao, peso, largura, altura, comprimento, destacado_em, sku)
  ON canastra.produtos TO anon, authenticated;

/**
 * A ESCRITA DO CATALOGO VOLTA PARA `authenticated`, E ISSO E DELIBERADO.
 *
 * 0003 e 0005 REVOGARAM INSERT/UPDATE/DELETE de `authenticated` em `produtos`,
 * `produto_opcoes`, `promocoes` e `config_loja`. Aquilo estava CERTO no momento
 * em que foi escrito, e o comentario de 0003 explica bem: enquanto nao existisse
 * politica nenhuma, a unica coisa entre um token estrangeiro e o catalogo era a
 * RLS sem policy, e a primeira policy ampla demais acordaria o privilegio. O
 * REVOKE era a segunda tranca justamente porque a primeira ainda nao existia.
 *
 * Esta migracao e o momento em que essa segunda tranca e trocada, de propria
 * vontade, por uma politica explicita e testada. O que forca a troca: o painel
 * do admin fala DIRETO com o Supabase por `supabase-js`, com RLS e
 * `canastra.admins` decidindo (so o upload de imagem passa pelo servico Node).
 * Administrador autentica como `authenticated`, como todo mundo — sem estes
 * GRANTs ele nao consegue cadastrar um produto de jeito nenhum.
 *
 * A troca so e aceitavel porque a politica que entra no lugar e ESTREITA:
 * escrita apenas com `canastra.eh_admin()`. O erro que 0003 previu — e que um
 * revisor demonstrou funcionando —
 *
 *     CREATE POLICY tudo ON canastra.produto_opcoes FOR ALL USING (true) WITH CHECK (true);
 *
 * apagava os filtros do catalogo com um token de outro projeto. Nao ha, neste
 * arquivo, nenhuma politica `USING (true)` que nao seja `FOR SELECT`, e
 * test/rls.test.js afirma isso como invariante sobre `pg_policies`, e nao como
 * lista de nomes.
 *
 * `canastra.admins` NAO ENTRA NESTA VOLTA e nao pode entrar. Nela quem escreve e
 * so o `service_role`, pelo servico. Esse e o alcapao: sem privilegio de INSERT
 * para `authenticated`, nenhuma politica escrita por engano — hoje ou em 0012 —
 * transforma um token estrangeiro em administrador desta loja.
 */
GRANT INSERT, UPDATE, DELETE ON canastra.produtos, canastra.produto_opcoes
  TO authenticated;
GRANT INSERT, UPDATE, DELETE ON canastra.promocoes, canastra.config_loja
  TO authenticated;

/**
 * `pedidos`: o unico recorte que a RLS NAO sabe fazer.
 *
 * O admin muda `status`, `codigo_rastreio` e `metodo_envio` de um pedido — e so
 * isso. Ele nao reescreve `total`, `itens`, `endereco_json` nem
 * `pagamento_id_mp`: sao o registro da venda, e a auditoria que originou esta
 * fase reclamava justamente de valores de pedido alteraveis fora do checkout.
 *
 * POLITICA DE RLS NAO RESTRINGE COLUNA. Ela decide LINHA; um
 * `FOR UPDATE USING (eh_admin())` autoriza o admin a mexer na linha inteira. O
 * unico mecanismo do Postgres que corta por coluna e o privilegio de coluna,
 * entao a trava desce um andar: tira-se o UPDATE de tabela e devolve-se apenas a
 * lista permitida. As duas camadas se somam — a RLS diz QUAL linha, o GRANT diz
 * QUAIS colunas.
 *
 * `atualizado_em` entra na lista porque nao ha trigger de `moddatetime` neste
 * schema (ver 0005): quem atualiza escreve a data junto, ou a coluna mente.
 *
 * Medido: com o admin, `SET status = 'enviado', atualizado_em = now()` passa; o
 * mesmo comando incluindo `total` recusa com 42501 e a mensagem "permission
 * denied for table pedidos" — barulhento, e nao um UPDATE que silenciosamente
 * ignora a coluna.
 */
REVOKE UPDATE ON canastra.pedidos FROM authenticated;
GRANT UPDATE (status, codigo_rastreio, metodo_envio, atualizado_em)
  ON canastra.pedidos TO authenticated;

/**
 * A SEGUNDA TRANCA NAS DUAS PORTAS QUE NAO PODEM ABRIR.
 *
 * Nenhuma politica deste arquivo autoriza INSERT em `clientes` ou em `pedidos`,
 * e RLS ligada sem politica ja recusa com 42501 — entao estes REVOKEs nao
 * consertam furo nenhum HOJE. Eles existem porque a ausencia de politica e uma
 * propriedade que se perde com um `CREATE POLICY` distraido, escrito noutro dia,
 * noutro arquivo, por quem nao leu isto aqui. O privilegio de tabela nao se
 * perde assim.
 *
 * O argumento e o mesmo que 0003 usou para `admins` — e vale AINDA MAIS para
 * `clientes`, que e o alvo mais valioso do schema: uma linha inserida ali
 * fabrica `eh_cliente()`, e `eh_cliente()` e a metade que sustenta TODA politica
 * de dono deste arquivo. Promover-se a admin exige passar por `clientes` antes
 * (a FK de 0002); virar cliente nao exige passar por lugar nenhum. Deixar a
 * porta maior guardada so por CI enquanto a menor tem tranca de banco seria
 * defender o principio no comentario e abrir mao dele no DDL.
 *
 * `pedidos` entra pela mesma razao e com o mesmo custo (zero): criar pedido e
 * baixar estoque acontecem no servico Node, pelo `service_role`. DELETE vai
 * junto nas duas — apagar cliente e caminho de LGPD (0005 lembra que exige
 * redigir `endereco_json` e `itens` antes) e pedido e registro fiscal. Nenhum
 * dos dois e um clique de navegador.
 *
 * O QUE FICA DE PROPOSITO: `UPDATE` em `clientes`, porque o cliente corrige
 * mesmo o proprio telefone, e `SELECT` nas duas. E `service_role` nao e tocado —
 * o REVOKE nomeia so `authenticated`.
 */
REVOKE INSERT, DELETE ON canastra.clientes FROM authenticated;
REVOKE INSERT, DELETE ON canastra.pedidos  FROM authenticated;

/* ------------------------------------------------------------------------- *
 * Politicas
 * ------------------------------------------------------------------------- */

/**
 * `clientes` — a tabela que define o que "ser cliente" quer dizer.
 *
 * NAO HA POLITICA DE INSERT, PARA NINGUEM, e essa ausencia e a peca central de
 * seguranca desta fase inteira. Virar cliente acontece no cadastro, pelo
 * `service_role`, que tem BYPASSRLS. Se `authenticated` pudesse inserir aqui,
 * qualquer usuario de qualquer outro projeto da instancia se auto-cadastraria
 * como cliente desta loja — e a partir dai `eh_cliente()` passaria a concordar
 * com ele e TODA a defesa deste arquivo cairia de uma vez. RLS ligada sem
 * politica de INSERT nega: o INSERT volta 42501.
 *
 * NAO HA POLITICA DE DELETE tampouco: apagar cliente e caminho de LGPD, que
 * (ver 0005) exige redigir `endereco_json` e `itens` dos pedidos junto e por
 * isso nao pode ser um DELETE solto vindo do navegador.
 *
 * A EXCECAO A REGRA 2 DO CABECALHO, com a prova: aqui a politica de dono e
 * `user_id = auth.uid()` SEM `eh_cliente()`, e as duas sao a mesma condicao.
 * `eh_cliente()` e `EXISTS (SELECT 1 FROM clientes WHERE user_id = auth.uid())`;
 * se a linha sob teste satisfaz `user_id = auth.uid()`, entao ela mesma e uma
 * testemunha desse EXISTS, e o EXISTS e verdadeiro. A reciproca nao interessa,
 * porque a politica ja exigiu a igualdade. Somar `eh_cliente()` aqui seria uma
 * chamada de funcao por linha que nunca muda resposta nenhuma.
 */
CREATE POLICY clientes_dono_le ON canastra.clientes
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY clientes_admin_le ON canastra.clientes
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());

CREATE POLICY clientes_dono_atualiza ON canastra.clientes
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

/**
 * `admins` — leitura para admin, e mais nada.
 *
 * Sem politica de escrita, e sem privilegio de escrita (REVOKE de 0003). As duas
 * camadas negam, que e como tem de ser na tabela onde o estrago e maior.
 *
 * Por que `admins` precisa ser LEGIVEL, ja que `eh_admin()` le por baixo da RLS:
 * o painel mostra a lista de administradores. Quem nao e admin nao ve nem que a
 * tabela tem linhas.
 */
CREATE POLICY admins_admin_le ON canastra.admins
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());

/**
 * Catalogo, filtros, promocoes e configuracao: leitura publica, escrita de
 * admin. Quatro tabelas, o mesmo par de politicas.
 *
 * O `FOR SELECT ... USING (true)` e a unica forma de `true` que aparece neste
 * arquivo. Escrita nunca — foi exatamente `FOR ALL USING (true)` em
 * `produto_opcoes` que um revisor usou para apagar os filtros do catalogo com um
 * token de outro projeto.
 *
 * O `FOR ALL` das politicas de escrita NAO e o mesmo perigo: o predicado e
 * `eh_admin()`, e ele vale igual para INSERT, UPDATE e DELETE. Ele tambem cobre
 * SELECT, o que aqui e inofensivo — as politicas permissivas se somam com OR, e
 * a de leitura publica ja diz `true`.
 *
 * O QUE UM NAO-ADMIN VE AO TENTAR ESCREVER, e vale saber antes de depurar: o
 * INSERT recusa com 42501 (o WITH CHECK barra a linha nova), mas o UPDATE e o
 * DELETE simplesmente NAO CASAM LINHA NENHUMA e voltam "0 linhas afetadas", sem
 * erro. E a semantica normal da RLS: o USING filtra, nao acusa. O catalogo
 * continua intacto — o que muda e o barulho, e test/rls.test.js afirma os dois
 * comportamentos para que ninguem os descubra em producao.
 */
CREATE POLICY produtos_leitura_publica ON canastra.produtos
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY produtos_admin_escreve ON canastra.produtos
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

CREATE POLICY produto_opcoes_leitura_publica ON canastra.produto_opcoes
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY produto_opcoes_admin_escreve ON canastra.produto_opcoes
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

CREATE POLICY promocoes_leitura_publica ON canastra.promocoes
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY promocoes_admin_escreve ON canastra.promocoes
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

CREATE POLICY config_loja_leitura_publica ON canastra.config_loja
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY config_loja_admin_escreve ON canastra.config_loja
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

/**
 * `enderecos` e `carrinhos` — dados do dono, e so do dono.
 *
 * `FOR ALL` com o MESMO predicado nas quatro operacoes, porque "dono" quer dizer
 * a mesma coisa em ler, criar, alterar e apagar o proprio endereco. O que foi
 * proibido no cabecalho e `USING (true)`, nao `FOR ALL`.
 *
 * O `WITH CHECK` e tao importante quanto o `USING` e nao pode ser esquecido: sem
 * ele, o cliente inseriria uma linha com o `user_id` do vizinho e a esconderia
 * de si mesmo — e um endereco plantado na conta alheia muda para onde a
 * encomenda vai.
 *
 * `canastra.eh_cliente() AND` na frente e a Regra 2 do cabecalho: sem ela, um
 * token de outro projeto da instancia insere `user_id = auth.uid()` (o proprio
 * uid, que a igualdade aceita), passa a ter linhas aqui e vira, na pratica,
 * usuario da loja sem nunca ter se cadastrado. A chave estrangeira para
 * `clientes` ja barraria ESTAS duas tabelas com 23503 — mas o teste de cliente e
 * o que faz a regra valer por si, sem depender de cada tabela futura lembrar de
 * apontar a FK para `clientes` em vez de `auth.users`.
 */
CREATE POLICY enderecos_dono ON canastra.enderecos
  FOR ALL TO authenticated
  USING (canastra.eh_cliente() AND user_id = auth.uid())
  WITH CHECK (canastra.eh_cliente() AND user_id = auth.uid());

CREATE POLICY carrinhos_dono ON canastra.carrinhos
  FOR ALL TO authenticated
  USING (canastra.eh_cliente() AND user_id = auth.uid())
  WITH CHECK (canastra.eh_cliente() AND user_id = auth.uid());

/**
 * `carrinho_itens` — o dono vem do carrinho PAI, porque a linha nao tem dono
 * proprio.
 *
 * ATENCAO AO QUE ESTE EXISTS DEPENDE, que nao e obvio: `canastra.carrinhos` esta
 * sob RLS, e a subconsulta de uma politica roda como o INVOCADOR, nao como dono.
 * Ou seja, este EXISTS enxerga apenas os carrinhos que a politica
 * `carrinhos_dono` deixa a pessoa enxergar. Aqui isso da certo por construcao —
 * o unico carrinho de que ela precisa e o dela, e e exatamente o que
 * `carrinhos_dono` mostra — e foi MEDIDO, nao suposto: Ana le e escreve os
 * proprios itens, Bruno nao ve nenhum deles.
 *
 * O acoplamento, porem, e real e silencioso: se um dia `carrinhos_dono` for
 * estreitada (um filtro por carrinho "ativo", por exemplo), a sacola daqui
 * esvazia SEM ERRO. Quem mexer naquela politica tem de reler esta. A alternativa
 * — uma funcao SECURITY DEFINER que devolvesse o carrinho do chamador — foi
 * recusada por acrescentar superficie de bypass de RLS para resolver um
 * acoplamento que os testes ja pegam.
 *
 * `eh_cliente()` continua na frente pela Regra 2 do cabecalho, e aqui ela e
 * menos redundante do que parece: esta tabela NAO tem chave estrangeira para
 * `clientes` — a ligacao passa por `carrinhos` —, entao ela e o unico ponto onde
 * a exigencia de cadastro e feita por politica e nao por FK.
 */
CREATE POLICY carrinho_itens_dono ON canastra.carrinho_itens
  FOR ALL TO authenticated
  USING (
    canastra.eh_cliente()
    AND EXISTS (
      SELECT 1 FROM canastra.carrinhos c
      WHERE c.carrinho_id = carrinho_itens.carrinho_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    canastra.eh_cliente()
    AND EXISTS (
      SELECT 1 FROM canastra.carrinhos c
      WHERE c.carrinho_id = carrinho_itens.carrinho_id
        AND c.user_id = auth.uid()
    )
  );

/**
 * `pedidos` — le o dono, le o admin, e NINGUEM insere.
 *
 * A AUSENCIA DE POLITICA DE INSERT E O PONTO DA TABELA. Criar pedido e baixar
 * estoque acontecem no servico Node, numa transacao unica, com chave de
 * idempotencia (os indices parciais de 0005 existem para isso). Deixar o
 * navegador — ou o painel — inserir por PostgREST significaria total, itens e
 * estoque escritos por quem nao passou pelo checkout: exatamente o achado de
 * auditoria que esta fase inteira fecha. Nem cliente nem admin inserem; so o
 * `service_role`, que tem BYPASSRLS. RLS ligada sem politica de INSERT recusa
 * com 42501.
 *
 * NEM POLITICA DE DELETE: pedido e registro fiscal, nao se apaga pelo painel.
 *
 * A POLITICA DO ADMIN PRECISA EXISTIR SEPARADA, e 0005 ja avisava por que: a
 * chave e `ON DELETE SET NULL`, entao o pedido de um cliente apagado fica com
 * `user_id IS NULL`. Contra ele, `user_id = auth.uid()` avalia NULL — que nao e
 * TRUE — e o pedido some para todo cliente, que e o desfecho certo (ninguem
 * herda a compra de outro). Mas o historico do painel nao pode sumir junto, e e
 * por isso que o admin le por `eh_admin()` e nao por uma frouxidao na politica
 * de dono.
 *
 * O UPDATE do admin e por LINHA aqui e por COLUNA no GRANT acima. As duas coisas
 * juntas sao a regra completa: `eh_admin()` diz que ele pode mexer no pedido,
 * o privilegio de coluna diz que "mexer" e status, rastreio, envio e a data.
 *
 * LEIA ISTO ANTES DE MEXER NO GRANT DE COLUNA DE `pedidos`: o `WITH CHECK` de
 * `pedidos_admin_atualiza` NAO restringe `user_id`. Ele exige `eh_admin()` da
 * linha nova, e uma linha com o `user_id` de OUTRO cliente satisfaz isso — a
 * politica autorizaria, calada, transferir uma venda de um cliente para outro.
 * O QUE IMPEDE HOJE E EXCLUSIVAMENTE `user_id` estar de fora do
 * `GRANT UPDATE (...)` acima: medido, a tentativa recusa com 42501. Isso quer
 * dizer que a defesa inteira de `user_id` mora numa lista de quatro colunas, e o
 * dia em que alguem acrescentar `user_id` ali por um motivo alheio — importar
 * pedido antigo, corrigir um cadastro duplicado — a transferencia passa a ser
 * permitida sem que nenhuma politica tenha mudado.
 *
 * E NAO DA PARA FECHAR ISSO NA POLITICA, e vale registrar por que, para ninguem
 * tentar de novo: `WITH CHECK` so enxerga a linha NOVA, nao existe OLD numa
 * politica, e a saida obvia — subconsultar `canastra.pedidos` para comparar com
 * o valor antigo — e uma politica de `pedidos` lendo `pedidos`, o unico formato
 * que o Postgres corta na hora com 42P17 ("infinite recursion detected in policy
 * for relation"). Entao a trava e o GRANT, e este paragrafo e o aviso preso a
 * ela.
 */
CREATE POLICY pedidos_dono_le ON canastra.pedidos
  FOR SELECT TO authenticated
  USING (canastra.eh_cliente() AND user_id = auth.uid());

CREATE POLICY pedidos_admin_le ON canastra.pedidos
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());

CREATE POLICY pedidos_admin_atualiza ON canastra.pedidos
  FOR UPDATE TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

-- O ENABLE repetido, como 0002 anunciou que seria. E idempotente e vale como
-- rede: se alguem desligar a RLS de uma destas tabelas a mao, reaplicar as
-- migracoes num banco novo nao herda o desligamento. Politica sem RLS ligada nao
-- filtra nada — e nao avisa.
ALTER TABLE canastra.clientes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.admins         ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.produtos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.produto_opcoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.enderecos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.carrinhos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.carrinho_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.pedidos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.promocoes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.config_loja    ENABLE ROW LEVEL SECURITY;

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0006_politicas_rls')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0007_fundir_sacola
-- ----------------------------------------------------------------------------

-- A sacola montada deslogado, fundida na sacola da conta no login.
--
-- POR QUE ESTA MIGRACAO EXISTE
-- `frontend/lib/sacola/sacola.tsx` guarda a sacola de quem nao esta logado em
-- `localStorage["cart"]`, e hoje quem funde essa lista na sacola da conta e o
-- `signIn` do backend proprio. Com o GoTrue assumindo o login, essa costura
-- deixa de existir. Sem substituto, TODO cliente que monta a sacola deslogado e
-- depois entra PERDE os itens, em silencio — e a sacola e o caminho da receita.
-- A fusao passa a ser esta funcao, chamada pelo navegador logo depois do login.
--
-- O CONTRATO, QUE NAO E O DA VITRINE — LEIA ANTES DE LIGAR OS DOIS LADOS
-- As chaves do JSON aqui sao as COLUNAS de `canastra.carrinho_itens`, em
-- portugues: produto_id, quantidade, preco, nome, imagem, tamanho, moagem. O
-- `ItemDaSacola` do `localStorage` esta em ingles (product_id, quantity, price,
-- name, image, size) e so `moagem` coincide. Quem chamar TEM de traduzir; mandar
-- a lista crua faz `produto_id` vir nulo em todo item, e o efeito e a sacola
-- inteira ser descartada em silencio (ver o filtro adiante). O portugues foi
-- mantido porque o resto do schema e portugues e uma RPC que fala ingles so
-- deste lado seria a excecao que ninguem lembra.
--
-- A FUSAO NAO E IDEMPOTENTE, E NAO TEM COMO SER. A lista que chega nao carrega
-- identidade nenhuma, entao chamar duas vezes com a mesma sacola soma duas
-- vezes. `onAuthStateChange` do supabase-js dispara mais de uma vez por sessao
-- (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED): quem chamar em todas elas dobra
-- a sacola do cliente a cada evento. A unica defesa esta no navegador — apagar
-- `localStorage["cart"]` assim que a fusao responder, e so entao. Medido em
-- test/fundir_sacola.test.js.

/**
 * NAO E SECURITY DEFINER, e isso e a decisao mais importante do arquivo.
 *
 * O reflexo, numa funcao que escreve em tabela sob RLS, e marca-la DEFINER. Aqui
 * seria errado, e foi MEDIDO: como Ana (cliente da loja), o upsert em
 * `carrinhos` e o upsert em `carrinho_itens` passam sob as PROPRIAS politicas de
 * 0006 (`carrinhos_dono` e `carrinho_itens_dono`); como ESTRANHA — token de
 * outro projeto da instancia compartilhada, ausente de `canastra.clientes` — os
 * mesmos comandos levam 42501. Ou seja, a RLS ja faz exatamente o recorte certo
 * e nao falta privilegio nenhum a ser emprestado.
 *
 * O que DEFINER acrescentaria seria so o risco: dentro dela `auth.uid()`
 * continua sendo o do chamador, mas a RLS para de valer, e qualquer descuido
 * futuro no corpo (aceitar um `user_id` vindo do JSON, por exemplo) viraria
 * escrita na sacola alheia sem que politica nenhuma reclamasse — a superficie de
 * bypass que 0006 gasta o arquivo inteiro fechando. test/fundir_sacola.test.js
 * afirma `prosecdef = false` no catalogo para que ligar DEFINER aqui fique
 * vermelho no CI.
 *
 * `SET search_path` NAO e obrigatorio numa funcao INVOKER — ela roda com os
 * poderes de quem chama, entao nao ha privilegio a sequestrar. Vai mesmo assim,
 * e por um motivo pratico: PostgREST chama com o `search_path` que estiver
 * configurado na instancia COMPARTILHADA, que nao e desta loja e pode mudar sem
 * aviso. Todo nome no corpo ja esta qualificado; o SET so garante que continue
 * resolvendo igual se alguem esquecer de qualificar um nome novo.
 *
 * NAO E `STRICT`, de proposito. Com STRICT, `fundir_sacola(NULL)` devolveria
 * NULL sem entrar no corpo — sem a checagem de cliente e sem garantir a sacola
 * da conta. O caso nulo e tratado la dentro, onde da para decidir o que ele
 * significa.
 */
CREATE FUNCTION canastra.fundir_sacola(itens jsonb) RETURNS void
  LANGUAGE plpgsql
  SET search_path = canastra, pg_temp
AS $fundir_sacola$
DECLARE
  /**
   * Teto de quantidade por item, e a unica razao dele e aritmetica.
   *
   * `quantidade` e `integer`. Uma sacola com quantidades absurdas — lixo em
   * `localStorage`, ou um item somado muitas vezes por chamadas repetidas —
   * chegaria em 2^31 e a fusao morreria com 22003 ("integer out of range") no
   * login. O teto e generoso o bastante para nunca alcancar cliente nenhum de
   * uma torrefacao e baixo o bastante para a soma jamais transbordar.
   */
  TETO_DE_QUANTIDADE constant integer := 999999;

  lista jsonb;
  id_do_carrinho uuid;
BEGIN
  /**
   * A checagem explicita de cliente NAO e redundante com a RLS, e nao esta aqui
   * por seguranca — a seguranca ja e das politicas de 0006, que recusam sozinhas.
   * Esta aqui pela MENSAGEM: sem ela, quem nao e cliente desta loja recebe um
   * 42501 falando de politica de linha numa tabela chamada `carrinhos`, e o
   * problema real e nao ter cadastro na loja.
   *
   * ERRCODE explicito, e nao o P0001 que o RAISE daria de graca, pela mesma
   * licao de 0002: P0001 e o codigo de QUALQUER RAISE do banco, entao quem chama
   * teria de casar TEXTO de mensagem para reconhecer esta recusa.
   * `insufficient_privilege` (42501) e o codigo que a propria RLS usaria neste
   * caso — os dois caminhos passam a responder a mesma coisa, que e o que quem
   * chama precisa tratar.
   */
  IF NOT canastra.eh_cliente() THEN
    RAISE EXCEPTION 'Quem chamou não é cliente desta loja.'
      USING ERRCODE = 'insufficient_privilege',
            HINT = 'A sacola só existe para quem tem cadastro nesta loja.';
  END IF;

  /**
   * O ENVELOPE E EXIGIDO; O CONTEUDO E MELHOR ESFORCO. A linha entre tolerar e
   * recusar esta aqui, e ela foi escolhida, nao herdada.
   *
   * TOLERADO — ausencia de sacola, nas tres formas que o navegador produz: SQL
   * NULL, o JSON `null` e a lista vazia. Nenhuma pode virar excecao: a fusao roda
   * no INSTANTE do login, e derrubar o login de quem tem a sacola vazia troca um
   * problema nenhum por um problema grande.
   *
   * RECUSADO — qualquer outra coisa no lugar da lista (objeto, numero, string,
   * booleano). Isso nao e dado velho de cliente: o `lerLocal()` da vitrine ja
   * devolve `[]` para o que nao for array, entao esta forma so chega aqui por bug
   * de quem chama. Tolerar em silencio significaria a sacola sumir no login sem
   * uma linha de log — exatamente a falha que esta migracao existe para impedir.
   *
   * Sem este guarda o proprio `jsonb_array_elements` recusaria, com o mesmo
   * SQLSTATE e uma mensagem que fala de "cannot extract elements from a scalar";
   * o que se ganha aqui e um texto que diz o que mandar.
   */
  IF itens IS NULL OR jsonb_typeof(itens) = 'null' THEN
    lista := '[]'::jsonb;
  ELSIF jsonb_typeof(itens) <> 'array' THEN
    RAISE EXCEPTION 'A sacola precisa ser uma lista JSON, e veio %.', jsonb_typeof(itens)
      USING ERRCODE = 'invalid_parameter_value',
            HINT = 'Mande [] quando não houver nada a fundir.';
  ELSE
    lista := itens;
  END IF;

  /**
   * A sacola da conta, criada se ainda nao houver — e o `ON CONFLICT` so e
   * possivel por causa do UNIQUE em `carrinhos.user_id` que 0004 criou para isto.
   *
   * `DO UPDATE`, e nao `DO NOTHING`, por DUAS razoes independentes:
   *
   *   1. `RETURNING` num upsert devolve a linha nos ramos INSERT e DO UPDATE, mas
   *      NAO no DO NOTHING — com DO NOTHING, `id_do_carrinho` ficaria NULL toda
   *      vez que a sacola ja existisse, e o INSERT de itens logo abaixo morreria
   *      com NOT NULL em `carrinho_id`. Ou seja, funcionaria no primeiro login de
   *      cada pessoa e quebraria em todos os seguintes.
   *   2. `atualizado_em` nao tem gatilho nenhum neste schema (0004 registra isso:
   *      manter a coluna e trabalho de quem escreve, e esta RPC e uma das
   *      escritoras). Sem o `now()` aqui, a data de alteracao da sacola fica igual
   *      a de criacao para sempre.
   *
   * `carrinho_itens` NAO tem `atualizado_em` — a coluna nao existe naquela tabela
   * —, entao nao ha carimbo a manter do lado dos itens.
   */
  INSERT INTO canastra.carrinhos (user_id)
  VALUES (auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET atualizado_em = now()
  RETURNING carrinho_id INTO id_do_carrinho;

  /**
   * A fusao propriamente dita, em duas etapas com nomes.
   *
   * `validos` — o filtro. Cada predicado descarta um item, nunca a sacola inteira:
   *   · `jsonb_typeof(item) = 'object'` tira null, numero, string e lista soltos
   *     na lista; sem ele, `item ->> 'produto_id'` num escalar levanta 22023.
   *   · o regex de uuid substitui um `::uuid` que levantaria 22P02 em qualquer
   *     `produto_id` torto — e um item sem produto nao e um item.
   *   · o regex de quantidade e o mais estreito de todos porque quantidade e a
   *     unica coisa aqui que vira dinheiro: so inteiro de 1 a 999999 passa. Zero e
   *     negativo cairiam no CHECK (quantidade > 0) de 0004 e derrubariam a fusao
   *     inteira por causa de um item; fracionado e texto levantariam 22P02.
   *
   * MATERIALIZED nao e enfeite: ele obriga o filtro a rodar como um passo
   * proprio, antes de qualquer conversao da etapa seguinte. Sem a barreira, a
   * garantia de que o `::uuid` so ve linha ja filtrada passa a depender do plano
   * que o Postgres escolher — e um plano nao e um contrato.
   *
   * `somados` — a soma DENTRO da propria lista, e ela conserta uma armadilha real
   * do ON CONFLICT: um unico INSERT nao pode tocar a MESMA linha duas vezes. Com
   * duas entradas de mesmo produto e mesma moagem na lista, o comando morre com
   * 21000 ("ON CONFLICT DO UPDATE command cannot affect row a second time") — no
   * login, na cara do cliente, com a sacola inteira perdida. E `localStorage`
   * chega assim com facilidade: basta um resto de uma versao do site que juntasse
   * itens por outra chave.
   *
   * `min()` nas colunas de exibicao e escolha arbitraria assumida: sao copias do
   * mesmo produto, e o que se precisa e de UM valor determinista, nao do "certo".
   * O preco vale a mesma coisa e um pouco mais: ele e COPIA DE EXIBICAO, quem
   * cobra e o checkout, que rele preco e estoque do banco antes de gerar o
   * pagamento. Por isso um preco impresentavel vira 0 em vez de descartar o
   * item — mostrar "R$ 0,00" ate a vitrine reler o catalogo e reversivel; perder
   * o item nao e.
   */
  WITH validos AS MATERIALIZED (
    SELECT item
    FROM jsonb_array_elements(lista) AS item
    WHERE jsonb_typeof(item) = 'object'
      AND item ->> 'produto_id' ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND item ->> 'quantidade' ~ '^[1-9][0-9]{0,5}$'
  ),
  somados AS (
    SELECT
      (item ->> 'produto_id')::uuid AS produto_id,
      item ->> 'moagem'             AS moagem,
      least(sum((item ->> 'quantidade')::integer), TETO_DE_QUANTIDADE)::integer
                                    AS quantidade,
      min(
        CASE
          WHEN item ->> 'preco' ~ '^[0-9]{1,8}(\.[0-9]+)?$'
          THEN (item ->> 'preco')::numeric
          ELSE 0
        END
      )                             AS preco,
      min(item ->> 'nome')          AS nome,
      min(item ->> 'imagem')        AS imagem,
      min(item ->> 'tamanho')       AS tamanho
    FROM validos
    GROUP BY 1, 2
  )
  INSERT INTO canastra.carrinho_itens AS destino
    (carrinho_id, produto_id, quantidade, preco, nome, imagem, tamanho, moagem)
  SELECT id_do_carrinho, produto_id, quantidade, preco, nome, imagem, tamanho, moagem
  FROM somados
  /**
   * LIMITE CONHECIDO, herdado de 0004 e NAO esquecido: no Postgres cada NULL e
   * distinto dos outros num indice unico (NULLS DISTINCT, o padrao), entao a
   * chave (carrinho_id, produto_id, NULL) nunca colide com ela mesma e este
   * ON CONFLICT NAO DISPARA para item sem moagem — ele duplica na sacola em vez
   * de somar.
   *
   * A RPC NAO conserta isso por conta propria, e a decisao e deliberada: um
   * `coalesce(moagem, 'padrao')` aqui gravaria uma moagem que a vitrine nunca
   * escreve quando insere direto pelo PostgREST, e as duas metades da sacola
   * passariam a nao casar NUNCA MAIS — trocaria uma duplicata visivel por uma
   * divergencia permanente entre dois caminhos de escrita. Passa porque a vitrine
   * sempre manda moagem para cafe, o unico produto com essa variacao. O conserto
   * de verdade e `UNIQUE NULLS NOT DISTINCT` (PG 15+) ou um default na coluna, e
   * as DUAS mexem no alvo deste ON CONFLICT. Nao mude uma sem a outra.
   *
   * O `::bigint` no meio da soma existe para o mesmo transbordo que o teto: a
   * linha que ja esta na conta pode ter sido escrita direto pelo PostgREST, sem
   * passar por este teto, e `int + int` estoura antes de o `least` opinar.
   */
  ON CONFLICT (carrinho_id, produto_id, moagem) DO UPDATE
    SET quantidade =
      least(destino.quantidade::bigint + EXCLUDED.quantidade, TETO_DE_QUANTIDADE)::integer;
END;
$fundir_sacola$;

/**
 * `proacl` nasce nulo, o que significa EXECUTE para PUBLIC — e PUBLIC inclui
 * `anon`. O REVOKE primeiro e a lista explicita depois deixam escrito quem chama.
 *
 * SO `authenticated`, e a ausencia dos outros dois e deliberada:
 *   · `anon` nao tem `auth.uid()`, entao so entraria na funcao para ser barrado
 *     la dentro pelo `eh_cliente()`. Negar no privilegio e a camada de baixo
 *     negando primeiro — o principio das duas camadas de 0001.
 *   · `service_role` nao chama: a fusao e um gesto do NAVEGADOR de quem acabou de
 *     entrar, e o servico Node, quando precisar mexer em sacola, tem BYPASSRLS e
 *     escreve direto nas tabelas.
 *
 * NOTA PARA A CONFIGURACAO DO POSTGREST: uma RPC so aparece em /rest/v1/rpc/ se o
 * schema estiver em `PGRST_DB_SCHEMAS`. Se `canastra` nao estiver la, esta funcao
 * responde 404 com a migracao perfeitamente aplicada.
 */
REVOKE EXECUTE ON FUNCTION canastra.fundir_sacola(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canastra.fundir_sacola(jsonb) TO authenticated;

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0007_fundir_sacola')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0008_garantir_cliente
-- ----------------------------------------------------------------------------

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
--
-- E O TROCO CONCRETO DISSO, que e onde alguem vai de fato procurar um dia:
-- `clientes.cpf` e UNIQUE. Uma conta estrangeira que chame esta RPC pode OCUPAR
-- o CPF de uma pessoa real, e o cadastro legitimo dessa pessoa passa a falhar
-- com 23505 sobre um numero que e dela. NAO e regressao — o formulario publico
-- da loja sempre permitiu exatamente isso, e continua permitindo —, mas e o
-- primeiro sintoma que chega ao suporte, e daqui ate a causa nao ha pista
-- nenhuma. Quem for fechar essa porta: ela nao se fecha AQUI, e sim exigindo
-- prova do CPF (o checkout com nota e quem tem essa prova), porque uma RPC nao
-- tem como distinguir o dono do numero de quem apenas o digitou.

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
   * nao e de CPF. Quem mexer em 0002 tem de reler isto.
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
    INSERT INTO canastra.clientes (user_id, nome, telefone, cpf)
    VALUES (id_do_usuario, nome_limpo, telefone_limpo, cpf_limpo)
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Este CPF já está cadastrado em outra conta desta loja.'
      USING ERRCODE = 'unique_violation',
            HINT = 'Confira o número digitado, ou entre com a conta que já usa este CPF.';
  END;
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

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0008_garantir_cliente')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0009_status_e_frete_gratis
-- ----------------------------------------------------------------------------

-- Status de pedido com lista fechada, e o piso do frete gratis.
--
-- ESTA E A DECISAO QUE 0005 DEIXOU ADIADA DE PROPOSITO. La, `pedidos.status`
-- nasceu texto livre com o aviso explicito: "a tarefa que escrever as
-- transicoes de status e quem tem a lista dos valores validos e deve decidir
-- explicitamente entre um CHECK, um enum ou deixar livre". A tarefa chegou
-- (F4, plano mestre de 2026-08-20) e a decisao e um CHECK:
--
--   * CHECK, e nao enum: acrescentar valor num enum exige ALTER TYPE e, antes
--     do PG 12, truques de transacao; num CHECK e uma migracao trivial que
--     recria a constraint. O custo de consulta e o mesmo.
--   * portugues, e nao o vocabulario do Mercado Pago: o schema inteiro fala
--     portugues desde 0003, e o gateway e um DETALHE do pagamento — amanha um
--     Pix direto ou outro gateway nao deveria obrigar a loja a pensar em
--     "in_process". Quem traduz MP -> loja e o servico Node
--     (src/utils/statusDePedido.js), num unico lugar.
--
-- A lista e a fixada no plano mestre. `enviado` e `entregue` nao existem no
-- MP: sao passos LOGISTICOS, escritos pelo painel do admin.

-- Defensivo, e barato: se alguma linha tiver entrado com o vocabulario antigo
-- do MP (nao deveria existir nenhuma — o codigo que escrevia pedidos apontava
-- para a tabela `orders`, que nunca existiu, entao toda gravacao falhava),
-- traduz antes de trancar. Sem isto, UMA linha velha faria o ALTER TABLE
-- abaixo falhar com 23514 e derrubaria a migracao inteira.
UPDATE canastra.pedidos
   SET status = CASE status
                  WHEN 'pending'     THEN 'pendente'
                  WHEN 'approved'    THEN 'aprovado'
                  WHEN 'in_process'  THEN 'em_processamento'
                  WHEN 'authorized'  THEN 'autorizado'
                  WHEN 'sent'        THEN 'enviado'
                  WHEN 'delivered'   THEN 'entregue'
                  WHEN 'cancelled'   THEN 'cancelado'
                  WHEN 'rejected'    THEN 'rejeitado'
                  WHEN 'refunded'    THEN 'reembolsado'
                END,
       atualizado_em = now()
 WHERE status IN ('pending', 'approved', 'in_process', 'authorized', 'sent',
                  'delivered', 'cancelled', 'rejected', 'refunded');

-- O CHECK em si. Quem tratar o erro no servico deve esperar 23514 citando
-- `pedidos_status_valido` — e vale lembrar o modo de falha que ele fecha:
-- 'pendnete' gravado em texto livre nao levantava erro nenhum, so sumia de
-- todo filtro que procurasse 'pendente'.
ALTER TABLE canastra.pedidos
  ADD CONSTRAINT pedidos_status_valido CHECK (status IN (
    'pendente', 'aprovado', 'em_processamento', 'autorizado',
    'enviado', 'entregue', 'cancelado', 'rejeitado', 'reembolsado'
  ));

-- Frete gratis e REGRA DE SERVIDOR (decisao 3 do plano mestre), e por isso o
-- piso mora no banco e nao numa constante do frontend: o ShippingController
-- zera as opcoes quando o subtotal atinge o minimo, o `conferirFrete` do
-- checkout recota pela MESMA regra, e a vitrine apenas EXIBE o valor que
-- `GET /config` devolver. Um numero escrito no navegador nunca decide frete.
--
-- Em CENTAVOS e inteiro, como todo dinheiro que o frontend ja calcula
-- (frontend/lib/catalogo/repositorio.ts trabalha em centavos): numeric aqui
-- convidaria a aritmetica de ponto flutuante no caminho do dinheiro.
--
-- 14900 = R$ 149,00, o valor que a vitrine ja anuncia hoje no Cabecalho.
--
-- Sem GRANT novo: o SELECT de `config_loja` para `anon` (0005) e de TABELA,
-- entao a coluna nova ja nasce legivel pela vitrine — e o minimo de frete
-- gratis e informacao publica por natureza (esta escrito no topo da loja).
-- O UPDATE de `authenticated` (0006) tambem e de tabela, entao o painel do
-- admin ja consegue ajustar o valor pela politica `config_loja_admin_escreve`.
ALTER TABLE canastra.config_loja
  ADD COLUMN frete_gratis_minimo_centavos integer NOT NULL DEFAULT 14900
    CONSTRAINT config_frete_gratis_nao_negativo
      CHECK (frete_gratis_minimo_centavos >= 0);

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0009_status_e_frete_gratis')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0010_cupons
-- ----------------------------------------------------------------------------

-- Cupons de desconto, e o rastro deles no pedido.
--
-- O DESENHO INTEIRO PARTE DE UMA REGRA DA F4: numero que vira dinheiro nunca
-- vem do navegador. O cupom segue a mesma linha — o cliente manda so o CODIGO;
-- quem le esta tabela, calcula o desconto sobre os precos do BANCO e decide se
-- o cupom vale e o servico Node (utils/cupom.js + PaymentController), sempre no
-- servidor. O `descontoCentavos` que o navegador exibe e cortesia de interface.

CREATE TABLE canastra.cupons (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- O codigo e salvo MAIUSCULO pelo servico (quem digita "cafe10" quis dizer
  -- "CAFE10"), e o CHECK tranca o formato no banco para o caminho que nao
  -- passar pelo servico — um INSERT manual de emergencia, por exemplo — nao
  -- criar um cupom que a validacao nunca encontra: a busca e por igualdade
  -- exata, e um codigo minusculo gravado aqui seria invisivel para sempre.
  -- A-Z e 0-9 apenas, 3 a 30 caracteres: e o que cabe num anuncio e num campo
  -- de checkout sem ambiguidade de espaco, acento ou emoji.
  codigo   text NOT NULL UNIQUE
             CONSTRAINT cupons_codigo_formato CHECK (codigo ~ '^[A-Z0-9]{3,30}$'),

  -- percent desconta proporcao do subtotal; fixed desconta valor em reais.
  tipo     text NOT NULL
             CONSTRAINT cupons_tipo_valido CHECK (tipo IN ('percent', 'fixed')),

  -- O MESMO teto de 90% das promocoes (promotionsRepository.validarDesconto),
  -- pelo MESMO motivo: acima disso e quase certamente engano, e um "100%"
  -- liberaria a loja de graca para quem soubesse o codigo. So que la o teto e
  -- so do servico; aqui vai tambem no banco, porque cupom e um segredo que
  -- circula fora da loja (anuncio, influencer) e o custo de um erro e maior.
  -- `fixed` nao tem teto no banco: o servico trava o desconto no subtotal do
  -- pedido, entao um fixed maior que a compra desconta a compra e para.
  valor    numeric(10,2) NOT NULL
             CONSTRAINT cupons_valor_valido
               CHECK (valor > 0 AND (tipo <> 'percent' OR valor <= 90)),

  descricao text,

  -- Pedido minimo em CENTAVOS e inteiro, como todo dinheiro de comparacao
  -- neste schema (frete_gratis_minimo_centavos, 0009): numeric aqui convidaria
  -- aritmetica de ponto flutuante exatamente na fronteira do "vale/nao vale".
  minimo_centavos integer NOT NULL DEFAULT 0
             CONSTRAINT cupons_minimo_nao_negativo CHECK (minimo_centavos >= 0),

  -- NULL = sem limite. O CHECK barra o `limite_usos = 0`, que nao significa
  -- "ilimitado" nem "esgotado desde o inicio" — significa que alguem confundiu
  -- os dois, e melhor descobrir no INSERT que no primeiro cliente recusado.
  limite_usos integer
             CONSTRAINT cupons_limite_positivo
               CHECK (limite_usos IS NULL OR limite_usos > 0),

  -- Incrementado ATOMICAMENTE pelo checkout (`SET usos = usos + 1 WHERE ...
  -- usos < limite_usos`), dentro da transacao de reserva de estoque — e o
  -- mesmo desenho do FOR UPDATE dos produtos: dois checkouts simultaneos no
  -- ultimo uso serializam e o segundo recebe "Cupom esgotado" ANTES de ser
  -- cobrado. O CHECK de nao-negativo protege a compensacao (falha de gateway
  -- devolve o uso): um decremento a mais viraria erro visivel, nao -1.
  usos     integer NOT NULL DEFAULT 0
             CONSTRAINT cupons_usos_nao_negativo CHECK (usos >= 0),

  ativo    boolean NOT NULL DEFAULT true,

  -- Janela de validade, as duas pontas opcionais — diferente das promocoes,
  -- onde as duas datas sao obrigatorias para valer (semantica herdada do
  -- painel legado). Cupom sem data e o caso comum ("CAFE10 ate acabar").
  inicio_em timestamptz,
  fim_em    timestamptz,

  criado_em     timestamptz NOT NULL DEFAULT now(),
  -- MANTIDA POR QUEM ESCREVE, como em 0004/0005: nao ha trigger de moddatetime
  -- neste schema. Todo UPDATE do servico escreve `atualizado_em = now()` junto.
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- O rastro no pedido. `cupom_codigo` e TEXTO, nao FK, pela mesma licao do
-- carrinho sem FK para produtos (0004): o pedido guarda a fotografia do que
-- foi usado na compra, e apagar ou renomear o cupom amanha nao pode tocar uma
-- venda ja feita — faturamento nao herda o ciclo de vida de uma campanha.
-- `desconto` em reais com 2 casas, como `total` e `frete` da mesma tabela:
-- os tres somam juntos na conferencia de um pedido.
ALTER TABLE canastra.pedidos
  ADD COLUMN cupom_codigo text,
  ADD COLUMN desconto numeric(10,2) NOT NULL DEFAULT 0
    CONSTRAINT pedidos_desconto_nao_negativo CHECK (desconto >= 0);

-- Chave geral fechada, SEM politica nenhuma — e aqui isso e o estado FINAL,
-- nao um adiamento como foi em 0002/0004: cupom so e lido e escrito pelo
-- servico Node, que conecta como dono do banco e nao passa por RLS. O
-- PostgREST nao serve esta tabela a ninguem: a lista de cupons e o mapa de
-- descontos da loja, e a validacao publica ja existe do jeito certo
-- (POST /cupons/validar, que responde so sobre O codigo perguntado).
ALTER TABLE canastra.cupons ENABLE ROW LEVEL SECURITY;

-- Os ALTER DEFAULT PRIVILEGES de 0001 deram a `authenticated` o pacote arwd
-- nesta tabela recem-nascida. Hoje ele esta inerte (RLS sem politica nega
-- tudo), mas a licao de 0003 vale: a primeira politica ampla escrita daqui a
-- seis meses acordaria o GRANT esquecido. Como nenhuma politica e planejada
-- para cupons — o painel fala com o Express, nao com o PostgREST — revogar
-- custa uma linha e fecha a porta nas DUAS camadas. `service_role` fica, como
-- sempre: e credencial de servidor.
REVOKE ALL ON canastra.cupons FROM authenticated;

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0010_cupons')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0011_newsletter_e_abandono
-- ----------------------------------------------------------------------------

-- Newsletter (captacao de e-mail no rodape) e o marcador do lembrete de
-- carrinho abandonado.

-- E-mail e DADO PESSOAL, e a tabela nasce com a postura de 0004: RLS ligada,
-- politica nenhuma, e nenhum GRANT para `anon` — quem escreve aqui e SO o
-- servico Node (POST /newsletter), que conecta como dono do banco. A rota
-- publica responde `{ok:true}` para qualquer e-mail valido, inclusive o ja
-- inscrito, de proposito: uma resposta diferente para "ja existe" deixaria
-- qualquer pessoa testar se um e-mail especifico esta na lista (enumeracao).
CREATE TABLE canastra.newsletter_inscritos (
  id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- O UNIQUE e o que faz o INSERT ... ON CONFLICT DO NOTHING da rota ser a
  -- deduplicacao inteira: inscrever duas vezes nao cria duas linhas nem vira
  -- erro. O CHECK e de FORMATO BASICO (algo@algo.tld, sem espaco) — validar
  -- e-mail "de verdade" por regex e uma guerra perdida; o que este CHECK barra
  -- e lixo obvio ("teste", "a@b") entrando por um caminho que nao passou pela
  -- validacao do servico.
  email  text NOT NULL UNIQUE
           CONSTRAINT newsletter_email_formato
             CHECK (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  -- De onde veio a inscricao ('rodape' hoje; um pop-up ou o checkout amanha).
  -- Serve para medir qual superficie converte — sem coluna, essa pergunta
  -- nunca mais tem resposta retroativa.
  origem text NOT NULL DEFAULT 'rodape',

  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE canastra.newsletter_inscritos ENABLE ROW LEVEL SECURITY;

-- Mesmo fecho de 0010: o pacote arwd que 0001 concede por padrao a
-- `authenticated` esta inerte sob a RLS sem politica, e revogar agora impede
-- que uma politica ampla futura o acorde. Uma lista de e-mails legivel por
-- qualquer token `authenticated` da instancia COMPARTILHADA seria vazamento
-- de dado pessoal em massa.
REVOKE ALL ON canastra.newsletter_inscritos FROM authenticated;

-- O marcador do lembrete de carrinho abandonado: UM lembrete por EPISODIO de
-- abandono.
--
-- A SEMANTICA COMPLETA, porque a coluna sozinha nao conta: NULL = "esta
-- sacola ainda nao foi lembrada"; preenchida = "ja foi". O episodio comeca
-- quando a sacola para (job de src/jobs/carrinhoAbandonado.js) e TERMINA NA
-- COMPRA: o checkout (`limparCarrinho`, PaymentController) apaga os itens e
-- devolve esta coluna a NULL no mesmo gesto. Sem o reset, quem comprou uma
-- vez nunca mais receberia lembrete de sacola nenhuma — "um lembrete por
-- carrinho" e por episodio, nao por cliente para sempre. O ciclo
-- abandona -> lembra -> compra -> abandona de novo -> lembra de novo esta
-- medido em test/f6_cupons.test.js.
--
-- POR QUE UMA COLUNA, e nao uma tabela de envios: a pergunta que o job faz e
-- binaria ("esta sacola ja foi lembrada?") e a resposta precisa ser travavel
-- na MESMA transacao do envio — `UPDATE ... SET lembrete_enviado_em = now()
-- WHERE lembrete_enviado_em IS NULL` com rowCount 0 significando "outra
-- execucao chegou antes". Historico de campanhas e problema de outra tarefa.
--
-- COMO SE MEDE "ABANDONADO", ja que `carrinho_itens` NAO tem timestamp nenhum
-- (0004): pelo `carrinhos.atualizado_em`. Quem o mantem e a RPC
-- `fundir_sacola` (0007), que roda a cada login — a unica escritora do
-- carrinho do servidor nesta fase (a sacola do dia a dia vive no localStorage
-- e so encosta no banco no login e no checkout, que APAGA os itens). Ou seja:
-- carrinho com itens e `atualizado_em` velho = pessoa entrou, fundiu a sacola
-- e nao comprou. E exatamente o abandono que se quer lembrar.
ALTER TABLE canastra.carrinhos
  ADD COLUMN lembrete_enviado_em timestamptz;

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0011_newsletter_e_abandono')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0012_bling
-- ----------------------------------------------------------------------------

-- Bling/NF-e (onda 3G): o rastro do ERP no pedido, e o refresh token rotativo
-- do OAuth na configuracao da loja.
--
-- O gestor opera o fiscal e o estoque no Bling, e vem da Tray, onde pedido
-- aprovado virava pedido de venda + NF-e sozinho. Esta migracao da ao schema o
-- que o servico (src/services/blingPedidos.js) precisa para reproduzir isso:
-- saber SE um pedido ja foi ao Bling (idempotencia), COMO ele esta la, e o que
-- a NF-e emitida devolveu. Tudo NULL por padrao: a integracao nasce desligada
-- (BLING_ATIVO, decisao 5 do plano mestre) e um banco sem Bling nenhum e
-- exatamente igual ao de ontem.

-- `bling_id` e TEXTO, nao inteiro, pela mesma lente de `pagamento_id_mp` (0005):
-- e um identificador OPACO de outro sistema — nao se soma, nao se ordena por
-- valor, e o dia em que o Bling mudar o formato nao pode ser uma migracao aqui.
--
-- `bling_situacao` guarda a ultima situacao conhecida no Bling ('sincronizando'
-- enquanto a criacao esta em voo — e o claim atomico da idempotencia, ver o
-- servico — e depois o que o Bling disser). E cache informativo para o painel,
-- nunca fonte de decisao de dinheiro: quem manda no status da LOJA continua
-- sendo `status`, com o CHECK de 0009.
--
-- `bling_claim_em` e o RELOGIO DO CLAIM, e existe separado de propósito. O
-- corte que desfaz um claim orfao ("faz mais de 10 minutos que alguem disse
-- 'sincronizando' e nunca voltou") precisa de um carimbo que so o claim mexa.
-- `atualizado_em` nao serve: QUALQUER escritor o carimba — o webhook do MP, a
-- mudanca de status pelo painel, a redacao da LGPD. Com ele, um pedido travado
-- em 'sincronizando' cuja linha fosse tocada por outro fluxo teria o relogio
-- do claim zerado sem que o claim tivesse recomecado, e a auto-cura ficaria
-- adiada indefinidamente — o botao do painel responderia "ja esta
-- sincronizando" para sempre.
--
-- Os `nfe_*` sao a fotografia da nota emitida: o id da nota DENTRO do Bling
-- (`nfe_id`, guardado assim que ela e gerada), numero (com serie), chave de
-- acesso (a identidade fiscal do documento, 44 digitos) e o link do DANFE que
-- o Bling publica. Fotografia, como `cupom_codigo` em 0010: a nota e um
-- documento fiscal imutavel — se amanha a conta Bling for outra, o que foi
-- emitido continua registrado aqui.
--
-- `nfe_id` E O QUE SEPARA "GERADA" DE "TRANSMITIDA". A emissao tem dois
-- passos no Bling (gerar a nota a partir do pedido; envia-la a SEFAZ), e o
-- segundo falha sozinho — configuracao fiscal ausente e o caso classico. Sem
-- guardar o id, a nota gerada ficava orfa no Bling e a retentativa geraria
-- OUTRA. Com ele, a retentativa retransmite a MESMA. Quem responde "ja
-- emitida" e `nfe_chave`, que so e gravada depois da transmissao aceita.
ALTER TABLE canastra.pedidos
  ADD COLUMN bling_id              text,
  ADD COLUMN bling_situacao        text,
  ADD COLUMN bling_claim_em        timestamptz,
  ADD COLUMN bling_sincronizado_em timestamptz,
  ADD COLUMN nfe_id                text,
  ADD COLUMN nfe_numero            text,
  ADD COLUMN nfe_chave             text,
  ADD COLUMN nfe_url               text;

-- A trava que impede um MESMO pedido de venda do Bling de ser dado como
-- origem de dois pedidos da loja: o segundo estoura 23505 em vez de virar um
-- vinculo cruzado em silencio (dois pedidos apontando para a mesma venda, e a
-- conferencia do gestor sem saber qual e qual).
--
-- ATENCAO AO QUE ELE **NAO** FAZ: ele nao impede duas vendas serem criadas no
-- Bling para o MESMO pedido da loja — nesse caso os dois `bling_id` sao
-- diferentes e o indice aceita os dois de bom grado. Contra o dobro no ERP
-- quem trabalha e o claim do servico (`bling_situacao = 'sincronizando'` +
-- `bling_claim_em`), o prazo agregado que aborta antes de o claim envelhecer,
-- e a busca por `numeroLoja` no Bling antes de criar quando o claim foi
-- herdado de um processo morto. PARCIAL (WHERE ... IS NOT NULL)
-- como os indices de 0005: quase todo pedido vive com bling_id nulo (integracao
-- desligada, ou pedido anterior a ela) e um indice total recusaria o segundo
-- NULL... nao recusa (NULL nunca conflita), mas indexaria toda a tabela para
-- proteger um punhado de linhas.
CREATE UNIQUE INDEX pedidos_bling_id_idx
  ON canastra.pedidos (bling_id)
  WHERE bling_id IS NOT NULL;

-- O refresh token do OAuth do Bling e ROTATIVO: cada renovacao INVALIDA o token
-- usado e devolve um novo. Guarda-lo so no .env mataria a integracao no
-- primeiro restart depois da primeira renovacao — o processo subiria com um
-- token ja queimado e nenhum log de renovacao explicaria o 400 do Bling. Por
-- isso ele mora no banco, atualizado a cada renovacao pelo servico
-- (src/services/blingClient.js); a env BLING_REFRESH_TOKEN vira so a semente
-- da primeira autorizacao. Em `config_loja` porque e configuracao de UMA loja,
-- linha unica — criar tabela nova para um campo seria cerimonia sem ganho.
ALTER TABLE canastra.config_loja
  ADD COLUMN bling_refresh_token text;

-- E AQUI ESTA O PONTO DE SEGURANCA DA MIGRACAO: `config_loja` e PUBLICA por
-- desenho — GRANT SELECT para `anon` (0005), politica de leitura USING (true)
-- (0006) — porque banner, titulo e piso de frete gratis SAO informacao publica.
-- Um segredo em coluna nova desta tabela nasceria legivel por qualquer chave
-- anonima da instancia via PostgREST, e refresh token do Bling e credencial
-- que emite nota fiscal e mexe em estoque.
--
-- A tranca e a mesma do `custo` em `produtos` (0006): privilegio de COLUNA.
-- Revoga-se o privilegio de tabela e devolve-se a lista explicita — todas as
-- colunas MENOS `bling_refresh_token`. O UPDATE/INSERT de `authenticated`
-- (0006) vira lista tambem: a politica `config_loja_admin_escreve` decide a
-- LINHA, o GRANT decide as COLUNAS, e nem o admin escreve o token pelo
-- PostgREST — quem o escreve e SO o servico Node, que conecta como dono do
-- banco e nao passa por GRANT nenhum.
--
-- Consequencia conhecida, a mesma medida em 0006 para `produtos`: `select=*`
-- (e `RETURNING *`) de PostgREST nesta tabela passa a responder 42501. Medido
-- que ninguem faz isso hoje: vitrine e painel leem a configuracao pelo Express
-- (`GET /config`), que projeta as colunas pelo nome.
REVOKE SELECT ON canastra.config_loja FROM anon, authenticated;
REVOKE INSERT, UPDATE ON canastra.config_loja FROM authenticated;

GRANT SELECT (id, banner_desktop, banner_mobile, titulo_site, whatsapp,
              barra_de_aviso, frete_gratis_minimo_centavos, atualizado_em)
  ON canastra.config_loja TO anon, authenticated;

GRANT INSERT (id, banner_desktop, banner_mobile, titulo_site, whatsapp,
              barra_de_aviso, frete_gratis_minimo_centavos, atualizado_em),
      UPDATE (banner_desktop, banner_mobile, titulo_site, whatsapp,
              barra_de_aviso, frete_gratis_minimo_centavos, atualizado_em)
  ON canastra.config_loja TO authenticated;

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0012_bling')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0013_redacao_lgpd
-- ----------------------------------------------------------------------------

-- LGPD: redação dos dados do titular nos pedidos.
--
-- POR QUE ESTA MIGRACAO EXISTE
-- 0005 deixou a divida escrita no proprio cabecalho de `pedidos`: o ON DELETE
-- SET NULL preserva a VENDA quando o cliente e apagado (faturamento e registro
-- fiscal), mas `endereco_json` e uma fotografia congelada — nome, CPF, telefone
-- e endereco completo sobrevivem intactos no pedido orfao. "Apagar o cliente"
-- NUNCA foi apagar os dados da pessoa, e um pedido de exclusao de titular
-- (LGPD art. 18, IV/VI) nao era atendivel. Esta migracao cria o passo que
-- faltava: redigir o que identifica a pessoa, preservando o que a obrigacao
-- fiscal e a estatistica de vendas pedem.
--
-- O QUE FICA E O QUE SAI, E POR QUE A LINHA E ESSA
--   FICA  cidade + UF ........ estatistica de venda por regiao, nao identifica
--                              uma pessoa sozinha;
--   FICA  prefixo do CEP ..... 3 digitos + 'xxxxx': regiao de distribuicao,
--                              nunca a porta da casa (o CEP completo, junto do
--                              numero, e um endereco);
--   FICA  total/status/itens de produto ... a VENDA, que 0005 preserva de
--                              proposito — o que se vendeu, por quanto, quando;
--   SAI   todo o resto do endereco, por WHITELIST e nao por denylist: chave
--                              que a redacao nao conhece (um campo novo do
--                              checkout de amanha) vira "[redigido]" em vez de
--                              vazar por omissao. Denylist envelhece.
--
-- OS DOIS VOCABULARIOS SAO REAIS, nao paranoia: a vitrine atual grava chaves em
-- ingles (`zip_code`, `street`, `city` — frontend/lib/sacola/checkout.ts), e o
-- legado/loja anterior gravava em portugues (`nome`, `cpf`, `rua` — o exemplo
-- literal do cabecalho de 0005). A whitelist cobre os dois; o que nao esta nela
-- e redigido de qualquer forma.
--
-- O LIMITE CONHECIDO, ESCRITO PARA NAO SE PERDER: pedido JA orfao (user_id
-- NULL) e IRREDIGIVEL por titular — o vinculo se foi, nao ha como saber de quem
-- ele era. Por isso a redacao TEM de acontecer ANTES ou JUNTO da exclusao da
-- conta (conta.routes.js chama esta funcao antes do DELETE no GoTrue e aborta a
-- exclusao se ela falhar), e por isso o parametro NULL e ERRO e nao no-op — um
-- no-op silencioso naquele fluxo "redigiria" nada e fabricaria o orfao
-- irredigivel para sempre. Orfaos pre-existentes (criados antes desta migracao)
-- so tem redacao MANUAL, em massa: o SQL pronto esta em
-- docs/seguranca-dados-pessoais.md.

-- NULL = nunca redigido; preenchida = quando a redacao aconteceu. E o carimbo
-- de auditoria do atendimento ao titular (prova de que o pedido do art. 18 foi
-- atendido, e quando) e o que torna a funcao abaixo idempotente: so pedidos
-- com a coluna NULL sao alvo, entao repetir a chamada nao move o carimbo da
-- PRIMEIRA redacao.
ALTER TABLE canastra.pedidos
  ADD COLUMN redigido_em timestamptz;

/**
 * POR QUE UMA FUNCAO NO BANCO, e nao SQL solto no Node: a redacao de todos os
 * pedidos de um titular precisa ser ATOMICA (redigir metade e falhar deixaria
 * um estado que nenhum retry entende) e precisa ser testavel isolada do
 * Express. Uma funcao e as duas coisas de graca.
 *
 * NAO E SECURITY DEFINER, e a decisao e a mesma medida em 0007: quem chama e o
 * pool do Express (o dono do banco, isento de RLS nas proprias tabelas) ou
 * `service_role` (BYPASSRLS + ALL em tabelas de `canastra`, default privileges
 * de 0001). Nao ha privilegio faltando a emprestar — DEFINER aqui so
 * acrescentaria a superficie de bypass que 0006 gasta o arquivo inteiro
 * fechando. O teste f7_lgpd.test.js afirma `prosecdef = false` no catalogo.
 *
 * `SET search_path` vai mesmo assim, pelo motivo pratico de 0007: todo nome no
 * corpo esta qualificado, e o SET garante que continue resolvendo igual se um
 * nome novo entrar sem qualificacao.
 *
 * NAO E STRICT, de proposito e com consequencia grave se mudar: STRICT faria
 * `redigir_dados_do_titular(NULL)` devolver NULL SEM ENTRAR NO CORPO — um
 * no-op silencioso exatamente no fluxo de exclusao de conta, que apagaria a
 * conta sem redigir nada. O caso NULL e tratado dentro, como ERRO.
 *
 * RETORNA a contagem de pedidos redigidos: o endpoint de atendimento a titular
 * responde com ela, e "0" depois de uma primeira chamada e a prova barata de
 * idempotencia nos testes.
 */
CREATE FUNCTION canastra.redigir_dados_do_titular(alvo_user_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path = canastra, pg_temp
AS $redigir$
DECLARE
  pedidos_redigidos integer;
BEGIN
  /**
   * NULL e ERRO, nunca "nenhum pedido". Ver o cabecalho: pedido orfao perdeu o
   * vinculo com o titular, entao nao existe "redigir os pedidos do titular
   * NULL" — existiria "redigir TODOS os orfaos da tabela", que e outra
   * operacao, manual e deliberada (docs/seguranca-dados-pessoais.md).
   *
   * ERRCODE 22004 (null_value_not_allowed): e o codigo que um STRICT
   * implicitamente "usaria" se recusasse em vez de calar — quem chama trata um
   * caso de contrato, nao um P0001 generico.
   */
  IF alvo_user_id IS NULL THEN
    RAISE EXCEPTION 'A redação exige um titular: pedido órfão não tem redação por titular.'
      USING ERRCODE = 'null_value_not_allowed',
            HINT = 'Redija ANTES ou JUNTO da exclusão da conta — depois dela o vínculo já se foi.';
  END IF;

  UPDATE canastra.pedidos p
     SET
       /**
        * O endereco, por WHITELIST. `jsonb_each` + `jsonb_object_agg` reescreve
        * o objeto chave a chave:
        *   - cidade/UF passam intactas (as duas grafias);
        *   - CEP vira prefixo: so os digitos, 3 primeiros, resto 'xxxxx'. Um
        *     CEP impresentavel (vazio, lixo) degrada para 'xxxxx' — perde a
        *     estatistica, nunca vaza o dado;
        *   - TODA outra chave vira "[redigido]", inclusive as que ainda nao
        *     existem.
        *
        * O COALESCE para '{}' nao e enfeite: `jsonb_object_agg` sobre um objeto
        * VAZIO agrega zero linhas e devolve NULL — e um endereco que era `{}`
        * viraria NULL, mudando de tipo aos olhos de quem le.
        *
        * Endereco NULL (ou JSON null) fica como esta: nao ha dado a redigir e
        * inventar um objeto onde nunca houve um mentiria sobre o pedido.
        * Endereco que nao e objeto (escalar gravado por algum caminho torto)
        * vira "[redigido]" inteiro: nao da para saber o que ha dentro de uma
        * string livre, entao ela sai por inteiro.
        */
       endereco_json = CASE
         WHEN p.endereco_json IS NULL OR jsonb_typeof(p.endereco_json) = 'null'
           THEN p.endereco_json
         WHEN jsonb_typeof(p.endereco_json) <> 'object'
           THEN to_jsonb('[redigido]'::text)
         ELSE (
           SELECT COALESCE(
             jsonb_object_agg(
               e.chave,
               CASE
                 WHEN lower(e.chave) IN ('cidade', 'city')          THEN e.valor
                 WHEN lower(e.chave) IN ('uf', 'estado', 'state')   THEN e.valor
                 WHEN lower(e.chave) IN ('cep', 'zip_code', 'zipcode', 'postal_code')
                   THEN to_jsonb(
                     left(regexp_replace(COALESCE(e.valor #>> '{}', ''), '\D', '', 'g'), 3)
                     || 'xxxxx'
                   )
                 ELSE to_jsonb('[redigido]'::text)
               END
             ),
             '{}'::jsonb
           )
           FROM jsonb_each(p.endereco_json) AS e(chave, valor)
         )
       END,
       /**
        * Os itens, por DENYLIST — e aqui a denylist e a escolha certa, nao a
        * preguicosa: o formato real gravado pelo checkout (validatedItems em
        * PaymentController) e SO produto — product_id, name (nome do PRODUTO,
        * que e registro fiscal do que se vendeu, nunca dado pessoal), image,
        * price, quantity, size e dimensoes. Uma whitelist congelaria essa
        * lista e apagaria o proximo campo de PRODUTO que o checkout gravasse —
        * destruindo registro fiscal, que e exatamente o que 0005 preserva. A
        * denylist aqui e defensiva contra formato historico/futuro que carregue
        * dado pessoal DENTRO do item; hoje ela nao encontra nada.
        *
        * So listas sao processadas: e o unico formato que algum caminho de
        * escrita da loja produz (JSON.stringify de um array, sempre). NULL e
        * nao-lista ficam como estao.
        */
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
               -- A ordem dos itens e parte do registro da venda; sem o ORDER BY
               -- a agregacao teria licenca para embaralha-la.
               ORDER BY item.ordem
             ),
             '[]'::jsonb
           )
           FROM jsonb_array_elements(p.itens) WITH ORDINALITY AS item(valor, ordem)
         )
       END,
       redigido_em = now(),
       -- Regra de 0005: nao ha trigger de moddatetime, quem escreve carimba.
       atualizado_em = now()
   WHERE p.user_id = alvo_user_id
     -- A idempotencia inteira esta neste predicado: pedido ja redigido nao e
     -- alvo de novo, entao repetir a chamada devolve 0 e o carimbo da PRIMEIRA
     -- redacao (a que atendeu o titular) fica intacto para a auditoria.
     AND p.redigido_em IS NULL;

  GET DIAGNOSTICS pedidos_redigidos = ROW_COUNT;
  RETURN pedidos_redigidos;
END;
$redigir$;

/**
 * `proacl` nasce nulo = EXECUTE para PUBLIC, e PUBLIC inclui `anon`. O REVOKE
 * primeiro e a lista explicita depois deixam escrito quem chama.
 *
 * SO `service_role`, e a ausencia dos outros dois e deliberada:
 *   · `authenticated` NAO executa: redacao e gesto de SERVIDOR — o fluxo de
 *     exclusao de conta e o atendimento a titular pelo admin, ambos no Express
 *     (que conecta como dono do banco e nem precisa de GRANT). Dar EXECUTE a
 *     `authenticated` deixaria qualquer token da instancia COMPARTILHADA
 *     disparar redacao... de nada (a funcao so alcanca pedidos do proprio
 *     user_id se combinada com RLS? NAO — ela e INVOKER mas recebe o alvo por
 *     PARAMETRO, entao um token qualquer apontaria para o user_id que quisesse
 *     e apagaria dados de endereco de pedidos ALHEIOS. E destruicao de dado
 *     como servico, e fica fechada).
 *   · `anon` idem, com menos cerimonia ainda.
 *
 * NOTA: o pool do Express conecta como o DONO do banco (docs/producao.md §5.1),
 * que executa a propria funcao sem GRANT nenhum — o GRANT a `service_role`
 * existe para o caminho PostgREST/scripts de operacao, nao para o Express.
 */
REVOKE EXECUTE ON FUNCTION canastra.redigir_dados_do_titular(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canastra.redigir_dados_do_titular(uuid) TO service_role;

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0013_redacao_lgpd')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0014_avaliacoes
-- ----------------------------------------------------------------------------

-- Avaliacoes de produto: quem RECEBEU o cafe avalia; o resto le.
--
-- O DESENHO EM UMA FRASE: a fronteira e a RLS (a vitrine fala PostgREST
-- direto, sem servico no meio), e a pergunta "essa pessoa pode avaliar este
-- cafe?" e respondida pelo proprio banco — pedido `entregue` do chamador cujo
-- `itens` contem o SKU. Nenhum claim, nenhum campo vindo do navegador decide
-- nada alem de nota, titulo e texto.
--
-- POR QUE `sku` TEXTO, E NAO FK PARA `produtos`
-- A PDP agrupa por LINHA de cafe, e uma linha tem varios produtos no banco
-- (um por peso/pacote) casados com o catalogo editorial pelo `produtos.sku`
-- (`frontend/lib/catalogo/repositorio.ts`). O SKU e o vocabulario comum das
-- duas pontas — e, como no carrinho (0004) e no cupom do pedido (0010), a
-- avaliacao e uma fotografia: retirar um produto do catalogo nao pode apagar
-- as opinioes ja publicadas sobre ele.
--
-- POR QUE `nome_exibicao` CONGELADO NO INSERT
-- `user_id` e ON DELETE SET NULL (a avaliacao publicada sobrevive a exclusao
-- da conta, como o pedido em 0005). Exibir o nome via join com `clientes`
-- faria toda avaliacao de conta apagada aparecer sem autor — e um join da
-- vitrine com uma tabela de dado pessoal seria superficie a mais. A trigger
-- abaixo copia o nome UMA vez, no INSERT, e o navegador nao alcanca a coluna.

CREATE TABLE canastra.avaliacoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SET NULL, nunca CASCADE: apagar a conta nao apaga a prova social da loja.
  -- O que a LGPD manda apagar e o DADO PESSOAL — e o unico aqui e o nome, que
  -- o fluxo de exclusao pode redigir via service_role se o titular pedir.
  user_id       uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,

  -- Preenchida SEMPRE pela trigger `avaliacoes_congelar_nome`, nunca por quem
  -- insere (a coluna fica fora do GRANT de INSERT la embaixo): o cliente nao
  -- assina como outra pessoa, e o nome nao depende do vinculo continuar vivo.
  nome_exibicao text NOT NULL,

  sku           text NOT NULL,

  nota          integer NOT NULL
                  CONSTRAINT avaliacoes_nota_valida CHECK (nota BETWEEN 1 AND 5),

  -- Limites de tamanho no BANCO, nao so no formulario: o PostgREST aceita o
  -- que o GRANT deixar, e um texto de 2 MB numa coluna lida pela PDP inteira
  -- e um problema de todo mundo. 23514 citando a constraint e a recusa certa.
  --
  -- E O PISO TAMBEM: "nao informado" e NULL, nunca `''` nem `'   '`. A vitrine
  -- decide se renderiza o titulo/texto por VERACIDADE (`avaliacao.titulo ?`),
  -- e uma string de espacos e truthy — vira um <p> vazio empurrando o layout
  -- da PDP sem nada dentro. O formulario ja normaliza (`.trim() || null` em
  -- lib/avaliacoes/avaliacoes.ts), mas o formulario nao e a fronteira: o
  -- PostgREST aceita o INSERT que o GRANT permitir, de qualquer cliente. Aqui
  -- e onde a regra vale para todo mundo.
  --
  -- `~ '[^[:space:]]'` ("tem ao menos um caractere que nao e espaco") E NAO
  -- `btrim(x) <> ''`, e a diferenca importa: o `btrim` de um argumento so tira
  -- ESPACOS — `btrim(E' \n\t ')` devolve `E'\n\t'`, que nao e vazio e passaria
  -- pela constraint. Um texto de quebras de linha renderiza o mesmo paragrafo
  -- vazio que a regra existe para impedir. A classe POSIX cobre espaco, tab,
  -- nova linha, CR, FF e VT de uma vez, e diz em SQL a frase que se quer.
  titulo        text
                  CONSTRAINT avaliacoes_titulo_tamanho
                    CHECK (titulo IS NULL OR char_length(titulo) <= 80)
                  CONSTRAINT avaliacoes_titulo_nao_vazio
                    CHECK (titulo IS NULL OR titulo ~ '[^[:space:]]'),
  texto         text
                  CONSTRAINT avaliacoes_texto_tamanho
                    CHECK (texto IS NULL OR char_length(texto) <= 2000)
                  CONSTRAINT avaliacoes_texto_nao_vazio
                    CHECK (texto IS NULL OR texto ~ '[^[:space:]]'),

  -- `pendente` -> moderacao -> `aprovada` (publica) ou `oculta`. O DEFAULT e
  -- a UNICA porta de entrada: `status` esta fora do GRANT de INSERT, entao
  -- nenhuma avaliacao nasce publicada por conta propria.
  status        text NOT NULL DEFAULT 'pendente'
                  CONSTRAINT avaliacoes_status_valido
                    CHECK (status IN ('pendente', 'aprovada', 'oculta')),

  criado_em     timestamptz NOT NULL DEFAULT now(),
  -- Escrita pelo painel JUNTO com o status (nao ha trigger de moddatetime
  -- neste schema — a regra de 0005 vale aqui tambem).
  moderado_em   timestamptz,

  -- Uma avaliacao por cliente por cafe. Com `user_id` NULL (conta apagada) o
  -- indice trata cada ausencia como distinta (NULLS DISTINCT, o padrao), que
  -- e o desejado: duas contas apagadas nao colidem entre si.
  CONSTRAINT avaliacoes_uma_por_cafe UNIQUE (user_id, sku)
);

-- A consulta da PDP: aprovadas de uma lista de SKUs, mais novas primeiro.
CREATE INDEX avaliacoes_aprovadas_idx
  ON canastra.avaliacoes (sku, criado_em DESC)
  WHERE status = 'aprovada';

/**
 * "Quem esta pedindo RECEBEU este cafe?"
 *
 * SECURITY DEFINER pelo mesmo motivo de `eh_cliente()`/`eh_admin()` (0006):
 * a funcao le `pedidos`, que esta sob RLS, e e chamada DE DENTRO de uma
 * politica — como INVOKER ela enxergaria so o que a politica de `pedidos`
 * mostra ao chamador (que aqui ate bastaria: o dono le os proprios pedidos),
 * mas herdaria em silencio qualquer estreitamento futuro daquela politica.
 * `SET row_security = off` tira a mudez do modo de falha com FORCE, como la.
 * `SET search_path` obrigatorio em DEFINER; `pg_temp` por ultimo; `auth.uid()`
 * qualificado porque `auth` nao esta no caminho.
 *
 * O FORMATO DE `itens` E O DO CHECKOUT (PaymentController.validatedItems):
 * `[{product_id, name, image, price, quantity, size, weight, ...}]` — NAO ha
 * chave `sku` nos itens. O SKU e resolvido pelo join com `canastra.produtos`
 * via `product_id`. O preco disso esta escrito: produto APAGADO do catalogo
 * deixa de ser avaliavel (o join nao casa mais), o que e aceitavel — a PDP
 * dele tambem ja nao existe.
 *
 * DEFESAS, as duas medidas em test/f7_avaliacoes.test.js:
 *   - `jsonb_typeof(...) = 'array'`: `itens` nulo ou um objeto legado nao
 *     pode estourar 22023 ("cannot extract elements from a scalar") dentro
 *     de TODO INSERT da tabela — vira simplesmente zero linhas.
 *   - `pr.produto_id::text = item->>'product_id'`: a comparacao e em texto
 *     para um `product_id` malformado num pedido antigo nao virar 22P02 de
 *     cast de uuid no meio da politica.
 *
 * `alvo_sku` NULL responde FALSE (o EXISTS nao casa), nunca erro — e por isso
 * a funcao nao e STRICT: STRICT devolveria NULL, que o WITH CHECK trata igual
 * a FALSE, mas um boolean honesto poupa o proximo leitor da tabela-verdade.
 */
CREATE FUNCTION canastra.pode_avaliar(alvo_sku text) RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = canastra, pg_temp
  SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM canastra.pedidos p
     CROSS JOIN LATERAL jsonb_array_elements(
       CASE WHEN jsonb_typeof(p.itens) = 'array' THEN p.itens
            ELSE '[]'::jsonb END
     ) AS item
      JOIN canastra.produtos pr
        ON pr.produto_id::text = item->>'product_id'
     WHERE p.user_id = auth.uid()
       AND p.status = 'entregue'
       AND pr.sku = alvo_sku
  )
$$;

-- `proacl` nasce nulo (EXECUTE para PUBLIC): o REVOKE primeiro e a lista
-- explicita depois, como em 0006/0008. `anon` ENTRA na lista pela regra de
-- 0006 — hoje nenhuma politica que ele alcance chama a funcao (a leitura
-- publica e `status = 'aprovada'` puro), mas o dia em que uma chamar, a falta
-- de EXECUTE seria 42501 na vitrine parecendo recusa de politica.
REVOKE EXECUTE ON FUNCTION canastra.pode_avaliar(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canastra.pode_avaliar(text)
  TO anon, authenticated, service_role;

/**
 * Congela o nome no INSERT — SEMPRE, sobrescrevendo qualquer valor que tenha
 * chegado (o GRANT ja impede o navegador de mandar a coluna; a trigger cobre
 * os caminhos que nao passam pelo GRANT, como o service_role e o proprio
 * dono do banco num INSERT de manutencao).
 *
 * SECURITY DEFINER porque le `canastra.clientes`, que esta sob RLS, e o
 * insersor comum (authenticated) so enxerga a PROPRIA linha — o que ate
 * bastaria (a politica de INSERT exige `user_id = auth.uid()`), mas o DEFINER
 * desacopla a trigger da politica de leitura de `clientes`, que e a mesma
 * licao do `pode_avaliar` acima. `search_path` fixo, como manda 0006.
 *
 * O RAISE de 42501 cobre o insersor privilegiado que aponta para um uid sem
 * cadastro: sem ele o sintoma seria 23502 na coluna `nome_exibicao`, uma
 * mensagem sobre NOT NULL que manda procurar o erro no lugar errado. Para o
 * `authenticated` este ramo e inalcancavel — o WITH CHECK com `eh_cliente()`
 * ja teria recusado com o MESMO codigo.
 *
 * `SET row_security = off` PELO MOTIVO DE 0006, e nao por enfeite: e
 * exatamente o RAISE acima que cria a mudez. Com `FORCE ROW LEVEL SECURITY`
 * ligado em `clientes`, o dono deixa de ser isento, nenhuma politica daquela
 * tabela e `TO` dono, o SELECT volta ZERO linhas — e toda avaliacao da loja,
 * de qualquer cliente cadastrado, passa a ser recusada com "So quem tem
 * cadastro nesta loja pode avaliar.". Uma frase que mente com confianca e
 * manda procurar o erro no cadastro do cliente. Com o SET, a mesma situacao
 * responde 42501 "query would be affected by row-level security policy for
 * table clientes", que nomeia a tabela e a causa. No caminho saudavel e um
 * no-op (o dono ja e isento). E o contrario de 0008, onde a ausencia e
 * deliberada porque la o FORCE ja falharia sozinho, alto e nomeando a tabela.
 */
CREATE FUNCTION canastra.avaliacoes_congelar_nome() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = canastra, pg_temp
  SET row_security = off
AS $congelar_nome$
DECLARE
  nome_do_cliente text;
BEGIN
  SELECT c.nome INTO nome_do_cliente
    FROM canastra.clientes c
   WHERE c.user_id = NEW.user_id;

  IF nome_do_cliente IS NULL THEN
    RAISE EXCEPTION 'Só quem tem cadastro nesta loja pode avaliar.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  NEW.nome_exibicao := nome_do_cliente;
  RETURN NEW;
END;
$congelar_nome$;

REVOKE EXECUTE ON FUNCTION canastra.avaliacoes_congelar_nome() FROM PUBLIC;

CREATE TRIGGER avaliacoes_congela_nome
  BEFORE INSERT ON canastra.avaliacoes
  FOR EACH ROW
  EXECUTE FUNCTION canastra.avaliacoes_congelar_nome();

/* ------------------------------------------------------------------------- *
 * Privilegios: REVOKE do pacote de 0001, GRANTs por coluna
 * ------------------------------------------------------------------------- */

-- 0001 deu `arwd` de tabela a `authenticated` por default. Aqui o recorte e
-- por COLUNA nas tres operacoes, entao o pacote sai inteiro e volta so o que
-- cada papel precisa. `service_role` nao e tocado: credencial de servidor.
REVOKE ALL ON canastra.avaliacoes FROM anon, authenticated;

-- LEITURA. `anon` NAO recebe `user_id` nem `moderado_em`: o visitante nao tem
-- por que saber o uuid de quem avaliou (linkabilidade gratuita entre a
-- avaliacao e as outras tabelas da instancia) nem o carimbo interno de
-- moderacao. O preco e o mesmo do `custo` em 0006: um `select=*` de `anon`
-- responde 42501 em vez de dados — barulhento, nunca vazado — e a vitrine
-- lista colunas explicitas. `authenticated` le a tabela inteira: o dono
-- filtra as SUAS por `user_id`, e o painel do admin modera com tudo a vista.
GRANT SELECT (id, sku, nota, titulo, texto, nome_exibicao, status, criado_em)
  ON canastra.avaliacoes TO anon;
GRANT SELECT ON canastra.avaliacoes TO authenticated;

-- ESCRITA DO CLIENTE: so o que e dele. Fora da lista, e de proposito:
--   `status` ........ nasceria 'aprovada' por auto-servico;
--   `nome_exibicao` .. assinatura e da trigger;
--   `id`/`criado_em` . defaults;
--   `moderado_em` .... carimbo do painel.
GRANT INSERT (user_id, sku, nota, titulo, texto)
  ON canastra.avaliacoes TO authenticated;

-- MODERACAO: o mesmo desenho de `pedidos` em 0006 — a politica diz QUAL linha
-- (eh_admin), o GRANT diz QUAIS colunas. O dono NAO edita a avaliacao depois
-- de criada (decisao de simplicidade da onda 3I): nao ha politica de UPDATE
-- de dono, entao este GRANT so ganha vida nas maos de um admin.
GRANT UPDATE (status, moderado_em) ON canastra.avaliacoes TO authenticated;

-- DELETE fica sem GRANT e sem politica: remover avaliacao e gesto de
-- atendimento (service_role, que tem BYPASSRLS e o ALL de 0001), nao um
-- clique de navegador — nem do admin, que OCULTA em vez de apagar.

/* ------------------------------------------------------------------------- *
 * Politicas
 * ------------------------------------------------------------------------- */

ALTER TABLE canastra.avaliacoes ENABLE ROW LEVEL SECURITY;

-- A vitrine (logada ou nao) le o que passou pela moderacao. ATENCAO no
-- consumidor logado: as politicas se somam com OR, entao um cliente ve tambem
-- as proprias pendentes — a listagem publica da PDP FILTRA `status=eq.aprovada`
-- na consulta para nao misturar as duas coisas.
CREATE POLICY avaliacoes_aprovadas_publicas ON canastra.avaliacoes
  FOR SELECT TO anon, authenticated
  USING (status = 'aprovada');

-- Regra 2 de 0006: dono e `eh_cliente() AND user_id = auth.uid()`, nunca a
-- igualdade sozinha. E assim que a pessoa acompanha a propria avaliacao
-- enquanto pendente (e ve que uma foi ocultada, em vez de "sumiu").
CREATE POLICY avaliacoes_dono_le ON canastra.avaliacoes
  FOR SELECT TO authenticated
  USING (canastra.eh_cliente() AND user_id = auth.uid());

CREATE POLICY avaliacoes_admin_le ON canastra.avaliacoes
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());

-- A porta de entrada, com as tres condicoes somadas:
--   eh_cliente() ......... token estrangeiro da instancia compartilhada nao
--                          planta linha aqui (Regra 2 de 0006);
--   user_id = auth.uid() . ninguem avalia EM NOME de outro uid;
--   pode_avaliar(sku) .... so quem tem pedido `entregue` com o cafe.
CREATE POLICY avaliacoes_cliente_envia ON canastra.avaliacoes
  FOR INSERT TO authenticated
  WITH CHECK (
    canastra.eh_cliente()
    AND user_id = auth.uid()
    AND canastra.pode_avaliar(sku)
  );

-- Moderar e mudar linha inteira? NAO — o GRANT de coluna acima ja recorta
-- para (status, moderado_em). As duas camadas juntas sao a regra completa,
-- exatamente como `pedidos_admin_atualiza` + GRANT de coluna em 0006.
CREATE POLICY avaliacoes_admin_modera ON canastra.avaliacoes
  FOR UPDATE TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0014_avaliacoes')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0015_assinaturas
-- ----------------------------------------------------------------------------

-- Clube da Canastra — assinaturas recorrentes (Onda 3J do plano mestre).
--
-- Uma linha = uma assinatura de UM cafe, com TUDO que a cobranca recorrente
-- precisa CONGELADO na adesao: sku, quantidade, preco e endereco. O Mercado
-- Pago (preapproval) cobra um valor fixo por ciclo e nao ha checkout a cada
-- envio, entao o pedido que cada cobranca gera nao pode depender do catalogo
-- do dia — depende desta fotografia. Reajustar o preco no painel muda as
-- assinaturas NOVAS; as vivas seguem no valor da adesao, que e o que os
-- termos de uso prometem ("preco travado").

CREATE TABLE canastra.assinaturas (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ON DELETE SET NULL, como em `pedidos` (0005) e pela mesma razao: a
  -- assinatura e historico comercial e a cobranca pode ja ter acontecido —
  -- apagar o cliente (LGPD) nao pode apagar o registro do que foi vendido.
  -- Uma assinatura orfa e cancelada no MP pelo fluxo de exclusao de conta;
  -- aqui ela apenas perde o dono.
  user_id  uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,

  -- O SKU do produto no catalogo (`canastra.produtos.sku`), TEXTO e nao FK —
  -- a mesma licao do carrinho (0004) e do cupom no pedido (0010): fotografia
  -- nao herda o ciclo de vida do catalogo. Um produto descontinuado nao pode
  -- derrubar a assinatura de quem ja assina; quem decide encerra-la e o
  -- gestor, cancelando no painel/MP.
  sku      text NOT NULL,

  quantidade integer NOT NULL DEFAULT 1
             CONSTRAINT assinaturas_quantidade_positiva CHECK (quantidade > 0),

  -- As tres frequencias que a loja vende (estetica.md §7.4). CHECK fechado de
  -- proposito: o preapproval e criado com `frequency` = este numero, e um 20
  -- gravado por engano viraria uma cobranca que nenhuma tela oferece.
  frequencia_dias integer NOT NULL
             CONSTRAINT assinaturas_frequencia_valida
               CHECK (frequencia_dias IN (15, 30, 45)),

  -- O valor de CADA cobranca, em CENTAVOS e inteiro (regra da casa para
  -- dinheiro de decisao — 0009/0010), JA com os 10% do Clube:
  -- Math.round(preco_reais * 0.9 * 100) * quantidade, calculado no SERVIDOR
  -- na adesao. E o `transaction_amount` do preapproval e o `total` de cada
  -- pedido gerado. Nunca recalculado a partir do catalogo.
  preco_centavos integer NOT NULL
             CONSTRAINT assinaturas_preco_positivo CHECK (preco_centavos > 0),

  -- Entrega recorrente exige endereco proprio: o de `canastra.enderecos` e o
  -- "endereco atual" do cliente e muda com a proxima compra avulsa — a
  -- assinatura entrega onde foi contratada ate o cliente dizer o contrario.
  -- Mesmo formato do `endereco_json` de pedidos (zip_code, street, ...).
  endereco_json jsonb NOT NULL,

  -- O id do preapproval no Mercado Pago. NULL enquanto a ida ao MP nao
  -- respondeu (a linha nasce antes, para o `external_reference` existir);
  -- UNIQUE porque e por ele que o webhook de assinaturas acha a linha, e duas
  -- linhas com o mesmo preapproval seriam dois pedidos por cobranca.
  preapproval_id text UNIQUE,

  -- Vocabulario proprio, em portugues, traduzido do MP pelo servico:
  --   pending -> pendente (criada, cliente ainda nao autorizou no MP)
  --   authorized -> ativa | paused -> pausada | cancelled -> cancelada
  status   text NOT NULL DEFAULT 'pendente'
             CONSTRAINT assinaturas_status_valido
               CHECK (status IN ('pendente', 'ativa', 'pausada', 'cancelada')),

  criado_em     timestamptz NOT NULL DEFAULT now(),
  -- MANTIDA POR QUEM ESCREVE, como em 0004/0005/0010: nao ha trigger de
  -- moddatetime neste schema. Todo UPDATE do servico escreve now() junto.
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  cancelada_em  timestamptz
);

-- A consulta da conta do cliente ("minhas assinaturas") e a do webhook (por
-- preapproval_id, ja coberto pelo UNIQUE).
CREATE INDEX assinaturas_cliente_idx ON canastra.assinaturas (user_id);

/* --------------------------------------------------------------------------
 * RLS — dono le as proprias, admin le todas, SO o servico escreve
 * -------------------------------------------------------------------------- */

ALTER TABLE canastra.assinaturas ENABLE ROW LEVEL SECURITY;

-- Regra 2 de 0006: dono e `eh_cliente() AND user_id = auth.uid()`, nunca a
-- igualdade sozinha — um token de outro projeto da instancia compartilhada
-- nao pode virar "dono" de nada aqui dentro.
CREATE POLICY assinaturas_dono_le ON canastra.assinaturas
  FOR SELECT TO authenticated
  USING (canastra.eh_cliente() AND user_id = auth.uid());

CREATE POLICY assinaturas_admin_le ON canastra.assinaturas
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());

-- NAO HA POLITICA DE ESCRITA, e a ausencia e o desenho: criar assinatura passa
-- pelo Express (que valida o preco no servidor e fala com o MP), e transicao
-- de status vem do webhook — nada disso e um INSERT/UPDATE de navegador. RLS
-- ligada sem politica ja nega; o REVOKE abaixo e a segunda tranca, pelo mesmo
-- argumento de `clientes`/`pedidos` em 0006: a ausencia de politica se perde
-- com um CREATE POLICY distraido de outro dia, o privilegio de tabela nao.
-- (O default de 0001 deu `arwd` a `authenticated` nesta tabela recem-nascida;
-- fica so o SELECT, que e o que as politicas acima governam.)
REVOKE INSERT, UPDATE, DELETE ON canastra.assinaturas FROM authenticated;

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0015_assinaturas')
  ON CONFLICT (versao) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 1.0016_redacao_ampliada
-- ----------------------------------------------------------------------------

-- LGPD: a redação alcança TUDO que congela dado pessoal — pedidos,
-- assinaturas e avaliações.
--
-- POR QUE UMA MIGRACAO NOVA, E NAO UMA EDICAO DA 0013: migracao aplicada nao
-- se edita (regra da casa desde 0011), e ha um motivo tecnico alem da regra —
-- a 0013 roda ANTES de 0014/0015 na ordem do runner, entao a funcao dela nao
-- pode citar `avaliacoes` nem `assinaturas` (plpgsql resolve nomes na primeira
-- CHAMADA, e o teste chama; num banco parcialmente migrado seria 42P01). Esta
-- migracao, criada DEPOIS das duas, pode.
--
-- O ACHADO QUE ELA FECHA (revisao da onda 3H): as ondas irmas criaram DUAS
-- outras fotografias de dado pessoal que a redacao da 0013 nao alcancava:
--
--   `assinaturas.endereco_json` (0015) — endereco de entrega congelado na
--       adesao, NOT NULL, com user_id ON DELETE SET NULL: a exclusao da conta
--       deixaria o endereco orfao e irredigivel, o MESMO furo de `pedidos` que
--       a 0013 acabou de fechar;
--   `avaliacoes.nome_exibicao` (0014) — nome CONGELADO no INSERT e PUBLICO
--       (a PDP exibe; `anon` tem GRANT de SELECT na coluna): depois da
--       exclusao, o nome da pessoa continuaria estampado na vitrine.
--
-- E DEIXA REGISTRADO O QUE VIROU VERDADE NESTA ONDA: o comentario da 0015
-- ("uma assinatura orfa e cancelada no MP pelo fluxo de exclusao de conta")
-- descrevia um fluxo que NAO existia quando foi escrito. Ele passou a existir
-- aqui: `conta.routes.js` cancela no MP e marca `cancelada` TODA assinatura
-- viva do titular ANTES de redigir e de apagar a conta — e aborta a exclusao
-- se o MP recusar, pelo mesmo padrao da redacao (nunca apagar deixando um
-- preapproval vivo cobrando um cliente que ja nao existe).

-- O carimbo de auditoria/idempotencia das assinaturas — mesmo papel do
-- `pedidos.redigido_em` da 0013: NULL = nunca redigida; preenchida = quando.
ALTER TABLE canastra.assinaturas
  ADD COLUMN redigido_em timestamptz;

/**
 * A whitelist de endereco, agora com nome proprio.
 *
 * A 0013 tinha esta expressao inline; com DOIS consumidores (pedidos e
 * assinaturas) e um terceiro fora do banco (o SQL manual de orfaos em
 * docs/seguranca-dados-pessoais.md), a copia divergiria na primeira correcao.
 * A regra e a MESMA da 0013, chave a chave:
 *
 *   FICA   cidade/city e uf/estado/state ........ estatistica por regiao;
 *   VIRA PREFIXO  cep/zip_code/zipCode/postal_code -> 3 digitos + 'xxxxx'
 *          (CEP impresentavel degrada para 'xxxxx' — perde a estatistica,
 *          nunca vaza o dado);
 *   SAI    toda outra chave -> "[redigido]" — whitelist, nao denylist: chave
 *          que a redacao nao conhece cai para o lado seguro.
 *
 * Formas nao-objeto: SQL NULL -> NULL (STRICT), JSON null -> ele mesmo,
 * `{}` -> `{}` (o COALESCE — `jsonb_object_agg` de zero linhas e NULL),
 * escalar/lista -> "[redigido]" inteiro (nao ha como saber o que ha dentro).
 *
 * IMMUTABLE de verdade: so olha o argumento. E IDEMPOTENTE por construcao —
 * redigir o ja redigido devolve byte a byte o mesmo jsonb ('379xxxxx' vira
 * '379' + 'xxxxx' de novo) — mas a idempotencia OPERACIONAL de quem a usa vem
 * do carimbo `redigido_em`, que evita ate o UPDATE vazio.
 */
CREATE FUNCTION canastra.redigir_endereco(endereco jsonb) RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path = canastra, pg_temp
AS $redigir_endereco$
  SELECT CASE
    WHEN jsonb_typeof(endereco) = 'null' THEN endereco
    WHEN jsonb_typeof(endereco) <> 'object' THEN to_jsonb('[redigido]'::text)
    ELSE (
      SELECT COALESCE(
        jsonb_object_agg(
          e.chave,
          CASE
            WHEN lower(e.chave) IN ('cidade', 'city')        THEN e.valor
            WHEN lower(e.chave) IN ('uf', 'estado', 'state') THEN e.valor
            WHEN lower(e.chave) IN ('cep', 'zip_code', 'zipcode', 'postal_code')
              THEN to_jsonb(
                left(regexp_replace(COALESCE(e.valor #>> '{}', ''), '\D', '', 'g'), 3)
                || 'xxxxx'
              )
            ELSE to_jsonb('[redigido]'::text)
          END
        ),
        '{}'::jsonb
      )
      FROM jsonb_each(endereco) AS e(chave, valor)
    )
  END
$redigir_endereco$;

-- Funcao pura sobre o proprio argumento — nao le tabela nenhuma —, mas a
-- lista explicita e o padrao da casa (0007/0008/0013): quem chama fica
-- escrito. `service_role` entra por causa do SQL manual de orfaos do runbook.
REVOKE EXECUTE ON FUNCTION canastra.redigir_endereco(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION canastra.redigir_endereco(jsonb) TO service_role;

/**
 * A redacao do titular, versao completa. CREATE OR REPLACE sobre a assinatura
 * EXATA da 0013 — mesmo nome, mesmo parametro, mesmo retorno — entao todo
 * chamador existente (conta.routes.js, lgpd.routes.js) continua valendo.
 *
 * O CONTRATO DO RETORNO NAO MUDA: continua sendo a contagem de PEDIDOS
 * redigidos (e o `pedidosRedigidos` que o endpoint de titular responde, e o
 * "0 na segunda chamada" que prova a idempotencia). Assinaturas e avaliacoes
 * sao redigidas no MESMO gesto, sem numero proprio no retorno — quem precisar
 * de contagem por tabela le os carimbos.
 *
 * TRES DECISOES NOVAS, escritas aqui porque e aqui que se vai procurar:
 *
 * 1. ASSINATURA VIVA NAO E REDIGIDA — so as `cancelada`. Enquanto a entrega
 *    recorrente existe, o endereco congelado e NECESSARIO a execucao do
 *    contrato (LGPD art. 7º, V; art. 16, I): redigi-lo destruiria a entrega
 *    de quem continua assinante — e o endpoint de eliminacao PARCIAL
 *    (POST /lgpd/titulares/:id/redigir) roda exatamente nesse cenario. Na
 *    exclusao TOTAL nada escapa por aqui: conta.routes.js cancela TODAS as
 *    assinaturas vivas ANTES de chamar esta funcao, entao elas ja chegam
 *    `cancelada`. Assinatura cancelada DEPOIS de uma redacao parcial fica com
 *    o endereco ate a proxima redacao — limite conhecido, documentado tambem
 *    no runbook.
 *
 * 2. `avaliacoes.nome_exibicao` VIRA 'Cliente Canastra', nao "[redigido]": a
 *    coluna e PUBLICA na PDP, e um colchete tecnico no lugar do autor viraria
 *    curiosidade de vitrine. O placeholder diz a unica coisa que importa —
 *    foi um cliente de verdade (a RLS de 0014 so deixa avaliar quem recebeu o
 *    cafe). Nota e texto ficam: sao a prova social, e a 0014 ja decidiu que
 *    sobrevivem a exclusao; o dado PESSOAL da tabela e o nome. A idempotencia
 *    aqui e o proprio predicado (`<> 'Cliente Canastra'`), sem coluna nova —
 *    o segundo UPDATE nao acha linha.
 *
 * 3. `pedidos` continua identico a 0013 (denylist de itens inclusive), agora
 *    escrito via `redigir_endereco` — comportamento medido antes e depois
 *    pelo MESMO teste (f7_lgpd.test.js, casos das formas inesperadas).
 *
 * CREATE OR REPLACE preserva a ACL da 0013 (REVOKE PUBLIC + GRANT
 * service_role — proacl fica na troca de corpo), mas NAO preserva atributos
 * declarados: SECURITY INVOKER (default), o `SET search_path` e o nao-STRICT
 * sao re-declarados aqui de proposito, com as MESMAS razoes da 0013 — INVOKER
 * porque quem chama ja tem o privilegio (DEFINER so acrescentaria superficie
 * de bypass), nao-STRICT porque NULL tem de ser ERRO e nunca no-op silencioso
 * no fluxo de exclusao.
 */
CREATE OR REPLACE FUNCTION canastra.redigir_dados_do_titular(alvo_user_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path = canastra, pg_temp
AS $redigir$
DECLARE
  pedidos_redigidos integer;
BEGIN
  -- Identico a 0013: NULL e erro de contrato (22004), nunca "nenhum alvo" —
  -- um no-op silencioso no fluxo de exclusao fabricaria o orfao irredigivel.
  IF alvo_user_id IS NULL THEN
    RAISE EXCEPTION 'A redação exige um titular: pedido órfão não tem redação por titular.'
      USING ERRCODE = 'null_value_not_allowed',
            HINT = 'Redija ANTES ou JUNTO da exclusão da conta — depois dela o vínculo já se foi.';
  END IF;

  /**
   * PEDIDOS — o comportamento da 0013, com o endereco delegado a
   * `redigir_endereco`. A denylist de itens continua aqui (e um formato de
   * ITEM, nao de endereco): o formato real do checkout so tem produto —
   * product_id, name (nome do PRODUTO, registro fiscal), price, quantity... —
   * e a denylist e defesa contra formato historico/futuro com dado pessoal
   * dentro do item. So listas sao processadas: e o unico formato que algum
   * caminho de escrita da loja produz.
   */
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
       redigido_em = now(),
       -- Regra de 0005: sem trigger de moddatetime, quem escreve carimba.
       atualizado_em = now()
   WHERE p.user_id = alvo_user_id
     AND p.redigido_em IS NULL;

  GET DIAGNOSTICS pedidos_redigidos = ROW_COUNT;

  /**
   * ASSINATURAS — so as canceladas (decisao 1 do cabecalho). O `redigido_em`
   * novo faz o mesmo servico do de pedidos: idempotencia + auditoria da
   * PRIMEIRA redacao.
   */
  UPDATE canastra.assinaturas a
     SET endereco_json = canastra.redigir_endereco(a.endereco_json),
         redigido_em   = now(),
         atualizado_em = now()
   WHERE a.user_id = alvo_user_id
     AND a.status = 'cancelada'
     AND a.redigido_em IS NULL;

  /**
   * AVALIACOES — o nome publico sai; nota e texto ficam (decisao 2). O
   * predicado E a idempotencia: 'Cliente Canastra' nao e alvo de novo.
   * `moderado_em` NAO e tocado — redacao nao e moderacao.
   */
  UPDATE canastra.avaliacoes av
     SET nome_exibicao = 'Cliente Canastra'
   WHERE av.user_id = alvo_user_id
     AND av.nome_exibicao <> 'Cliente Canastra';

  RETURN pedidos_redigidos;
END;
$redigir$;

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- `npm run db:migrar` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES ('0016_redacao_ampliada')
  ON CONFLICT (versao) DO NOTHING;


-- ----------------------------------------------------------------------------
-- 2. Catálogo, filtros e configuração da loja
-- ----------------------------------------------------------------------------

-- Os mesmos valores que db/seed.js escreve, gerados a partir da MESMA funcao
-- (`linhasDeProdutos()`). O `produto_id` e UUID v5 do `sku`, entao ele nao muda
-- entre instalacoes nem entre maquinas — e o que costura a vitrine ao banco.
--
-- DO NOTHING, e nao DO UPDATE: preco e estoque pertencem ao painel a partir da
-- primeira semeadura. Um upsert aqui reverteria, a cada execucao, o preco que o
-- administrador acabou de corrigir.
INSERT INTO canastra.produtos (produto_id, sku, nome, tamanho, categoria, preco, imagem, quantidade, descricao, peso, largura, altura, comprimento, destacado_em) VALUES
  ('52098635-04a0-5f3f-917b-c42f12ce0796', 'classico-graos-250', 'Café Especial Canastra Clássico em Grãos - Pacote com 250 gramas', 'Pacote com 250 g', 'Café em grãos', '39.70', 'http://localhost:3000/cafe-classico.png', 20, 'Torra média-escura de maior intensidade. Corpo cheio, notas amadeiradas e levemente achocolatadas, com finalização de especiarias. Em grãos, para moer na hora. Torra média-escura (French roast). Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.250', 18, 7, 24, now()),
  ('f97a28a5-791a-5b57-b6b5-b52335bf3136', 'classico-graos-500', 'Café Especial Canastra Clássico em Grãos - Pacote com 500 gramas', 'Pacote com 500 g', 'Café em grãos', '65.70', 'http://localhost:3000/cafe-classico.png', 20, 'Torra média-escura de maior intensidade. Corpo cheio, notas amadeiradas e levemente achocolatadas, com finalização de especiarias. Em grãos, para moer na hora. Torra média-escura (French roast). Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.500', 18, 7, 24, now()),
  ('09773312-bf99-50fc-9a0c-67b98575e5dd', 'classico-graos-1000', 'Café Especial Canastra Clássico em Grãos - Pacote com 1 quilograma', 'Pacote com 1 kg', 'Café em grãos', '109.90', 'http://localhost:3000/cafe-classico.png', 20, 'Torra média-escura de maior intensidade. Corpo cheio, notas amadeiradas e levemente achocolatadas, com finalização de especiarias. Em grãos, para moer na hora. Torra média-escura (French roast). Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '1.000', 24, 10, 32, now()),
  ('d55e0030-c87b-5496-89d3-408b31c267d5', 'classico-graos-caixa-4x500', 'Café Especial Canastra Clássico em Grãos - Caixa com 4 pacotes de 500 gramas', 'Caixa com 4 pacotes de 500 g', 'Café em grãos', '236.70', 'http://localhost:3000/cafe-classico.png', 10, 'Torra média-escura de maior intensidade. Corpo cheio, notas amadeiradas e levemente achocolatadas, com finalização de especiarias. Em grãos, para moer na hora. Torra média-escura (French roast). Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '2.000', 18, 7, 24, now()),
  ('2876f272-419a-5ec2-8915-ec560a5b01ab', 'classico-moido-250', 'Café Especial Canastra Clássico Moído - Pacote com 250 gramas', 'Pacote com 250 g', 'Café moído', '39.70', 'http://localhost:3000/cafe-classico.png', 20, 'Torra média-escura de maior intensidade. Corpo cheio, notas amadeiradas e levemente achocolatadas, com finalização de especiarias. Moído no pedido, na moagem que você escolher. Torra média-escura (French roast). Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.250', 18, 7, 24, now()),
  ('53e684a8-7392-5227-90cf-50d2ef6e3106', 'classico-moido-500', 'Café Especial Canastra Clássico Moído - Pacote com 500 gramas', 'Pacote com 500 g', 'Café moído', '65.70', 'http://localhost:3000/cafe-classico.png', 20, 'Torra média-escura de maior intensidade. Corpo cheio, notas amadeiradas e levemente achocolatadas, com finalização de especiarias. Moído no pedido, na moagem que você escolher. Torra média-escura (French roast). Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.500', 18, 7, 24, now()),
  ('2ba077d1-dfeb-5cbe-8dbf-6a0e641401c3', 'classico-moido-caixa-3x250', 'Café Especial Canastra Clássico Moído - Caixa com 3 pacotes de 250 gramas', 'Caixa com 3 pacotes de 250 g', 'Café moído', '99.90', 'http://localhost:3000/cafe-classico.png', 10, 'Torra média-escura de maior intensidade. Corpo cheio, notas amadeiradas e levemente achocolatadas, com finalização de especiarias. Moído no pedido, na moagem que você escolher. Torra média-escura (French roast). Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.750', 18, 7, 24, now()),
  ('8a0e8d2a-13e7-5e13-a477-3feb4b7d9ce3', 'suave-graos-250', 'Café Especial Canastra Suave em Grãos - Pacote com 250 gramas', 'Pacote com 250 g', 'Café em grãos', '39.70', 'http://localhost:3000/cafe-suave.png', 20, 'Torra média, mais delicada. Notas frutadas e levemente achocolatadas, doçura limpa e final leve. Em grãos, para moer na hora. Torra média. Corpo médio. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.250', 18, 7, 24, now()),
  ('bda48bae-8ba3-5434-b577-b3c527e5dcf0', 'suave-graos-500', 'Café Especial Canastra Suave em Grãos - Pacote com 500 gramas', 'Pacote com 500 g', 'Café em grãos', '65.70', 'http://localhost:3000/cafe-suave.png', 20, 'Torra média, mais delicada. Notas frutadas e levemente achocolatadas, doçura limpa e final leve. Em grãos, para moer na hora. Torra média. Corpo médio. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.500', 18, 7, 24, now()),
  ('c2370586-098f-5e92-aa1d-7f653afd5e00', 'suave-graos-1000', 'Café Especial Canastra Suave em Grãos - Pacote com 1 quilograma', 'Pacote com 1 kg', 'Café em grãos', '109.90', 'http://localhost:3000/cafe-suave.png', 20, 'Torra média, mais delicada. Notas frutadas e levemente achocolatadas, doçura limpa e final leve. Em grãos, para moer na hora. Torra média. Corpo médio. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '1.000', 24, 10, 32, now()),
  ('cdc49b64-365c-5984-9bc5-4327dd4817d2', 'suave-moido-250', 'Café Especial Canastra Suave Moído - Pacote com 250 gramas', 'Pacote com 250 g', 'Café moído', '39.70', 'http://localhost:3000/cafe-suave.png', 20, 'Torra média, mais delicada. Notas frutadas e levemente achocolatadas, doçura limpa e final leve. Moído no pedido, na moagem que você escolher. Torra média. Corpo médio. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.250', 18, 7, 24, now()),
  ('7a5cff3e-6626-52c8-9653-ffa4d46d9938', 'suave-moido-500', 'Café Especial Canastra Suave Moído - Pacote com 500 gramas', 'Pacote com 500 g', 'Café moído', '65.70', 'http://localhost:3000/cafe-suave.png', 20, 'Torra média, mais delicada. Notas frutadas e levemente achocolatadas, doçura limpa e final leve. Moído no pedido, na moagem que você escolher. Torra média. Corpo médio. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.500', 18, 7, 24, now()),
  ('d5103126-5b34-5a56-83ff-1951207e9d08', 'suave-moido-caixa-3x250', 'Café Especial Canastra Suave Moído - Caixa com 3 pacotes de 250 gramas', 'Caixa com 3 pacotes de 250 g', 'Café moído', '99.90', 'http://localhost:3000/cafe-suave.png', 10, 'Torra média, mais delicada. Notas frutadas e levemente achocolatadas, doçura limpa e final leve. Moído no pedido, na moagem que você escolher. Torra média. Corpo médio. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.750', 18, 7, 24, now()),
  ('6453243e-27c6-5011-9d83-341611267cf3', 'microlote-graos-250', 'Microlote Canastra em Grãos 250g', 'Pacote com 250 g', 'Café em grãos', '43.70', 'http://localhost:3000/microlote-png.png', 8, 'Lote separado da safra, em quantidade limitada. É o café mais caro por grama da casa — vendido só em 250 g, só em grão. Em grãos, para moer na hora. Torra clara-média. Corpo sedoso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.250', 18, 7, 24, now()),
  ('0cc8900a-a81e-5661-bff1-b35e16ad5045', 'nectar-de-minas-graos-1000', 'Café Tipo Exportação Néctar de Minas em Grãos - Pacote com 1 quilograma', 'Pacote com 1 kg', 'Café em grãos', '105.70', 'http://localhost:3000/cafe-classico.png', 12, 'Marca irmã, tipo exportação. Vendida na mesma loja, em pacote de 1 kg em grãos. Em grãos, para moer na hora. Torra média-escura. Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '1.000', 24, 10, 32, now()),
  ('0954bcf6-8c72-5032-976b-51fbd1d1d5fe', 'kit-canela-classico-suave-moido-3x250', 'Café Especial Canastra Canela, Clássico e Suave Moído - Caixa com 1 pacote de 250 gramas de cada', 'Caixa com 1 pacote de 250 g de cada', 'Kits', '109.70', 'http://localhost:3000/cafe-canela.png', 6, 'Café torrado e moído com canela, moída junto ao grão. O aromatizado da casa. Moído no pedido, na moagem que você escolher. Torra média-escura. Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.750', 18, 7, 24, now()),
  ('ba8fdb92-3ae1-54a0-8904-de4f6d86b5c2', 'drip-suave-display-10', 'Café Canastra Drip Coffee Suave - Display com 10 unidades', 'Display com 10 sachês', 'Drip Coffee', '37.70', 'http://localhost:3000/cafe-suave.png', 0, 'Torra média, mais delicada. Notas frutadas e levemente achocolatadas, doçura limpa e final leve. Sachê individual de drip coffee: filtro e café numa coisa só. Torra média. Corpo médio. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.110', 18, 7, 24, now()),
  ('bfa756bf-e17f-5540-b46f-0ec7e123f5f4', 'drip-classico-display-10', 'Café Canastra Drip Coffee Clássico - Display com 10 unidades', 'Display com 10 sachês', 'Drip Coffee', '37.70', 'http://localhost:3000/cafe-classico.png', 0, 'Torra média-escura de maior intensidade. Corpo cheio, notas amadeiradas e levemente achocolatadas, com finalização de especiarias. Sachê individual de drip coffee: filtro e café numa coisa só. Torra média-escura (French roast). Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.110', 18, 7, 24, now()),
  ('5ac1714d-3bfa-5a53-9947-5ac6732675c7', 'drip-classico-3-caixas', 'Drip Coffee - Canastra Clássico 3 caixas - Total 30 unidades', '3 caixas — 30 sachês', 'Drip Coffee', '0.00', 'http://localhost:3000/cafe-classico.png', 0, 'Torra média-escura de maior intensidade. Corpo cheio, notas amadeiradas e levemente achocolatadas, com finalização de especiarias. Sachê individual de drip coffee: filtro e café numa coisa só. Torra média-escura (French roast). Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.330', 18, 7, 24, now()),
  ('bf24decb-ec27-522d-918e-ff4ed2fd1571', 'drip-classico-6-caixas', 'Drip Coffee - Canastra Clássico 6 caixas com 10 unidades cada - Total 60 unidades', '6 caixas — 60 sachês', 'Drip Coffee', '0.00', 'http://localhost:3000/cafe-classico.png', 0, 'Torra média-escura de maior intensidade. Corpo cheio, notas amadeiradas e levemente achocolatadas, com finalização de especiarias. Sachê individual de drip coffee: filtro e café numa coisa só. Torra média-escura (French roast). Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.660', 18, 7, 24, now()),
  ('aeee3d2f-69c5-5569-9225-843857fd9eeb', 'drip-canela-3-caixas', 'Drip Coffee - Canastra Canela 3 caixas - Total 30 unidades', '3 caixas — 30 sachês', 'Drip Coffee', '0.00', 'http://localhost:3000/cafe-canela.png', 0, 'Café torrado e moído com canela, moída junto ao grão. O aromatizado da casa. Sachê individual de drip coffee: filtro e café numa coisa só. Torra média-escura. Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.330', 18, 7, 24, now()),
  ('ba5add3b-7ee9-5a9e-9f8c-f6bc90e6702c', 'drip-canela-6-caixas', 'Drip Coffee - Canastra Canela 6 caixas com 10 unidades cada - Total 60 unidades', '6 caixas — 60 sachês', 'Drip Coffee', '0.00', 'http://localhost:3000/cafe-canela.png', 0, 'Café torrado e moído com canela, moída junto ao grão. O aromatizado da casa. Sachê individual de drip coffee: filtro e café numa coisa só. Torra média-escura. Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.660', 18, 7, 24, now()),
  ('64ba5d13-1f28-5e15-9d66-4c245e953869', 'drip-suave-3-caixas', 'Drip Coffee - Canastra Suave 3 caixas - Total 30 unidades', '3 caixas — 30 sachês', 'Drip Coffee', '0.00', 'http://localhost:3000/cafe-suave.png', 0, 'Torra média, mais delicada. Notas frutadas e levemente achocolatadas, doçura limpa e final leve. Sachê individual de drip coffee: filtro e café numa coisa só. Torra média. Corpo médio. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.330', 18, 7, 24, now()),
  ('9ce8f68d-4d82-5bd5-b106-e609e64d6656', 'capsula-classico-1-caixa', 'Cápsula Compatível Nespresso - Canastra Clássico 1 caixa com 10 unidades', '1 caixa — 10 cápsulas', 'Cápsulas', '0.00', 'http://localhost:3000/cafe-classico.png', 0, 'Torra média-escura de maior intensidade. Corpo cheio, notas amadeiradas e levemente achocolatadas, com finalização de especiarias. Cápsula compatível com o sistema Nespresso. Torra média-escura (French roast). Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.110', 18, 7, 24, now()),
  ('9d3fc3a0-6cde-5fcc-9190-095778e03703', 'capsula-classico-6-caixas', 'Cápsula Compatível Nespresso - Canastra Clássico 6 caixas com 10 unidades cada', '6 caixas — 60 cápsulas', 'Cápsulas', '0.00', 'http://localhost:3000/cafe-classico.png', 0, 'Torra média-escura de maior intensidade. Corpo cheio, notas amadeiradas e levemente achocolatadas, com finalização de especiarias. Cápsula compatível com o sistema Nespresso. Torra média-escura (French roast). Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.660', 18, 7, 24, now()),
  ('dc077306-a19b-577b-af42-acea63503208', 'capsula-canela-1-caixa', 'Cápsula Compatível Nespresso - Canastra Canela 1 caixa com 10 unidades', '1 caixa — 10 cápsulas', 'Cápsulas', '0.00', 'http://localhost:3000/cafe-canela.png', 0, 'Café torrado e moído com canela, moída junto ao grão. O aromatizado da casa. Cápsula compatível com o sistema Nespresso. Torra média-escura. Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.110', 18, 7, 24, now()),
  ('9ade4f0e-5474-5737-abb4-024f77da14af', 'capsula-canela-6-caixas', 'Cápsula Compatível Nespresso - Canastra Canela 6 caixas com 10 unidades cada', '6 caixas — 60 cápsulas', 'Cápsulas', '0.00', 'http://localhost:3000/cafe-canela.png', 0, 'Café torrado e moído com canela, moída junto ao grão. O aromatizado da casa. Cápsula compatível com o sistema Nespresso. Torra média-escura. Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.660', 18, 7, 24, now()),
  ('05754efb-b436-5a52-b7e7-da94d2a08bdf', 'capsula-classico-2-canela-1', 'Cápsula Compatível Nespresso - Canastra Clássico 2 caixas + Canela 1 caixa', '3 caixas — 30 cápsulas', 'Kits', '0.00', 'http://localhost:3000/cafe-classico.png', 0, 'Torra média-escura de maior intensidade. Corpo cheio, notas amadeiradas e levemente achocolatadas, com finalização de especiarias. Cápsula compatível com o sistema Nespresso. Torra média-escura (French roast). Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.330', 18, 7, 24, now()),
  ('e7203f2c-8fba-586c-99be-7ae1cee1a8fd', 'capsula-classico-3-canela', 'Cápsula Compatível Nespresso - Canastra Clássico 3 caixas + Canela', '4 caixas — 40 cápsulas', 'Kits', '0.00', 'http://localhost:3000/cafe-classico.png', 0, 'Torra média-escura de maior intensidade. Corpo cheio, notas amadeiradas e levemente achocolatadas, com finalização de especiarias. Cápsula compatível com o sistema Nespresso. Torra média-escura (French roast). Corpo intenso. 100% arábica · Origem única da Serra da Canastra · Carbono zero · 100% energia fotovoltaica · Sem glúten · Vegano. Selo GOURMET / ESPECIAL / SCA 80+.', '0.440', 18, 7, 24, now())
ON CONFLICT (sku) WHERE sku IS NOT NULL DO NOTHING;

INSERT INTO canastra.produto_opcoes (id, tipo, valor) VALUES
  ('24db0673-a9d1-54ce-b3e9-767e4424a87d', 'categoria', 'Café em grãos'),
  ('a1c82889-e3c3-5a1d-978d-12d00ff445dd', 'categoria', 'Café moído'),
  ('e7be3957-c71a-5238-b2f2-69c008e334b9', 'categoria', 'Drip Coffee'),
  ('2ee030ca-11cc-514b-9611-fef844a5addc', 'categoria', 'Cápsulas'),
  ('e50027d3-0183-58fc-a2a4-45808072b2bf', 'categoria', 'Kits'),
  ('2af57c74-1100-5e70-9ddd-65d5d9307a38', 'tamanho', 'Pacote com 250 g'),
  ('fd2d3b93-23ad-556b-b440-ebaf1c572c58', 'tamanho', 'Pacote com 500 g'),
  ('b6abc48c-390a-5c27-abff-6febe5338d79', 'tamanho', 'Pacote com 1 kg'),
  ('f7b010e1-1fe0-52c5-a8f1-b46779c1921a', 'tamanho', 'Caixa com 4 pacotes de 500 g'),
  ('bd942eac-1999-5d07-80a9-1cae6641436e', 'tamanho', 'Caixa com 3 pacotes de 250 g'),
  ('563f154a-ead7-5c31-b436-598a957b3bb8', 'tamanho', 'Caixa com 1 pacote de 250 g de cada'),
  ('3a763d7c-0315-5d7a-b631-71a09c68b06f', 'tamanho', 'Display com 10 sachês'),
  ('9e891efd-355c-52f4-864a-eb7cc4f1ad61', 'tamanho', '3 caixas — 30 sachês'),
  ('830db52b-fade-5559-aacc-dc5e4e98470f', 'tamanho', '6 caixas — 60 sachês'),
  ('9d5d8cd6-c033-58bb-b398-7f9e299b519a', 'tamanho', '1 caixa — 10 cápsulas'),
  ('d662eaf9-d479-500c-92b7-f9b5a10055bd', 'tamanho', '6 caixas — 60 cápsulas'),
  ('992d3003-3647-5acb-84e6-7264b40afc8d', 'tamanho', '3 caixas — 30 cápsulas'),
  ('0237b204-860c-5306-a163-e17e19566bbf', 'tamanho', '4 caixas — 40 cápsulas')
ON CONFLICT (tipo, valor) DO NOTHING;

INSERT INTO canastra.config_loja
  (id, banner_desktop, banner_mobile, titulo_site, whatsapp, barra_de_aviso)
VALUES (1, 'http://localhost:3000/bannerdesktop.jpg', 'http://localhost:3000/imagem-banner.jpg', 'Café Canastra', '', 'Torramos na terça, enviamos na quarta.')
ON CONFLICT (id) DO NOTHING;


-- ----------------------------------------------------------------------------
-- 3. Contas de teste (senha publicada — nunca em produção)
-- ----------------------------------------------------------------------------

-- >>> INICIO CONTAS DE TESTE (o teste local corta daqui)
-- Este trecho exige o schema `auth` de verdade, do GoTrue. O harness de teste
-- local traz so um arremedo de `auth.users` (id e email), por isso
-- backend/test/instalacao.test.js corta daqui ate o marcador de fim. A parte de
-- ESTRUTURA acima e comparada linha a linha; esta so se verifica num Supabase.

DO $conta_admin$
DECLARE
  id_do_usuario uuid;
  coluna        text;
BEGIN
  SELECT id INTO id_do_usuario FROM auth.users WHERE email = 'admin@canastra.teste';

  IF id_do_usuario IS NULL THEN
    id_do_usuario := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      id_do_usuario,
      'authenticated',
      'authenticated',
      'admin@canastra.teste',
      crypt('canastra-teste-admin', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome', 'Administração de Teste')
    );

    INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      id_do_usuario::text,
      id_do_usuario,
      jsonb_build_object('sub', id_do_usuario::text, 'email', 'admin@canastra.teste'),
      'email',
      now(), now(), now()
    );

    RAISE NOTICE 'Conta criada no GoTrue: %', 'admin@canastra.teste';
  ELSE
    RAISE NOTICE 'Conta já existia, senha preservada: %', 'admin@canastra.teste';
  END IF;

  -- OS CAMPOS DE TOKEN PRECISAM SER '' — NUNCA NULL.
  --
  -- Medido contra um Supabase de verdade: com eles em NULL, o login responde
  -- 500 com "Database error querying schema" e nada no erro aponta para a
  -- causa. O GoTrue e escrito em Go e mapeia essas colunas como `string`, nao
  -- `*string`; ler NULL ali estoura na desserializacao, antes de qualquer
  -- verificacao de senha. A conta existe, a senha esta certa, e o login falha.
  --
  -- Feito em UPDATE, e coluna a coluna com checagem de existencia, porque a
  -- lista muda entre versoes do GoTrue: um INSERT citando coluna que a versao
  -- instalada nao tem quebraria a instalacao inteira.
  FOREACH coluna IN ARRAY ARRAY[
    'confirmation_token', 'recovery_token', 'email_change',
    'email_change_token_new', 'email_change_token_current',
    'phone_change', 'phone_change_token', 'reauthentication_token'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users'
        AND column_name = coluna
    ) THEN
      EXECUTE format(
        'UPDATE auth.users SET %I = '''' WHERE id = %L AND %I IS NULL',
        coluna, id_do_usuario, coluna
      );
    END IF;
  END LOOP;

  -- O vinculo com a loja. E ESTA linha, e nao o token, que faz alguem ser
  -- cliente daqui: as politicas de RLS todas passam por canastra.eh_cliente().
  INSERT INTO canastra.clientes (user_id, nome)
  VALUES (id_do_usuario, 'Administração de Teste')
  ON CONFLICT (user_id) DO NOTHING;

  -- Administrador e linha em canastra.admins, nunca claim no JWT — outro projeto
  -- da mesma instancia poderia emitir o claim que quisesse.
  INSERT INTO canastra.admins (user_id) VALUES (id_do_usuario)
  ON CONFLICT (user_id) DO NOTHING;
END $conta_admin$;

DO $conta_cliente$
DECLARE
  id_do_usuario uuid;
  coluna        text;
BEGIN
  SELECT id INTO id_do_usuario FROM auth.users WHERE email = 'cliente@canastra.teste';

  IF id_do_usuario IS NULL THEN
    id_do_usuario := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      id_do_usuario,
      'authenticated',
      'authenticated',
      'cliente@canastra.teste',
      crypt('canastra-teste-cliente', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome', 'Cliente de Teste')
    );

    INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      id_do_usuario::text,
      id_do_usuario,
      jsonb_build_object('sub', id_do_usuario::text, 'email', 'cliente@canastra.teste'),
      'email',
      now(), now(), now()
    );

    RAISE NOTICE 'Conta criada no GoTrue: %', 'cliente@canastra.teste';
  ELSE
    RAISE NOTICE 'Conta já existia, senha preservada: %', 'cliente@canastra.teste';
  END IF;

  -- OS CAMPOS DE TOKEN PRECISAM SER '' — NUNCA NULL.
  --
  -- Medido contra um Supabase de verdade: com eles em NULL, o login responde
  -- 500 com "Database error querying schema" e nada no erro aponta para a
  -- causa. O GoTrue e escrito em Go e mapeia essas colunas como `string`, nao
  -- `*string`; ler NULL ali estoura na desserializacao, antes de qualquer
  -- verificacao de senha. A conta existe, a senha esta certa, e o login falha.
  --
  -- Feito em UPDATE, e coluna a coluna com checagem de existencia, porque a
  -- lista muda entre versoes do GoTrue: um INSERT citando coluna que a versao
  -- instalada nao tem quebraria a instalacao inteira.
  FOREACH coluna IN ARRAY ARRAY[
    'confirmation_token', 'recovery_token', 'email_change',
    'email_change_token_new', 'email_change_token_current',
    'phone_change', 'phone_change_token', 'reauthentication_token'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users'
        AND column_name = coluna
    ) THEN
      EXECUTE format(
        'UPDATE auth.users SET %I = '''' WHERE id = %L AND %I IS NULL',
        coluna, id_do_usuario, coluna
      );
    END IF;
  END LOOP;

  -- O vinculo com a loja. E ESTA linha, e nao o token, que faz alguem ser
  -- cliente daqui: as politicas de RLS todas passam por canastra.eh_cliente().
  INSERT INTO canastra.clientes (user_id, nome)
  VALUES (id_do_usuario, 'Cliente de Teste')
  ON CONFLICT (user_id) DO NOTHING;
END $conta_cliente$;

-- <<< FIM CONTAS DE TESTE


-- ----------------------------------------------------------------------------
-- 4. Conferência
-- ----------------------------------------------------------------------------

-- Uma linha por migracao: a instalacao ficou registrada e `npm run db:migrar` nao
-- tem mais nada a fazer. Se aqui vier menos, alguma migracao nao rodou.
SELECT versao, aplicada_em FROM canastra.migracoes ORDER BY versao;

-- 29 produtos, 1 configuracao, 2 clientes, 1 administrador.
SELECT
  (SELECT count(*) FROM canastra.produtos)       AS produtos,
  (SELECT count(*) FROM canastra.produto_opcoes) AS opcoes,
  (SELECT count(*) FROM canastra.config_loja)    AS config,
  (SELECT count(*) FROM canastra.clientes)       AS clientes,
  (SELECT count(*) FROM canastra.admins)         AS admins;

-- Toda tabela da loja com a RLS ligada. Se alguma vier `false`, PARE: a
-- instalacao esta com dado pessoal legivel por quem tiver a chave anonima.
SELECT c.relname, c.relrowsecurity AS rls_ligada
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'canastra' AND c.relkind = 'r'
ORDER BY c.relname;
