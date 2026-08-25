"use strict";

/**
 * F8 — o ciclo de vida do token da Melhor Envio.
 *
 * `fetchImpl` é injetável no serviço justamente para este arquivo: o fluxo
 * OAuth inteiro se prova sem rede. O molde é o de `f7_bling.test.js`.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let melhorEnvioClient;

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);
  await bd.pool.query("INSERT INTO canastra.config_loja (id) VALUES (1)");
  process.env.DATABASE_URL = bd.connectionString;

  /**
   * O `require` vem DEPOIS do DATABASE_URL, e a ordem é obrigatória: o
   * `src/pgPool.js` lê a variável no momento em que é carregado. Requerido
   * antes, o serviço abriria um pool apontando para o banco de produção — ou
   * para lugar nenhum.
   *
   * A porta 9 é o `discard` do IANA: se algum caminho esquecer de injetar o
   * `fetchImpl`, o teste falha por conexão recusada em vez de bater na API de
   * verdade com a credencial de mentira.
   */
  process.env.MELHOR_ENVIO_URL = "http://127.0.0.1:9";
  process.env.MELHOR_ENVIO_CLIENT_ID = "123";
  process.env.MELHOR_ENVIO_CLIENT_SECRET = "segredo-de-teste";
  melhorEnvioClient = require("../src/services/melhorEnvioClient.js");
}, { timeout: 120_000 });

