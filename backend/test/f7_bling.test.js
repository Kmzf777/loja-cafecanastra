"use strict";

/**
 * F7 (onda 3G) — Bling/NF-e: a migração 0012, a sincronização idempotente, o
 * gatilho no aprovado (ligado E desligado), o erro legível de SKU que NÃO
 * quebra o webhook, a emissão da NF-e, o rastreio que volta e o refresh token
 * rotativo persistido.
 *
 * O `blingClient` INTEIRO é dublê via hook de require (mesmo padrão do MP em
 * f6_cupons.test.js): `blingPedidos` roda de verdade, contra banco real, com
 * as respostas do Bling programadas. O fluxo OAuth (rotação + persistência em
 * config_loja) é a exceção deliberada: usa o blingClient REAL com `fetchImpl`
 * injetado — é exatamente o comportamento dele que se quer provar.
 */

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const express = require("express");
const jwt = require("jsonwebtoken");
const { subirPostgres } = require("./ajuda/postgres.js");
const { aplicarMigracoes } = require("../db/migrar.js");

let bd;
let PaymentController;
let blingPedidos;
let blingClientReal;
let servidor;
let urlDaApi;
let tokenDeAdmin;

const ANA = "aaaaaaaa-0000-0000-0000-000000000001";
const P1 = "11111111-0000-0000-0000-0000000000b1"; // 50,00 — SKU cadastrado no "Bling"
const P2 = "11111111-0000-0000-0000-0000000000b2"; // 80,00 — SKU que NÃO existe no "Bling"

/** O que o dublê do MP responde; cada teste ajusta. */
const mp = { statusDoCreate: "pending", statusDoGet: "pending", criacoes: [] };

/** E-mails capturados do dublê do emailSender. */
const emails = [];

/**
 * O estado do dublê do Bling: o que "existe" lá e o que já foi pedido.
 * `requisicoes` é a evidência dos testes de idempotência e de gatilho.
 */
const bling = {
  requisicoes: [],
  produtosPorSku: { "F7-P1": { id: 501, codigo: "F7-P1" } },
  /**
   * Liga a resposta FROUXA da busca de produto: um produto de código
   * PARECIDO, que não é o SKU pedido. É o que a API de verdade pode fazer —
   * `GET /produtos?codigo=` é BUSCA, não lookup — e é contra isso que a
   * resolução exige `codigo` idêntico.
   */
  correspondenciaFrouxa: false,
  contatos: [],
  notas: {},
  /** Vendas que já existem lá, indexadas pelo `numeroLoja` (o pedido da loja). */
  vendasPorNumeroLoja: {},
  rastreioPorPedido: {},
  /** Erro programado: (metodo, caminho) => Error | null. */
  falharEm: null,
  /** Portão para orquestrar duas chamadas simultâneas no GET do pedido. */
  portaoDoPedido: null,
  proximoId: 1000,
};

function chamadasDe(metodo, caminho) {
  return bling.requisicoes.filter(
    (r) => r.metodo === metodo && r.caminho === caminho,
  );
}

/** Um erro no formato que o blingClient REAL produz para falha da API v3. */
function erroDoBling(mensagem, statusBling = 400) {
  const erro = new Error(`Bling: ${mensagem}`);
  erro.statusBling = statusBling;
  return erro;
}

/** Rendezvous de N chamadas: ninguém passa antes de todas chegarem. */
function barreiraDe(n) {
  let liberar;
  const pronto = new Promise((resolve) => {
    liberar = resolve;
  });
  let chegaram = 0;
  return async () => {
    chegaram += 1;
    if (chegaram >= n) liberar();
    await pronto;
  };
}

const dubleDoBlingClient = {
  configurado: () => true,
  zerarCacheParaTeste: () => {},
  sondar: async () => ({ configurado: true, token: { ok: true } }),
  renovarAccessToken: async () => "token-do-duble",
  obterAccessToken: async () => "token-do-duble",
  requisitar: async (metodo, caminho, { body, query } = {}) => {
    bling.requisicoes.push({ metodo, caminho, body, query });

    const programado = bling.falharEm?.(metodo, caminho);
    if (programado) throw programado;

    if (metodo === "GET" && caminho === "/produtos") {
      if (bling.correspondenciaFrouxa) {
        // "Achei um parecido": o id existe, o código NÃO é o pedido.
        return { data: [{ id: 999, codigo: `${query?.codigo}-OUTRO` }] };
      }
      const p = bling.produtosPorSku[query?.codigo];
      return { data: p ? [p] : [] };
    }
    if (metodo === "GET" && caminho === "/pedidos/vendas") {
      const venda = bling.vendasPorNumeroLoja[query?.numeroLoja];
      return { data: venda ? [venda] : [] };
    }
    if (metodo === "GET" && caminho === "/contatos") {
      const c = bling.contatos.find(
        (x) => x.numeroDocumento === query?.numeroDocumento,
      );
      return { data: c ? [c] : [] };
    }
    if (metodo === "POST" && caminho === "/contatos") {
      const id = ++bling.proximoId;
      bling.contatos.push({ id, numeroDocumento: body.numeroDocumento });
      return { data: { id } };
    }
    if (metodo === "POST" && caminho === "/pedidos/vendas") {
      const id = ++bling.proximoId;
      // Como no Bling de verdade: criada, ela passa a ser encontrável pelo
      // `numeroLoja` — é disso que a busca da auto-cura depende.
      if (body?.numeroLoja) {
        bling.vendasPorNumeroLoja[body.numeroLoja] = {
          id,
          numeroLoja: body.numeroLoja,
        };
      }
      return { data: { id } };
    }
    if (metodo === "POST" && /^\/pedidos\/vendas\/\d+\/gerar-nfe$/.test(caminho)) {
      const id = ++bling.proximoId;
      bling.notas[id] = {
        id,
        numero: 4242,
        serie: 1,
        chaveAcesso: "31260847000100550010000042421000042420",
        linkDanfe: `https://bling.local/danfe/${id}`,
      };
      return { data: { id } };
    }
    if (metodo === "POST" && /^\/nfe\/\d+\/enviar$/.test(caminho)) {
      return { data: {} };
    }
    const nfe = caminho.match(/^\/nfe\/(\d+)$/);
    if (metodo === "GET" && nfe) {
      return { data: bling.notas[nfe[1]] };
    }
    const pedido = caminho.match(/^\/pedidos\/vendas\/(\d+)$/);
    if (metodo === "GET" && pedido) {
      if (bling.portaoDoPedido) await bling.portaoDoPedido();
      const codigo = bling.rastreioPorPedido[pedido[1]] || null;
      return {
        data: {
          id: Number(pedido[1]),
          situacao: { id: 9, valor: "Atendido" },
          transporte: {
            volumes: codigo ? [{ codigoRastreamento: codigo }] : [],
          },
        },
      };
    }
    throw new Error(`dublê do Bling não conhece ${metodo} ${caminho}`);
  },
};

