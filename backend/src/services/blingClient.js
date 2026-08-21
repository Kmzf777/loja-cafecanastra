"use strict";

/**
 * Cliente da API v3 do Bling (OAuth 2.0 com refresh token rotativo).
 *
 * O QUE ESTE MÓDULO SABE FAZER, e só isso: manter um access token válido e
 * executar requisições autenticadas contra `https://api.bling.com.br/Api/v3`.
 * Quem sabe o que é um pedido de venda, uma NF-e ou um rastreio é
 * `blingPedidos.js` — a separação é a mesma do `config/mercadopago` (SDK) vs
 * `PaymentController` (regra), e é o que permite aos testes dublarem ESTE
 * módulo inteiro por hook de require.
 *
 * O REFRESH TOKEN É ROTATIVO, E ISSO MOLDA O DESENHO INTEIRO. A cada
 * renovação o Bling INVALIDA o refresh token usado e devolve um NOVO. Um
 * processo que guardasse o token só no .env morreria no primeiro restart
 * depois da primeira renovação — subiria com um token já queimado, e o 400
 * `invalid_grant` do Bling não diria por quê. A escolha (fixada no plano
 * `docs/superpowers/plans/2026-08-20-bling-nfe.md`): o token novo é PERSISTIDO
 * em `canastra.config_loja.bling_refresh_token` (coluna da 0012, protegida por
 * privilégio de coluna — ver a migração) a cada renovação. A ordem de leitura
 * na hora de renovar é memória (o mais recente) → banco → env
 * BLING_REFRESH_TOKEN (a semente da primeira autorização, colada uma vez).
 * Se a gravação no banco falhar, o processo segue com o token da memória e o
 * log GRITA que um restart antes do próximo sucesso de gravação exige refazer
 * a autorização — é a limitação documentada, não um silêncio.
 *
 * NENHUM TOKEN VAI PARA LOG OU MENSAGEM DE ERRO. Os erros do Bling carregam
 * status e corpo (que não ecoa credencial); os nossos, só frases.
 */

const pool = require("../pgPool");

/** Base da API. Sobrescritível para teste e para eventual mudança de host. */
function baseDaApi() {
  return (process.env.BLING_API_URL || "https://api.bling.com.br/Api/v3").replace(
    /\/+$/,
    "",
  );
}

/**
 * Margem antes do vencimento real do access token (o Bling responde
 * `expires_in: 21600`, seis horas). Renovar 5 minutos antes evita a corrida
 * "o token venceu entre o if e o fetch" sem gastar renovação à toa.
 */
const MARGEM_DE_EXPIRACAO_MS = 5 * 60 * 1000;

/** Teto de espera por resposta do Bling. Sem isto, um socket mudo penduraria
 * a sincronização — e, pior, o cron de rastreio — para sempre. */
const TIMEOUT_MS = 15_000;

/**
 * Estado em memória do OAuth. Vive no módulo (singleton por processo, como o
 * pool): o access token vale para o processo inteiro e renová-lo por chamador
 * seria estourar o rate limit do Bling de graça.
 */
const memoria = {
  accessToken: null,
  expiraEm: 0,
  /** O refresh token mais recente CONHECIDO por este processo. Prevalece
   * sobre banco e env — é o único que o Bling ainda aceita. */
  refreshToken: null,
  /** Renovação em voo: chamadores simultâneos esperam a MESMA promessa em vez
   * de disparar duas renovações — a segunda queimaria o token que a primeira
   * acabou de receber. */
  renovacaoEmVoo: null,
};

/** Só para os testes recomeçarem do zero entre casos. */
function zerarCacheParaTeste() {
  memoria.accessToken = null;
  memoria.expiraEm = 0;
  memoria.refreshToken = null;
  memoria.renovacaoEmVoo = null;
}

/** Credencial mínima presente? (Sem ela, nada aqui tenta rede.) */
function configurado() {
  return Boolean(process.env.BLING_CLIENT_ID && process.env.BLING_CLIENT_SECRET);
}

/**
 * fetch com teto de tempo. O AbortController é por requisição — um timeout
 * não pode abortar a requisição do vizinho.
 *
 * `rotulo` é o que aparece na frase de erro, e é SEMPRE método + caminho —
 * NUNCA a URL completa. A querystring desta integração carrega dado pessoal
 * (`GET /contatos?numeroDocumento=<CPF>` é a busca do cliente no Bling), e um
 * CPF em log é exatamente o que a mesma entrega passa a redigir do banco.
 *
 * O timeout vira 504, e não 500: o Bling não respondeu a tempo é falha do
 * lado de lá, passageira, e quem chamou pode repetir — dizer "erro inesperado
 * do servidor" mandaria o gestor procurar no lugar errado.
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
        `O Bling não respondeu em ${TIMEOUT_MS / 1000}s (${rotulo}). ` +
          "Nada foi criado por esta chamada; tente de novo em instantes.",
      );
      estouro.status = 504;
      estouro.codigoPublico = "BLING_SEM_RESPOSTA";
      throw estouro;
    }
    throw erro;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * O refresh token vigente, na ordem documentada no topo: memória → banco →
 * env. O SELECT tolera banco fora do ar devolvendo a env — a renovação ainda
 * pode funcionar com a semente, e recusar aqui só anteciparia a falha.
 */
