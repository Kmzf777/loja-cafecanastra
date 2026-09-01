-- Auditoria: quem mexeu no que, e com que papel.
--
-- O QUE NAO EXISTE HOJE, e e o problema inteiro: `canastra.admins` tem duas
-- colunas — `user_id` e `criado_em` — e nada mais. Todo administrador pode tudo,
-- e NENHUM gesto do painel deixa rastro. Num painel que cria promocao, muda
-- preco e emite NF-e, tres perguntas normais de operacao nao tem resposta:
--
--   "quem aprovou este desconto de 50%?"
--   "quem mudou o preco do micro-lote na sexta a noite?"
--   "quem baixou a base inteira com CPF e e-mail?"
--
-- A terceira e a mais urgente e e a que a spec §3.9 nomeia: a exportacao de
-- pedidos de hoje baixa TUDO quando as datas ficam vazias — sem confirmacao, sem
-- teto e sem registro nenhum de quem pediu. Toda exportacao de lista com dado
-- pessoal passa a gravar aqui quem exportou e quando, e isso e requisito de LGPD
-- (prestacao de contas, art. 6º, X), nao capricho de auditoria.
--
-- ESTA MIGRACAO NAO REGISTRA NADA SOZINHA. Ela cria o lugar; quem escreve a linha
-- e a Onda 4, no mesmo gesto que faz a acao. Ver o limite conhecido, abaixo.

/* ------------------------------------------------------------------------- *
 * 1. `admins.papel`
 * ------------------------------------------------------------------------- */

/**
 * A COLUNA NASCE SEM INTERFACE, DE PROPOSITO. A spec §8 e explicita: "papeis e
 * permissoes granulares" estao FORA do escopo — o painel tem dois usuarios, e
 * uma matriz de permissao para duas pessoas e cerimonia. Ela entra agora por um
 * motivo so: acrescentar coluna a `canastra.admins` depois exigiria uma migracao
 * no meio de uma onda de interface, e o custo de ter a coluna vazia e zero.
 *
 * DEFAULT 'dono' PARA AS LINHAS QUE JA EXISTEM, e essa e a unica escolha segura:
 * qualquer outro default REBAIXARIA, no instante do deploy, as duas pessoas que
 * hoje administram a loja. O default certo aqui e o mais permissivo, porque a
 * coluna ainda nao decide nada — e no dia em que decidir, quem rebaixa alguem faz
 * isso de propria vontade, na tela.
 *
 * A LISTA FECHADA MAPEIA AS TELAS QUE EXISTEM, nao uma hierarquia inventada:
 *   dono ....... tudo, inclusive dinheiro (custo, promocao, configuracao, Bling);
 *   gerente .... catalogo, promocao e pedido — o dia a dia comercial;
 *   operador ... expedicao: status, rastreio, etiqueta. Nao ve custo nem margem.
 * Um papel fora da lista nao seria uma permissao nova: seria uma pessoa que
 * NENHUMA tela sabe classificar, e o codigo teria de escolher entre negar tudo
 * (ela para de trabalhar) ou permitir tudo (o papel nao serviu para nada). As
 * duas saidas sao piores que 23514 no UPDATE.
 *
 * QUEM ESCREVE ESTA COLUNA E SO O SERVICO. 0003:269 revogou
 * INSERT/UPDATE/DELETE de `authenticated` em `canastra.admins` e nenhuma politica
 * de escrita existe — as duas camadas negam, que e como tem de ser na tabela onde
 * o estrago e maior. Isso vale para `papel` sem nada a acrescentar aqui: um
 * `UPDATE admins SET papel = 'dono' WHERE user_id = auth.uid()` seria a
 * auto-promocao que aquele REVOKE existe para impedir.
 */
ALTER TABLE canastra.admins
  ADD COLUMN papel text NOT NULL DEFAULT 'dono'
    CONSTRAINT admins_papel_valido
      CHECK (papel IN ('dono', 'gerente', 'operador'));

