"use strict";

/**
 * Gera `backend/db/instalacao-completa.sql` — o arquivo que se cola no editor
 * SQL do Supabase para levantar a loja inteira de uma vez.
 *
 * POR QUE UM GERADOR, E NAO UM ARQUIVO ESCRITO A MAO
 * O arquivo colavel precisa conter as mesmas sete migracoes e o mesmo catalogo
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
  let sql = `${moldura("1. Estrutura: as sete migrações, na ordem do runner")}
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
-- Sete linhas: a instalacao ficou registrada e \`npm run db:migrar\` nao tem mais
-- nada a fazer. Se aqui vier menos de 7, alguma migracao nao rodou.
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
 * `reset.sql`, gerado pelo mesmo script de proposito.
 *
 * A lista de e-mails que o reset apaga TEM de ser a mesma que a instalacao cria.
 * Mantidas em dois arquivos escritos a mao, elas divergem — e a divergencia e
 * silenciosa nas duas direcoes: um e-mail a menos no reset deixa conta orfa em
 * auth.users (e a reinstalacao reaproveita a senha antiga, sem avisar); um
 * e-mail a mais e uma conta apagada que ninguem pediu para apagar. Uma fonte so.
 */
function gerarReset() {
  const emails = CONTAS_DE_TESTE.map((c) => literal(c.email)).join(", ");
  const listaHumana = CONTAS_DE_TESTE.map((c) => `--     ${c.email}`).join("\n");

  return `-- ============================================================================
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
${listaHumana}
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
  contas_de_teste text[] := ARRAY[${emails}];
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
