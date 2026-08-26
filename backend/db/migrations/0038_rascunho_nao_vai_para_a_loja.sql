-- O rascunho deixa de aparecer na vitrine.
--
-- A 0037 recortou `produtos_publicos` por `estado <> 'arquivado'` e escreveu, no
-- proprio arquivo, que a escolha deixava 'rascunho' VISIVEL — e que trocar por
-- `estado = 'ativo'` seria uma linha. Esta e a linha.
--
-- POR QUE A DECISAO INVERTEU. Enquanto nada escrevia 'rascunho', os dois
-- predicados eram o mesmo no-op e a diferenca era teorica. A tela de produto da
-- Onda 5 acaba com isso: ela salva rascunho, e com o predicado antigo o rascunho
-- ia para a loja NO PRIMEIRO SALVAMENTO — cafe sem foto, sem descricao e com
-- preco provisorio, publicado por alguem que achou que estava rascunhando. O
-- estado se chama 'rascunho' justamente porque a promessa dele e nao estar
-- publicado; um predicado que o publica desmente o nome da coluna.
--
-- A LISTA BRANCA E A DEFESA CERTA AQUI. `<> 'arquivado'` e lista negra: um
-- estado novo no CHECK amanha (digamos 'em_revisao') nasce PUBLICO por omissao,
-- e a falha e por esquecimento, que e a que ninguem revisa. `= 'ativo'` faz o
-- contrario: estado novo nasce invisivel, e quem quiser publica-lo tem de vir
-- aqui e escrever isso num diff.
--
-- POR QUE UMA MIGRACAO NOVA E NAO UMA EDICAO DA 0037. A chave de controle em
-- `canastra.migracoes` e o NOME COMPLETO do arquivo: uma 0037 ja aplicada nao
-- roda de novo, entao editar o conteudo dela mudaria o schema de quem instalasse
-- do zero e NAO mudaria o de quem ja aplicou. Duas realidades com o mesmo numero
-- e pior do que um numero a mais.

/**
 * O que NAO muda, e precisa continuar assim:
 *
 *  - `WITH (security_invoker = true)`. `CREATE OR REPLACE` preserva a ACL, mas
 *    REDECLARA as opcoes: omitir aqui faria a view voltar a rodar com os poderes
 *    do dono, e a vitrine dependeria de novo da isencao de RLS que 0006
 *    desmontou de proposito. O modo de falha daquele arranjo e silencioso —
 *    FORCE RLS ligado, vitrine vazia, sem erro e sem log.
 *
 *  - A projecao, incluindo `estado`. Com `security_invoker`, o Postgres exige
 *    privilegio de coluna sobre tudo que a view referencia, inclusive o que so
 *    aparece no WHERE. O `GRANT SELECT (estado)` de 0037 continua valendo e e o
 *    que impede este WHERE de virar 42501 para `anon`.
 *
 *  - `canastra.produtos_sku` fica INTACTA, e e por isso que ela existe. Ela
 *    mostra todos os estados de proposito: `AvaliarPedido.tsx` traduz o
 *    `product_id` congelado em `pedidos.itens` para o `sku` da avaliacao, e quem
 *    comprou um cafe que foi arquivado depois continua tendo o que dizer. Sao
 *    dois recortes diferentes porque sao duas perguntas diferentes.
 */
CREATE OR REPLACE VIEW canastra.produtos_publicos
  WITH (security_invoker = true)
AS
  SELECT produto_id, nome, tamanho, categoria, preco, imagem, quantidade,
         descricao, peso, largura, altura, comprimento, destacado_em, sku,
         estado
  FROM canastra.produtos
  WHERE estado = 'ativo';
