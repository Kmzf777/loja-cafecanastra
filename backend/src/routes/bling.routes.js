"use strict";

/**
 * Rotas admin da integração Bling (onda 3G). Todas exigem
 * isAuthenticated + isAdmin — sincronizar, emitir nota e consultar rastreio
 * são gestos de GESTÃO —, MENOS UMA: `GET /bling/callback`, que é pública por
 * força da física e está explicada em cima dela.
 *
 * Os handlers moram no próprio arquivo, e não num controller novo: são cascas
 * finas sobre `services/blingPedidos` e `services/blingConexao` — a regra vive
 * toda lá (e é lá que os testes a exercitam); um controller só para repassar
 * seria camada de cerimônia.
 *
 * REGISTRO NO index.js (responsabilidade do orquestrador da onda — este
 * arquivo é compartilhado e não foi editado daqui):
 *
 *   const blingRoutes = require("./routes/bling.routes");
 *   app.use("/bling", blingRoutes);
 */

const { Router } = require("express");

const isAuthenticated = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");
const pool = require("../pgPool");
const blingClient = require("../services/blingClient");
const blingConexao = require("../services/blingConexao");
const blingPedidos = require("../services/blingPedidos");

const blingRoutes = Router();

const FORMATO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A CONFIG RELIDA DO BANCO, IGNORANDO O CACHE DE 30s.
 *
 * `carregarConfig()` cacheia, e no caminho quente isso está certo: o gatilho do
 * pedido aprovado roda a cada venda. Aqui é outro caminho — estas rotas são
 * cliques de um gestor que pode ter acabado de mexer no interruptor da tela ao
 * lado. Daí a regra que as duas recusas abaixo seguem: pode ACEITAR pelo cache,
 * mas para RECUSAR confirma no banco. Uma recusa fundada em leitura de trinta
 * segundos atrás é o "liguei e ele diz que está desligado" que esta entrega
 * existe para eliminar, e o custo é um SELECT no caminho que ia terminar ali de
 * qualquer jeito.
 */
async function reconferirConfig() {
  blingClient.esquecerConfig();
  return blingClient.carregarConfig();
}

/**
 * As ações exigem a integração LIGADA. 503, e não 404: a rota EXISTE, é a
 * integração que está desligada — e a frase diz onde se liga.
 *
 * Quem responde é `carregarConfig()`, não `process.env.BLING_ATIVO`: desde a
 * tela de conexão o interruptor mora em `canastra.config_loja`, e a env é só a
 * semente de quem configurou antes de a tela existir (a precedência, e o
 * `NULL` que quer dizer "use a env", estão em `blingClient.carregarConfig`). A
 * frase segue citando `BLING_ATIVO` de propósito: numa instalação que ainda
 * vive de `.env` é ela que está desligando, e omitir o nome mandaria o gestor
 * procurar na tela uma chave que não está lá.
 */
async function blingLigado(req, res, next) {
  let { ativo } = await blingClient.carregarConfig();
  if (!ativo) ({ ativo } = await reconferirConfig());

  if (!ativo) {
    return res.status(503).json({
      error: "BLING_DESLIGADO",
      message:
        "A integração com o Bling está desligada. Ligue-a em /dashboard/bling " +
        "(ou, na instalação que ainda usa o .env, em BLING_ATIVO) — passo a " +
        "passo em docs/bling.md.",
    });
  }
  return next();
}

/** O :id precisa ser UUID antes de qualquer ida ao banco (22P02 vira 400). */
function pedidoIdValido(req, res, next) {
  if (!FORMATO_UUID.test(String(req.params.id || ""))) {
    return res.status(400).json({ error: "Identificador de pedido inválido." });
  }
  return next();
}

