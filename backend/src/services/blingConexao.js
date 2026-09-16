"use strict";

/**
 * O fluxo OAuth do Bling: estabelecer a autorização.
 *
 * Separado de `blingClient.js` de propósito — o cliente fala com uma API JÁ
 * autorizada; este arquivo é o que produz essa autorização. Juntar os dois
 * faria o arquivo que todo pedido de venda atravessa carregar também o código
 * que roda duas vezes na vida da loja.
 */

const crypto = require("node:crypto");
const pool = require("../pgPool");
const blingClient = require("./blingClient");

/**
 * O `state` vale 10 minutos. É o tempo de ir ao Bling, entrar na conta se
 * preciso, ler a tela de permissões e clicar em autorizar — com folga, sem
 * deixar um nonce vivo a tarde inteira.
 */
const VALIDADE_DO_STATE_MS = 10 * 60 * 1000;

/**
 * OS STATES VIVOS, EM MEMÓRIA, E ISSO É DELIBERADO.
 *
 * O callback é PÚBLICO por força da física: é um redirect de navegador vindo do
 * Bling, e redirect não carrega `Authorization`. Sem `state`, qualquer um que
 * descobrisse a URL poderia chamá-la com um `code` da PRÓPRIA conta Bling e
 * amarrar esta loja ao ERP dele — o CSRF clássico de OAuth. O `state` é gerado
 * no clique, que É autenticado, e só ele autoriza o callback a agir.
 *
 * Em memória basta porque a API roda em INSTÂNCIA ÚNICA — não por conveniência,
 * mas porque o rodízio do refresh token do Bling não tolera dois processos
 * (docs/bling.md, seção do token rotativo). Se a API reiniciar entre o clique e
 * o retorno, o nonce some e a tela diz "a autorização expirou, clique de novo":
 * a janela é de ~30 segundos e a falha é benigna. Um state assinado por HMAC
 * sobreviveria ao restart, ao custo de um segredo novo e mais código, para
 * cobrir trinta segundos de risco de nada.
 */
const statesVivos = new Map();

function limparStatesVencidos() {
  const agora = Date.now();
  for (const [state, expiraEm] of statesVivos) {
    if (agora >= expiraEm) statesVivos.delete(state);
  }
}

function gerarState() {
  limparStatesVencidos();
  const state = crypto.randomBytes(32).toString("hex");
  statesVivos.set(state, Date.now() + VALIDADE_DO_STATE_MS);
  return state;
}

/**
 * Valida e QUEIMA o state — uso único, aconteça o que acontecer.
 *
 * O `delete` vem ANTES da conferência de validade de propósito: um state
 * apresentado, válido ou vencido, não volta a valer. Conferir primeiro e apagar
 * só no caminho feliz deixaria um state vencido sendo reapresentado para sempre.
 */
function consumirState(state) {
  limparStatesVencidos();
  if (!state || !statesVivos.has(state)) return false;
  const expiraEm = statesVivos.get(state);
  statesVivos.delete(state);
  return Date.now() < expiraEm;
}

/** Só para teste: envelhece tudo sem esperar dez minutos. */
function envelhecerStatesParaTeste() {
  for (const state of statesVivos.keys()) statesVivos.set(state, 0);
}

/**
 * A base da AUTORIZAÇÃO, que NÃO é a mesma da API.
 *
 * A troca de token é em `api.bling.com.br`; a autorização é em
 * `www.bling.com.br`. Hosts diferentes, e confundi-los rende um 404 do Bling
 * que não explica nada. Sobrescritível pela mesma razão que `baseDaApi()`: para
 * o teste deste fluxo não sair para a internet.
 */
function baseDaAutorizacao() {
  return (
    process.env.BLING_AUTORIZACAO_URL || "https://www.bling.com.br/Api/v3"
  ).replace(/\/+$/, "");
}

/**
 * A URL para onde o navegador vai.
 *
 * NÃO leva `redirect_uri`: o Bling usa a que está CADASTRADA no aplicativo.
 * Mandá-la aqui não muda nada e dá a falsa impressão de que a URL de callback
 * é configurável deste lado — ela não é, e quando não bate o Bling recusa com
 * erro genérico.
 */
async function urlDeAutorizacao() {
  const { clientId } = await blingClient.carregarConfig();
  if (!clientId) {
    const erro = new Error(
      "Salve o Client ID e o Client Secret antes de conectar.",
    );
    erro.status = 409;
    erro.codigoPublico = "SEM_CREDENCIAIS";
    throw erro;
  }

  const state = gerarState();
  const url = new URL(`${baseDaAutorizacao()}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("state", state);
  return { url: url.toString(), state };
}

/**
 * Troca o `code` pelo par de tokens e GRAVA o refresh token.
 *
 * Não devolve token nenhum — só o veredito. O chamador é uma rota que redireciona
 * o navegador, e um refresh token num query string acabaria no histórico, no log
 * do Traefik e no `Referer` da próxima requisição.
 */
async function trocarCodePorTokens(code, { fetchImpl = fetch } = {}) {
  const { clientId, clientSecret } = await blingClient.carregarConfig();
  if (!clientId || !clientSecret) {
    const erro = new Error("Credenciais do Bling ausentes.");
    erro.status = 409;
    throw erro;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  // `baseDaApi` não é exportado por blingClient; use a env com o mesmo default.
  const base = (
    process.env.BLING_API_URL || "https://api.bling.com.br/Api/v3"
  ).replace(/\/+$/, "");

  const resposta = await fetchImpl(`${base}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
    }).toString(),
  });

  const corpo = await resposta.json().catch(() => null);

  if (!resposta.ok || !corpo?.refresh_token) {
    const doBling =
      corpo?.error?.description ||
      corpo?.error_description ||
      corpo?.error?.type ||
      (typeof corpo?.error === "string" ? corpo.error : null);
    const erro = new Error(
      doBling
        ? `O Bling recusou a autorização: ${doBling}`
        : "O Bling não devolveu o refresh token. O código de autorização " +
          "expira em cerca de um minuto — clique em Conectar de novo.",
    );
    erro.status = 502;
    erro.codigoPublico = "BLING_RECUSOU";
    throw erro;
  }

  await pool.query(
    "INSERT INTO canastra.config_loja (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
  );
  await pool.query(
    `UPDATE canastra.config_loja
        SET bling_refresh_token = $1, atualizado_em = now()
      WHERE id = 1`,
    [corpo.refresh_token],
  );
  blingClient.esquecerConfig();

  return { conectado: true };
}

/**
 * Desconecta: apaga o refresh token e desliga.
 *
 * As DUAS coisas, e nesta ordem de intenção: um token apagado com `ativo = true`
 * deixaria o gatilho de pedido aprovado tentando sincronizar a cada venda e
 * falhando, enchendo o log sem que ninguém tivesse pedido nada.
 *
 * O Client ID e o Secret FICAM. Desconectar é "refazer a autorização", não
 * "esquecer o aplicativo" — quem quiser trocar de app sobrescreve as credenciais
 * pela tela.
 */
async function desconectar() {
  await pool.query(
    `UPDATE canastra.config_loja
        SET bling_refresh_token = NULL, bling_ativo = false, atualizado_em = now()
      WHERE id = 1`,
  );
  blingClient.esquecerConfig();
  return { desconectado: true };
}

module.exports = {
  gerarState,
  consumirState,
  envelhecerStatesParaTeste,
  urlDeAutorizacao,
  trocarCodePorTokens,
  desconectar,
};
