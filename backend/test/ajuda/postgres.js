"use strict";

/**
 * Postgres de verdade para os testes.
 *
 * RLS nao e simulavel: `pg-mem` e afins nao implementam politica de linha, e uma
 * politica que "passa" num mock e exatamente o tipo de falha que este projeto
 * nao pode ter — o isolamento contra os outros projetos da instancia
 * compartilhada depende dela. Entao os testes sobem um Postgres 16 real, sem
 * Docker.
 *
 * O shim de `auth` existe porque `auth.users` e `auth.uid()` sao do GoTrue e nao
 * existem num Postgres cru. Ele NAO entra em migracao nenhuma: em producao esse
 * schema ja esta la, criado pelo Supabase.
 */

// `embedded-postgres` e um pacote ESM puro e o construtor e o export default.
// Sob require() o Node devolve o namespace do modulo, nao a classe — sem o
// `.default` o `new` abaixo estoura com "is not a constructor".
const EmbeddedPostgres = require("embedded-postgres").default;
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const fs = require("node:fs/promises");
const { Client, Pool } = require("pg");

const SENHA = "postgres";
const BANCO = "canastra_teste";

// Literal fixa em todo lugar (pool, cliente de setup, bind do cluster). Se um
// caminho usasse "localhost" e outro "127.0.0.1", um host que resolve localhost
// para ::1 antes de IPv4 daria bind parcial: o boot passa e a falha aparece
// depois, longe da causa.
const HOST = "127.0.0.1";

const TENTATIVAS_DE_BOOT = 3;
const LINHAS_DE_LOG = 50;
const LIMITE_DE_PARADA_MS = 10_000;

/**
 * Papeis que o Supabase cria e dos quais as politicas dependem.
 *
 * Esta e a UNICA fonte da verdade sobre quais papeis existem: `sessao.js`
 * importa as chaves daqui como whitelist, entao um papel novo entra num lugar
 * so. NOINHERIT copia o Supabase, que cria os tres como `nologin noinherit` —
 * sem ele um papel que herdasse privilegios de outro daria ao teste mais acesso
 * do que a producao tem, e o teste passaria verde por motivo errado.
 */
const PAPEIS_SUPABASE = Object.freeze({
  anon: "NOLOGIN NOINHERIT",
  authenticated: "NOLOGIN NOINHERIT",
  // BYPASSRLS e o que faz o service_role (usado pela API server-side) enxergar
  // tudo, do mesmo jeito que na instancia real.
  service_role: "NOLOGIN NOINHERIT BYPASSRLS",
});

const SQL_PAPEIS = `
  DO $$ BEGIN
${Object.entries(PAPEIS_SUPABASE)
  .map(
    ([nome, atributos]) => `    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${nome}') THEN
      CREATE ROLE ${nome} ${atributos};
    END IF;`,
  )
  .join("\n")}
  END $$;
`;

/**
 * Shim do GoTrue. `auth.uid()` reproduz a definicao real do Supabase: le o
 * claim `sub` de `request.jwt.claims`, que o PostgREST injeta por requisicao.
 *
 * Os dois `nullif` protegem falhas DIFERENTES e nenhum dos dois e enfeite —
 * cada um esta comentado no seu lugar abaixo.
 */
