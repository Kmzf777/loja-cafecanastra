-- ============================================================================
-- Loja do Café Canastra — RESET TOTAL do banco
--
-- ARQUIVO GERADO. Não edite à mão.
--   Gerador: node backend/db/gerar-instalacao.js   (npm run db:gerar-sql)
--
-- !!! LEIA. Isto apaga o banco inteiro e não tem desfazer. !!!
--
-- O QUE ISTO DESTRÓI
--   · TODOS os schemas que não são do Supabase — inclusive "public" (recriado
--     vazio) e "canastra". Tabelas, dados, views, funções, políticas: tudo.
--   · TODOS os usuários de auth.users e, em cascata, suas identidades, sessões
--     e refresh tokens. Ninguém entra depois disto até você recriar.
--   · Os buckets e objetos do Storage, QUANDO o servidor deixar. O Supabase
--     gerenciado protege essas tabelas com um trigger e recusa DELETE direto
--     (42501, "Use the Storage API instead"). Nesse caso o reset avisa e segue —
--     esvazie os buckets pelo painel. Hoje isso é inofensivo: a loja só passa a
--     usar Storage na fase F3.
--
-- O QUE FICA DE PÉ
--   Os schemas que o Supabase administra: auth, storage, realtime, extensions,
--   graphql, vault, supabase_functions, cron, net. Eles não são dados do seu
--   projeto — são a instalação do Supabase. Derrubá-los não limparia nada:
--   quebraria os serviços, e nenhum SQL de instalação reconstrói isso.
--
-- QUANDO USAR
--   Num banco de TESTE que é só deste projeto, para reinstalar do zero.
--
-- QUANDO NÃO USAR
--   · Em produção. Nunca.
--   · Numa instância compartilhada com outros projetos seus: este arquivo apaga
--     por CATEGORIA, não por nome, e os outros projetos morrem junto.
--
-- DEPOIS DELE
--   Cole backend/db/instalacao-completa.sql, que recria tudo: schema, tabelas,
--   RLS, RPC, catálogo com 29 SKUs e as duas contas de teste.
-- ============================================================================

DO $reset$
DECLARE
  -- Schemas da instalação do Supabase. Tudo que não estiver aqui é tratado como
  -- dado de projeto e cai. A lista é generosa de propósito: derrubar um schema
  -- de serviço por engano quebra a instância, enquanto o preço de ser
  -- conservador é deixar de apagar algo de que ninguém sente falta.
  protegidos text[] := ARRAY[
    'information_schema', 'public',
    'auth', 'storage', 'realtime', '_realtime', 'extensions', 'graphql',
    'graphql_public', 'vault', 'pgsodium', 'pgsodium_masks', 'supabase_functions',
    'supabase_migrations', 'cron', 'net', 'pgbouncer', 'dbdev', 'pgtle',
    '_analytics', '_supavisor', 'pgmq'
  ];
  s          record;
  n          integer;
  derrubados integer := 0;
