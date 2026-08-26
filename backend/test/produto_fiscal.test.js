"use strict";

/**
 * O bloco fiscal de `produtos` e o estado do produto, de 0034, vistos de fora.
 *
 * O QUE ESTA MIGRACAO E: as doze colunas que a NF-e exige e que nao existiam em
 * nenhuma das dezesseis colunas de `canastra.produtos`, mais o `estado` que
 * substitui o DELETE. Nada aqui EMITE nota: a Onda 4 e quem monta o corpo dos
 * dois POST de emissao (que hoje vao vazios). O criterio de pronto e o mesmo de
 * 0032 e 0033: o banco ACEITA E RECUSA as coisas certas.
 *
 * POR QUE O VOCABULARIO FISCAL PRECISA DE CHECK, e este e o argumento inteiro da
 * migracao: um produto sem NCM PASSA na sincronizacao com o Bling e so falha na
 * transmissao a SEFAZ — com o pedido do cliente ja pago e parado. O erro nasce
 * meses antes de aparecer, e aparece no pior momento possivel. O CHECK antecipa
 * a recusa para o INSERT, onde ela custa uma mensagem de tela.
 *
 * TODA ASERCAO DE RECUSA E EM `err.code`, nunca em texto de mensagem — a mesma
 * regra de rls.test.js.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { subirPostgres } = require("./ajuda/postgres.js");
const { comoPapel, PERMISSAO_NEGADA } = require("./ajuda/sessao.js");
const { aplicarMigracoes } = require("../db/migrar.js");

const CHECK_VIOLADO = "23514";
const UNICO_VIOLADO = "23505";

let bd;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const DORA = "dddddddd-0000-0000-0000-000000000004";

const SESSAO_DORA = { papel: "authenticated", sub: DORA };
const SESSAO_ANON = { papel: "anon" };

/** O cafe que ja existia antes de 0034 — e que prova o DEFAULT das linhas velhas. */
const CAFE_ANTIGO = "cccccccc-0000-0000-0000-000000000001";
const PED_ANA = "a3333333-0000-0000-0000-000000000001";

async function exigeRecusa(sessao, sql, parametros, contexto, codigo = PERMISSAO_NEGADA) {
  await assert.rejects(
    () => comoPapel(bd.pool, sessao, (cliente) => cliente.query(sql, parametros)),
    (erro) => {
      assert.equal(erro.code, codigo, `deveria recusar com ${codigo}: ${contexto}`);
      return true;
    },
  );
}

async function exigeRecusaDoBanco(sql, parametros, contexto, codigo = CHECK_VIOLADO) {
  await assert.rejects(
    () => bd.pool.query(sql, parametros),
    (erro) => {
      assert.equal(erro.code, codigo, `deveria recusar com ${codigo}: ${contexto}`);
      return true;
    },
  );
}

/** Cadastra um produto pelo caminho do painel (o pool do Express, que e o dono). */
async function cadastrar(colunas, valores) {
  return bd.pool.query(
    `INSERT INTO canastra.produtos (nome, preco, ${colunas})
     VALUES ('Canastra Teste', 10, ${valores})`,
  );
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    `INSERT INTO auth.users (id, email) VALUES ($1,'ana@ex.com'), ($2,'dora@ex.com')`,
    [ANA, DORA],
  );
  await bd.pool.query(
    `INSERT INTO canastra.clientes (user_id, nome) VALUES ($1,'Ana'), ($2,'Dora')`,
    [ANA, DORA],
  );
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [DORA]);
}, { timeout: 180_000 });

after(async () => {
  await bd?.derrubar();
});

/* ------------------------------------------------------------------------- *
 * O bloco fiscal
 * ------------------------------------------------------------------------- */