function respostaFalsa() {
  const res = { codigo: null, corpo: null };
  res.status = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.sendStatus = (codigo) => {
    res.codigo = codigo;
    return res;
  };
  res.json = (corpo) => {
    if (res.codigo === null) res.codigo = 200;
    res.corpo = corpo;
    return res;
  };
  return res;
}

async function pedidoNoBanco(pedidoId) {
  const { rows } = await bd.pool.query(
    `SELECT status, codigo_rastreio, bling_id, bling_situacao, bling_claim_em,
            bling_sincronizado_em, nfe_id, nfe_numero, nfe_chave, nfe_url
       FROM canastra.pedidos WHERE pedido_id = $1`,
    [pedidoId],
  );
  return rows[0];
}

/** Um pedido gravado direto no banco, já no status pedido. */
async function criarPedidoDireto({
  status = "aprovado",
  produto = P1,
  quantity = 2,
  price = 50,
  desconto = 0,
  cupom = null,
  itens = null,
} = {}) {
  const { rows } = await bd.pool.query(
    `INSERT INTO canastra.pedidos
       (user_id, total, status, metodo_pagamento, itens, endereco_json,
        frete, metodo_envio, desconto, cupom_codigo)
     VALUES ($1, $2, $3, 'pix', $4::jsonb, $5::jsonb, 0, 'Retirada', $6, $7)
     RETURNING pedido_id`,
    [
      ANA,
      price * quantity - desconto,
      status,
      JSON.stringify(
        itens || [{ product_id: produto, name: "Café F7", price, quantity }],
      ),
      JSON.stringify({
        zip_code: "35012-345",
        street: "Rua X",
        number: "1",
        neighborhood: "Centro",
        city: "Piumhi",
        state: "MG",
      }),
      desconto,
      cupom,
    ],
  );
  return rows[0].pedido_id;
}

function corpoDeCheckout({ produto = P1, quantity = 1 } = {}) {
  return {
    formData: {
      paymentMethodId: "pix",
      payer: {
        email: "ana@ex.com",
        identification: { type: "CPF", number: "529.982.247-25" },
      },
    },
    paymentMethodType: "pix",
    items: [{ product_id: produto, quantity, name: "Café F7" }],
    userEmail: "ana@ex.com",
    address: { zip_code: "35012345", street: "Rua X", number: "1" },
    shippingCost: 0,
    shippingMethod: "Retirada na loja",
  };
}

before(async () => {
  bd = await subirPostgres();
  await aplicarMigracoes(bd.pool);

  await bd.pool.query(
    "INSERT INTO auth.users (id, email) VALUES ($1, 'ana@ex.com')",
    [ANA],
  );
  await bd.pool.query(
    "INSERT INTO canastra.clientes (user_id, nome, cpf) VALUES ($1, 'Ana', '52998224725')",
    [ANA],
  );
  await bd.pool.query("INSERT INTO canastra.config_loja (id) VALUES (1)");
  await bd.pool.query(
    `INSERT INTO canastra.produtos (produto_id, nome, preco, quantidade, sku) VALUES
       ($1, 'Café F7',        50.00, 50, 'F7-P1'),
       ($2, 'Café Sem Bling', 80.00, 50, 'F7-SEM-BLING')`,
    [P1, P2],
  );

  process.env.DATABASE_URL = bd.connectionString;
  process.env.NODE_ENV = "development";
  delete process.env.MP_WEBHOOK_SECRET;
  delete process.env.BLING_ATIVO;
  delete process.env.BLING_NFE_AUTO;
  // Porta fechada: nenhum teste depende de rede (padrão de f6).
  process.env.MELHOR_ENVIO_URL = "http://127.0.0.1:9";

  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (caminho) {
    if (caminho === "../config/mercadopago") {
      return {
        payment: {
          get: async ({ id }) => ({ id, status: mp.statusDoGet }),
          create: async ({ body }) => {
            mp.criacoes.push(body);
            return {
              id: 900000 + mp.criacoes.length,
              status: mp.statusDoCreate,
              point_of_interaction: {
                transaction_data: { ticket_url: "https://mp.local/pix" },
              },
            };
          },
        },
      };
    }
    if (caminho === "../utils/emailSender") {
      return {
        sendStatusEmail: async (order, status, trackingCode) => {
          emails.push({ orderId: order.order_id, status, trackingCode });
        },
        sendAdminNewOrderEmail: async () => {},
        sendCartReminderEmail: async () => {},
      };
    }
    // O dublê desta onda: blingPedidos (e só ele) requer "./blingClient".
    if (caminho === "./blingClient") {
      return dubleDoBlingClient;
    }
    return requireOriginal.apply(this, arguments);
  };

  try {
    PaymentController = require("../src/controllers/PaymentController.js");
    blingPedidos = require("../src/services/blingPedidos.js");
  } finally {
    Module.prototype.require = requireOriginal;
  }

  // O blingClient REAL, para os testes do OAuth — carregado FORA do hook
  // (o caminho daqui é outro, então o hook nem o veria).
  blingClientReal = require("../src/services/blingClient.js");

  /**
   * As rotas /bling num Express de VERDADE, com a cadeia inteira de
   * middlewares — isAuthenticated e isAdmin inclusive.
   *
   * Não é cerimônia: 503 com a integração desligada, 400 de UUID malformado e
   * 502 de erro do Bling são decisões que moram NA ROTA, e chamar o serviço
   * direto (como fazem os testes acima) não passa por nenhuma delas. O token é
   * HS256 do `SUPABASE_JWT_SECRET`, o caminho self-hosted que é o alvo de
   * produção; a Ana entra em `canastra.admins` porque `isAdmin` lê o BANCO,
   * nunca um claim.
   */
  process.env.SUPABASE_JWT_SECRET = "segredo-de-teste-hs256";
  await bd.pool.query("INSERT INTO canastra.admins (user_id) VALUES ($1)", [ANA]);
  tokenDeAdmin = jwt.sign(
    { sub: ANA, role: "authenticated", email: "ana@ex.com" },
    process.env.SUPABASE_JWT_SECRET,
    { expiresIn: "1h" },
  );

  const app = express();
  app.use("/bling", require("../src/routes/bling.routes.js"));
  await new Promise((pronto) => {
    servidor = app.listen(0, "127.0.0.1", pronto);
  });
  urlDaApi = `http://127.0.0.1:${servidor.address().port}`;
}, { timeout: 120_000 });

