-- O conteudo editavel da vitrine: o heroi da home e a barra de aviso.
--
-- POR QUE ISTO EXISTE. `config_loja` ja tinha `banner_desktop`, `banner_mobile`
-- e `barra_de_aviso`, o painel legado ja os editava — e a vitrine nova NUNCA
-- LEU nenhum dos tres. O heroi da home e `<Image src="/imagem-banner.jpg">`,
-- arquivo estatico, com kicker/titulo/texto numa tabela chumbada dentro do
-- proprio `page.tsx`. Eram tres campos write-only: o gestor salvava e nada
-- acontecia em lugar nenhum.
--
-- POR QUE DUAS TABELAS E NAO COLUNAS EM `config_loja`. A loja fala tres
-- idiomas (`app/[locale]`), e o texto do heroi precisa existir nos tres. Em
-- coluna isso seriam quinze colunas novas (cinco campos x tres idiomas) que
-- viram trinta no dia em que entrar um quarto idioma. A imagem, ao contrario,
-- e UMA para os tres — pedir tres uploads da mesma foto e trabalho inventado.
-- Dai a divisao: imagem numa linha unica, texto numa linha por (chave, idioma).
--
-- POR QUE 0030 E NAO 0017, que seria o proximo numero livre nesta pasta. O 17
-- esta TRIPLAMENTE disputado fora daqui: a worktree `melhor-envio` tem um
-- `0017_melhor_envio.sql` e a `whatsapp-bot` vai de `0017` a `0021`. O runner
-- (`db/migrar.js`) ABORTA em numero repetido — e a chave de controle em
-- `canastra.migracoes` e o NOME COMPLETO do arquivo, entao uma migracao ja
-- aplicada nao pode ser renomeada depois sem rodar de novo. Deixar a faixa
-- 0017-0029 livre custa nada e evita um merge que so falha no deploy.
--
-- `config_loja` NAO E TOCADA AQUI, de proposito. As duas convivem nesta onda:
-- migrar `banner_desktop`/`banner_mobile` para ca e depois remove-los e decisao
-- de outra tarefa, e faze-la junto misturaria "criar o lugar novo" com "esvaziar
-- o velho" numa migracao so.

CREATE TABLE canastra.vitrine_heroi (
  id               integer PRIMARY KEY DEFAULT 1
                     CONSTRAINT vitrine_heroi_linha_unica CHECK (id = 1),
  imagem_desktop   text,
  imagem_mobile    text,
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);

-- O MESMO GUARDA DUPLO de `config_loja` (ver 0005): um INSERT com id explicito
-- diferente de 1 bate no CHECK (23514); um INSERT sem citar `id` pega o DEFAULT,
-- passa pelo CHECK e bate na chave primaria (23505). Quem tratar erro no painel
-- precisa esperar os dois SQLSTATEs.

CREATE TABLE canastra.vitrine_texto (
  chave         text NOT NULL
                  CONSTRAINT vitrine_texto_chave_valida
                    CHECK (chave IN ('heroi', 'barra_aviso')),
  -- 'pt', 'en', 'es' — os mesmos tres de `app/[locale]`. Lista fechada por
  -- CHECK e nao texto livre: um 'pt-BR' gravado por engano nunca seria lido
  -- pela vitrine, que procura por 'pt', e o gestor veria o texto sumir sem
  -- nenhuma mensagem de erro.
  locale        text NOT NULL
                  CONSTRAINT vitrine_texto_locale_valido
                    CHECK (locale IN ('pt', 'en', 'es')),
  kicker        text,
  titulo        text,
  texto         text,
  rotulo_botao  text,
  destino       text,
  imagem_alt    text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chave, locale)
);

