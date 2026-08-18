"use strict";

/**
 * Gera `backend/db/instalacao-completa.sql` — o arquivo que se cola no editor
 * SQL do Supabase para levantar a loja inteira de uma vez.
 *
 * POR QUE UM GERADOR, E NAO UM ARQUIVO ESCRITO A MAO
 * O arquivo colavel precisa conter as mesmas oito migracoes e o mesmo catalogo
 * que `db:migrar` e `db:seed` aplicam. Mantido a mao, ele diverge na primeira
 * migracao nova — e a divergencia nao levanta erro: leva a um banco instalado
 * pelo SQL diferente do instalado pelo runner, e isso so aparece quando alguem
 * compara os dois. Aqui a unica fonte continua sendo `db/migrations/*.sql` e
 * `db/seed.js`; este script so transcreve.
 *
 * O teste `backend/test/instalacao.test.js` sobe DOIS Postgres, aplica o runner
 * num e este arquivo no outro, e compara catalogo a catalogo. E ele que garante
 * que a transcricao continua fiel.
 *
 * Uso: node backend/db/gerar-instalacao.js
 */

const fs = require("node:fs");
const path = require("node:path");

const { BOOTSTRAP, listarMigracoes, PASTA_PADRAO } = require("./migrar.js");
const {
  COLUNAS_DE_PRODUTO,
  linhasDeProdutos,
  linhasDeOpcoes,
  valoresDeConfig,
} = require("./seed.js");

const DESTINO = path.join(__dirname, "instalacao-completa.sql");
const DESTINO_RESET = path.join(__dirname, "reset.sql");

/**
 * Credenciais de teste.
 *
 * Ficam aqui e sao repetidas no cabecalho do SQL para quem for usar nao precisar
 * ler o gerador. Sao de TESTE: o arquivo inteiro cria conta com senha conhecida
 * por quem tem acesso a este repositorio, entao ele nao pode ser aplicado em
 * producao. Em producao a conta inicial nasce pelo GoTrue, via `db:seed`, com
 * SEED_ADMIN_PASSWORD gerado (`openssl rand -base64 24`).
 */
const CONTAS_DE_TESTE = Object.freeze([
  {
    email: "admin@canastra.teste",
    senha: "canastra-teste-admin",
    nome: "Administração de Teste",
    admin: true,
  },
  {
    email: "cliente@canastra.teste",
    senha: "canastra-teste-cliente",
    nome: "Cliente de Teste",
    admin: false,
  },
]);

/** Marcadores que o teste usa para cortar o trecho que o shim de `auth` nao suporta. */
const INICIO_DAS_CONTAS = "-- >>> INICIO CONTAS DE TESTE (o teste local corta daqui)";
const FIM_DAS_CONTAS = "-- <<< FIM CONTAS DE TESTE";

/** Literal SQL a partir de um valor JS. Nunca interpola sem passar por aqui. */
function literal(valor) {
  if (valor === null || valor === undefined) return "NULL";
  if (typeof valor === "number") return String(valor);
  return `'${String(valor).replace(/'/g, "''")}'`;
}

function moldura(titulo) {
  const barra = "-".repeat(76);
  return `\n-- ${barra}\n-- ${titulo}\n-- ${barra}\n`;
}

function cabecalho() {
  const contas = CONTAS_DE_TESTE.map(
    (c) => `--   ${c.admin ? "administrador" : "cliente comum "}  ${c.email}  /  ${c.senha}`,
  ).join("\n");

  return `-- ============================================================================
-- Loja do Café Canastra — instalação completa do banco
--
-- ARQUIVO GERADO. Não edite à mão.
--   Fonte:  backend/db/migrations/*.sql  +  backend/db/seed.js
--   Gerador: node backend/db/gerar-instalacao.js
--
-- Uma edição feita aqui é perdida na próxima geração, e — pior — cria um banco
-- diferente do que \`npm run db:migrar\` produz. O teste
-- backend/test/instalacao.test.js compara os dois e reprova a divergência.
--
-- PARA QUE SERVE
-- Levantar a loja inteira num Supabase novo ou de teste, colando um arquivo só
-- no editor SQL. Inclui: schema, tabelas, RLS, RPC, catálogo com 29 SKUs e duas
-- contas de teste já confirmadas.
--
-- QUANDO NÃO USAR
-- Numa instalação que já rodou. Este arquivo pressupõe que \`canastra\` não
-- existe e aborta se existir. Para aplicar só o que falta, use
-- \`npm run db:migrar\`, que roda cada migração uma vez e registra a versão.
--
-- COMO RODAR DE NOVO DO ZERO
-- \`backend/db/reset.sql\` primeiro, depois este arquivo.
--
-- !! CONTAS DE TESTE COM SENHA PUBLICADA NESTE REPOSITORIO:
${contas}
--
-- Não aplique este arquivo em produção. Lá a conta inicial nasce pelo GoTrue,
-- via \`npm run db:seed\`, com senha gerada.
-- ============================================================================
`;
}

