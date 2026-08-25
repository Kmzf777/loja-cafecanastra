"use strict";

/**
 * Cliente da API da Melhor Envio (OAuth 2.0).
 *
 * O QUE ESTE MÓDULO SABE FAZER, e só isso: manter um access token válido e
 * assinar requisições com ele. Não sabe o que é pedido, etiqueta ou frete —
 * quem sabe é `melhorEnvioEtiquetas.js`. A fronteira existe porque as duas
 * coisas falham por motivos diferentes: token falha por autorização vencida,
 * etiqueta falha por saldo, endereço ou serviço. É a mesma separação de
 * `blingClient.js` (token e transporte) e `blingPedidos.js` (regra), e é ela
 * que deixa os testes dublarem ESTE módulo inteiro por hook de require.
 *
 * ONDE O TOKEN MORA: memória → banco → env, nesta ordem. O access token vale 30
 * dias e o refresh, 45. `MELHOR_ENVIO_REFRESH_TOKEN` no .env é só a SEMENTE da
 * primeira autorização; a partir da primeira renovação quem manda é
 * `canastra.config_loja.melhor_envio_refresh_token` (migração 0017, coluna
 * protegida por privilégio de coluna — nasce sem GRANT, ver a migração).
 *
 * POR QUE ISTO EXISTE, e não um `MELHOR_ENVIO_TOKEN` colado no .env: um token
 * fixo para de funcionar 30 dias depois de configurado. O sintoma é frete que
 * não cota, checkout que não fecha e venda perdida em silêncio — descoberta por
 * reclamação de cliente, nunca por alarme.
 *
 * INSTÂNCIA ÚNICA, pelo mesmo motivo do Bling: duas instâncias renovando em
 * paralelo podem invalidar o token uma da outra. `deploy/ecosystem.config.cjs`
 * fixa `instances: 1`.
 *
 * NENHUM TOKEN E NENHUM SEGREDO VAI PARA LOG OU MENSAGEM DE ERRO. Os corpos de
 * erro da Melhor Envio não ecoam a credencial enviada; os nossos, só frases.
 */

const pool = require("../pgPool");

/** Teto de espera por resposta. Sem isto, um socket mudo penduraria a compra
 * da etiqueta — e a tela de expedição junto — para sempre. */
const TIMEOUT_MS = 15000;

/**
 * Margem antes do vencimento real do access token.
 *
 * Uma hora inteira, e não os 5 minutos do Bling, porque a escala é outra: o
 * token vale 30 dias, então antecipar a renovação em 1h custa 0,14% da vida
 * dele e cobre um processo que ficou horas sem chamar nada — o caso comum
 * nesta loja, onde a expedição acontece em rajadas.
 */
const MARGEM_DE_EXPIRACAO_MS = 60 * 60 * 1000;

/**
 * Estado do OAuth em memória. Vive no módulo (singleton por processo, como o
 * pool): o access token vale para o processo inteiro, e renovar por chamador
 * seria gastar autorização à toa.
 */
const memoria = {
  accessToken: null,
  /** O refresh token mais recente CONHECIDO por este processo. Prevalece
   * sobre banco e env. */
  refreshToken: null,
  expiraEm: 0,
  /** Renovação em voo: chamadores simultâneos esperam a MESMA promessa. */
  voo: null,
};

/** Base da API. Sobrescritível para teste e para o ambiente de homologação. */
function base() {
  return (process.env.MELHOR_ENVIO_URL || "https://melhorenvio.com.br").replace(
    /\/+$/,
    "",
  );
}

/**
 * O User-Agent que a API EXIGE — nome da aplicação e e-mail de contato. Sem
 * ele a Melhor Envio recusa a requisição, e o erro não explica o motivo: volta
 * um 401 igualzinho ao de token inválido, e a caça ao bug começa no lugar
 * errado.
 */
