"use strict";

/**
 * Aplicador de migracoes.
 *
 * POR QUE ISTO SUBSTITUI schema.sql
 * `schema.sql` so criava (tudo IF NOT EXISTS) e nunca alterava. A auditoria
 * registrou o efeito (docs/producao.md): a proxima mudanca de coluna seria
 * manual e sem historico. Aqui cada arquivo roda uma vez, em ordem, dentro de
 * uma transacao, e fica registrado.
 *
 * O bootstrap de `canastra.migracoes` vive no codigo, e nao numa migracao, pelo
 * problema obvio do ovo e da galinha: o runner precisa da tabela para saber o
 * que ja rodou.
 */

const fs = require("node:fs/promises");
const path = require("node:path");

const PASTA_PADRAO = path.join(__dirname, "migrations");

/**
 * O REVOKE nao e enfeite, e o unico ponto onde esta tabela e protegida.
 *
 * Hoje `canastra.migracoes` esta fechada por ACIDENTE DE ORDEM: este bootstrap
 * roda ANTES de 0001, e e 0001 que faz `ALTER DEFAULT PRIVILEGES ... GRANT ...
 * TO authenticated`. Default privilege so alcanca objeto criado DEPOIS dele,
 * entao a tabela nasceu sem GRANT nenhum — e por isso `authenticated` leva 42501
 * aqui sem que ninguem tenha decidido isso.
 *
 * O acidente se desfaz sozinho no primeiro cenario em que a tabela for recriada
 * com 0001 ja aplicado: recuperacao de desastre, um 0001 rodado a mao, um DROP
 * TABLE seguido de `migrar`. Ai ela nasce com `arwd` para `authenticated` e SEM
 * RLS, e um token de outro projeto da instancia compartilhada pode inserir a
 * linha `('0007_...')` — que faz o runner PULAR uma migracao futura de seguranca
 * achando que ja rodou. Sem erro, sem log, e o deploy seguinte diz "nada
 * pendente".
 *
 * Ser explicito aqui custa duas linhas e vale nos dois mundos: no banco de hoje
 * e um no-op, e no banco recriado amanha e a unica coisa que fecha a porta.
 *
 * O DO/IF existe porque `migrar.js` tambem roda contra Postgres cru (os testes
 * do proprio runner sobem um schema vazio, sem os papeis do Supabase), e um
 * REVOKE citando papel inexistente aborta o bootstrap inteiro com 42704.
 * `service_role` fica de fora do REVOKE: e credencial de servidor e o runner
 * pode ser executado por ela.
 */
const BOOTSTRAP = `
  CREATE SCHEMA IF NOT EXISTS canastra;
  CREATE TABLE IF NOT EXISTS canastra.migracoes (
    versao      text PRIMARY KEY,
    aplicada_em timestamptz NOT NULL DEFAULT now()
  );
  DO $bootstrap$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON canastra.migracoes FROM anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      REVOKE ALL ON canastra.migracoes FROM authenticated;
    END IF;
  END $bootstrap$;
`;

/**
 * Falha ao aplicar uma migracao, com contexto suficiente para agir.
 *
 * COPIA o `code` do erro do Postgres de proposito. Isto e o oposto do que
 * `test/ajuda/sessao.js` faz com o ErroDeHarness, e pelo motivo oposto: la, o
 * `code` e escondido porque uma falha do harness NAO e uma recusa de politica e
 * confundir as duas faria um teste passar verde a toa. Aqui o erro E o erro do
 * banco, so que embrulhado para dizer QUAL migracao quebrou — se o SQLSTATE
 * sumisse, quem chama teria de casar texto de mensagem para distinguir
 * "relacao ja existe" (42P07) de "sintaxe invalida" (42601), e mensagem do
 * Postgres muda com a versao e com o locale. O erro original continua em
 * `cause`.
 */
class ErroDeMigracao extends Error {
  constructor(mensagem, causa, versao = null) {
    super(mensagem);
    this.name = "ErroDeMigracao";
    this.versao = versao;
    if (causa) {
      this.cause = causa;
      if (causa.code) this.code = causa.code;
    }
  }
}

/** "0010_segunda.sql" -> 10. Ordem numerica, nao alfabetica. */
function numeroDaVersao(arquivo) {
  const inicio = arquivo.match(/^(\d+)_/);
  return inicio ? Number(inicio[1]) : null;
}

/**
 * Responde "este arquivo manda alguma coisa para o banco?".
 *
 * A remocao de comentarios e deliberadamente ingenua e NAO serve para reescrever
 * SQL — so para saber se sobrou algo. Um `--` dentro de um literal de string faz
 * a heuristica cortar demais, e mesmo assim o que sobra continua nao-vazio: todo
 * erro dela cai para o lado de ACEITAR o arquivo, que e o lado seguro. O bloco e
 * nao-guloso pelo mesmo motivo (comentario de bloco aninha no Postgres; casar de
 * menos deixa resto e o arquivo passa, casar demais e que seria ruim).
 */