after(async () => {
  // O pool do SERVIÇO é outro objeto que o `bd.pool`, e os clientes ociosos
  // dele seguram o event loop do filho do `node --test` até o idleTimeout.
  // Fechá-lo aqui é o mesmo cuidado de `f7_bling.test.js`.
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

/** O refresh token gravado, do jeito que o serviço o deixou. */
async function tokenNoBanco() {
  const { rows } = await bd.pool.query(
    `SELECT melhor_envio_refresh_token, melhor_envio_token_expira_em
       FROM canastra.config_loja WHERE id = 1`,
  );
  return rows[0];
}

/** Volta a coluna ao estado neutro entre casos. */
async function limparTokenDoBanco(valor = null) {
  await bd.pool.query(
    "UPDATE canastra.config_loja SET melhor_envio_refresh_token = $1 WHERE id = 1",
    [valor],
  );
}

/** Um fetch de mentira que responde o que o teste mandar, e conta as chamadas. */
function fetchFalso(respostas) {
  const chamadas = [];
  const fila = [...respostas];
  const fn = async (url, opcoes) => {
    chamadas.push({ url, opcoes, corpo: JSON.parse(opcoes.body || "{}") });
    const proxima = fila.shift();
    if (!proxima) throw new Error("fetch chamado mais vezes que o esperado");
    return {
      ok: proxima.status < 400,
      status: proxima.status,
      json: async () => proxima.corpo,
      text: async () => JSON.stringify(proxima.corpo),
    };
  };
  fn.chamadas = chamadas;
  return fn;
}

test("a migração 0017 cria as colunas de token e de etiqueta", async () => {
  const { rows: config } = await bd.pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'canastra' AND table_name = 'config_loja'
        AND column_name LIKE 'melhor_envio%'
      ORDER BY column_name`,
  );
  assert.deepEqual(config.map((r) => r.column_name), [
    "melhor_envio_refresh_token",
    "melhor_envio_token_expira_em",
  ]);

  const { rows: pedidos } = await bd.pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'canastra' AND table_name = 'pedidos'
        AND column_name LIKE 'me\\_%'
      ORDER BY column_name`,
  );
  assert.deepEqual(pedidos.map((r) => r.column_name), [
    "me_claim_em",
    "me_comprada_em",
    "me_order_id",
    "me_protocolo",
    "me_servico_id",
    "me_situacao",
  ]);
});

test("o refresh token da Melhor Envio não é legível por anon nem authenticated", async () => {
  /**
   * CLIENTE DEDICADO, e não `bd.pool.query`: `SET ROLE` vale para a CONEXÃO, e
   * o pool entrega uma conexão qualquer a cada query. Trocar o papel numa e
   * consultar noutra testaria o papel errado — e passaria por acidente, que é
   * o pior resultado possível para um teste de privilégio.
   */
  for (const papel of ["anon", "authenticated"]) {
    const cliente = await bd.pool.connect();
    try {
      await cliente.query(`SET ROLE ${papel}`);
      await assert.rejects(
        () =>
          cliente.query(
            "SELECT melhor_envio_refresh_token FROM canastra.config_loja WHERE id = 1",
          ),
        /permission denied|42501/i,
        `${papel} não pode ler o refresh token`,
      );
    } finally {
      await cliente.query("RESET ROLE").catch(() => {});
      cliente.release();
    }
  }
});

test("duas etiquetas para o mesmo pedido é impossível pelo índice", async () => {
  const primeiro = await bd.pool.query(
    `INSERT INTO canastra.pedidos (total, status) VALUES (10, 'aprovado')
     RETURNING pedido_id`,
  );
  await bd.pool.query(
    "UPDATE canastra.pedidos SET me_order_id = 'etq-1' WHERE pedido_id = $1",
    [primeiro.rows[0].pedido_id],
  );

  const segundo = await bd.pool.query(
    `INSERT INTO canastra.pedidos (total, status) VALUES (10, 'aprovado')
     RETURNING pedido_id`,
  );
  await assert.rejects(
    () =>
      bd.pool.query(
        "UPDATE canastra.pedidos SET me_order_id = 'etq-1' WHERE pedido_id = $1",
        [segundo.rows[0].pedido_id],
      ),
    /duplicate key|unique/i,
  );
});

test("as colunas me_* não são escrevíveis por authenticated", async () => {
  const cliente = await bd.pool.connect();
  try {
    await cliente.query("SET ROLE authenticated");
    await assert.rejects(
      () =>
        cliente.query(
          "UPDATE canastra.pedidos SET me_situacao = 'released' WHERE true",
        ),
      /permission denied|42501/i,
      "um cliente não pode fingir que a própria etiqueta já foi paga",
    );
  } finally {
    await cliente.query("RESET ROLE").catch(() => {});
    cliente.release();
  }
});

/* --------------------------------------------------------------------------
 * O ciclo de vida do token: renovar, persistir, esquecer o queimado
 * -------------------------------------------------------------------------- */

test("a renovação persiste o refresh token novo no banco", async () => {
  melhorEnvioClient.zerarMemoria();
  await limparTokenDoBanco("semente");

  try {
    const fetchImpl = fetchFalso([
      {
        status: 200,
        corpo: {
          token_type: "Bearer",
          expires_in: 2592000,
          access_token: "access-novo",
          refresh_token: "refresh-novo",
        },
      },
    ]);

    const token = await melhorEnvioClient.renovarAccessToken({ fetchImpl });
    assert.equal(token, "access-novo");

    const config = await tokenNoBanco();
    assert.equal(config.melhor_envio_refresh_token, "refresh-novo");
    assert.ok(
      config.melhor_envio_token_expira_em > new Date(),
      "o vencimento gravado tem de estar no futuro",
    );

    /**
     * AQUI MORA A DIFERENÇA PARA O BLING, e ela só quebraria contra a API de
     * verdade: a Melhor Envio quer o corpo em JSON com as credenciais DENTRO
     * dele. O Bling quer form-encoding e um header `Basic`. Trocar um pelo
     * outro passa em qualquer dublê e falha em produção com um 401 mudo.
     */
    const chamada = fetchImpl.chamadas[0];
    assert.match(String(chamada.url), /\/oauth\/token$/);
    assert.equal(chamada.opcoes.headers["Content-Type"], "application/json");
    assert.equal(
      chamada.opcoes.headers.Authorization,
      undefined,
      "não existe header Basic nesta API",
    );
    assert.equal(chamada.corpo.grant_type, "refresh_token");
    assert.equal(chamada.corpo.refresh_token, "semente");
    assert.equal(chamada.corpo.client_id, 123, "client_id vai como número");
    assert.equal(chamada.corpo.client_secret, "segredo-de-teste");
  } finally {
    melhorEnvioClient.zerarMemoria();
    await limparTokenDoBanco(null);
  }
});

test("a ordem de leitura é memória → banco → env", async () => {
  melhorEnvioClient.zerarMemoria();
  await limparTokenDoBanco(null);
  process.env.MELHOR_ENVIO_REFRESH_TOKEN = "da-env";

  try {
    // Sem memória e sem banco, quem vale é a SEMENTE da env.
    assert.equal(await melhorEnvioClient.carregarRefreshToken(), "da-env");

    // Com a coluna preenchida, o banco ganha da env — é o que faz a env virar
    // obsoleta depois da primeira renovação.
    await limparTokenDoBanco("do-banco");
    assert.equal(await melhorEnvioClient.carregarRefreshToken(), "do-banco");

    // E a memória ganha dos dois: depois de uma renovação, o token mais
    // recente é o que este processo tem na mão. Trocar a coluna por fora não
    // muda nada até o próximo restart.
    const fetchImpl = fetchFalso([
      {
        status: 200,
        corpo: {
          access_token: "acc",
          refresh_token: "da-memoria",
          expires_in: 2592000,
        },
      },
    ]);
    await melhorEnvioClient.renovarAccessToken({ fetchImpl });
    await limparTokenDoBanco("trocado-por-fora");
    assert.equal(await melhorEnvioClient.carregarRefreshToken(), "da-memoria");
  } finally {
    delete process.env.MELHOR_ENVIO_REFRESH_TOKEN;
    melhorEnvioClient.zerarMemoria();
    await limparTokenDoBanco(null);
  }
});

test("invalid_grant esquece o token da memória para a próxima tentativa reler o banco", async () => {
  /**
   * O BUG QUE ISTO FECHA: a memória tem precedência sobre o banco. Um token
   * que a Melhor Envio acabou de recusar não vale mais nunca — e insistir com
   * ele deixaria a integração morta até um restart, mesmo com um token bom
   * colado na `config_loja` pelo gestor, que é justamente o que o runbook
   * manda fazer quando a autorização se perde.
   */
  melhorEnvioClient.zerarMemoria();
  await limparTokenDoBanco("semente");

  try {
    // Uma renovação boa põe o token na memória...
    await melhorEnvioClient.renovarAccessToken({
      fetchImpl: fetchFalso([
        {
          status: 200,
          corpo: {
            access_token: "acc",
            refresh_token: "queimado",
            expires_in: 2592000,
          },
        },
      ]),
    });
    assert.equal(melhorEnvioClient.tokenEmMemoria(), "queimado");

    // ...o gestor cola um token bom no banco (o passo do runbook)...
    await limparTokenDoBanco("bom-no-banco");

    // ...e a Melhor Envio recusa o da memória.
    await assert.rejects(
      () =>
        melhorEnvioClient.renovarAccessToken({
          fetchImpl: fetchFalso([{ status: 401, corpo: { error: "invalid_grant" } }]),
        }),
      /invalid_grant|recusou/i,
    );
    assert.equal(
      melhorEnvioClient.tokenEmMemoria(),
      null,
      "a memória esquece o token que foi recusado",
    );

    // A tentativa seguinte recomeça a ordem de leitura pelo BANCO.
    const terceira = fetchFalso([
      { status: 200, corpo: { access_token: "acc-2", expires_in: 2592000 } },
    ]);
    await melhorEnvioClient.renovarAccessToken({ fetchImpl: terceira });
    assert.equal(terceira.chamadas[0].corpo.refresh_token, "bom-no-banco");
  } finally {
    melhorEnvioClient.zerarMemoria();
    await limparTokenDoBanco(null);
  }
});

test("o User-Agent obrigatório vai em toda requisição", async () => {
  /**
   * A Melhor Envio RECUSA requisição sem User-Agent, e o erro não diz por quê
   * — some num 401 genérico. Por isso a asserção varre TODAS as chamadas, e
   * não só a do token: a requisição autenticada precisa dele igual.
   */
  const nomeAntes = process.env.LOJA_NOME;
  const emailAntes = process.env.LOJA_EMAIL;
  melhorEnvioClient.zerarMemoria();
  await limparTokenDoBanco("semente");
  process.env.LOJA_NOME = "Cafe Canastra";
  process.env.LOJA_EMAIL = "canastrainteligencia@gmail.com";

  try {
    const fetchImpl = fetchFalso([
      {
        status: 200,
        corpo: { access_token: "a", refresh_token: "r", expires_in: 2592000 },
      },
      { status: 200, corpo: { id: "conta-de-teste" } },
    ]);

    await melhorEnvioClient.renovarAccessToken({ fetchImpl });
    const dados = await melhorEnvioClient.requisitar("GET", "/me", { fetchImpl });
    assert.deepEqual(dados, { id: "conta-de-teste" });

    assert.equal(fetchImpl.chamadas.length, 2, "o token da memória foi reusado");
    for (const chamada of fetchImpl.chamadas) {
      const ua = chamada.opcoes.headers["User-Agent"];
      assert.match(ua, /Cafe Canastra/);
      assert.match(ua, /canastrainteligencia@gmail\.com/);
    }

    // E a requisição autenticada vai para a v2, com Bearer.
    assert.match(String(fetchImpl.chamadas[1].url), /\/api\/v2\/me$/);
    assert.equal(
      fetchImpl.chamadas[1].opcoes.headers.Authorization,
      "Bearer a",
    );
  } finally {
    if (nomeAntes === undefined) delete process.env.LOJA_NOME;
    else process.env.LOJA_NOME = nomeAntes;
    if (emailAntes === undefined) delete process.env.LOJA_EMAIL;
    else process.env.LOJA_EMAIL = emailAntes;
    melhorEnvioClient.zerarMemoria();
    await limparTokenDoBanco(null);
  }
});

test("duas chamadas concorrentes renovam UMA vez só", async () => {
  /**
   * Duas renovações em paralelo podem invalidar o token uma da outra — é o
   * mesmo motivo de a integração exigir instância única. O `fetchFalso` só
   * tem UMA resposta na fila: uma segunda chamada estoura, e o teste falha
   * com a frase certa em vez de passar por acaso.
   */
  melhorEnvioClient.zerarMemoria();
  await limparTokenDoBanco("semente-concorrente");

  try {
    const fetchImpl = fetchFalso([
      {
        status: 200,
        corpo: {
          access_token: "acc-unico",
          refresh_token: "r-unico",
          expires_in: 2592000,
        },
      },
    ]);

    const [primeiro, segundo] = await Promise.all([
      melhorEnvioClient.accessToken({ fetchImpl }),
      melhorEnvioClient.accessToken({ fetchImpl }),
    ]);

    assert.equal(primeiro, "acc-unico");
    assert.equal(segundo, "acc-unico");
    assert.equal(fetchImpl.chamadas.length, 1, "uma renovação só, não duas");
  } finally {
    melhorEnvioClient.zerarMemoria();
    await limparTokenDoBanco(null);
  }
});

test("falhar ao gravar no banco NÃO derrota a renovação", async () => {
  /**
   * O access token JÁ ESTÁ NA MÃO quando a gravação acontece. Deixar a falha
   * de escrita derrubar a renovação trocaria uma degradação (perder o token
   * num restart) por uma pane (frete parado agora). Mas silêncio também não
   * serve: o log tem de gritar, porque a consequência só aparece no próximo
   * restart.
   *
   * A falha é forçada por um CHECK que recusa exatamente o valor que a
   * resposta traz — determinístico, sem depender de derrubar o Postgres.
   */
  melhorEnvioClient.zerarMemoria();
  await limparTokenDoBanco("semente-que-fica");
  await bd.pool.query(
    `ALTER TABLE canastra.config_loja
       ADD CONSTRAINT me_token_recusado
       CHECK (melhor_envio_refresh_token IS DISTINCT FROM 'refresh-que-o-banco-recusa')`,
  );

  const gritos = [];
  const erroOriginal = console.error;
  console.error = (...args) => {
    gritos.push(args.map(String).join(" "));
  };

  try {
    const fetchImpl = fetchFalso([
      {
        status: 200,
        corpo: {
          access_token: "access-mesmo-sem-banco",
          refresh_token: "refresh-que-o-banco-recusa",
          expires_in: 2592000,
        },
      },
    ]);

    const token = await melhorEnvioClient.renovarAccessToken({ fetchImpl });
    assert.equal(token, "access-mesmo-sem-banco", "a renovação não foi derrotada");
    assert.equal(
      melhorEnvioClient.tokenEmMemoria(),
      "refresh-que-o-banco-recusa",
      "o token novo segue valendo na memória deste processo",
    );

    const config = await tokenNoBanco();
    assert.equal(
      config.melhor_envio_refresh_token,
      "semente-que-fica",
      "a gravação realmente falhou (senão o teste não prova nada)",
    );
  } finally {
    console.error = erroOriginal;
    await bd.pool
      .query("ALTER TABLE canastra.config_loja DROP CONSTRAINT me_token_recusado")
      .catch(() => {});
    melhorEnvioClient.zerarMemoria();
    await limparTokenDoBanco(null);
  }

  assert.ok(
    gritos.some((linha) => /MELHOR ENVIO/.test(linha) && /reautoriz/i.test(linha)),
    "a falha de gravação tem de GRITAR no log, com a consequência escrita",
  );
  assert.ok(
    !gritos.some((linha) => linha.includes("refresh-que-o-banco-recusa")),
    "e o grito NÃO pode ecoar o token",
  );
});