BEGIN
  -- -- 1. Schemas do projeto ------------------------------------------------
  -- "public" fica FORA deste laço, tratado logo abaixo: ele não pode ser
  -- derrubado e esquecido, porque meio mundo assume que ele existe.
  FOR s IN
    SELECT nspname FROM pg_namespace
    WHERE nspname <> ALL (protegidos)
      AND nspname NOT LIKE 'pg\_%'
    ORDER BY nspname
  LOOP
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s.nspname);
    derrubados := derrubados + 1;
    RAISE NOTICE 'Schema removido: %', s.nspname;
  END LOOP;

  -- -- 2. public, zerado e devolvido ao padrão ------------------------------
  -- Derrubar e recriar é mais confiável que apagar tabela a tabela: pega view,
  -- função, tipo, sequência e trigger que um DROP TABLE deixaria para trás.
  DROP SCHEMA IF EXISTS public CASCADE;
  CREATE SCHEMA public;

  -- Os privilégios de fábrica. Sem isto, o PostgREST e o painel do Supabase
  -- passam a responder "permission denied for schema public" em tudo — e o
  -- sintoma não aponta para o reset.
  ALTER SCHEMA public OWNER TO pg_database_owner;
  COMMENT ON SCHEMA public IS 'standard public schema';
  GRANT USAGE ON SCHEMA public TO public;
  GRANT ALL   ON SCHEMA public TO postgres, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
  RAISE NOTICE 'Schema "public" recriado vazio, com os privilégios padrão.';

  -- -- 3. Storage -----------------------------------------------------------
  -- Objetos antes de buckets: há FK entre os dois. Os arquivos em si seguem no
  -- disco (ou no S3) até o coletor do Storage passar; o que some aqui é o
  -- registro, que é o que a API enxerga.
  --
  -- CADA PASSO NUM BLOCO COM EXCEPTION, E ISSO NÃO É ZELO EXCESSIVO.
  -- O Supabase gerenciado protege estas tabelas com um trigger
  -- (`storage.protect_delete`) que recusa DELETE direto:
  --
  --   42501: Direct deletion from storage tables is not allowed.
  --          Use the Storage API instead.
  --
  -- Como o reset inteiro é UM comando `DO`, ou seja, UMA transação, essa recusa
  -- abortava tudo — inclusive os DROP SCHEMA que já tinham rodado. O operador
  -- via um erro sobre Storage e ficava com o banco intacto, sem entender por
  -- quê. Com o bloco `EXCEPTION`, a recusa vira um aviso e o reset segue.
  --
  -- Não desligamos o trigger de propósito. Ele existe porque apagar a linha sem
  -- passar pela Storage API deixa o arquivo órfão no bucket, e um reset de banco
  -- não tem por que sujar o storage de arquivos que ninguém mais referencia.
  IF to_regclass('storage.objects') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DELETE FROM storage.objects';
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'Objetos do Storage removidos: %', n;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Storage: objetos NÃO removidos (%). Esvazie os buckets pelo painel do Supabase ou pela Storage API.', SQLERRM;
    END;
  END IF;

  IF to_regclass('storage.buckets') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DELETE FROM storage.buckets';
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'Buckets do Storage removidos: %', n;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Storage: buckets NÃO removidos (%). Apague-os pelo painel do Supabase.', SQLERRM;
    END;
  END IF;

  -- -- 4. Contas ------------------------------------------------------------
  -- DELETE, e não TRUNCATE: as tabelas do GoTrue (identities, sessions,
  -- refresh_tokens, mfa_factors) pendem de auth.users por FK ON DELETE CASCADE,
  -- e o DELETE dispara essas cascatas. O TRUNCATE exigiria listar cada uma — e
  -- a lista muda de versão para versão do GoTrue.
  --
  -- Também com EXCEPTION, pelo mesmo motivo do Storage: se uma versão do GoTrue
  -- proteger a tabela, ou se uma FK de outro projeto travar a cascata, o reset
  -- avisa em vez de desfazer os DROP SCHEMA que já rodaram.
  IF to_regclass('auth.users') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DELETE FROM auth.users';
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'Contas removidas de auth.users: %', n;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Contas NÃO removidas (%). Apague-as em Authentication > Users no painel.', SQLERRM;
    END;
  END IF;

  IF to_regclass('auth.audit_log_entries') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DELETE FROM auth.audit_log_entries';
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'Entradas de auditoria do GoTrue removidas: %', n;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Auditoria do GoTrue não pôde ser limpa (%) — inofensivo.', SQLERRM;
    END;
  END IF;

  RAISE NOTICE '---';
  RAISE NOTICE 'Reset concluído. % schema(s) de projeto removido(s).', derrubados;
  RAISE NOTICE 'Agora cole backend/db/instalacao-completa.sql.';
END $reset$;
