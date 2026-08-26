-- A vitrine passa a respeitar `produtos.estado` — e o SEGUNDO leitor da view
-- continua enxergando o que ela deixa de mostrar.
--
-- O NUMERO PULA 0036 DE PROPOSITO. Aquele numero esta reservado por NOME
-- (`0036_aposentar_promocoes_e_cupons.sql`) num comentario de
-- `controllers/PaymentController.js`, que descreve a ponte entre o motor novo e
-- o caminho legado e diz quem a remove. Tomar o 0036 aqui obrigaria a corrigir
-- aquele texto ou a deixar uma referencia mentindo. O runner aplica por ordem
-- numerica e ignora buraco; um 0036 criado depois simplesmente roda depois
-- desta, e as duas nao se tocam.
--
-- O QUE 0034 DEIXOU ANOTADO, e e o problema inteiro: a coluna `estado` nasceu
-- com CHECK ('rascunho','ativo','arquivado') e NAO ESCONDE NADA. A view
-- `canastra.produtos_publicos` (0003:140) nao tem WHERE nenhum, entao todo
-- produto aparece na loja qualquer que seja o estado. Nao houve regressao ate
-- aqui — nada escreve 'rascunho' e o DEFAULT e 'ativo' —, mas a tela de produto
-- da Onda 5 publica um rascunho no primeiro salvamento se a view continuar como
-- esta.
--
-- E O AVISO QUE VEM COLADO NELE: A VIEW TEM DOIS LEITORES, NAO UM.
--
--   a vitrine ............... catalogo e PDP, por `produtos_publicos`;
--   `AvaliarPedido.tsx` ..... usa a MESMA view para mapear product_id -> sku e
--                             decidir o que a pessoa pode avaliar.
--
-- Filtrar sem mais nada tiraria o formulario de avaliacao de quem comprou um
-- cafe que a loja arquivou depois — o pedido esta entregue, `pode_avaliar(sku)`
-- diz sim, e o formulario simplesmente nao apareceria, sem erro nenhum na tela.
-- Por isso esta migracao faz DUAS coisas: filtra a view da vitrine e cria uma
-- segunda janela, estreita, para o mapeamento produto->SKU.

/* ------------------------------------------------------------------------- *
 * 1. `produtos_publicos` deixa de mostrar o arquivado
 * ------------------------------------------------------------------------- */

/**
 * O RECORTE E `estado <> 'arquivado'`, E NAO `estado = 'ativo'` — e a diferenca
 * precisa estar escrita porque ela decide o que a loja mostra.
 *
 * Com este predicado, 'rascunho' CONTINUA VISIVEL na vitrine. Hoje isso e um
 * no-op (nada escreve 'rascunho'), e amanha e uma decisao de produto que a tela
 * da Onda 5 tem de conhecer: se o formulario de produto salvar rascunho, o
 * rascunho aparece. Quem quiser que 'rascunho' esconda tem de trocar este
 * predicado por `estado = 'ativo'` — uma linha, nesta view, com o mesmo GRANT
 * abaixo continuando valido.
 *
 * `estado` ENTRA NA PROJECAO, e nao e escolha estetica: com
 * `security_invoker = true` (0006) a view roda com os privilegios de QUEM
 * CHAMA, e o Postgres confere privilegio de COLUNA sobre tudo que a consulta
 * referencia — inclusive o que so aparece no WHERE. Sem `GRANT SELECT (estado)`
 * a vitrine inteira responderia 42501, e `canastra.produtos` e a unica relacao
 * do schema com privilegio por coluna justamente para `custo` nao vazar. Uma
 * vez que a coluna precisa do GRANT, projeta-la e o que mantem a invariante que
 * test/rls.test.js afirma desde 0006: "a lista publica de colunas de `produtos`
 * e EXATAMENTE a projecao da view". Deixar as duas listas diferentes seria abrir
 * a excecao que aquele teste existe para nao deixar acontecer.
 *
 * E o que `estado` conta a quem le e o que a propria filtragem ja contou: as
 * linhas que sobram sao as nao-arquivadas. `custo`, `criado_em` e `tsv`
 * continuam fora das duas listas.
 *
 * CREATE OR REPLACE preserva a ACL da view (o GRANT de 0003 e o REVOKE de
 * escrita), mas as OPCOES sao redeclaradas — por isso o `WITH` vem explicito
 * aqui com o `security_invoker = true` que 0006 ligou. Sem ele, a view voltaria
 * a rodar com os poderes do dono, e a vitrine passaria a depender de novo da
 * isencao de RLS que 0006 desmontou de proposito (o modo de falha daquele
 * arranjo e silencioso: FORCE RLS -> vitrine vazia, sem erro e sem log).
 */