after(async () => {
  if (servidor) await new Promise((pronto) => servidor.close(pronto));
  await require("../src/pgPool.js").end().catch(() => {});
  await bd?.derrubar();
});

/** Uma chamada às rotas /bling já autenticada como admin. */
async function chamarApi(metodo, caminho) {
  const resposta = await fetch(`${urlDaApi}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${tokenDeAdmin}` },
  });
  const texto = await resposta.text();
  let corpo = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = texto;
  }
  return { status: resposta.status, corpo };
}

beforeEach(() => {
  if (!bd) {
    throw new Error(
      "O Postgres nao subiu no before(); a causa real esta no erro daquele hook.",
    );
  }
});

/* --------------------------------------------------------------------------
 * Migração 0012: colunas, índice único e a coluna do segredo protegida
 * -------------------------------------------------------------------------- */

test("0012: bling_id não duplica, e bling_refresh_token não vaza para anon", async () => {
  const a = await criarPedidoDireto();
  const b = await criarPedidoDireto();
  await bd.pool.query(
    "UPDATE canastra.pedidos SET bling_id = 'BL-1' WHERE pedido_id = $1",
    [a],
  );
  await assert.rejects(
    () =>
      bd.pool.query(
        "UPDATE canastra.pedidos SET bling_id = 'BL-1' WHERE pedido_id = $1",
        [b],
      ),
    (e) => e.code === "23505",
  );

  // O privilégio de COLUNA: anon lê a configuração pública, mas a coluna do
  // refresh token responde 42501 — é a tranca que impede o segredo de sair
  // pelo PostgREST da instância compartilhada.
  const cliente = await bd.pool.connect();
  try {
    await cliente.query("SET ROLE anon");
    const ok = await cliente.query(
      "SELECT titulo_site, frete_gratis_minimo_centavos FROM canastra.config_loja",
    );
    assert.equal(ok.rows.length, 1);
    await assert.rejects(
      () => cliente.query("SELECT bling_refresh_token FROM canastra.config_loja"),
      (e) => e.code === "42501",
    );
    await assert.rejects(
      () => cliente.query("SELECT * FROM canastra.config_loja"),
      (e) => e.code === "42501",
    );
  } finally {
    await cliente.query("RESET ROLE").catch(() => {});
    cliente.release();
  }
});

/* --------------------------------------------------------------------------
 * Sincronização idempotente
 * -------------------------------------------------------------------------- */

test("sincronizarPedido: cria pedido de venda uma vez; a segunda chamada é no-op", async () => {
  const pedidoId = await criarPedidoDireto({ desconto: 10, cupom: "CAFE10" });

  const antes = chamadasDe("POST", "/pedidos/vendas").length;
  const resultado = await blingPedidos.sincronizarPedido(pedidoId);

  assert.equal(resultado.jaSincronizado, false);
  assert.ok(resultado.blingId);
  assert.equal(resultado.pedido.bling_id, resultado.blingId);

  const criacoes = chamadasDe("POST", "/pedidos/vendas");
  assert.equal(criacoes.length, antes + 1);
  const corpo = criacoes[criacoes.length - 1].body;
  assert.equal(corpo.numeroLoja, pedidoId, "o elo loja→Bling é o pedido_id");
  assert.equal(corpo.itens.length, 1);
  assert.equal(corpo.itens[0].codigo, "F7-P1", "item casa por SKU");
  assert.equal(corpo.itens[0].quantidade, 2);
  assert.equal(corpo.itens[0].valor, 50);
  assert.deepEqual(corpo.desconto, { valor: 10, unidade: "REAL" });
  assert.equal(corpo.contato.id, bling.contatos[0].id);
  assert.equal(bling.contatos[0].numeroDocumento, "52998224725");

  const gravado = await pedidoNoBanco(pedidoId);
  assert.equal(gravado.bling_id, resultado.blingId);
  assert.equal(gravado.bling_situacao, "sincronizado");
  assert.ok(gravado.bling_sincronizado_em);

  // Idempotência: mesma chamada de novo → no-op, sem segunda criação.
  const repeticao = await blingPedidos.sincronizarPedido(pedidoId);
  assert.equal(repeticao.jaSincronizado, true);
  assert.equal(repeticao.blingId, resultado.blingId);
  assert.equal(chamadasDe("POST", "/pedidos/vendas").length, antes + 1);

  // E o contato não é recriado: a segunda venda da Ana reusa o contato.
  const outro = await criarPedidoDireto();
  await blingPedidos.sincronizarPedido(outro);
  assert.equal(bling.contatos.length, 1, "contato buscado por CPF, não duplicado");
});

test("sincronizarPedido: pedido sem pagamento confirmado é recusado com frase", async () => {
  const pendente = await criarPedidoDireto({ status: "pendente" });
  await assert.rejects(
    () => blingPedidos.sincronizarPedido(pendente),
    (e) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /pagamento confirmado/);
      return true;
    },
  );
  assert.equal((await pedidoNoBanco(pendente)).bling_situacao, null);
});