function userAgent() {
  const nome = process.env.LOJA_NOME || "Cafe Canastra";
  const email = process.env.LOJA_EMAIL || "contato@cafecanastra.com";
  return `${nome} (${email})`;
}

/** Credencial mínima presente? (Sem ela, nada aqui tenta rede.) */
function configurado() {
  return Boolean(
    process.env.MELHOR_ENVIO_CLIENT_ID && process.env.MELHOR_ENVIO_CLIENT_SECRET,
  );
}

/**
 * Esquece as credenciais em memória SEM tocar no voo em andamento.
 *
 * A distinção não é preciosismo: quem chama isto é o tratamento de
 * `invalid_grant`, de DENTRO de uma renovação que ainda não terminou. Zerar
 * `memoria.voo` ali abriria a porta para um chamador simultâneo disparar uma
 * SEGUNDA renovação enquanto a primeira ainda se resolve — exatamente o que o
 * voo único existe para impedir.
 */
function esquecerTokens() {
  memoria.accessToken = null;
  memoria.refreshToken = null;
  memoria.expiraEm = 0;
}

/** Só para os testes recomeçarem de um estado conhecido. */
function zerarMemoria() {
  esquecerTokens();
  memoria.voo = null;
}

/** O refresh token que este processo conhece — nulo depois de um recusado. */
function tokenEmMemoria() {
  return memoria.refreshToken;
}

/**
 * O refresh token vigente, na ordem documentada no topo: memória → banco →
 * env. O SELECT tolera banco fora do ar devolvendo a env — a semente ainda
 * pode servir, e recusar aqui só anteciparia a falha.
 */
async function carregarRefreshToken() {
  if (memoria.refreshToken) return memoria.refreshToken;
  try {
    const { rows } = await pool.query(
      "SELECT melhor_envio_refresh_token FROM canastra.config_loja WHERE id = 1",
    );
    if (rows[0]?.melhor_envio_refresh_token) {
      return rows[0].melhor_envio_refresh_token;
    }
  } catch (erro) {
    console.warn(
      "Melhor Envio: não consegui ler o refresh token do banco; tentando a env.",
      erro.message,
    );
  }
  return process.env.MELHOR_ENVIO_REFRESH_TOKEN || null;
}

/**
 * Persiste o refresh token vigente e a data em que o access token morre.
 *
 * O INSERT garante a linha 1 (mesma defesa do `configRepository` e do
 * `blingClient`: numa instalação sem seed, o UPDATE seria um no-op silencioso).
 *
 * Falhar aqui NÃO falha a renovação — o access token já está na mão, e trocar
 * uma degradação por uma pane seria o pior negócio possível. Mas o log GRITA a
 * consequência, porque ela só aparece no próximo restart. A mensagem leva
 * `erro.message` e nada mais: o `detail` do Postgres pode carregar a linha
 * inteira, token incluído.
 */
async function persistirToken(refreshToken, expiraEm) {
  try {
    await pool.query(
      "INSERT INTO canastra.config_loja (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
    );
    await pool.query(
      `UPDATE canastra.config_loja
          SET melhor_envio_refresh_token = $1,
              melhor_envio_token_expira_em = $2,
              atualizado_em = now()
        WHERE id = 1`,
      [refreshToken, expiraEm],
    );
    return true;
  } catch (erro) {
    console.error(
      "⚠️  MELHOR ENVIO: o refresh token NOVO não pôde ser gravado no banco " +
        `(${erro.message}). O processo segue com o token em memória, mas um ` +
        "RESTART antes da próxima gravação perde a autorização — seria preciso " +
        "reautorizar (docs/melhor-envio.md).",
    );
    return false;
  }
}