/**
 * Aborta se o schema ja existe, em vez de fingir idempotencia.
 *
 * As migracoes usam `CREATE TABLE` puro, nao `IF NOT EXISTS` — de proposito, pois
 * uma migracao que "cria se nao existir" esconde divergencia de estado. Colar
 * este arquivo em cima de um banco ja instalado, portanto, para no primeiro
 * CREATE, no meio, com parte aplicada. Falhar na PRIMEIRA linha, com uma
 * mensagem que diz o que fazer, e melhor que falhar na trigesima.
 */
function guarda() {
  return `${moldura("0. Guarda: este arquivo é para instalação limpa")}
DO $guarda$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'canastra') THEN
    RAISE EXCEPTION
      'O schema "canastra" já existe neste banco.'
      USING HINT =
        'Para reinstalar do zero: rode backend/db/reset.sql e cole este arquivo de novo. '
        'Para aplicar apenas migrações novas: use npm run db:migrar.';
  END IF;
END $guarda$;

-- pgcrypto: \`crypt()\` e \`gen_salt()\` criam o hash das senhas de teste mais
-- abaixo. Em Supabase gerenciado ja vem instalada; num self-hosted enxuto, nao.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
`;
}

async function secaoDasMigracoes() {
  const migracoes = await listarMigracoes(PASTA_PADRAO);
  let sql = `${moldura(`1. Estrutura: as ${migracoes.length} migrações, na ordem do runner`)}
-- Identico ao BOOTSTRAP de db/migrar.js — inclusive os REVOKE em
-- canastra.migracoes, que mantem o livro-caixa das migracoes fora do PostgREST.
${BOOTSTRAP.trim()}
`;

  for (const { versao, sql: corpo } of migracoes) {
    sql += `${moldura(`1.${versao}`)}
${corpo.trim()}

-- Registra a versao, exatamente como db/migrar.js faria. SEM ISTO, um
-- \`npm run db:migrar\` posterior tentaria reaplicar esta migracao e morreria no
-- primeiro CREATE de objeto ja existente.
INSERT INTO canastra.migracoes (versao) VALUES (${literal(versao)})
  ON CONFLICT (versao) DO NOTHING;
`;
  }

  return sql;
}

function secaoDoCatalogo() {
  const colunas = COLUNAS_DE_PRODUTO.join(", ");
  const produtos = linhasDeProdutos()
    .map((linha) => `  (${linha.map(literal).join(", ")}, now())`)
    .join(",\n");

  const opcoes = linhasDeOpcoes()
    .map((o) => `  (${literal(o.id)}, ${literal(o.tipo)}, ${literal(o.valor)})`)
    .join(",\n");

  const config = valoresDeConfig().map(literal).join(", ");

  return `${moldura("2. Catálogo, filtros e configuração da loja")}
-- Os mesmos valores que db/seed.js escreve, gerados a partir da MESMA funcao
-- (\`linhasDeProdutos()\`). O \`produto_id\` e UUID v5 do \`sku\`, entao ele nao muda
-- entre instalacoes nem entre maquinas — e o que costura a vitrine ao banco.
--
-- DO NOTHING, e nao DO UPDATE: preco e estoque pertencem ao painel a partir da
-- primeira semeadura. Um upsert aqui reverteria, a cada execucao, o preco que o
-- administrador acabou de corrigir.
INSERT INTO canastra.produtos (${colunas}, destacado_em) VALUES
${produtos}
ON CONFLICT (sku) WHERE sku IS NOT NULL DO NOTHING;

INSERT INTO canastra.produto_opcoes (id, tipo, valor) VALUES
${opcoes}
ON CONFLICT (tipo, valor) DO NOTHING;

INSERT INTO canastra.config_loja
  (id, banner_desktop, banner_mobile, titulo_site, whatsapp, barra_de_aviso)
VALUES (1, ${config})
ON CONFLICT (id) DO NOTHING;
`;
}