/**
 * Tradução de erro para resposta: quem lança com intenção carrega
 * `erro.status` (404 pedido, 400 SKU, 409 corrida, 422 pedido redigido pela
 * LGPD, 504 Bling mudo ou prazo da sincronização estourado); erro vindo da API
 * do Bling carrega `statusBling` e vira 502 — o problema é do lado de lá, e a
 * mensagem (já legível, composta pelo blingClient) é para o gestor ler no
 * painel. O resto é 500 genérico, com o detalhe só no log.
 *
 * O 504 vale a distinção do 500: "o Bling não respondeu a tempo" é passageiro
 * e o botão do painel pode ser clicado de novo; "falha inesperada" manda o
 * gestor abrir chamado. Quem os separa é `erro.status`, posto lá no
 * blingClient/blingPedidos, onde se sabe o que aconteceu.
 */
function responderErro(res, erro, contexto) {
  console.error(`Bling (${contexto}):`, erro.message);
  if (erro.status) {
    return res.status(erro.status).json({
      error: erro.codigoPublico || "BLING_FALHOU",
      message: erro.message,
    });
  }
  if (erro.statusBling) {
    return res.status(502).json({ error: "BLING_FALHOU", message: erro.message });
  }
  return res.status(500).json({
    error: "BLING_FALHOU",
    message: "Falha inesperada na integração com o Bling. Veja o log do servidor.",
  });
}

/**
 * GET /bling/status — a sonda do painel: config presente? token renova?
 * Responde SEMPRE, ligado ou não — é o endpoint que diagnostica o desligado.
 * A sonda só vai à rede quando há credencial (blingClient.sondar decide).
 */
blingRoutes.get("/status", isAuthenticated, isAdmin, async (req, res) => {
  // `sondar()` primeiro: ela já carrega a config (e aquece o cache), então o
  // `carregarConfig()` de baixo é leitura de memória, não uma segunda consulta.
  const sonda = await blingClient.sondar();
  const config = await blingClient.carregarConfig();
  return res.json({
    ativo: config.ativo,
    nfeAuto: process.env.BLING_NFE_AUTO === "true",
    rastreioCron: process.env.BLING_RASTREIO_CRON === "true",
    /*
      OS DOIS CAMPOS NOVOS SÃO BOOLEANOS, E NUNCA OS VALORES.

      É a tela de conexão que os consome, e ela só precisa saber EM QUE PASSO a
      loja está: sem credencial cadastrada, cadastrada mas sem autorizar, ou
      conectada (`estadoDaConexao`, em frontend/lib/painel/bling/conexao.logica).
      Devolver o Client ID "só para conferir" já poria metade do par de
      credenciais numa resposta que o navegador cacheia, e o Client Secret e o
      refresh token são segredo de verdade — emitem nota fiscal e mexem em
      estoque. Nada de `config_loja` sai daqui além do sim/não.
    */
    temCredenciais: Boolean(config.clientId && config.clientSecret),
    conectado: config.temRefreshToken,
    ...sonda,
  });
});

/* --------------------------------------------------------------------------
 * A CONEXÃO (tela /dashboard/bling): cadastrar o aplicativo, autorizar pelo
 * OAuth, ligar/desligar e desconectar. Nenhuma delas fala com a API do Bling
 * para trabalhar — elas ESTABELECEM a autorização que o resto usa.
 * -------------------------------------------------------------------------- */