/**
 * fetch com teto de tempo. O AbortController é por requisição — um timeout não
 * pode abortar a requisição do vizinho.
 *
 * O timeout vira 504, e não 500: a Melhor Envio não respondeu a tempo é falha
 * do lado de lá, passageira, e quem chamou pode repetir. Dizer "erro inesperado
 * do servidor" mandaria o gestor procurar no lugar errado.
 *
 * `rotulo` é sempre método + caminho, nunca a URL completa — a mesma disciplina
 * do `blingClient`, para nenhuma querystring vazar para log.
 */
async function fetchComTimeout(fetchImpl, url, opcoes, rotulo) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...opcoes, signal: controlador.signal });
  } catch (erro) {
    if (erro?.name === "AbortError") {
      const estouro = new Error(
        `A Melhor Envio não respondeu em ${TIMEOUT_MS / 1000}s (${rotulo}). ` +
          "Nada foi comprado por esta chamada; tente de novo em instantes.",
      );
      estouro.status = 504;
      estouro.codigoPublico = "MELHOR_ENVIO_SEM_RESPOSTA";
      throw estouro;
    }
    throw erro;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Troca o refresh token por um access token novo.
 *
 * AS TRÊS DIFERENÇAS PARA O BLING, e todas só quebrariam contra a API de
 * verdade (qualquer dublê aceitaria o formato errado):
 *
 *   1. O corpo é JSON e as credenciais vão DENTRO dele (`client_id`,
 *      `client_secret`). O Bling usa `x-www-form-urlencoded` e um header
 *      `Basic`; aqui não existe header de autorização nenhum nesta chamada.
 *      `client_id` vai como NÚMERO — é o que a Melhor Envio documenta.
 *   2. O `User-Agent` é obrigatório (ver `userAgent()`).
 *   3. O refresh token NÃO é rotativo por desenho, ao contrário do Bling. Mas
 *      a resposta pode trazer um novo, e quando traz é o novo que vale — por
 *      isso o que se persiste é `dados.refresh_token || refreshToken`, e a
 *      gravação acontece a cada renovação, não só quando muda: é ela que
 *      renova também o `melhor_envio_token_expira_em`, o campo que o painel lê
 *      para avisar antes de a autorização morrer.
 *
 * `fetchImpl` é injetável para o teste do fluxo OAuth rodar sem rede — em
 * produção é o fetch nativo do Node 22.
 */
async function renovarAccessToken({ fetchImpl = fetch } = {}) {
  if (!configurado()) {
    throw new Error(
      "Melhor Envio não configurada: defina MELHOR_ENVIO_CLIENT_ID e " +
        "MELHOR_ENVIO_CLIENT_SECRET (docs/melhor-envio.md).",
    );
  }

  const refreshToken = await carregarRefreshToken();
  if (!refreshToken) {
    throw new Error(
      "Nenhum refresh token da Melhor Envio: cole o primeiro em " +
        "MELHOR_ENVIO_REFRESH_TOKEN (docs/melhor-envio.md).",
    );
  }

  const resposta = await fetchComTimeout(
    fetchImpl,
    `${base()}/oauth/token`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": userAgent(),
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: Number(process.env.MELHOR_ENVIO_CLIENT_ID),
        client_secret: process.env.MELHOR_ENVIO_CLIENT_SECRET,
        refresh_token: refreshToken,
      }),
    },
    "POST /oauth/token",
  );

  if (!resposta.ok) {
    // O corpo do erro de OAuth não ecoa a credencial enviada, então ele pode
    // entrar na frase (truncado) — é o que diz ao gestor o que aconteceu.
    const corpo = await resposta.text().catch(() => "");

    /**
     * `invalid_grant` ESQUECE O TOKEN DA MEMÓRIA, e este é o ponto sutil.
     *
     * A memória tem precedência sobre o banco, porque guarda o token mais
     * recente. Só que um token que a Melhor Envio acabou de recusar não vale
     * mais NUNCA — insistir com ele deixaria a integração morta até um
     * restart, mesmo com um token bom gravado na `config_loja`. Esquecendo
     * aqui, a PRÓXIMA tentativa recomeça a leitura pelo banco: o do gestor,
     * colado à mão pelo SQL do runbook, ou o que uma reautorização gravou.
     * É rede de recuperação, não permissão para rodar em duas instâncias.
     */
    if (/invalid_grant/i.test(corpo)) esquecerTokens();

    throw new Error(
      `A Melhor Envio recusou a renovação (HTTP ${resposta.status}): ` +
        `${corpo.slice(0, 300) || "sem corpo"}. Se for invalid_grant, o ` +
        "refresh token venceu — reautorize (docs/melhor-envio.md).",
    );
  }

  const dados = await resposta.json();
  if (!dados?.access_token) {
    throw new Error("A Melhor Envio respondeu a renovação sem access_token.");
  }

  const validadeMs = Math.max(0, Number(dados.expires_in || 0) * 1000);
  memoria.accessToken = dados.access_token;
  memoria.expiraEm = Date.now() + Math.max(0, validadeMs - MARGEM_DE_EXPIRACAO_MS);

  const novoRefresh = dados.refresh_token || refreshToken;
  memoria.refreshToken = novoRefresh;
  // O `await` é de propósito: a gravação nunca lança (ver `persistirToken`),
  // e esperá-la mantém banco e memória em passo — um teste, ou o painel, que
  // leia a coluna logo depois vê o valor certo, não o antigo.
  await persistirToken(novoRefresh, new Date(Date.now() + validadeMs));

  return memoria.accessToken;
}