/**
 * As contas de teste, direto em `auth.users`.
 *
 * POR QUE DIRETO NO BANCO, quando db/seed.js insiste em passar pelo GoTrue
 * O editor SQL do Supabase roda como `postgres`, que e dono de `auth` e pode
 * escrever ali. `service_role` NAO pode — foi medido: 42501, porque so tem USAGE
 * no schema. Entao o seed em producao precisa da Admin API, e este arquivo, que
 * roda como `postgres` num banco de teste, nao precisa.
 *
 * `email_confirmed_at` preenchido: o fluxo normal exige clicar num link de
 * confirmacao, e sem provedor de e-mail configurado a conta ficaria travada no
 * primeiro login — que e exatamente o que se quer testar.
 *
 * A linha em `auth.identities` nao e opcional. Sem ela o GoTrue autentica mas
 * nao reconhece o provedor "email", e o login falha de um jeito que nao diz o
 * porque. `provider_id` e obrigatorio nas versoes atuais.
 *
 * As colunas listadas sao o conjunto estavel; `is_sso_user`, `is_anonymous` e
 * afins ficam no default de proposito, para o arquivo nao quebrar em uma versao
 * de Supabase que ainda nao os tenha.
 */
function secaoDasContas() {
  let sql = `${moldura("3. Contas de teste (senha publicada — nunca em produção)")}
${INICIO_DAS_CONTAS}
-- Este trecho exige o schema \`auth\` de verdade, do GoTrue. O harness de teste
-- local traz so um arremedo de \`auth.users\` (id e email), por isso
-- backend/test/instalacao.test.js corta daqui ate o marcador de fim. A parte de
-- ESTRUTURA acima e comparada linha a linha; esta so se verifica num Supabase.
`;

  for (const conta of CONTAS_DE_TESTE) {
    const tag = conta.admin ? "admin" : "cliente";
    sql += `
DO $conta_${tag}$
DECLARE
  id_do_usuario uuid;
  coluna        text;
BEGIN
  SELECT id INTO id_do_usuario FROM auth.users WHERE email = ${literal(conta.email)};

  IF id_do_usuario IS NULL THEN
    id_do_usuario := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      id_do_usuario,
      'authenticated',
      'authenticated',
      ${literal(conta.email)},
      crypt(${literal(conta.senha)}, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome', ${literal(conta.nome)})
    );

    INSERT INTO auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      id_do_usuario::text,
      id_do_usuario,
      jsonb_build_object('sub', id_do_usuario::text, 'email', ${literal(conta.email)}),
      'email',
      now(), now(), now()
    );

    RAISE NOTICE 'Conta criada no GoTrue: %', ${literal(conta.email)};
  ELSE
    RAISE NOTICE 'Conta já existia, senha preservada: %', ${literal(conta.email)};
  END IF;

  -- OS CAMPOS DE TOKEN PRECISAM SER '' — NUNCA NULL.
  --
  -- Medido contra um Supabase de verdade: com eles em NULL, o login responde
  -- 500 com "Database error querying schema" e nada no erro aponta para a
  -- causa. O GoTrue e escrito em Go e mapeia essas colunas como \`string\`, nao
  -- \`*string\`; ler NULL ali estoura na desserializacao, antes de qualquer
  -- verificacao de senha. A conta existe, a senha esta certa, e o login falha.
  --
  -- Feito em UPDATE, e coluna a coluna com checagem de existencia, porque a
  -- lista muda entre versoes do GoTrue: um INSERT citando coluna que a versao
  -- instalada nao tem quebraria a instalacao inteira.
  FOREACH coluna IN ARRAY ARRAY[
    'confirmation_token', 'recovery_token', 'email_change',
    'email_change_token_new', 'email_change_token_current',
    'phone_change', 'phone_change_token', 'reauthentication_token'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'users'
        AND column_name = coluna
    ) THEN
      EXECUTE format(
        'UPDATE auth.users SET %I = '''' WHERE id = %L AND %I IS NULL',
        coluna, id_do_usuario, coluna
      );
    END IF;
  END LOOP;

  -- O vinculo com a loja. E ESTA linha, e nao o token, que faz alguem ser
  -- cliente daqui: as politicas de RLS todas passam por canastra.eh_cliente().
  INSERT INTO canastra.clientes (user_id, nome)
  VALUES (id_do_usuario, ${literal(conta.nome)})
  ON CONFLICT (user_id) DO NOTHING;
`;

    if (conta.admin) {
      sql += `
  -- Administrador e linha em canastra.admins, nunca claim no JWT — outro projeto
  -- da mesma instancia poderia emitir o claim que quisesse.
  INSERT INTO canastra.admins (user_id) VALUES (id_do_usuario)
  ON CONFLICT (user_id) DO NOTHING;
`;
    }

    sql += `END $conta_${tag}$;
`;
  }

  sql += `
${FIM_DAS_CONTAS}
`;
  return sql;
}