async function carregarRefreshToken() {
  if (memoria.refreshToken) return memoria.refreshToken;
  try {
    const { rows } = await pool.query(
      "SELECT bling_refresh_token FROM canastra.config_loja WHERE id = 1",
    );
    if (rows[0]?.bling_refresh_token) return rows[0].bling_refresh_token;
  } catch (erro) {
    console.warn(
      "Bling: não consegui ler o refresh token do banco; tentando o da env.",
      erro.message,
    );
  }
  return process.env.BLING_REFRESH_TOKEN || null;
}

/**
 * Persiste o refresh token NOVO que a renovação devolveu. O INSERT garante a
 * linha 1 (mesma defesa do configRepository: numa instalação sem seed o UPDATE
 * seria no-op silencioso). Falhar aqui NÃO falha a renovação — o access token
 * já está na mão — mas o log grita a consequência: um restart antes da próxima
 * gravação bem-sucedida perde o token e exige nova autorização no Bling.
 */
async function persistirRefreshToken(novo) {
  try {
    await pool.query(
      "INSERT INTO canastra.config_loja (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
    );
    await pool.query(
      `UPDATE canastra.config_loja
          SET bling_refresh_token = $1, atualizado_em = now()
        WHERE id = 1`,
      [novo],
    );
    return true;
  } catch (erro) {
    console.error(
      "⚠️  BLING: o refresh token NOVO não pôde ser gravado no banco " +
        `(${erro.message}). O processo segue funcionando com o token em ` +
        "memória, mas um RESTART antes da próxima gravação bem-sucedida " +
        "perde a autorização — seria preciso gerar novo refresh token no " +
        "Bling (docs/bling.md, seção do token rotativo).",
    );
    return false;
  }
}

/**
 * Renova o access token (e recebe o refresh token novo do rodízio).
 *
 * `fetchImpl` é injetável para o teste do fluxo OAuth rodar sem rede — em
 * produção é o fetch nativo do Node 22.
 */
async function renovarAccessToken({ fetchImpl = fetch } = {}) {
  if (!configurado()) {
    throw new Error(
      "Bling não configurado: defina BLING_CLIENT_ID e BLING_CLIENT_SECRET.",
    );
  }

  const refreshToken = await carregarRefreshToken();
  if (!refreshToken) {
    throw new Error(
      "Nenhum refresh token do Bling: cole o primeiro em BLING_REFRESH_TOKEN " +
        "(passo a passo em docs/bling.md).",
    );
  }

  const basic = Buffer.from(
    `${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`,
  ).toString("base64");

  const urlDoToken = new URL(`${baseDaApi()}/oauth/token`);
  const resposta = await fetchComTimeout(
    fetchImpl,
    urlDoToken.toString(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    },
    `POST ${urlDoToken.pathname}`,
  );

  if (!resposta.ok) {
    // O corpo do erro de OAuth não ecoa o token enviado; `invalid_grant` aqui
    // quase sempre significa refresh token já usado/expirado — o runbook
    // explica como gerar outro.
    const corpo = await resposta.text().catch(() => "");

    /**
     * `invalid_grant` ESQUECE O TOKEN DA MEMÓRIA, e este é o ponto sutil.
     *
     * A memória tem precedência sobre o banco (é ela que guarda o token mais
     * recente do rodízio). Só que um token que o Bling acabou de recusar não
     * vale mais NUNCA — e insistir com ele deixaria a integração morta até um
     * restart, mesmo com um token bom gravado no banco. Zerando aqui, a
     * PRÓXIMA tentativa recomeça a ordem de leitura do banco: o do gestor,
     * colado à mão pelo SQL do runbook, ou o que outro processo tenha
     * gravado.
     *
     * "Outro processo" é justamente o que NÃO pode existir: com duas
     * instâncias, as duas renovam, cada rotação invalida a da outra e a
     * integração entra em invalid_grant permanente. Por isso a integração
     * exige INSTÂNCIA ÚNICA (`deploy/ecosystem.config.cjs` fixa
     * `instances: 1`) — está escrito em docs/bling.md, seção do token
     * rotativo. Zerar a memória é a rede de recuperação, não a permissão.
     */
    if (/invalid_grant/i.test(corpo)) {
      memoria.refreshToken = null;
      memoria.accessToken = null;
      memoria.expiraEm = 0;
    }

    throw new Error(
      `Bling recusou a renovação do token (HTTP ${resposta.status}): ` +
        `${corpo.slice(0, 300) || "sem corpo"}. Se for invalid_grant, o ` +
        "refresh token expirou ou já foi usado — gere outro (docs/bling.md).",
    );
  }

  const dados = await resposta.json();
  if (!dados?.access_token) {
    throw new Error("Bling respondeu a renovação sem access_token.");
  }

  memoria.accessToken = dados.access_token;
  memoria.expiraEm =
    Date.now() + Math.max(0, Number(dados.expires_in || 0) * 1000 - MARGEM_DE_EXPIRACAO_MS);

  if (dados.refresh_token && dados.refresh_token !== refreshToken) {
    memoria.refreshToken = dados.refresh_token;
    const gravou = await persistirRefreshToken(dados.refresh_token);
    console.warn(
      "🔑 BLING: refresh token RENOVADO pelo rodízio do Bling. O valor de " +
        "BLING_REFRESH_TOKEN no .env ficou OBSOLETO e não vale mais" +
        (gravou
          ? " — o novo já está gravado em canastra.config_loja e será usado daqui em diante (pode limpar a env)."
          : " — e a gravação no banco FALHOU: veja o erro acima."),
    );
  } else if (dados.refresh_token) {
    memoria.refreshToken = dados.refresh_token;
  }

  return memoria.accessToken;
}

