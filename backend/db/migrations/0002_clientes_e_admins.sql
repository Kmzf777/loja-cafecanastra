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
 * trigger, vale para qualquer caminho — painel, psql, PostgREST ou script.
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
 * ATENCAO PARA A MIGRACAO DE RLS: esta funcao e SECURITY INVOKER, entao o
 * `SELECT ... FROM canastra.admins` daqui passa pelas politicas do papel que
 * disparou o DELETE. Se algum dia `canastra.admins` ganhar RLS que esconda
 * linhas de quem apaga, este NOT EXISTS pode dar verdadeiro com admins
 * existindo, e a trava recusaria uma remocao legitima. Ao ligar a RLS, decidir
 * conscientemente entre manter admins so no alcance do `service_role` (que tem
 * BYPASSRLS) ou tornar esta funcao SECURITY DEFINER com search_path fixo.
 */
CREATE FUNCTION canastra.exigir_um_admin() RETURNS trigger
  LANGUAGE plpgsql
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

CREATE TRIGGER admins_nunca_zero
  AFTER DELETE ON canastra.admins
  REFERENCING OLD TABLE AS apagados
  FOR EACH STATEMENT
  EXECUTE FUNCTION canastra.exigir_um_admin();