/* --------------------------------------------------------------------------
 * O gatilho do aprovado — ligado e desligado
 * -------------------------------------------------------------------------- */

test("checkout aprovado com BLING_ATIVO=true dispara a sincronização", async () => {
  process.env.BLING_ATIVO = "true";
  mp.statusDoCreate = "approved";
  try {
    const res = respostaFalsa();
    await PaymentController.createPayment(
      { user: { userId: ANA }, headers: {}, body: corpoDeCheckout() },
      res,
    );
    assert.equal(res.codigo, 201);

    // O gatilho é deliberadamente fora da resposta: espera os disparos.
    await blingPedidos.aguardarDisparos();

    const gravado = await pedidoNoBanco(res.corpo.orderId);
    assert.ok(gravado.bling_id, "o pedido aprovado foi ao Bling sozinho");
    assert.equal(gravado.status, "aprovado");
  } finally {
    delete process.env.BLING_ATIVO;
    mp.statusDoCreate = "pending";
  }
});

test("com BLING_ATIVO desligado, aprovado NÃO vai ao Bling", async () => {
  assert.notEqual(process.env.BLING_ATIVO, "true");
  mp.statusDoCreate = "approved";
  const chamadasAntes = bling.requisicoes.length;
  try {
    const res = respostaFalsa();
    await PaymentController.createPayment(
      { user: { userId: ANA }, headers: {}, body: corpoDeCheckout() },
      res,
    );
    assert.equal(res.codigo, 201);
    await blingPedidos.aguardarDisparos();

    const gravado = await pedidoNoBanco(res.corpo.orderId);
    assert.equal(gravado.bling_id, null);
    assert.equal(
      bling.requisicoes.length,
      chamadasAntes,
      "nenhuma chamada ao Bling com a integração desligada",
    );
  } finally {
    mp.statusDoCreate = "pending";
  }
});

test("webhook aprovado dispara; SKU inexistente vira log e o pedido segue aprovado", async () => {
  // Pedido nasce pendente pelo checkout, com o produto cujo SKU NÃO está no
  // Bling — o pior caso do gatilho.
  const res = respostaFalsa();
  await PaymentController.createPayment(
    { user: { userId: ANA }, headers: {}, body: corpoDeCheckout({ produto: P2 }) },
    res,
  );
  assert.equal(res.codigo, 201);
  const { rows } = await bd.pool.query(
    "SELECT pagamento_id_mp FROM canastra.pedidos WHERE pedido_id = $1",
    [res.corpo.orderId],
  );

  process.env.BLING_ATIVO = "true";
  mp.statusDoGet = "approved";
  try {
    const hook = respostaFalsa();
    await PaymentController.receiveWebhook(
      {
        headers: { "x-request-id": "req-teste" },
        body: { type: "payment", data: { id: rows[0].pagamento_id_mp } },
        ip: "127.0.0.1",
      },
      hook,
    );
    // A REGRA DE OURO: o webhook responde 200 — a falha do Bling é problema
    // do Bling, nunca do fluxo de pagamento.
    assert.equal(hook.codigo, 200);

    await blingPedidos.aguardarDisparos();

    const gravado = await pedidoNoBanco(res.corpo.orderId);
    assert.equal(gravado.status, "aprovado", "o pedido continua aprovado");
    assert.equal(gravado.bling_id, null, "nada sincronizado");
    assert.equal(gravado.bling_situacao, null, "o claim foi desfeito para retentativa");

    // E a retentativa manual explica O QUE fazer, nomeando o SKU.
    await assert.rejects(
      () => blingPedidos.sincronizarPedido(res.corpo.orderId),
      (e) => {
        assert.equal(e.status, 400);
        assert.equal(e.codigoPublico, "SKU_AUSENTE_NO_BLING");
        assert.match(e.message, /F7-SEM-BLING/);
        assert.match(e.message, /docs\/bling\.md/);
        return true;
      },
    );
  } finally {
    delete process.env.BLING_ATIVO;
    mp.statusDoGet = "pending";
  }
});

/* --------------------------------------------------------------------------
 * NF-e
 * -------------------------------------------------------------------------- */