const SQL_SHIM_AUTH = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (
    id    uuid PRIMARY KEY,
    email text UNIQUE,
    -- POR QUE O SHIM CRESCEU (era so id + email ate 0008).
    --
    -- A RPC \`canastra.garantir_cliente\` (migracao 0008) recusa quem ainda nao
    -- confirmou o e-mail, e le ESTA coluna em vez do JWT — um claim e escrito por
    -- quem emite o token, e nesta instancia compartilhada quem emite nao e a loja.
    -- Sem a coluna no shim, o teste daquela recusa nao teria como existir: a
    -- funcao morreria com 42703 ("column does not exist") em TODA chamada, e o
    -- caminho feliz iria junto.
    --
    -- SEM DEFAULT, de proposito, e isso e o fiel da balanca do teste negativo: no
    -- GoTrue de verdade a coluna nasce NULL e so e preenchida quando a pessoa
    -- clica no link de confirmacao. Um \`DEFAULT now()\` aqui deixaria toda conta
    -- semeada nascer confirmada e o teste de "e-mail pendente" passaria a ser
    -- impossivel de escrever sem um UPDATE que ninguem lembraria de fazer.
    --
    -- SO ESTA COLUNA. \`auth.users\` de verdade tem dezenas (phone_confirmed_at,
    -- is_anonymous, raw_app_meta_data...); copiar a lista faria o shim envelhecer
    -- junto com o GoTrue sem nenhum teste dependendo disso.
    email_confirmed_at timestamptz
  );
  -- Bancos criados por uma execucao anterior do harness nao existem (cada teste
  -- sobe um cluster novo), mas o CREATE TABLE acima e IF NOT EXISTS: se um dia
  -- ele passar a rodar sobre um banco reaproveitado, a coluna nova nao apareceria.
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
  AS $$
    -- nullif EXTERNO: cobre um claim presente porem com {"sub": ""}. Sem ele o
    -- ''::uuid estoura "invalid input syntax for type uuid".
    SELECT nullif(
      -- nullif INTERNO: este e o load-bearing, NAO REMOVA. Um GUC
      -- personalizado nao volta a NULL quando a transacao que o setou termina,
      -- volta a STRING VAZIA. Como o pool reaproveita conexoes, a segunda
      -- transacao de uma mesma conexao encontra '' e o ''::jsonb estoura
      -- "invalid input syntax for type json" — derrubando toda politica que
      -- chame auth.uid() a partir da segunda requisicao de cada conexao.
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
      ''
    )::uuid
  $$;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
`;

/** Falha de boot do cluster, com o stderr do Postgres junto. */
class ErroDeBoot extends Error {
  constructor(porta, registro, causa) {
    const cauda = registro.length
      ? `\n\nUltimas linhas do Postgres:\n${registro.join("\n")}`
      : "\n\n(o Postgres nao chegou a logar nada)";
    super(`Postgres nao subiu em ${HOST}:${porta}.${cauda}`);
    this.name = "ErroDeBoot";
    this.porta = porta;
    this.registro = registro;
    if (causa) this.cause = causa;
  }
}

/**
 * Assinatura de porta ocupada no log do Postgres.
 *
 * Casar texto em ingles e seguro aqui, e nao por sorte: o initdb grava
 * `lc_messages = C` no postgresql.conf, o `getBestLocale()` do pacote devolve
 * 'C' incondicionalmente no win32, o `start()` ainda fixa `env.LC_MESSAGES`, e
 * este harness nao passa `postgresFlags`. O locale do SO nao tem por onde
 * chegar — conferido nesta maquina pt-BR, onde todo o resto e
 * Portuguese_Brazil.1252.
 *
 * Se algum dia isso for forcado para outro locale, NAO existe rede de seguranca
 * fina: a linha vira "nao foi possivel vincular o endereco IPv4" e, no mesmo
 * movimento, quebra tambem a deteccao de "ready to accept connections" do
 * proprio pacote — entao `start()` nem resolve nem rejeita, e nenhum connect
 * chega a ser tentado (o connectionTimeoutMillis dos clientes nunca engata). O
 * que sobra e o `timeout: 120_000` do before() no harness.test.js, que degrada
 * para um teste lento e nomeado em vez de travar para sempre. Risco aceito.
 */
const LINHA_DE_COLISAO = "could not bind IPv4 address";

/**
 * O casamento e especifico de IPv4 de proposito: numa maquina sem IPv6 o
 * "could not bind IPv6" e esperado e inofensivo, e tratar os dois igual faria o
 * harness nunca subir la.
 */
function houveColisaoDePorta(registro) {
  return registro.some((linha) => linha.includes(LINHA_DE_COLISAO));
}

/**
 * Uma porta que o SO acabou de confirmar como livre.
 *
 * Derivar a porta do pid (`55000 + pid % 5000`) era chute, e o modo de falha
 * era pessimo: com a porta ocupada o `start()` do pacote rejeita com `undefined`
 * literal e o `stop()` seguinte nunca resolve, entao o `node --test` ficava
 * pendurado para sempre sem dizer o motivo. Deixar o SO escolher (`listen(0)`)
 * troca o chute por um fato.
 */
function portaLivre() {
  return new Promise((resolve, reject) => {
    const servidor = net.createServer();
    servidor.once("error", reject);
    servidor.listen(0, HOST, () => {
      const { port } = servidor.address();
      servidor.close(() => resolve(port));
    });
  });
}

/**
 * Zera o handle interno do processo do pacote.
 *
 * O pacote guarda TODA instancia criada num Set global e, num AsyncExitHook,
 * chama `stop()` em cada uma quando o processo sai. Uma instancia cujo `start()`
 * falhou continua nesse Set com `process` preenchido porem morto, e o `stop()`
 * dela registra `on('exit')` num processo que ja saiu — ou seja, nunca resolve
 * e trava a saida do `node --test`. O Set nao e exportado, entao a unica
 * alavanca e apagar o handle: com `process` undefined o `stop()` do pacote
 * retorna de imediato no proprio guard.
 */
function neutralizar(pg) {
  pg.process = undefined;
}

/**
 * `maxRetries`/`retryDelay` sao para o Windows: depois do `taskkill /f /t` o
 * postgres.exe ainda leva alguns milissegundos soltando os handles do datadir, e
 * nesse intervalo o `fs.rm` bate em EBUSY/EPERM. O `force` cobre ENOENT, nao
 * esses dois.
 */
function removerDiretorio(diretorio) {
  return fs.rm(diretorio, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

/**
 * Para o cluster com um teto de tempo.
 *
 * `stop()` fica pendurado para sempre se o processo ja morreu por conta propria
 * (ele so registra `on('exit', resolve)` depois do fato). O limite transforma
 * "o node --test nunca termina" em "o teardown demorou 10s e seguiu".
 *
 * O troco, quando o limite estoura: o `neutralizar()` abaixo roda com o cluster
 * possivelmente AINDA VIVO, e ai o `removerDiretorio()` seguinte esbarra nos
 * handles abertos e falha — com o erro engolido no `.catch(() => {})` de quem
 * chama. Ou seja, nesse caso o datadir fica para tras em %TEMP%. E vazamento
 * conhecido e aceito, bem melhor que o hang infinito de antes: se aparecer um
 * canastra-pg-* orfao, provavelmente veio daqui, nao de um bug novo.
 */
async function pararCluster(pg) {
  if (!pg.process) return;
  const limite = new Promise((resolve) => {
    setTimeout(resolve, LIMITE_DE_PARADA_MS).unref();
  });
  await Promise.race([pg.stop(), limite]);
  neutralizar(pg);
}

/** Abre um cliente avulso, roda algo e fecha — para o setup antes do pool. */
async function comCliente(porta, banco, acao) {
  const cliente = new Client({
    host: HOST,
    port: porta,
    user: "postgres",
    password: SENHA,
    database: banco,
    // Sem teto, um socket que aceita a conexao mas nunca fala o protocolo do
    // Postgres (qualquer processo alheio segurando a porta) deixa o connect()
    // pendurado PARA SEMPRE. Foi assim que a colisao de porta travava o
    // node --test sem dizer nada.
    connectionTimeoutMillis: 5000,
  });
  await cliente.connect();
  try {
    return await acao(cliente);
  } finally {
    await cliente.end().catch(() => {});
  }
}

async function tentarSubir() {
  // A porta vem ANTES do mkdtemp de proposito: as duas chamadas estao fora do
  // try/catch de baixo, entao criar o diretorio primeiro faria uma rejeicao de
  // portaLivre() vazar sem passar por nenhum caminho de limpeza.
  const porta = await portaLivre();
  const diretorio = await fs.mkdtemp(path.join(os.tmpdir(), "canastra-pg-"));

  // Ultimas linhas do stderr do Postgres. O pacote manda TUDO por `onLog` —
  // inclusive o "could not bind IPv4 address ..." que explica uma porta
  // ocupada — e nada por `onError`. Um `onLog: () => {}` para calar o ruido no
  // TAP apaga junto a unica mensagem que diagnostica a falha de boot. Entao
  // guardamos as ultimas linhas e so as revelamos se o boot falhar: silencio no
  // sucesso, diagnostico no erro.
  const registro = [];
  const anotar = (mensagem) => {
    for (const linha of String(mensagem).split("\n")) {
      if (linha.trim()) registro.push(linha.trim());
    }
    if (registro.length > LINHAS_DE_LOG) {
      registro.splice(0, registro.length - LINHAS_DE_LOG);
    }
  };

  const pg = new EmbeddedPostgres({
    databaseDir: diretorio,
    user: "postgres",
    password: SENHA,
    port: porta,
    // `false` faria o proprio pacote apagar o diretorio dentro do stop(), com
    // um fs.rm sem retentativa que no Windows bate em EBUSY/EPERM. Mantendo
    // `true`, a remocao e nossa, em derrubar(), com maxRetries.
    persistent: true,
    onLog: anotar,
    onError: anotar,
  });

  try {
    await pg.initialise();
    await pg.start();
  } catch (causa) {
    // `start()` rejeita com `undefined` literal, entao nao ha mensagem alguma
    // para propagar: e preciso fabricar uma que ao menos nomeie a porta.
    // Aqui NAO se chama pararCluster/stop: o processo ja morreu e o stop()
    // penduraria o teardown.
    neutralizar(pg);
    await removerDiretorio(diretorio).catch(() => {});
    throw new ErroDeBoot(porta, registro, causa);
  }

  try {
    // O Postgres NAO morre quando a porta esta ocupada: ele binda o que
    // conseguir. Com o IPv4 tomado ele sobe so em "::1", anuncia "ready to
    // accept connections" e o start() RESOLVE normalmente — medido, nao
    // suposto. A falha so apareceria depois, como um connect() pendurado em
    // HOST contra o processo alheio que segura a porta. Detectar aqui vira uma
    // retentativa numa porta livre, em vez de um teardown misterioso.
    if (houveColisaoDePorta(registro)) {
      throw new ErroDeBoot(porta, registro);
    }

    // O createDatabase() do pacote conecta em "localhost"; fazemos o CREATE
    // DATABASE na mesma literal que o pool usa (ver HOST).
    await comCliente(porta, "postgres", (c) =>
      c.query(`CREATE DATABASE ${BANCO}`),
    );

    const connectionString = `postgres://postgres:${SENHA}@${HOST}:${porta}/${BANCO}`;
    const pool = new Pool({
      connectionString,
      // Mesmo motivo documentado em src/pgPool.js: sem isso, esgotar o pool
      // deixa cada pool.connect() pendurado PARA SEMPRE, sem erro e sem log.
      // Num teste o sintoma seria o suite travado sem dizer por que.
      connectionTimeoutMillis: 5000,
    });

    await pool.query(SQL_PAPEIS);
    await pool.query(SQL_SHIM_AUTH);

    return {
      connectionString,
      pool,
      async derrubar() {
        // Cada passo isolado: se o pool.end() estourar, o cluster ainda TEM que
        // ser parado — senao ele fica de pe segurando a porta e o datadir, que e
        // exatamente o cenario que quebrava a proxima execucao.
        await pool.end().catch(() => {});
        await pararCluster(pg).catch(() => {});
        await removerDiretorio(diretorio).catch(() => {});
      },
    };
  } catch (erro) {
    // Aqui o cluster subiu de verdade, entao o stop() resolve normalmente.
    await pararCluster(pg).catch(() => {});
    await removerDiretorio(diretorio).catch(() => {});
    throw erro;
  }
}

async function subirPostgres() {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= TENTATIVAS_DE_BOOT; tentativa += 1) {
    try {
      return await tentarSubir();
    } catch (erro) {
      ultimoErro = erro;
      // So a corrida de porta merece nova tentativa: portaLivre() confirma a
      // porta livre, mas entre o close() dela e o bind do Postgres outro
      // processo pode toma-la, e ai sortear outra porta resolve.
      //
      // Falha permanente (binario ausente, disco cheio, initialise() quebrado)
      // nao melhora repetindo — so paga tres initdb antes de aparecer. Como o
      // ErroDeBoot embrulha os dois casos, a classe sozinha nao distingue: quem
      // decide e a linha de colisao no log.
      if (!(erro instanceof ErroDeBoot && houveColisaoDePorta(erro.registro))) {
        throw erro;
      }
    }
  }
  throw ultimoErro;
}

module.exports = { subirPostgres, PAPEIS_SUPABASE, ErroDeBoot };