function rodape() {
  return `${moldura("4. Conferência")}
-- Uma linha por migracao: a instalacao ficou registrada e \`npm run db:migrar\` nao
-- tem mais nada a fazer. Se aqui vier menos, alguma migracao nao rodou.
SELECT versao, aplicada_em FROM canastra.migracoes ORDER BY versao;

-- 29 produtos, 1 configuracao, 2 clientes, 1 administrador.
SELECT
  (SELECT count(*) FROM canastra.produtos)       AS produtos,
  (SELECT count(*) FROM canastra.produto_opcoes) AS opcoes,
  (SELECT count(*) FROM canastra.config_loja)    AS config,
  (SELECT count(*) FROM canastra.clientes)       AS clientes,
  (SELECT count(*) FROM canastra.admins)         AS admins;

-- Toda tabela da loja com a RLS ligada. Se alguma vier \`false\`, PARE: a
-- instalacao esta com dado pessoal legivel por quem tiver a chave anonima.
SELECT c.relname, c.relrowsecurity AS rls_ligada
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'canastra' AND c.relkind = 'r'
ORDER BY c.relname;
`;
}

async function gerar() {
  return [
    cabecalho(),
    guarda(),
    await secaoDasMigracoes(),
    secaoDoCatalogo(),
    secaoDasContas(),
    rodape(),
  ].join("\n");
}

/**
 * `reset.sql` — devolve o banco ao estado de projeto Supabase recem-criado.
 *
 * ESCOPO, E POR QUE ELE E TAO LARGO
 * A primeira versao deste arquivo so derrubava o schema `canastra`. Isso resolvia
 * reinstalar A LOJA, mas nao era o que se pedia: num banco de teste onde ainda
 * moram as tabelas da loja ANTIGA (em `public`), rodar o reset e ver "nada
 * mudou" e pior que nao ter reset nenhum, porque parece que funcionou.
 *
 * Entao: cai TODO schema que nao seja do proprio Supabase, `public` inclusive —
 * recriado vazio, com os privilegios de fabrica. Somem todos os usuarios de
 * `auth.users` e todo objeto e bucket do Storage.
 *
 * O QUE FICA DE PE, E POR QUE
 * Os schemas que o Supabase administra: `auth`, `storage`, `realtime`,
 * `extensions`, `graphql`, `vault`, `supabase_functions` e afins. Eles nao sao
 * dados do projeto, sao a instalacao. Derrubar `auth` nao "limparia" o GoTrue —
 * quebraria o servico, e nenhum SQL de instalacao reconstroi isso.
 *
 * ESTE ARQUIVO NAO E PARA INSTANCIA COMPARTILHADA
 * Ele apaga por categoria, nao por nome: qualquer outro projeto que estivesse no
 * mesmo banco morre junto. E deliberado — foi para isso que foi pedido — e e o
 * motivo do aviso no cabecalho.
 */
function gerarReset() {
  return `-- ============================================================================
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
      AND nspname NOT LIKE 'pg\\_%'
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
  -- (\`storage.protect_delete\`) que recusa DELETE direto:
  --
  --   42501: Direct deletion from storage tables is not allowed.
  --          Use the Storage API instead.
  --
  -- Como o reset inteiro é UM comando \`DO\`, ou seja, UMA transação, essa recusa
  -- abortava tudo — inclusive os DROP SCHEMA que já tinham rodado. O operador
  -- via um erro sobre Storage e ficava com o banco intacto, sem entender por
  -- quê. Com o bloco \`EXCEPTION\`, a recusa vira um aviso e o reset segue.
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
`;
}

module.exports = {
  gerar,
  gerarReset,
  CONTAS_DE_TESTE,
  INICIO_DAS_CONTAS,
  FIM_DAS_CONTAS,
  DESTINO,
  DESTINO_RESET,
};

if (require.main === module) {
  gerar()
    .then((sql) => {
      const reset = gerarReset();
      fs.writeFileSync(DESTINO, sql, "utf8");
      fs.writeFileSync(DESTINO_RESET, reset, "utf8");
      const rel = (p) => path.relative(process.cwd(), p);
      console.log(`  · ${rel(DESTINO)} — ${sql.split("\n").length} linhas`);
      console.log(`  · ${rel(DESTINO_RESET)} — ${reset.split("\n").length} linhas`);
      console.log(`  · contas de teste: ${CONTAS_DE_TESTE.map((c) => c.email).join(", ")}`);
    })
    .catch((erro) => {
      console.error(`\n❌ Não consegui gerar o arquivo: ${erro.message}\n`);
      process.exit(1);
    });
}