test("emitirNfe: gera, envia e grava numero/chave/url; repetir é no-op", async () => {
  const pedidoId = await criarPedidoDireto();
  await blingPedidos.sincronizarPedido(pedidoId);

  const resultado = await blingPedidos.emitirNfe(pedidoId);
  assert.equal(resultado.jaEmitida, false);

  const gravado = await pedidoNoBanco(pedidoId);
  assert.equal(gravado.nfe_numero, "4242");
  assert.equal(gravado.nfe_chave, "31260847000100550010000042421000042420");
  assert.match(gravado.nfe_url, /^https:\/\/bling\.local\/danfe\//);

  const enviosAntes = bling.requisicoes.filter((r) =>
    /\/nfe\/\d+\/enviar$/.test(r.caminho),
  ).length;
  const repeticao = await blingPedidos.emitirNfe(pedidoId);
  assert.equal(repeticao.jaEmitida, true);
  assert.equal(
    bling.requisicoes.filter((r) => /\/nfe\/\d+\/enviar$/.test(r.caminho)).length,
    enviosAntes,
    "a segunda chamada não transmite de novo",
  );
});

/* --------------------------------------------------------------------------
 * Rastreio
 * -------------------------------------------------------------------------- */

test("consultarRastreio: código do Bling grava local, avança para enviado e manda o e-mail", async () => {
  const pedidoId = await criarPedidoDireto();
  const { blingId } = await blingPedidos.sincronizarPedido(pedidoId);

  // O Bling ainda não tem rastreio: nada muda, nenhum e-mail.
  let resultado = await blingPedidos.consultarRastreio(pedidoId);
  assert.equal(resultado.rastreio, null);
  assert.equal((await pedidoNoBanco(pedidoId)).status, "aprovado");

  // A expedição preencheu o rastreio no Bling.
  bling.rastreioPorPedido[blingId] = "AA123456785BR";
  const emailsAntes = emails.length;

  resultado = await blingPedidos.consultarRastreio(pedidoId);
  assert.equal(resultado.rastreio, "AA123456785BR");

  const gravado = await pedidoNoBanco(pedidoId);
  assert.equal(gravado.codigo_rastreio, "AA123456785BR");
  assert.equal(gravado.status, "enviado");
  assert.equal(gravado.bling_situacao, "Atendido", "a situação do Bling vira cache");

  assert.equal(emails.length, emailsAntes + 1);
  assert.deepEqual(emails[emails.length - 1], {
    orderId: pedidoId,
    status: "enviado",
    trackingCode: "AA123456785BR",
  });

  // Consultar de novo com o MESMO código: nem status nem e-mail repetido.
  resultado = await blingPedidos.consultarRastreio(pedidoId);
  assert.equal(resultado.rastreio, "AA123456785BR");
  assert.equal(emails.length, emailsAntes + 1, "sem e-mail dobrado");

  // E a rodada do cron encontra só quem ainda precisa.
  const rodada = await blingPedidos.rodadaDeRastreio();
  assert.equal(typeof rodada.candidatos, "number");
});

/* --------------------------------------------------------------------------
 * OAuth: o refresh token rotativo persiste em config_loja
 * -------------------------------------------------------------------------- */

async function tokenNoBanco() {
  const { rows } = await bd.pool.query(
    "SELECT bling_refresh_token FROM canastra.config_loja WHERE id = 1",
  );
  return rows[0].bling_refresh_token;
}

function fetchDeOauth(respostas) {
  const chamadas = [];
  const fetchImpl = async (url, opts) => {
    chamadas.push({ url: String(url), opts });
    const corpo = respostas.shift();
    return {
      ok: true,
      status: 200,
      json: async () => corpo,
      text: async () => JSON.stringify(corpo),
    };
  };
  return { fetchImpl, chamadas };
}

test("refresh token novo persiste em config_loja e é o usado dali em diante", async () => {
  process.env.BLING_CLIENT_ID = "id-de-teste";
  process.env.BLING_CLIENT_SECRET = "segredo-de-teste";
  process.env.BLING_REFRESH_TOKEN = "semente-do-env";
  blingClientReal.zerarCacheParaTeste();

  try {
    // 1ª renovação: usa a SEMENTE da env e persiste o token rotacionado.
    const primeira = fetchDeOauth([
      { access_token: "acc-1", expires_in: 21600, refresh_token: "rotado-1" },
    ]);
    const token = await blingClientReal.renovarAccessToken({
      fetchImpl: primeira.fetchImpl,
    });
    assert.equal(token, "acc-1");
    assert.match(primeira.chamadas[0].url, /\/oauth\/token$/);
    assert.match(
      primeira.chamadas[0].opts.body,
      /refresh_token=semente-do-env/,
      "a primeira renovação parte da env",
    );
    assert.match(primeira.chamadas[0].opts.headers.Authorization, /^Basic /);
    assert.equal(await tokenNoBanco(), "rotado-1", "o novo token está no banco");

    // 2ª renovação no MESMO processo: usa o da memória (o único que o Bling
    // ainda aceita), e o banco acompanha.
    const segunda = fetchDeOauth([
      { access_token: "acc-2", expires_in: 21600, refresh_token: "rotado-2" },
    ]);
    await blingClientReal.renovarAccessToken({ fetchImpl: segunda.fetchImpl });
    assert.match(segunda.chamadas[0].opts.body, /refresh_token=rotado-1/);
    assert.equal(await tokenNoBanco(), "rotado-2");

    // "Restart" (cache zerado): a env está OBSOLETA — quem vale é o banco.
    blingClientReal.zerarCacheParaTeste();
    const aposRestart = fetchDeOauth([
      { access_token: "acc-3", expires_in: 21600, refresh_token: "rotado-3" },
    ]);
    await blingClientReal.renovarAccessToken({ fetchImpl: aposRestart.fetchImpl });
    assert.match(
      aposRestart.chamadas[0].opts.body,
      /refresh_token=rotado-2/,
      "depois do restart, o token vem do banco e não da env",
    );
    assert.equal(await tokenNoBanco(), "rotado-3");
  } finally {
    delete process.env.BLING_CLIENT_ID;
    delete process.env.BLING_CLIENT_SECRET;
    delete process.env.BLING_REFRESH_TOKEN;
    blingClientReal.zerarCacheParaTeste();
    await bd.pool.query(
      "UPDATE canastra.config_loja SET bling_refresh_token = NULL WHERE id = 1",
    );
  }
});

test("sem credencial, o blingClient real recusa com frase e a sonda não estoura", async () => {
  blingClientReal.zerarCacheParaTeste();
  assert.equal(blingClientReal.configurado(), false);
  await assert.rejects(
    () => blingClientReal.renovarAccessToken(),
    /BLING_CLIENT_ID e BLING_CLIENT_SECRET/,
  );
  const sonda = await blingClientReal.sondar();
  assert.equal(sonda.configurado, false);
  assert.equal(sonda.token.ok, false);
});

test("invalid_grant ESQUECE o token da memória: a tentativa seguinte parte do banco", async () => {
  // O bug que isto fecha: com o token queimado preso na memória (que tem
  // precedência sobre o banco), a integração ficava morta até um restart —
  // mesmo com um token bom gravado na config_loja pelo gestor, que é
  // exatamente o que o runbook manda fazer quando o rodízio se perde.
  process.env.BLING_CLIENT_ID = "id-de-teste";
  process.env.BLING_CLIENT_SECRET = "segredo-de-teste";
  process.env.BLING_REFRESH_TOKEN = "queimado-na-env";
  blingClientReal.zerarCacheParaTeste();
  await bd.pool.query(
    "UPDATE canastra.config_loja SET bling_refresh_token = 'bom-no-banco' WHERE id = 1",
  );

  try {
    const recusa = async () => ({
      ok: false,
      status: 400,
      text: async () => '{"error":"invalid_grant"}',
      json: async () => ({ error: "invalid_grant" }),
    });
    // A memória guarda um token que o Bling acabou de recusar...
    await assert.rejects(
      () => blingClientReal.renovarAccessToken({ fetchImpl: recusa }),
      /invalid_grant/,
    );

    // ...e a tentativa seguinte NÃO insiste com ele: recomeça do banco.
    const segunda = fetchDeOauth([
      { access_token: "acc-ok", expires_in: 21600, refresh_token: "rotado-novo" },
    ]);
    await blingClientReal.renovarAccessToken({ fetchImpl: segunda.fetchImpl });
    assert.match(
      segunda.chamadas[0].opts.body,
      /refresh_token=bom-no-banco/,
      "depois do invalid_grant, a leitura recomeça do banco",
    );
  } finally {
    delete process.env.BLING_CLIENT_ID;
    delete process.env.BLING_CLIENT_SECRET;
    delete process.env.BLING_REFRESH_TOKEN;
    blingClientReal.zerarCacheParaTeste();
    await bd.pool.query(
      "UPDATE canastra.config_loja SET bling_refresh_token = NULL WHERE id = 1",
    );
  }
});

test("Bling mudo vira 504 com frase própria — e a frase NÃO leva o CPF da querystring", async () => {
  process.env.BLING_CLIENT_ID = "id-de-teste";
  process.env.BLING_CLIENT_SECRET = "segredo-de-teste";
  process.env.BLING_REFRESH_TOKEN = "semente-do-env";
  blingClientReal.zerarCacheParaTeste();

  try {
    // A primeira chamada é a renovação do token (responde); a segunda é a
    // requisição de verdade, e essa o AbortController mata.
    let chamadas = 0;
    const fetchImpl = async () => {
      chamadas += 1;
      if (chamadas === 1) {
        const corpo = { access_token: "acc-1", expires_in: 21600 };
        return {
          ok: true,
          status: 200,
          json: async () => corpo,
          text: async () => JSON.stringify(corpo),
        };
      }
      const abortado = new Error("The operation was aborted");
      abortado.name = "AbortError";
      throw abortado;
    };

    await assert.rejects(
      () =>
        blingClientReal.requisitar("GET", "/contatos", {
          query: { numeroDocumento: "52998224725" },
          fetchImpl,
        }),
      (e) => {
        assert.equal(e.status, 504, "504 próprio, e não 500 genérico");
        assert.equal(e.codigoPublico, "BLING_SEM_RESPOSTA");
        assert.match(e.message, /não respondeu em 15s/);
        assert.match(e.message, /GET .*\/contatos\)/, "o caminho ajuda a depurar");
        // A MESMA entrega que redige CPF do banco não pode publicá-lo aqui.
        assert.ok(
          !/52998224725|numeroDocumento/.test(e.message),
          "a querystring (com o CPF) não entra na frase de erro",
        );
        return true;
      },
    );
  } finally {
    delete process.env.BLING_CLIENT_ID;
    delete process.env.BLING_CLIENT_SECRET;
    delete process.env.BLING_REFRESH_TOKEN;
    blingClientReal.zerarCacheParaTeste();
  }
});