/**
 * O TRIGGER `admins_nunca_zero` (0002:118) CONTINUA VALENDO, e foi conferido em
 * vez de suposto.
 *
 * Ele e `AFTER DELETE ... REFERENCING OLD TABLE AS apagados FOR EACH STATEMENT`,
 * e a funcao so pergunta duas coisas: se a tabela de transicao tem alguma linha,
 * e se sobrou algum admin. Nenhuma das duas olha a LISTA de colunas — uma tabela
 * de transicao acompanha o formato da tabela sozinha —, entao um ALTER TABLE ADD
 * COLUMN nao a alcanca. Medido em test/auditoria.test.js: com duas admins,
 * remover uma passa; remover a segunda recusa com 23001, como sempre recusou.
 *
 * Este paragrafo existe porque o modo de falha seria MUDO — a loja aceitando
 * ficar sem administrador nenhum — e ninguem procuraria a causa numa coluna nova.
 */

/* ------------------------------------------------------------------------- *
 * 2. `admin_log`
 * ------------------------------------------------------------------------- */

CREATE TABLE canastra.admin_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  /**
   * A CHAVE APONTA PARA `clientes`, E NAO PARA `admins`, E ESSA E A DECISAO DA
   * TABELA.
   *
   * `admins.user_id` e a escolha obvia — o log e "quem administrou" — e ela tem
   * um efeito que so aparece tarde: `ON DELETE CASCADE` apagaria o log inteiro de
   * quem deixasse de ser admin, e `ON DELETE SET NULL` anonimizaria. Nos dois
   * casos, tirar alguem do time apagaria o nome dela do que ela ja fez — no
   * exato momento em que alguem pergunta o que ela fez. Uma democao nao pode ser
   * uma borracha.
   *
   * Apontando para `clientes`, sair de `canastra.admins` nao toca o log (medido),
   * e o unico evento que anonimiza a linha e a EXCLUSAO DA CONTA — que e o que a
   * LGPD manda mesmo. `SET NULL` e nao `CASCADE` pelo motivo de `pedidos` em
   * 0005: o registro do que aconteceu sobrevive a pessoa; e a coluna e NULAVEL de
   * verdade, pela armadilha que 0005 e 0032 ja documentaram (o Postgres ACEITA
   * declarar SET NULL numa coluna NOT NULL e so estoura no DELETE, com 23502,
   * deixando a exclusao de dados pessoais impossivel).
   *
   * O TROCO, escrito para nao surpreender: um log com `admin_user_id` nulo diz
   * "uma conta que nao existe mais fez isto". E menos do que se queria e mais do
   * que se tem hoje, que e nada.
   */
  admin_user_id uuid REFERENCES canastra.clientes (user_id) ON DELETE SET NULL,

  /**
   * `acao` E TEXTO LIVRE, E ISSO CONTRARIA O RESTO DESTA ONDA DE PROPOSITO.
   *
   * 0032 fecha todo vocabulario com CHECK, e 0033 e 0034 fazem o mesmo. Aqui a
   * regra se inverte pelo mesmo motivo que inverteu nas colunas de atribuicao de
   * 0033: o log e gravado na MESMA TRANSACAO da acao que ele registra — e essa e
   * a unica forma de ele nao mentir por omissao. Entao um CHECK que recusasse uma
   * `acao` fora da lista nao produziria um relatorio melhor: faria ROLLBACK DA
   * ACAO. A auditoria passaria a poder DERRUBAR a loja, e derrubaria justamente
   * na tela nova, que e a que ninguem lembrou de acrescentar a lista.
   *
   * O troco e real e conhecido: 'preco_alterado' e 'precoAlterado' viram duas
   * linhas de relatorio. A disciplina de vocabulario mora numa constante do
   * servico, na Onda 4, onde o custo de errar e um relatorio feio e nao uma venda
   * perdida. O CHECK que fica e so o que nao pode custar nada: nao ser vazio.
   */
  acao text NOT NULL
         CONSTRAINT admin_log_acao_preenchida CHECK (btrim(acao) <> ''),

  -- SOBRE O QUE ('produto', 'promocao', 'pedido', 'config_loja', 'pedidos' numa
  -- exportacao). Mesma razao de `acao` para nao ser lista fechada.
  entidade text NOT NULL
             CONSTRAINT admin_log_entidade_preenchida CHECK (btrim(entidade) <> ''),

  -- QUAL. `text` e nao `uuid` porque nem toda entidade tem uuid (`config_loja` e
  -- a linha 1, um SKU e texto) e porque uma FK aqui amarraria o log ao objeto —
  -- e apagar o objeto nao pode apagar o registro de que ele foi apagado.
  --
  -- NULAVEL: a exportacao de uma LISTA nao tem entidade_id, e e justamente o
  -- gesto mais sensivel da tabela. Exigir um id aqui obrigaria a inventar um.
  entidade_id text,

  -- O QUE ERA E O QUE FICOU. Os dois nulaveis, e as tres formas sao legitimas:
  -- criacao tem so `depois`, remocao tem so `antes`, alteracao tem os dois. Uma
  -- exportacao nao tem nenhum dos dois e o `depois` guarda o filtro usado, que e
  -- o que responde "baixou a base inteira ou so a semana?".
  --
  -- Sem CHECK de "pelo menos um": um log de leitura (exportacao, consulta de
  -- custo) legitimamente nao tem antes nem depois, e a acao ja diz o que foi.
  antes  jsonb,
  depois jsonb,

  criado_em timestamptz NOT NULL DEFAULT now()
);