/**
 * O access token válido, renovando se preciso.
 *
 * UM VOO POR VEZ: duas renovações simultâneas gastariam duas autorizações e a
 * segunda poderia invalidar a primeira. O `.finally` solta o voo tanto no
 * sucesso quanto na falha — preso, um erro passageiro deixaria todo chamador
 * futuro esperando uma promessa já rejeitada.
 */
async function accessToken({ fetchImpl = fetch } = {}) {
  if (memoria.accessToken && Date.now() < memoria.expiraEm) {
    return memoria.accessToken;
  }
  if (!memoria.voo) {
    memoria.voo = renovarAccessToken({ fetchImpl }).finally(() => {
      memoria.voo = null;
    });
  }
  return memoria.voo;
}

/**
 * Uma requisição autenticada à API v2. `caminho` começa com `/`
 * (ex.: "/me/cart"); `body` vira JSON.
 *
 * O corpo do erro entra na mensagem porque é ele que diz o que a Melhor Envio
 * recusou — saldo insuficiente, endereço incompleto, serviço indisponível — e
 * quem lê é o gestor no painel. `status` e `dados` viajam no erro para o
 * chamador decidir sem reabrir a string.
 */
async function requisitar(metodo, caminho, { body, fetchImpl = fetch } = {}) {
  const token = await accessToken({ fetchImpl });

  const resposta = await fetchComTimeout(
    fetchImpl,
    `${base()}/api/v2${caminho}`,
    {
      method: metodo,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": userAgent(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    `${metodo} ${caminho}`,
  );

  const texto = await resposta.text().catch(() => "");
  let dados = null;
  if (texto) {
    try {
      dados = JSON.parse(texto);
    } catch {
      // Corpo não-JSON (página de erro do gateway, por exemplo): a frase usa o
      // texto cru truncado e `dados` fica nulo.
    }
  }

  if (!resposta.ok) {
    const erro = new Error(
      `Melhor Envio ${metodo} ${caminho} respondeu HTTP ${resposta.status}: ` +
        `${texto.slice(0, 300) || "sem corpo"}`,
    );
    erro.status = resposta.status;
    erro.dados = dados;
    throw erro;
  }

  return dados;
}

module.exports = {
  accessToken,
  carregarRefreshToken,
  configurado,
  renovarAccessToken,
  requisitar,
  tokenEmMemoria,
  userAgent,
  zerarMemoria,
};