/* --------------------------------------------------------------------------
 * A corrida do claim, e a auto-cura sem venda dobrada
 * -------------------------------------------------------------------------- */

test("claim: chamada simultânea leva 409; o claim envelhecido se auto-cura", async () => {
  const pedidoId = await criarPedidoDireto();

  // Alguém está sincronizando AGORA.
  await bd.pool.query(
    `UPDATE canastra.pedidos
        SET bling_situacao = 'sincronizando', bling_claim_em = now()
      WHERE pedido_id = $1`,
    [pedidoId],
  );

  const criacoesAntes = chamadasDe("POST", "/pedidos/vendas").length;
  await assert.rejects(
    () => blingPedidos.sincronizarPedido(pedidoId),
    (e) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /outra chamada/);
      return true;
    },
  );
  assert.equal(
    chamadasDe("POST", "/pedidos/vendas").length,
    criacoesAntes,
    "quem perdeu o claim não chamou o Bling",
  );

  /**
   * O RELÓGIO DO CLAIM É SÓ DELE. Aqui o claim envelhece (11 minutos) e, no
   * mesmo UPDATE, `atualizado_em` é carimbado AGORA — é o que o webhook do MP,
   * o painel e a redação da LGPD fazem o tempo todo. Com o corte antigo (que
   * lia `atualizado_em`), este pedido ficaria travado em 'sincronizando' para
   * sempre; com `bling_claim_em`, a auto-cura acontece.
   */
  await bd.pool.query(
    `UPDATE canastra.pedidos
        SET bling_claim_em = now() - interval '11 minutes', atualizado_em = now()
      WHERE pedido_id = $1`,
    [pedidoId],
  );

  const buscasAntes = chamadasDe("GET", "/pedidos/vendas").length;
  const resultado = await blingPedidos.sincronizarPedido(pedidoId);
  assert.equal(resultado.jaSincronizado, false, "o claim órfão foi herdado");
  assert.equal(
    chamadasDe("GET", "/pedidos/vendas").length,
    buscasAntes + 1,
    "antes de criar, o claim herdado PERGUNTA se a venda já existe lá",
  );
  assert.equal(chamadasDe("POST", "/pedidos/vendas").length, criacoesAntes + 1);

  const gravado = await pedidoNoBanco(pedidoId);
  assert.equal(gravado.bling_situacao, "sincronizado");
  assert.equal(gravado.bling_claim_em, null, "o claim é solto ao terminar");
});