function temComandoSql(sql) {
  const semComentarios = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
  return semComentarios.trim() !== "";
}

/**
 * Lista as migracoes da pasta ja validadas, lidas e em ordem.
 *
 * A validacao acontece AQUI, num passo separado, e nao dentro do comparador do
 * `sort()`. Dois motivos, os dois medidos:
 *
 * 1. `sort()` nao chama o comparador quando ha um elemento so. Uma pasta com um
 *    unico `cria_tudo.sql` passaria batido pela conferencia e seria executada e
 *    registrada com "cria_tudo" no lugar de uma versao — exatamente o arquivo
 *    que a conferencia existia para barrar.
 * 2. Excecao vinda de comparador sai no meio de uma ordenacao parcial e nao diz
 *    quantos arquivos estao errados; aqui sai uma lista completa, de uma vez.
 *
 * Numeros repetidos sao recusados em vez de tolerados. Com numeros iguais o
 * comparador devolve 0, o `sort()` (estavel desde o ES2019) preserva a ordem do
 * `readdir()`, e essa ordem depende do sistema de arquivos: alfabetica no NTFS,
 * ordem de hash no ext4. Ou seja, a mesma pasta rodaria numa ordem nesta
 * maquina e noutra no VPS, sem aviso nenhum. Dois branches criando `0003_` e um
 * acidente de merge banal; descobri-lo aqui custa renomear um arquivo.
 *
 * A LEITURA DOS ARQUIVOS TAMBEM ACONTECE AQUI, antes de qualquer transacao, e
 * nao dentro do laco que aplica. Ler sob demanda criava uma janela em que a
 * primeira migracao ja estava COMMITADA e a leitura da segunda falhava fora de
 * todo o tratamento de erro — medido com um diretorio no lugar de um arquivo:
 * escapava um EISDIR cru, sem versao e sem sequer o caminho. Lendo tudo antes,
 * essa falha simplesmente nao alcanca um banco ja meio migrado.
 */
async function listarMigracoes(pasta) {
  let entradas;
  try {
    entradas = await fs.readdir(pasta);
  } catch (erro) {
    throw new ErroDeMigracao(
      `Não foi possível ler a pasta de migrações ${pasta}: ${erro.message}`,
      erro,
    );
  }

  const arquivos = entradas.filter((a) => a.endsWith(".sql"));

  const semNumero = arquivos.filter((a) => numeroDaVersao(a) === null);
  if (semNumero.length) {
    throw new ErroDeMigracao(
      `Migração sem prefixo numérico: ${semNumero.join(", ")}. ` +
        "Use NNNN_descricao.sql (ex.: 0003_pedidos.sql).",
    );
  }

  const porNumero = new Map();
  for (const arquivo of arquivos) {
    const numero = numeroDaVersao(arquivo);
    const irmaos = porNumero.get(numero);
    if (irmaos) irmaos.push(arquivo);
    else porNumero.set(numero, [arquivo]);
  }

  const repetidos = [...porNumero.values()].filter((g) => g.length > 1);
  if (repetidos.length) {
    throw new ErroDeMigracao(
      "Número de migração repetido, a ordem ficaria indefinida: " +
        repetidos.map((g) => g.sort().join(" e ")).join("; ") +
        ". Renumere uma delas.",
    );
  }

  arquivos.sort((a, b) => numeroDaVersao(a) - numeroDaVersao(b));

  const migracoes = [];
  for (const arquivo of arquivos) {
    const versao = arquivo.replace(/\.sql$/, "");
    let sql;
    try {
      // `readFile(..., "utf8")` NAO remove o BOM: o U+FEFF entra como primeiro
      // caractere da string, passa por temComandoSql() sem chamar atencao e so
      // estoura la no Postgres, com 22P05 ("character with byte sequence 0xef
      // 0xbb 0xbf"). Essa mensagem nao cita BOM nem editor, entao o operador
      // acaba cacando erro de sintaxe num arquivo que esta correto. E o caminho
      // comum no Windows: basta abrir uma das migracoes no Bloco de Notas e
      // salvar. Cortar na leitura fecha isso no unico ponto por onde todo
      // arquivo de migracao passa.
      sql = (
        await fs.readFile(path.join(pasta, arquivo), "utf8")
      ).replace(/^\uFEFF/, "");
    } catch (erro) {
      throw new ErroDeMigracao(
        `Não foi possível ler a migração ${arquivo}: ${erro.message}`,
        erro,
        versao,
      );
    }

    // Arquivo vazio (ou so com comentario) e uma armadilha silenciosa, nao um
    // caso inofensivo: criar 0004_enderecos.sql, rodar o migrar por habito e SO
    // ENTAO escrever o SQL deixa a versao registrada para sempre como aplicada,
    // com o conteudo real nunca executado — e o proximo migrar responde "nada
    // pendente". Sem checksum (fora de escopo, e continua fora), recusar o
    // arquivo vazio e o que fecha essa porta.
    if (!temComandoSql(sql)) {
      throw new ErroDeMigracao(
        `A migração ${arquivo} não tem nenhum comando SQL (está vazia ou só tem ` +
          "comentários). Ela seria registrada como aplicada e o SQL escrito " +
          "depois nunca rodaria. Escreva o SQL antes de migrar, ou apague o arquivo.",
        null,
        versao,
      );
    }

    migracoes.push({ arquivo, versao, sql });
  }

  return migracoes;
}

