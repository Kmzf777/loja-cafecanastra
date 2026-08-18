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
 * A vitrine le o catalogo com a chave anonima, que e publica por definicao —
 * ela viaja no bundle. Dar SELECT na tabela inteira publicaria `custo` junto
 * com o preco. A view define exatamente o que e publico.
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
 * As tres coisas que quebram isto: ligar FORCE RLS em `produtos`, virar o
 * `security_invoker` para true, e a view passar a pertencer a outro papel
 * (ALTER VIEW ... OWNER TO, ou recriar a view por outro usuario). Repare no modo
 * de falha do FORCE: vitrine VAZIA, sem erro, sem log — o pior dos tres. Por
 * isso test/catalogo.test.js confere `relforcerowsecurity` e o `security_invoker`
 * no catalogo do Postgres, e nao so o comportamento: no harness o dono e
 * superusuario, e superusuario ignora ate o FORCE, entao um teste apenas
 * comportamental passaria verde com a producao quebrada.
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
 * Por que neste arquivo: 0002 ja foi aplicada, e o runner nunca reexecuta uma
 * versao registrada — corrigir la fecharia o furo apenas em instalacoes novas e
 * deixaria a instancia do VPS aberta, com as duas populacoes divergindo sem
 * aviso. O conserto tem de vir numa migracao NOVA, e 0003 e a primeira que roda
 * depois de `admins` existir: escolhida por ser a mais cedo possivel, que e o
 * criterio certo para janela de exposicao. A arrumacao por assunto perde para
 * isso.
 *
 * `clientes` NAO leva REVOKE, e nem `enderecos`, `carrinhos`, `carrinho_itens`
 * (0004) ou `pedidos` (0005): nessas o cliente logado escreve de verdade — cria
 * a propria conta, salva endereco, mexe na sacola, fecha pedido. Ali quem tem de
 * fazer o recorte e a politica de RLS, que sabe distinguir a linha do dono da
 * linha do vizinho; o privilegio de tabela nao sabe.
 */
REVOKE INSERT, UPDATE, DELETE ON canastra.admins FROM authenticated;

-- Chave geral fechada, ainda sem politica nenhuma — mesmo motivo de 0002: entre
-- o COMMIT desta migracao e o da que escreve as politicas ha uma janela real, e
-- um deploy que pare no meio tem de parar FECHADO.
--
-- Ligar a RLS em `produtos` NAO cega a vitrine: ela le pela view, que roda como
-- dono e por isso nao passa pela RLS (ver o bloco da view acima). Ja
-- `produto_opcoes` e lida DIRETO por `anon` e, ate a migracao de politicas
-- chegar, responde vazio — os filtros da vitrine somem, e nada mais. Perder
-- filtro e visivel e inofensivo; o contrario, um `pedidos` aberto por
-- esquecimento, nao seria nem uma coisa nem outra.
ALTER TABLE canastra.produtos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.produto_opcoes ENABLE ROW LEVEL SECURITY;