test("claim herdado: venda que já existe no Bling é ADOTADA, não duplicada", async () => {
  // A janela real: o processo anterior criou a venda e morreu antes de gravar
  // o `bling_id`. Sem a busca por `numeroLoja`, a retentativa criaria a
  // segunda venda — estoque baixado duas vezes, e nenhuma trava de banco pega
  // isso (os dois `bling_id` seriam diferentes).
  const pedidoId = await criarPedidoDireto();
  bling.vendasPorNumeroLoja[pedidoId] = { id: 7777, numeroLoja: pedidoId };
  await bd.pool.query(
    `UPDATE canastra.pedidos
        SET bling_situacao = 'sincronizando',
            bling_claim_em = now() - interval '11 minutes'
      WHERE pedido_id = $1`,
    [pedidoId],
  );

  const criacoesAntes = chamadasDe("POST", "/pedidos/vendas").length;
  const resultado = await blingPedidos.sincronizarPedido(pedidoId);

  assert.equal(resultado.jaSincronizado, true);
  assert.equal(resultado.recuperado, true);
  assert.equal(resultado.blingId, "7777");
  assert.equal(
    chamadasDe("POST", "/pedidos/vendas").length,
    criacoesAntes,
    "NENHUMA segunda venda foi criada",
  );

  const gravado = await pedidoNoBanco(pedidoId);
  assert.equal(gravado.bling_id, "7777");
  assert.equal(gravado.bling_situacao, "sincronizado");
  assert.ok(gravado.bling_sincronizado_em);
});

/* --------------------------------------------------------------------------
 * As guardas: LGPD, SKU exato, pedido cancelado
 * -------------------------------------------------------------------------- */

test("pedido redigido pela LGPD NÃO vai ao ERP: 422 antes de qualquer chamada", async () => {
  const pedidoId = await criarPedidoDireto();
  // O que a redação da 0013 deixa: um endereço que não é endereço nenhum.
  await bd.pool.query(
    `UPDATE canastra.pedidos
        SET redigido_em = now(),
            endereco_json = jsonb_build_object(
              'street', '[redigido]', 'number', '0', 'zip_code', '312',
              'city', '[redigido]', 'state', 'MG')
      WHERE pedido_id = $1`,
    [pedidoId],
  );

  const chamadasAntes = bling.requisicoes.length;
  await assert.rejects(
    () => blingPedidos.sincronizarPedido(pedidoId),
    (e) => {
      assert.equal(e.status, 422);
      assert.equal(e.codigoPublico, "PEDIDO_REDIGIDO");
      assert.match(e.message, /redigido pela LGPD não vai ao ERP/);
      return true;
    },
  );
  assert.equal(
    bling.requisicoes.length,
    chamadasAntes,
    "a rua '[redigido]' e o CEP mutilado não chegaram perto do Bling",
  );
  assert.equal(
    (await pedidoNoBanco(pedidoId)).bling_situacao,
    null,
    "nem o claim foi tomado",
  );

  // E a NF-e, que sincroniza antes quando falta o pedido de venda, herda a recusa.
  await assert.rejects(
    () => blingPedidos.emitirNfe(pedidoId),
    (e) => e.status === 422,
  );
});

test("SKU casa só com código IDÊNTICO: 'o parecido' é recusado, não adotado", async () => {
  // O dublê passa a responder como a busca de verdade pode responder: um
  // produto que EXISTE e cujo código é PARECIDO. Aceitá-lo vincularia o item
  // ao produto errado e baixaria o estoque errado — em silêncio, porque nada
  // nisso levanta erro.
  const pedidoId = await criarPedidoDireto();
  const criacoesAntes = chamadasDe("POST", "/pedidos/vendas").length;
  bling.correspondenciaFrouxa = true;

  try {
    await assert.rejects(
      () => blingPedidos.sincronizarPedido(pedidoId),
      (e) => {
        assert.equal(e.status, 400);
        assert.equal(e.codigoPublico, "SKU_AUSENTE_NO_BLING");
        assert.match(e.message, /F7-P1/);
        assert.match(e.message, /código exato/);
        return true;
      },
    );
  } finally {
    bling.correspondenciaFrouxa = false;
  }

  assert.equal(
    chamadasDe("POST", "/pedidos/vendas").length,
    criacoesAntes,
    "nada foi criado com o produto parecido",
  );
  assert.equal((await pedidoNoBanco(pedidoId)).bling_situacao, null);
});

test("o mesmo SKU em duas linhas custa UM GET de produto", async () => {
  const pedidoId = await criarPedidoDireto({
    itens: [
      { product_id: P1, name: "Café F7", price: 50, quantity: 1 },
      { product_id: P1, name: "Café F7", price: 50, quantity: 3 },
    ],
  });

  const consultasAntes = chamadasDe("GET", "/produtos").length;
  await blingPedidos.sincronizarPedido(pedidoId);

  assert.equal(
    chamadasDe("GET", "/produtos").length,
    consultasAntes + 1,
    "um GET por SKU distinto, não por item",
  );
  const criacoes = chamadasDe("POST", "/pedidos/vendas");
  assert.equal(criacoes[criacoes.length - 1].body.itens.length, 2);
});

test("rastreio: venda cancelada/estornada é recusada com 409, sem gravar código", async () => {
  const pedidoId = await criarPedidoDireto();
  const { blingId } = await blingPedidos.sincronizarPedido(pedidoId);
  bling.rastreioPorPedido[blingId] = "BB999999999BR";

  await bd.pool.query(
    "UPDATE canastra.pedidos SET status = 'reembolsado' WHERE pedido_id = $1",
    [pedidoId],
  );

  const emailsAntes = emails.length;
  await assert.rejects(
    () => blingPedidos.consultarRastreio(pedidoId),
    (e) => {
      assert.equal(e.status, 409);
      assert.match(e.message, /cancelada ou estornada/);
      return true;
    },
  );

  const gravado = await pedidoNoBanco(pedidoId);
  assert.equal(gravado.codigo_rastreio, null, "estornado não recebe rastreio");
  assert.equal(gravado.status, "reembolsado");
  assert.equal(emails.length, emailsAntes, "e nenhum e-mail de 'enviado'");
});

/* --------------------------------------------------------------------------
 * NF-e gerada mas não transmitida — o caso mais comum, e o mais mentiroso
 * -------------------------------------------------------------------------- */

function geracoesDeNota() {
  return bling.requisicoes.filter((r) => /gerar-nfe$/.test(r.caminho)).length;
}