async function aplicarMigracoes(pool, pasta = PASTA_PADRAO) {
  try {
    await pool.query(BOOTSTRAP);
  } catch (erro) {
    // Dizer QUEM estava pedindo vale para qualquer falha aqui: sem o embrulho o
    // operador ve so a mensagem crua do pg, sem pista de que foi o runner nem
    // do que ele tentava criar.
    //
    // Ja a dica do GRANT so vale para 42501 (insufficient_privilege). Colada em
    // toda falha, ela mandava cacar permissao quando o problema era outro
    // completamente — um pool ja encerrado, por exemplo, saia como "Cannot use a
    // pool after calling end on the pool. O papel do DATABASE_URL precisa de
    // CREATE no banco.". Diagnostico errado custa mais que dica ausente.
    const dica =
      erro.code === "42501"
        ? " O papel do DATABASE_URL precisa de CREATE no banco."
        : "";
    throw new ErroDeMigracao(
      `Não foi possível preparar o schema canastra e a tabela canastra.migracoes: ${erro.message}.${dica}`,
      erro,
    );
  }

  const migracoes = await listarMigracoes(pasta);

  const jaAplicadas = new Set(
    (await pool.query("SELECT versao FROM canastra.migracoes")).rows.map(
      (r) => r.versao,
    ),
  );

  const aplicadas = [];

  for (const { versao, sql } of migracoes) {
    if (jaAplicadas.has(versao)) continue;

    const cliente = await pool.connect();
    let falhaNoRollback;

    try {
      await cliente.query("BEGIN");
      await cliente.query(sql);
      await cliente.query("INSERT INTO canastra.migracoes (versao) VALUES ($1)", [
        versao,
      ]);
      await cliente.query("COMMIT");
      aplicadas.push(versao);
      console.log(`  · ${versao}`);
    } catch (erro) {
      try {
        await cliente.query("ROLLBACK");
      } catch (falha) {
        falhaNoRollback = falha;
      }
      const sqlstate = erro.code ? ` (SQLSTATE ${erro.code})` : "";
      throw new ErroDeMigracao(
        `Migração ${versao} falhou${sqlstate}: ${erro.message}`,
        erro,
        versao,
      );
    } finally {
      // Mesma licao que `test/ajuda/sessao.js` registrou: se o ROLLBACK falhou
      // (conexao caida no meio da migracao, por exemplo), este cliente pode
      // voltar ao pool AINDA dentro da transacao e contaminar quem o pegar
      // depois. `release(erro)` destroi a conexao; sem argumento e um release
      // normal.
      cliente.release(falhaNoRollback);
    }
  }

  return aplicadas;
}

module.exports = {
  aplicarMigracoes,
  ErroDeMigracao,
  PASTA_PADRAO,
  // Os dois abaixo sao para o `db/gerar-instalacao.js`, que monta o arquivo
  // colavel no editor SQL do Supabase. Ele PRECISA usar exatamente este
  // bootstrap e exatamente esta ordenacao: uma `canastra.migracoes` criada de
  // outro jeito (sem os REVOKE, por exemplo) ou uma ordem alfabetica no lugar da
  // numerica produziriam um banco parecido com o do runner e diferente dele —
  // e a diferenca so apareceria na proxima migracao.
  BOOTSTRAP,
  listarMigracoes,
};

if (require.main === module) {
  const { Pool } = require("pg");

  // `new Pool({ connectionString: undefined })` NAO falha: o pg cai no
  // comportamento do libpq e monta a conexao a partir de PGHOST/PGUSER/PGDATABASE
  // ou, na ausencia deles, de localhost:5432 com o usuario do sistema. Este
  // comando e rodado a mao contra o VPS de producao — um DATABASE_URL esquecido
  // no shell aplicaria as migracoes em QUALQUER banco que estivesse a mao, em
  // silencio e com a saida de sucesso de sempre. Recusar e a unica leitura
  // segura.
  if (!process.env.DATABASE_URL) {
    console.error(
      "\n❌ DATABASE_URL não está definida.\n" +
        "   Sem ela a conexão cairia no padrão do libpq e as migrações poderiam\n" +
        "   ser aplicadas num banco que não é o pretendido.\n",
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  aplicarMigracoes(pool)
    .then((aplicadas) => {
      console.log(
        aplicadas.length
          ? `${aplicadas.length} migração(ões) aplicada(s).`
          : "Nada pendente.",
      );
      return pool.end();
    })
    .catch(async (erro) => {
      console.error(`\n❌ ${erro.message}\n`);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