CREATE OR REPLACE VIEW canastra.produtos_publicos
  WITH (security_invoker = true)
AS
  SELECT produto_id, nome, tamanho, categoria, preco, imagem, quantidade,
         descricao, peso, largura, altura, comprimento, destacado_em, sku,
         estado
  FROM canastra.produtos
  WHERE estado <> 'arquivado';

-- A lista publica de coluna e a projecao da view andam juntas, e agora as duas
-- ganham `estado`. Ver o paragrafo acima: sem este GRANT o proprio WHERE da
-- view seria 42501 para `anon`.
GRANT SELECT (estado) ON canastra.produtos TO anon, authenticated;

/* ------------------------------------------------------------------------- *
 * 2. `produtos_sku`: a janela do SEGUNDO leitor
 * ------------------------------------------------------------------------- */

/**
 * DUAS COLUNAS, E SO ELAS: `produto_id` e `sku`.
 *
 * `AvaliarPedido.tsx` faz uma coisa com a view publica — traduz o `product_id`
 * que esta congelado em `pedidos.itens` para o `sku` por onde a avaliacao e
 * gravada (`canastra.avaliacoes.sku`, 0014). Quem decide se aquela pessoa PODE
 * avaliar continua sendo `canastra.pode_avaliar(sku)`, que confere pedido
 * `entregue` do proprio `auth.uid()` e nao olha estado nenhum: um produto
 * arquivado depois da venda continua avaliavel, e e assim que tem de ser — a
 * pessoa comprou, recebeu e tem o que dizer.
 *
 * Ou seja, a view precisa mostrar TODOS os estados. Se ela filtrasse igual a de
 * cima, arquivar um cafe apagaria em silencio o formulario de avaliacao de quem
 * o comprou; e se a de cima nao filtrasse, o rascunho ia para a loja. Sao dois
 * recortes diferentes porque sao duas perguntas diferentes.
 *
 * `TO authenticated` E NAO `anon`: so quem tem conta abre a pagina do proprio
 * pedido. `anon` nao tem por que enumerar SKU de produto arquivado.
 *
 * `security_invoker = true`, como a irma: a leitura passa pelo GRANT de coluna
 * de `canastra.produtos` (produto_id e sku ja estao na lista publica desde
 * 0006) e pela politica `produtos_leitura_publica`. Nenhuma isencao de dono no
 * caminho — a mesma correcao que 0006 fez na view da vitrine, feita de nascenca
 * aqui.
 */
CREATE VIEW canastra.produtos_sku
  WITH (security_invoker = true)
AS
  SELECT produto_id, sku
  FROM canastra.produtos;

GRANT SELECT ON canastra.produtos_sku TO authenticated;

/**
 * A view e uma janela de LEITURA, e este REVOKE nao e higiene: e conserto.
 *
 * Os ALTER DEFAULT PRIVILEGES de 0001 valem tambem para VIEWS ("TABLES" ali
 * abrange tabela, view e foreign table), entao esta view NASCE com
 * INSERT/UPDATE/DELETE concedidos a `authenticated` — e ela e auto-atualizavel
 * (projecao simples de uma tabela so, sem DISTINCT, GROUP BY, agregado ou
 * juncao), entao o Postgres aceitaria escrita atraves dela. E o mesmo furo que
 * 0003 fechou em `produtos_publicos` depois de medi-lo. Aqui a politica
 * `produtos_admin_escreve` ja barraria a linha (a view e security_invoker), mas
 * duas trancas continuam melhores que uma, e o REVOKE e a que nao depende de
 * nenhuma politica continuar existindo.
 *
 * `service_role` fica de fora do REVOKE, como sempre: e credencial de servidor.
 */
REVOKE INSERT, UPDATE, DELETE ON canastra.produtos_sku FROM authenticated;