/** Access token válido, renovando se preciso — com renovação única em voo. */
async function obterAccessToken({ fetchImpl = fetch, forcarRenovacao = false } = {}) {
  if (!forcarRenovacao && memoria.accessToken && Date.now() < memoria.expiraEm) {
    return memoria.accessToken;
  }
  if (!memoria.renovacaoEmVoo) {
    memoria.renovacaoEmVoo = renovarAccessToken({ fetchImpl }).finally(() => {
      memoria.renovacaoEmVoo = null;
    });
  }
  return memoria.renovacaoEmVoo;
}

/**
 * Extrai a mensagem legível de um corpo de erro da API v3 do Bling
 * (`{ error: { type, message, description, fields: [{ msg }] } }`). O gestor
 * vai ler isto no painel — "VALIDATION_ERROR" sozinho não ajuda ninguém.
 */
function fraseDoErroDoBling(corpoJson, corpoTexto, status) {
  const e = corpoJson?.error;
  if (e) {
    const partes = [e.description || e.message || e.type];
    const campos = Array.isArray(e.fields)
      ? e.fields.map((f) => f?.msg).filter(Boolean)
      : [];
    if (campos.length) partes.push(campos.join("; "));
    return partes.filter(Boolean).join(" — ");
  }
  return (corpoTexto || "").slice(0, 300) || `HTTP ${status} sem corpo`;
}

/**
 * Uma requisição autenticada à API v3. `caminho` relativo à base
 * (ex.: "/pedidos/vendas"); `query` vira querystring; `body` vira JSON.
 *
 * 401 ganha UMA retentativa com renovação forçada: o access token pode ter
 * sido revogado no painel do Bling antes do vencimento calculado aqui. Um 401
 * na retentativa é erro de verdade.
 */
async function requisitar(metodo, caminho, { body, query, fetchImpl = fetch } = {}) {
  const url = new URL(`${baseDaApi()}${caminho}`);
  for (const [chave, valor] of Object.entries(query || {})) {
    if (valor !== undefined && valor !== null) url.searchParams.set(chave, valor);
  }

  let tentativas = 0;
  for (;;) {
    tentativas += 1;
    const token = await obterAccessToken({
      fetchImpl,
      forcarRenovacao: tentativas > 1,
    });

    const resposta = await fetchComTimeout(
      fetchImpl,
      url.toString(),
      {
        method: metodo,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      // Só o caminho: `url.searchParams` leva CPF na busca de contato.
      `${metodo} ${url.pathname}`,
    );

    if (resposta.status === 401 && tentativas === 1) {
      memoria.accessToken = null;
      continue;
    }

    const texto = await resposta.text().catch(() => "");
    let json = null;
    if (texto) {
      try {
        json = JSON.parse(texto);
      } catch {
        // Corpo não-JSON (página de erro do gateway, por exemplo): a frase
        // usa o texto cru truncado.
      }
    }

    if (!resposta.ok) {
      const frase = fraseDoErroDoBling(json, texto, resposta.status);
      // O corpo inteiro fica no LOG (não ecoa credencial nenhuma); a mensagem
      // do erro leva a frase legível, que os handlers repassam ao painel.
      console.error(
        `Bling: ${metodo} ${caminho} respondeu HTTP ${resposta.status}:`,
        texto.slice(0, 1000),
      );
      const erro = new Error(`Bling: ${frase}`);
      erro.statusBling = resposta.status;
      throw erro;
    }

    return json;
  }
}

/**
 * Sonda leve para `GET /bling/status`: a configuração existe? o token renova?
 * NUNCA lança — o endpoint de status precisa responder mesmo com tudo quebrado,
 * é para isso que ele existe.
 */
async function sondar({ fetchImpl = fetch } = {}) {
  if (!configurado()) {
    return {
      configurado: false,
      token: { ok: false, erro: "BLING_CLIENT_ID/BLING_CLIENT_SECRET ausentes." },
    };
  }
  try {
    await obterAccessToken({ fetchImpl });
    return { configurado: true, token: { ok: true } };
  } catch (erro) {
    return { configurado: true, token: { ok: false, erro: erro.message } };
  }
}

module.exports = {
  configurado,
  requisitar,
  renovarAccessToken,
  obterAccessToken,
  sondar,
  zerarCacheParaTeste,
};