/** Campo de texto que chegou do cliente (corpo ou query), sem espaço em volta. */
function textoLimpo(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * POST /bling/conexao/credenciais — o Client ID e o Secret do aplicativo.
 *
 * O INSERT antes do UPDATE é a mesma defesa de `persistirRefreshToken`: numa
 * instalação sem seed a linha 1 não existe, e o UPDATE sozinho seria um no-op
 * silencioso — a tela diria "salvo" e nada teria sido salvo.
 */
blingRoutes.post(
  "/conexao/credenciais",
  isAuthenticated,
  isAdmin,
  async (req, res) => {
    const clientId = textoLimpo(req.body?.clientId);
    const clientSecret = textoLimpo(req.body?.clientSecret);
    if (!clientId || !clientSecret) {
      return res.status(400).json({
        error: "CREDENCIAIS_INVALIDAS",
        message:
          "Informe o Client ID e o Client Secret do aplicativo criado no Bling.",
      });
    }

    try {
      await pool.query(
        "INSERT INTO canastra.config_loja (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
      );
      await pool.query(
        `UPDATE canastra.config_loja
            SET bling_client_id = $1, bling_client_secret = $2,
                atualizado_em = now()
          WHERE id = 1`,
        [clientId, clientSecret],
      );
      // Sem isto, a credencial nova ficaria até 30s sem valer e a autorização
      // sairia assinada com o aplicativo ANTIGO — erro genérico do Bling.
      blingClient.esquecerConfig();
      return res.json({ salvo: true });
    } catch (erro) {
      return responderErro(res, erro, "gravar credenciais");
    }
  },
);

/**
 * POST /bling/conexao/iniciar — a URL para onde o navegador vai.
 *
 * Devolve só a `url`. O `state` NÃO volta no corpo: ele já viaja dentro dela, o
 * cliente não tem o que fazer com ele, e repeti-lo só amplia a superfície de
 * quem quiser guardá-lo em algum lugar.
 */
blingRoutes.post("/conexao/iniciar", isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { url } = await blingConexao.urlDeAutorizacao();
    return res.json({ url });
  } catch (erro) {
    return responderErro(res, erro, "iniciar conexão");
  }
});

/** Toda saída do callback é um redirect para a tela — nunca um JSON. */
function voltarParaATela(res, parametros) {
  return res.redirect(`/dashboard/bling?${parametros}`);
}

/**
 * GET /bling/callback — A ÚNICA ROTA PÚBLICA DESTE ARQUIVO, e é por força da
 * física: é um redirect de navegador vindo do Bling, e redirect não carrega
 * cabeçalho `Authorization`. Não há como exigir `isAuthenticated` aqui.
 *
 * Quem faz o papel da autenticação é o `state`, gerado no clique em Conectar —
 * que É autenticado e admin — e queimado no uso. Sem state vivo, esta rota
 * redireciona com erro e NÃO TOCA EM NADA.
 *
 * O redirect é RELATIVO: Traefik serve vitrine e API na mesma origem, então o
 * navegador resolve sozinho, e não é preciso inventar uma env FRONTEND_URL.
 *
 * A ORDEM É OBRIGATÓRIA: `consumirState` PRIMEIRO, o `code` só depois. Ler o
 * `code` antes — para "validar", para logar, para qualquer coisa — já seria
 * agir a mando de quem chamou, que é exatamente o que o state existe para
 * impedir; e apresentar um `code` de outra conta Bling é o CSRF clássico de
 * OAuth, que amarraria esta loja ao ERP de um estranho.
 */
blingRoutes.get("/callback", async (req, res) => {
  if (!blingConexao.consumirState(req.query.state)) {
    return voltarParaATela(
      res,
      "erro=" +
        encodeURIComponent(
          "A autorização expirou ou não começou nesta tela. Abra " +
            "/dashboard/bling e clique em Conectar de novo.",
        ),
    );
  }

  const code = textoLimpo(req.query.code);
  if (!code) {
    return voltarParaATela(
      res,
      "erro=" +
        encodeURIComponent(
          "O Bling voltou sem o código de autorização. Se a tela de permissões " +
            "foi recusada, clique em Conectar e autorize com a conta da loja.",
        ),
    );
  }

  try {
    await blingConexao.trocarCodePorTokens(code);
    return voltarParaATela(res, "conectado=1");
  } catch (erro) {
    // A frase do Bling vai INTEIRA para a tela — é ela que diz se o code
    // expirou, se a credencial está errada ou se o app não tem os escopos. O
    // que nunca entra na URL é VALOR de segredo: nem o `code`, nem o
    // client_secret, nem o refresh token (a URL vai para o histórico do
    // navegador, para o log do Traefik e para o `Referer` da página seguinte).
    console.error("Bling (callback):", erro.message);
    return voltarParaATela(res, "erro=" + encodeURIComponent(erro.message));
  }
});

