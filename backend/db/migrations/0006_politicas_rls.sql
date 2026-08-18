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
