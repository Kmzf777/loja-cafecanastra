-- ============================================================================
-- Loja do Café Canastra — reset do banco
--
-- ARQUIVO GERADO. Não edite à mão.
--   Gerador: node backend/db/gerar-instalacao.js
--
-- !! LEIA ANTES DE RODAR. Isto apaga dados e nao tem volta.
--
-- O QUE ISTO DESTRÓI
--   · O schema "canastra" inteiro, com CASCADE: catálogo, clientes, endereços,
--     sacolas, pedidos, promoções, configuração da loja, políticas de RLS, as
--     funções eh_cliente/eh_admin/fundir_sacola e o registro de migrações.
--   · Somente estas contas de autenticação, por endereço exato:
--     admin@canastra.teste
--     cliente@canastra.teste
--
-- O QUE ISTO DEIXA EM PAZ, DE PROPÓSITO
--   · Todo o resto de auth.users. Numa instância Supabase self-hosted, auth.users
--     é ÚNICO e compartilhado entre todos os projetos que rodam nela. Um
--     "DELETE FROM auth.users" aqui apagaria as contas dos seus outros projetos.
--     Por isso o filtro é por igualdade de endereço, nunca por LIKE ou padrão:
--     um "%teste%" pegaria "contato@meurestaurante.com.br" no dia em que alguém
--     se cadastrasse com "teste" no endereço.
--   · Os schemas public, storage, realtime, extensions e vault.
--   · As extensões instaladas.
--
-- QUANDO USAR
--   Antes de recolar backend/db/instalacao-completa.sql num banco de TESTE.
--   Em produção, não. Não existe motivo legítimo para rodar isto num banco com
--   pedido de cliente de verdade dentro.
-- ============================================================================

DO $reset$
DECLARE
  contas_de_teste text[] := ARRAY['admin@canastra.teste', 'cliente@canastra.teste'];
  ids_apagados    uuid[];
  havia_schema    boolean;
  n_identidades   integer;
  n_usuarios      integer;
BEGIN
  havia_schema := EXISTS (
    SELECT 1 FROM information_schema.schemata WHERE schema_name = 'canastra'
  );

  -- O schema primeiro: enquanto canastra.clientes existir, a FK para auth.users
  -- (ON DELETE CASCADE) faz o delete das contas mexer em tabela que vai morrer
  -- de qualquer forma. Derrubar o schema antes deixa o passo seguinte trivial.
  DROP SCHEMA IF EXISTS canastra CASCADE;

  IF havia_schema THEN
    RAISE NOTICE 'Schema "canastra" removido.';
  ELSE
    RAISE NOTICE 'Schema "canastra" não existia — nada a remover.';
  END IF;

  -- Só as contas nomeadas. O ANY sobre o array é igualdade exata, item a item.
  SELECT array_agg(id) INTO ids_apagados
  FROM auth.users
  WHERE email = ANY (contas_de_teste);

  IF ids_apagados IS NULL OR array_length(ids_apagados, 1) = 0 THEN
    RAISE NOTICE 'Nenhuma conta de teste encontrada — nada a remover em auth.';
  ELSE
    DELETE FROM auth.identities WHERE user_id = ANY (ids_apagados);
    GET DIAGNOSTICS n_identidades = ROW_COUNT;
    RAISE NOTICE 'Identidades removidas: %', n_identidades;

    DELETE FROM auth.users WHERE id = ANY (ids_apagados);
    GET DIAGNOSTICS n_usuarios = ROW_COUNT;
    RAISE NOTICE 'Contas removidas: % (%)', n_usuarios, array_to_string(contas_de_teste, ', ');
  END IF;

  RAISE NOTICE 'Reset concluído. Agora cole backend/db/instalacao-completa.sql.';
END $reset$;