-- A tela de auditoria abre em "o que aconteceu por ultimo".
CREATE INDEX admin_log_recente_idx ON canastra.admin_log (criado_em DESC);

-- "O historico DESTE produto" — a pergunta que se faz olhando para uma coisa
-- especifica, que e como a duvida costuma chegar ("por que este cafe esta com
-- este preco?").
CREATE INDEX admin_log_entidade_idx
  ON canastra.admin_log (entidade, entidade_id, criado_em DESC);

-- "O que ESTA pessoa fez" — a pergunta do dia da democao. Parcial porque a linha
-- de autor nulo (conta excluida) nunca e resposta dela.
CREATE INDEX admin_log_autor_idx
  ON canastra.admin_log (admin_user_id, criado_em DESC)
  WHERE admin_user_id IS NOT NULL;

/* ------------------------------------------------------------------------- *
 * 3. Privilegios
 * ------------------------------------------------------------------------- */

/**
 * `anon` NAO RECEBE NADA, e nao ha REVOKE a escrever: 0001 inverteu o padrao de
 * proposito e tabela nova nao nasce legivel por visitante anonimo. O log carrega
 * o uuid de quem administra a loja e o jsonb de antes/depois de cada mudanca —
 * incluindo preco de custo e, num log de exclusao de cliente, o que foi apagado.
 * A spec §3.10 o nomeia junto de `promocao_resgates`, `consentimentos` e
 * `envios`. Medido em test/auditoria.test.js: `SELECT` como `anon` responde
 * 42501.
 */

/**
 * NEM A ADMIN ESCREVE AQUI PELO NAVEGADOR — e este REVOKE e o que faz o log ser
 * um log.
 *
 * E o desenho de `promocao_resgates` e `pedido_ajustes_desconto` em 0032 ("as
 * duas tabelas de registro so o servico escreve"), e aqui ele vale com mais
 * forca, por duas razoes que se somam:
 *
 *   1. O LOG PRECISA NASCER NA TRANSACAO DA ACAO. Um INSERT separado, disparado
 *      pelo navegador depois do UPDATE, e um log que some quando a rede cai entre
 *      os dois — e some exatamente na hora em que alguma coisa deu errado, que e
 *      quando ele seria lido. Escrito pelo servico, na mesma transacao, ou os
 *      dois acontecem ou nenhum.
 *   2. UM LOG QUE O AUDITADO REESCREVE NAO E AUDITORIA. `UPDATE` e `DELETE`
 *      concedidos a `authenticated` deixariam a admin corrigir a propria
 *      pegada — e o alcance seria a linha inteira, porque politica de RLS nao
 *      restringe coluna. Sem privilegio, nao ha politica distraida que reabra.
 *
 * `SELECT` NAO ENTRA NO REVOKE, de proposito: a admin LE o log (e a tela de
 * auditoria). Quem recorta a LINHA e a politica, que e o mecanismo certo para
 * esse recorte — diferente das operacoes inteiras acima. A distincao e a regra de
 * 0006:282 que 0031 repetiu: GRANT decide TABELA e COLUNA, RLS decide LINHA.
 *
 * LIMITE CONHECIDO, E ELE E O UNICO HONESTO A REGISTRAR: o log e escrito pelo
 * MESMO codigo que faz a acao, entao uma acao nova cujo autor esqueceu de chamar
 * o registro nao deixa rastro nenhum — e a ausencia e silenciosa. A alternativa
 * a prova de esquecimento seria um trigger no banco, e ele NAO consegue fazer
 * este trabalho aqui: o painel escreve pelo pool do Express, que conecta como
 * DONO do banco e sem claim nenhum, entao `auth.uid()` dentro de um trigger seria
 * NULL e todo log sairia sem autor — que e a unica coluna que a tabela existe
 * para guardar. Registrar quem foi exige que quem SABE quem foi escreva a linha.
 * O que fecha essa lacuna e teste, na Onda 4, por rota.
 */
REVOKE INSERT, UPDATE, DELETE ON canastra.admin_log FROM authenticated;

/* ------------------------------------------------------------------------- *
 * 4. RLS
 * ------------------------------------------------------------------------- */

ALTER TABLE canastra.admin_log ENABLE ROW LEVEL SECURITY;

/**
 * Leitura so da admin, e nada mais — nem cliente, nem `anon`, nem o token valido
 * de outro projeto da instancia compartilhada.
 *
 * `FOR SELECT` e nao `FOR ALL`, mesmo com o REVOKE de escrita ja no lugar: uma
 * politica `FOR ALL` aqui ficaria esperando o dia em que alguem devolvesse o
 * GRANT "so para testar", e a decisao de que ninguem escreve pelo navegador
 * deixaria de aparecer no diff. E a disciplina de 0031 — o privilegio e a tranca
 * de producao, a politica e a que se le.
 *
 * `TO authenticated` NAO E ENFEITE: sem clausula TO a politica nasce `TO public`,
 * e `public` alcanca tambem o DONO das tabelas — de quem `eh_admin()` depende
 * para ler `admins` por baixo da RLS. Foi assim que 0030 descobriu, do jeito
 * dificil.
 *
 * `canastra.eh_admin()` e nao um claim de JWT, pela razao do cabecalho de 0006: a
 * instancia do Supabase e COMPARTILHADA com outros projetos do mesmo dono, e um
 * token emitido para outro projeto chega aqui com assinatura valida, papel
 * `authenticated` e `auth.uid()` preenchido — carregando no `user_metadata` o que
 * quiser. Ser admin desta loja e ter LINHA em `canastra.admins`.
 *
 * E NENHUM NOME NOVO VAI PARA A LISTA `PUBLICAS` de test/rls.test.js: nao ha aqui
 * politica `USING (true)` nenhuma, como nao houve em 0032 nem em 0033.
 */
CREATE POLICY admin_log_admin_le ON canastra.admin_log
  FOR SELECT TO authenticated
  USING (canastra.eh_admin());
