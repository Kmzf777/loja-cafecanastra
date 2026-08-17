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