test("um produto fiscalmente completo entra inteiro", async () => {
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.produtos
       (produto_id, nome, tamanho, categoria, preco, custo, quantidade, sku,
        ncm, cest, origem_fiscal, gtin, gtin_embalagem, unidade, tipo_item,
        cfop_padrao, csosn, peso_liquido, peso_bruto, codigo_bling)
     VALUES ($1, 'Canastra Classico', '250 g', 'Cafe', 54.90, 22.50, 10, 'CAN-CLA-250',
             '09011110', '1700100', 0, '7891234567895', '17891234567892', 'UN', '04',
             '5102', '102', 0.250, 0.290, '1234567890')
     RETURNING ncm, origem_fiscal, peso, peso_liquido, estado`,
    [CAFE_ANTIGO],
  );
  assert.equal(rows[0].ncm, "09011110");
  assert.equal(rows[0].origem_fiscal, 0);
  // O `peso` de 0003 continua com o DEFAULT de sempre, intocado: ele serve ao
  // FRETE e o ShippingController depende dele hoje.
  assert.equal(Number(rows[0].peso), 0.3);
  assert.equal(Number(rows[0].peso_liquido), 0.25);
  assert.equal(rows[0].estado, "ativo");
});

test("NCM, CEST, CFOP e CSOSN so entram com o numero de digitos que a SEFAZ exige", async () => {
  for (const [coluna, ruim, motivo] of [
    ["ncm", "'0901111'", "NCM com 7 digitos"],
    ["ncm", "'090111100'", "NCM com 9 digitos"],
    ["ncm", "'0901.11.10'", "NCM com ponto, que e como o contador escreve"],
    ["cest", "'170010'", "CEST com 6 digitos"],
    ["cfop_padrao", "'510'", "CFOP com 3 digitos"],
    ["csosn", "'1'", "CSOSN com 1 digito"],
    ["csosn", "'1020'", "CSOSN com 4 digitos"],
  ]) {
    await exigeRecusaDoBanco(
      `INSERT INTO canastra.produtos (nome, preco, ${coluna}) VALUES ('X', 1, ${ruim})`,
      [],
      motivo,
    );
  }

  // CST de 2 digitos passa: e o que a loja vai precisar no dia em que sair do
  // Simples Nacional, e uma migracao naquele dia seria a pior hora possivel.
  await cadastrar("csosn", "'00'");
});

test("origem_fiscal e a tabela da SEFAZ, de 0 a 8 — nao um numero qualquer", async () => {
  await cadastrar("origem_fiscal", "0");
  await cadastrar("origem_fiscal", "8");
  await exigeRecusaDoBanco(
    "INSERT INTO canastra.produtos (nome, preco, origem_fiscal) VALUES ('X', 1, 9)",
    [],
    "origem fiscal 9",
  );
  await exigeRecusaDoBanco(
    "INSERT INTO canastra.produtos (nome, preco, origem_fiscal) VALUES ('X', 1, -1)",
    [],
    "origem fiscal negativa",
  );
});

test("GTIN: os quatro tamanhos validos, e o 'SEM GTIN' que a SEFAZ exige por escrito", async () => {
  for (const bom of ["'12345678'", "'123456789012'", "'1234567890128'", "'12345678901231'"]) {
    await cadastrar("gtin", bom);
  }
  // Produto sem codigo de barras NAO manda campo vazio: a SEFAZ exige a string
  // literal 'SEM GTIN'. Um vazio ali e rejeicao na transmissao.
  await cadastrar("gtin", "'SEM GTIN'");
  await cadastrar("gtin_embalagem", "'SEM GTIN'");

  await exigeRecusaDoBanco(
    "INSERT INTO canastra.produtos (nome, preco, gtin) VALUES ('X', 1, '123456789')",
    [],
    "GTIN com 9 digitos",
  );
  await exigeRecusaDoBanco(
    "INSERT INTO canastra.produtos (nome, preco, gtin) VALUES ('X', 1, '789-1234-567895')",
    [],
    "GTIN com hifen",
  );
  await exigeRecusaDoBanco(
    "INSERT INTO canastra.produtos (nome, preco, gtin) VALUES ('X', 1, 'sem gtin')",
    [],
    "'sem gtin' em minuscula",
  );
});

test("peso bruto nunca e menor que o liquido — embalagem tem massa", async () => {
  await cadastrar("peso_liquido, peso_bruto", "0.250, 0.290");
  await cadastrar("peso_liquido, peso_bruto", "0.250, 0.250");
  await exigeRecusaDoBanco(
    `INSERT INTO canastra.produtos (nome, preco, peso_liquido, peso_bruto)
     VALUES ('X', 1, 0.290, 0.250)`,
    [],
    "peso bruto menor que o liquido",
  );
  await exigeRecusaDoBanco(
    "INSERT INTO canastra.produtos (nome, preco, peso_liquido) VALUES ('X', 1, 0)",
    [],
    "peso liquido zero",
  );
});

test("codigo_bling e unico, e a ausencia dele nao colide com nada", async () => {
  await cadastrar("codigo_bling", "'99001'");
  await exigeRecusaDoBanco(
    "INSERT INTO canastra.produtos (nome, preco, codigo_bling) VALUES ('X', 1, '99001')",
    [],
    "dois produtos com o mesmo codigo do Bling",
    UNICO_VIOLADO,
  );
  // O indice e parcial: a loja inteira sem codigo do Bling continua valida.
  await bd.pool.query(
    "INSERT INTO canastra.produtos (nome, preco) VALUES ('Sem Bling A', 1), ('Sem Bling B', 1)",
  );
});

/* ------------------------------------------------------------------------- *
 * `estado`, e a linha que ja existia
 * ------------------------------------------------------------------------- */

test("estado: vocabulario fechado, e as linhas antigas nascem 'ativo'", async () => {
  const { rows } = await bd.pool.query(
    "SELECT estado FROM canastra.produtos WHERE produto_id = $1",
    [CAFE_ANTIGO],
  );
  assert.equal(rows[0].estado, "ativo", "produto que ja existia nao pode sumir da loja");

  await cadastrar("estado", "'rascunho'");
  await cadastrar("estado", "'arquivado'");
  await exigeRecusaDoBanco(
    "INSERT INTO canastra.produtos (nome, preco, estado) VALUES ('X', 1, 'inativo')",
    [],
    "estado fora da lista",
  );
});

/* ------------------------------------------------------------------------- *
 * Privilegio: quem le o bloco fiscal
 * ------------------------------------------------------------------------- */

test("a vitrine anonima nao muda: a view publica continua com as mesmas 14 colunas", async () => {
  const { rows } = await bd.pool.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema = 'canastra' AND table_name = 'produtos_publicos'`,
  );
  assert.equal(rows[0].n, 14, "coluna nova na view sem GRANT quebraria a vitrine com 42501");

  const publicos = await comoPapel(bd.pool, SESSAO_ANON, async (cliente) => {
    const { rows: r } = await cliente.query(
      "SELECT produto_id, nome, preco, peso FROM canastra.produtos_publicos",
    );
    return r;
  });
  assert.ok(publicos.length >= 1, "anon continua lendo o catalogo");
});