test("NF-e não transmitida: grava o parcial, o erro sobe, e a retentativa RETRANSMITE a mesma nota", async () => {
  const pedidoId = await criarPedidoDireto();
  await blingPedidos.sincronizarPedido(pedidoId);

  const geracoesAntes = geracoesDeNota();
  bling.falharEm = (metodo, caminho) =>
    metodo === "POST" && /^\/nfe\/\d+\/enviar$/.test(caminho)
      ? erroDoBling("Natureza de operação não configurada", 400)
      : null;

  try {
    await assert.rejects(
      () => blingPedidos.emitirNfe(pedidoId),
      (e) => {
        assert.match(e.message, /Natureza de operação/, "a frase do Bling sobe inteira");
        assert.match(e.message, /GERADA no Bling mas NÃO transmitida/);
        assert.equal(e.statusBling, 400, "continua sendo erro do Bling: 502 na rota");
        return true;
      },
    );

    const parcial = await pedidoNoBanco(pedidoId);
    assert.ok(parcial.nfe_id, "o id da nota ficou guardado para a retransmissão");
    assert.equal(parcial.nfe_numero, "4242", "o parcial mostra ao painel onde parou");
    assert.equal(
      parcial.nfe_chave,
      null,
      "a chave NÃO é gravada sem transmissão — é ela que responde 'já emitida'",
    );

    // A retentativa não gera outra nota: retransmite a MESMA. Falhando de
    // novo, a frase manda para onde dá para resolver.
    await assert.rejects(
      () => blingPedidos.emitirNfe(pedidoId),
      (e) => {
        assert.match(e.message, /retransmita pelo painel do Bling/);
        return true;
      },
    );
    assert.equal(geracoesDeNota(), geracoesAntes + 1, "nenhuma segunda nota gerada");
  } finally {
    bling.falharEm = null;
  }

  // Configuração fiscal corrigida no Bling: a MESMA nota transmite.
  const notaGerada = (await pedidoNoBanco(pedidoId)).nfe_id;
  const resultado = await blingPedidos.emitirNfe(pedidoId);
  assert.equal(resultado.jaEmitida, false, "não era 'já emitida' — nunca tinha sido");

  const emitida = await pedidoNoBanco(pedidoId);
  assert.equal(emitida.nfe_id, notaGerada, "transmitiu a nota que já existia");
  assert.equal(emitida.nfe_chave, "31260847000100550010000042421000042420");
  assert.equal(geracoesDeNota(), geracoesAntes + 1);

  // Agora sim: com a chave gravada, repetir é no-op.
  assert.equal((await blingPedidos.emitirNfe(pedidoId)).jaEmitida, true);
});

/* --------------------------------------------------------------------------
 * Rodadas sobrepostas do cron de rastreio
 * -------------------------------------------------------------------------- */

test("duas rodadas sobrepostas de rastreio mandam UM e-mail só", async () => {
  const pedidoId = await criarPedidoDireto();
  const { blingId } = await blingPedidos.sincronizarPedido(pedidoId);
  bling.rastreioPorPedido[blingId] = "CC123456785BR";

  const emailsAntes = emails.length;
  // As duas rodadas leem o pedido ('aprovado', sem código) ANTES de qualquer
  // uma gravar: é a sobreposição real (uma rodada lenta ainda em voo quando a
  // seguinte começa). Só o WHERE condicional decide quem avança o status.
  bling.portaoDoPedido = barreiraDe(2);
  try {
    await Promise.all([
      blingPedidos.consultarRastreio(pedidoId),
      blingPedidos.consultarRastreio(pedidoId),
    ]);
  } finally {
    bling.portaoDoPedido = null;
  }

  assert.equal(
    emails.length,
    emailsAntes + 1,
    "o cliente é avisado UMA vez, não uma por rodada",
  );
  const gravado = await pedidoNoBanco(pedidoId);
  assert.equal(gravado.status, "enviado");
  assert.equal(gravado.codigo_rastreio, "CC123456785BR");
});

/* --------------------------------------------------------------------------
 * As rotas /bling (Express de verdade, middlewares inclusive)
 * -------------------------------------------------------------------------- */

test("rotas /bling: 503 com a integração desligada, e o status responde mesmo assim", async () => {
  // Sem credencial nenhuma: a sonda do /status decide sozinha não ir à rede.
  delete process.env.BLING_CLIENT_ID;
  delete process.env.BLING_CLIENT_SECRET;
  assert.notEqual(process.env.BLING_ATIVO, "true");

  const pedidoId = await criarPedidoDireto();
  const desligada = await chamarApi(
    "POST",
    `/bling/pedidos/${pedidoId}/sincronizar`,
  );
  assert.equal(desligada.status, 503, "a rota EXISTE; a integração é que está off");
  assert.equal(desligada.corpo.error, "BLING_DESLIGADO");
  assert.match(desligada.corpo.message, /BLING_ATIVO/);

  const status = await chamarApi("GET", "/bling/status");
  assert.equal(status.status, 200, "o /status é o endpoint que diagnostica o desligado");
  assert.equal(status.corpo.ativo, false);
  assert.equal(status.corpo.configurado, false);
});

test("rotas /bling: UUID malformado é 400 antes do banco; erro do Bling vira 502", async () => {
  const pedidoId = await criarPedidoDireto();
  process.env.BLING_ATIVO = "true";

  try {
    const malformado = await chamarApi("POST", "/bling/pedidos/nao-e-uuid/nfe");
    assert.equal(malformado.status, 400);
    assert.match(malformado.corpo.error, /inválido/);

    bling.falharEm = (metodo, caminho) =>
      metodo === "GET" && caminho === "/produtos"
        ? erroDoBling("Você não tem permissão para acessar produtos", 403)
        : null;

    const falhou = await chamarApi(
      "POST",
      `/bling/pedidos/${pedidoId}/sincronizar`,
    );
    assert.equal(falhou.status, 502, "erro DO BLING é 502 — o problema é do lado de lá");
    assert.equal(falhou.corpo.error, "BLING_FALHOU");
    assert.match(falhou.corpo.message, /permissão para acessar produtos/);
  } finally {
    delete process.env.BLING_ATIVO;
    bling.falharEm = null;
  }

  assert.equal(
    (await pedidoNoBanco(pedidoId)).bling_situacao,
    null,
    "o claim foi desfeito: o botão do painel funciona de novo na hora",
  );
});