-- TODA COLUNA DE CONTEUDO E NULAVEL, e isso e a regra de seguranca do §3.6 da
-- spec escrita no schema: o valor de hoje, chumbado em `page.tsx`, vira o
-- FALLBACK. Linha ausente, coluna nula ou string vazia => a home aparece como
-- aparece hoje. Um NOT NULL aqui obrigaria o gestor a preencher os seis campos
-- dos tres idiomas antes de trocar uma foto, e um formulario salvo pela metade
-- apagaria o topo da loja.

-- A vitrine mostra heroi e barra de aviso ANTES de qualquer login, entao as
-- duas levam GRANT proprio — mesma regra de 0001 que `promocoes` e
-- `config_loja` ja seguem. (0001 inverteu o default de proposito: tabela nova
-- NAO nasce legivel por `anon`, para que o esquecimento vire 404 barulhento em
-- vez de vazamento calado. Quem e publico de verdade diz isso aqui.)
GRANT SELECT ON canastra.vitrine_heroi TO anon;
GRANT SELECT ON canastra.vitrine_texto TO anon;

ALTER TABLE canastra.vitrine_heroi ENABLE ROW LEVEL SECURITY;
ALTER TABLE canastra.vitrine_texto ENABLE ROW LEVEL SECURITY;

-- Leitura publica, escrita so de admin — `canastra.eh_admin()` (0006:120) le
-- `canastra.admins`, e NUNCA um claim do JWT: a instancia do Supabase e
-- compartilhada, e um token de projeto vizinho carrega o que quiser em
-- `user_metadata`.
--
-- O `TO anon, authenticated` NAO E ENFEITE, e o plano desta onda o trazia
-- implicito. Sem clausula TO, a politica nasce `TO public` — e `public` alcanca
-- tambem o DONO das tabelas, que e exatamente o papel de que `eh_cliente()` e
-- `eh_admin()` dependem para ler `clientes` e `admins` por baixo da RLS. Manter
-- toda politica presa aos dois papeis do navegador e o que mantem aquele
-- caminho livre, e `test/rls.test.js` afirma isso como invariante sobre
-- `pg_policies` (a lista `semPapel`), nao como lista de nomes.
CREATE POLICY vitrine_heroi_publico_le ON canastra.vitrine_heroi
  FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY vitrine_texto_publico_le ON canastra.vitrine_texto
  FOR SELECT TO anon, authenticated
  USING (true);

-- `USING (true)` SO EM LEITURA, e so aqui porque estas duas relacoes sao
-- publicas de verdade — o heroi e a primeira coisa que um visitante sem conta
-- ve. Escrita com `true` foi o erro que 0003 nomeou e que um revisor demonstrou
-- funcionando contra `produto_opcoes`; a mesma invariante de `pg_policies` que
-- vigia o TO acima reprova qualquer `true` fora de um SELECT de relacao publica.
CREATE POLICY vitrine_heroi_admin_escreve ON canastra.vitrine_heroi
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());
CREATE POLICY vitrine_texto_admin_escreve ON canastra.vitrine_texto
  FOR ALL TO authenticated
  USING (canastra.eh_admin())
  WITH CHECK (canastra.eh_admin());

-- REDUNDANTE HOJE, ESCRITO ASSIM MESMO. O `ALTER DEFAULT PRIVILEGES` de 0001 ja
-- da INSERT/UPDATE/DELETE a `authenticated` em toda tabela nova de `canastra`,
-- entao estas duas linhas nao mudam nada agora. Elas existem porque aquele
-- default so alcanca objeto criado pelo MESMO papel que rodou o ALTER: uma
-- destas tabelas recriada por outro caminho (psql com outro usuario, Supabase
-- Studio, restore parcial) nasceria SEM privilegio de escrita, e o painel do
-- admin passaria a levar 42501 com toda a RLS correta. GRANT decide TABELA,
-- politica decide LINHA — as duas somam, e nenhuma substitui a outra.
GRANT INSERT, UPDATE, DELETE ON canastra.vitrine_heroi TO authenticated;
GRANT INSERT, UPDATE, DELETE ON canastra.vitrine_texto TO authenticated;
