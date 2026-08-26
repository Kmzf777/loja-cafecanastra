"use strict";

/**
 * Os defeitos dos repositórios do painel que só aparecem contra o banco de
 * verdade — todos da família "a escrita foi aceita e destruiu o que não veio no
 * corpo", que é a família que não deixa rastro nenhum na tela.
 *
 * Padrão de f4_repositorios.test.js: Postgres embarcado, `DATABASE_URL`
 * apontando para o cluster efêmero ANTES do require dos módulos de `src/` (o
 * `pgPool` lê a variável no momento do require) e dublê de `res`.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let ConfigRepository;

/** Dublê de `res` no padrão de f4_repositorios.test.js, com send() para o 204. */
function respostaFalsa() {
  const res = { codigo: null, corpo: null };
  res.status = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.json = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    return res;
  };
  res.send = () => {
    if (res.codigo === null) res.codigo = 200;
    return res;
  };
  return res;
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    "INSERT INTO canastra.config_loja (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
  );

  process.env.DATABASE_URL = bd.connectionString;

  ConfigRepository = require("../src/repositories/configRepository.js");
}, { timeout: 120_000 });

after(async () => {
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

beforeEach(() => {
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
});

/* --------------------------------------------------------------------------
 * PUT /config — campo em branco é ausência, e só `0` explícito zera o piso
 * -------------------------------------------------------------------------- */

/** Deixa a config num estado conhecido, direto no banco. */
async function configConhecida() {
  await bd.pool.query(
    `UPDATE canastra.config_loja
        SET titulo_site = 'Café Canastra',
            whatsapp = '5535999990000',
            barra_de_aviso = 'Torramos na terça.',
            frete_gratis_minimo_centavos = 14900
      WHERE id = 1`,
  );
}

test("config: piso do frete grátis em BRANCO não muda o valor no banco", async () => {
  await configConhecida();

  // É exatamente o que o multipart entrega quando o campo do formulário fica
  // vazio — e era aqui que a loja inteira ganhava frete grátis: `Number('')` é
  // 0, `Number.isInteger(0)` é true, `0 < 0` é falso, a validação APROVAVA.
  const res = respostaFalsa();
  await ConfigRepository.updateConfig(
    {
      body: {
        site_title: "Café Canastra",
        frete_gratis_minimo_centavos: "",
      },
      files: undefined,
    },
    res,
  );
  assert.equal(res.codigo, 200);

  const depois = await ConfigRepository.getConfig();
  assert.equal(
    depois.frete_gratis_minimo_centavos,
    14900,
    "campo em branco é ausência: salvar qualquer outro campo do formulário não pode desligar o frete grátis",
  );
});

test("config: piso do frete grátis com 0 EXPLÍCITO zera (é assim que se desliga)", async () => {
  await configConhecida();

  // O número 0 (JSON) e a string "0" (multipart) são o mesmo pedido: desligar.
  for (const zero of [0, "0"]) {
    await configConhecida();

    const res = respostaFalsa();
    await ConfigRepository.updateConfig(
      { body: { frete_gratis_minimo_centavos: zero }, files: undefined },
      res,
    );
    assert.equal(res.codigo, 200);

    const depois = await ConfigRepository.getConfig();
    assert.equal(
      depois.frete_gratis_minimo_centavos,
      0,
      `zerar de propósito continua possível (enviado como ${JSON.stringify(zero)})`,
    );
  }
});

test("config: site_title em BRANCO não apaga o título", async () => {
  await configConhecida();

  const res = respostaFalsa();
  await ConfigRepository.updateConfig(
    {
      body: {
        site_title: "",
        whatsapp_number: "",
        announcement_bar: "",
        frete_gratis_minimo_centavos: "19900",
      },
      files: undefined,
    },
    res,
  );
  assert.equal(res.codigo, 200);

  const depois = await ConfigRepository.getConfig();
  assert.equal(depois.site_title, "Café Canastra");
  assert.equal(depois.whatsapp_number, "5535999990000");
  assert.equal(depois.announcement_bar, "Torramos na terça.");
  // E o campo que veio de verdade foi gravado — parcial não é o mesmo que inerte.
  assert.equal(depois.frete_gratis_minimo_centavos, 19900);
});

test("config: valor inválido continua 400, e não toca em nada", async () => {
  await configConhecida();

  const res = respostaFalsa();
  await ConfigRepository.updateConfig(
    {
      body: { site_title: "Outro nome", frete_gratis_minimo_centavos: "-1" },
      files: undefined,
    },
    res,
  );
  assert.equal(res.codigo, 400);

  const depois = await ConfigRepository.getConfig();
  assert.equal(depois.site_title, "Café Canastra");
  assert.equal(depois.frete_gratis_minimo_centavos, 14900);
});