test("nem anon nem admin leem o bloco fiscal pelo PostgREST — o caminho e a rota do Express", async () => {
  // `produtos` e a relacao com SELECT recortado por COLUNA (0006:232). As
  // colunas novas nao entram naquela lista, entao herdam a mesma recusa que
  // `custo` — e a recusa e barulhenta (42501), nunca uma leitura vazia.
  for (const sessao of [SESSAO_ANON, SESSAO_DORA]) {
    await exigeRecusa(
      sessao,
      "SELECT ncm, codigo_bling FROM canastra.produtos",
      [],
      "lendo o bloco fiscal direto na tabela",
    );
  }

  // E o `SELECT *` continua recusando ate para a admin, como 0006 mediu. As
  // colunas novas nao pioram nem melhoram isso — o teste esta aqui para que a
  // propriedade nao se perca sem aparecer no diff.
  await exigeRecusa(
    SESSAO_DORA,
    "SELECT * FROM canastra.produtos",
    [],
    "admin fazendo SELECT * em produtos",
  );

  // O painel le pelo pool do Express, que conecta como DONO do banco: sem RLS e
  // sem privilegio de coluna no caminho. E o mesmo caminho que
  // `dashboardRepository.js` ja usa hoje, e ele nao leva 42501.
  const { rows } = await bd.pool.query(
    `SELECT produto_id, nome, custo, ncm, cest, origem_fiscal, gtin, unidade,
            tipo_item, cfop_padrao, csosn, peso, peso_liquido, peso_bruto,
            codigo_bling, estado
       FROM canastra.produtos WHERE produto_id = $1`,
    [CAFE_ANTIGO],
  );
  assert.equal(rows[0].ncm, "09011110");
  assert.equal(rows[0].codigo_bling, "1234567890");
});

/* ------------------------------------------------------------------------- *
 * O snapshot de custo
 * ------------------------------------------------------------------------- */

test("o custo congelado vive no item do jsonb, e a redacao de LGPD o preserva", async () => {
  // A DECISAO: a chave entra em `pedidos.itens`, que 0005 chama de "fotografia
  // congelada". Este teste e a prova de que a decisao funciona no unico ponto
  // onde ela poderia falhar em silencio — a redacao do titular, que reescreve o
  // jsonb inteiro. A denylist de 0013 deixa passar campo de PRODUTO (registro
  // fiscal) e apaga campo de PESSOA, e `custo_centavos` e produto.
  await bd.pool.query(
    `INSERT INTO canastra.pedidos (pedido_id, user_id, total, itens)
     VALUES ($1, $2, 99.90, $3::jsonb)`,
    [
      PED_ANA,
      ANA,
      JSON.stringify([
        {
          product_id: CAFE_ANTIGO,
          name: "Canastra Classico",
          price: 54.9,
          quantity: 2,
          custo_centavos: 2250,
          cpf: "52998224725",
        },
      ]),
    ],
  );

  await bd.pool.query("SELECT canastra.redigir_dados_do_titular($1)", [ANA]);

  const { rows } = await bd.pool.query(
    "SELECT itens FROM canastra.pedidos WHERE pedido_id = $1",
    [PED_ANA],
  );
  const item = rows[0].itens[0];
  assert.equal(item.custo_centavos, 2250, "o custo do momento da venda tem de sobreviver");
  assert.equal(item.name, "Canastra Classico", "o nome do produto e registro fiscal");
  assert.equal(item.cpf, "[redigido]", "o dado pessoal dentro do item continua saindo");
});