/**
 * POST /bling/conexao/ativo — o interruptor da tela.
 *
 * Ligar sem autorização é recusado com 409: a integração ligada faz o gatilho
 * do pedido aprovado tentar sincronizar a cada venda, e sem refresh token toda
 * tentativa falharia — o log encheria e o gestor acharia que ligou.
 */
blingRoutes.post("/conexao/ativo", isAuthenticated, isAdmin, async (req, res) => {
  if (typeof req.body?.ativo !== "boolean") {
    return res.status(400).json({
      error: "ATIVO_INVALIDO",
      message: "Informe `ativo` como true ou false.",
    });
  }
  const ativo = req.body.ativo;

  try {
    if (ativo) {
      let { temRefreshToken } = await blingClient.carregarConfig();
      if (!temRefreshToken) ({ temRefreshToken } = await reconferirConfig());
      if (!temRefreshToken) {
        return res.status(409).json({
          error: "SEM_CONEXAO",
          message: "Conecte a loja ao Bling antes de ligar a integração.",
        });
      }
    }

    await pool.query(
      "INSERT INTO canastra.config_loja (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
    );
    await pool.query(
      `UPDATE canastra.config_loja
          SET bling_ativo = $1, atualizado_em = now()
        WHERE id = 1`,
      [ativo],
    );
    blingClient.esquecerConfig();
    return res.json({ ativo });
  } catch (erro) {
    return responderErro(res, erro, `ligar/desligar (ativo=${ativo})`);
  }
});

/** DELETE /bling/conexao — apaga a autorização e desliga (o app FICA). */
blingRoutes.delete("/conexao", isAuthenticated, isAdmin, async (req, res) => {
  try {
    return res.json(await blingConexao.desconectar());
  } catch (erro) {
    return responderErro(res, erro, "desconectar");
  }
});

/** POST /bling/pedidos/:id/sincronizar — reenvio manual pelo painel. */
blingRoutes.post(
  "/pedidos/:id/sincronizar",
  isAuthenticated,
  isAdmin,
  blingLigado,
  pedidoIdValido,
  async (req, res) => {
    try {
      const { jaSincronizado, blingId, pedido } =
        await blingPedidos.sincronizarPedido(req.params.id);
      return res.json({
        message: jaSincronizado
          ? "Este pedido já estava sincronizado com o Bling."
          : "Pedido sincronizado com o Bling.",
        jaSincronizado,
        blingId,
        pedido,
      });
    } catch (erro) {
      return responderErro(res, erro, `sincronizar ${req.params.id}`);
    }
  },
);

/** POST /bling/pedidos/:id/nfe — emissão manual da NF-e. */
blingRoutes.post(
  "/pedidos/:id/nfe",
  isAuthenticated,
  isAdmin,
  blingLigado,
  pedidoIdValido,
  async (req, res) => {
    try {
      const { jaEmitida, pedido } = await blingPedidos.emitirNfe(req.params.id);
      return res.json({
        message: jaEmitida
          ? "A NF-e deste pedido já tinha sido emitida."
          : "NF-e gerada e transmitida pelo Bling.",
        jaEmitida,
        pedido,
      });
    } catch (erro) {
      return responderErro(res, erro, `nfe ${req.params.id}`);
    }
  },
);

/** POST /bling/pedidos/:id/rastreio — busca manual do rastreio no Bling. */
blingRoutes.post(
  "/pedidos/:id/rastreio",
  isAuthenticated,
  isAdmin,
  blingLigado,
  pedidoIdValido,
  async (req, res) => {
    try {
      const { rastreio, pedido } = await blingPedidos.consultarRastreio(
        req.params.id,
      );
      return res.json({
        message: rastreio
          ? "Rastreio do Bling gravado no pedido."
          : "O Bling ainda não tem código de rastreio para este pedido.",
        rastreio,
        pedido,
      });
    } catch (erro) {
      return responderErro(res, erro, `rastreio ${req.params.id}`);
    }
  },
);

module.exports = blingRoutes;
