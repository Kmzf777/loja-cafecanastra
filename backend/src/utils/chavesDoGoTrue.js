"use strict";

const { createPublicKey } = require("node:crypto");

/**
 * As chaves PUBLICAS com que o GoTrue assina — o JWKS, quando ele existe.
 *
 * POR QUE ISTO PASSOU A EXISTIR. Ate aqui o servico so sabia verificar HS256
 * com `SUPABASE_JWT_SECRET`, e isso estava certo para o alvo de producao: um
 * stack self-hosted tem UM `JWT_SECRET` compartilhado e o GoTrue assina com
 * ele. So que o Supabase HOSPEDADO migrou para chaves de assinatura
 * assimetricas: o access token do usuario chega com
 * `{"alg":"ES256","kid":"<uuid>"}` e a assinatura so fecha contra a chave
 * publica publicada no JWKS. Contra um projeto desses, um servico que so sabe
 * HS256 responde 403 para TODO mundo, e o log diz apenas `invalid signature` —
 * exatamente o sintoma que a documentacao atribui a um segredo errado. Perde-se
 * um dia conferindo um segredo que estava certo.
 *
 * OS DOIS AMBIENTES CONVIVEM, E NENHUM VAI EMBORA. A VPS self-hosted continua
 * sendo o alvo de producao e continua assinando em HS256; o projeto hospedado
 * de teste ja assina em ES256. Mais: no projeto hospedado os dois formatos
 * existem AO MESMO TEMPO — as chaves de API `anon` e `service_role` legadas
 * continuam sendo JWT HS256 assinados com o segredo legado, enquanto o token do
 * usuario e ES256. Quem verifica precisa dar conta dos dois sem confundir um
 * com o outro.
 *
 * O QUE O GoTrue SERVE NESTE ENDPOINT, EM CADA CASO — e por que NAO da para
 * "tentar o JWKS primeiro e cair para o segredo". O handler (`WellKnownJwks`,
 * em supabase/auth) percorre `config.JWT.Keys` e PULA toda chave HMAC
 * (`jwa.OctetSeq`). Num stack configurado so com `GOTRUE_JWT_SECRET`, a
 * resposta e `200 {"keys":[]}` — conjunto vazio, nao erro. Numa versao anterior
 * ao endpoint, e 404. Nos dois casos nao ha nada contra o que verificar um
 * token HS256, entao a escolha do caminho tem de vir do `alg` do proprio token.
 * (Observe de passagem que `GOTRUE_JWT_KEYS` existe tambem no self-hosted: nao
 * e verdade que "chave assimetrica e recurso so da plataforma hospedada".)
 *
 * O `Cache-Control` que o proprio GoTrue devolve neste endpoint e
 * `public, max-age=600`. `VALIDADE_MS` copia esse numero de proposito: o cache
 * daqui envelhece no mesmo ritmo que a instancia diz que pode envelhecer.
 */

const CAMINHO_JWKS = "/auth/v1/.well-known/jwks.json";

/** Vida do conjunto em memoria. Igual ao `max-age=600` que o GoTrue manda. */
const VALIDADE_MS = 10 * 60 * 1000;

/**
 * Piso entre duas buscas — a trava que impede o refetch de virar arma.
 *
 * Um `kid` desconhecido e o sinal legitimo de ROTACAO de chave, e por isso
 * merece uma busca fora de hora. So que `kid` vem do token, e token vem de quem
 * chama: sem piso, um atacante inventa um `kid` novo por requisicao e cada uma
 * vira uma ida ao GoTrue — nos viramos uma alavanca de trafego contra a nossa
 * propria instancia. Com o piso, o pior caso e uma busca a cada 30s,
 * exatamente o que uma rotacao de verdade precisa.
 */
const INTERVALO_MINIMO_ENTRE_BUSCAS_MS = 30 * 1000;

/** Sem tempo limite, um JWKS que aceita a conexao e nao responde segura o pedido. */
const TEMPO_LIMITE_MS = 5_000;

/**
 * Os unicos algoritmos assimetricos aceitos, e a chave que cada um exige.
 *
 * A lista e curta de proposito: e o que o Supabase emite (ECC P-256 -> ES256,
 * RSA 2048 -> RS256). Aceitar uma familia que a instancia nao usa so aumenta a
 * superficie.
 */
const ALGORITMOS_ACEITOS = new Set(["ES256", "RS256"]);

/** Falha de INFRAESTRUTURA ao buscar o JWKS. Vira 503, nunca 403. */
class JwksIndisponivel extends Error {
  constructor(motivo) {
    super(`JWKS indisponível: ${motivo}`);
    this.name = "JwksIndisponivel";
    this.motivo = motivo;
  }
}

/** kid -> { chave: KeyObject, algoritmo }, ou null enquanto nunca buscamos. */
let conjunto = null;
/** Quando o conjunto atual foi obtido com sucesso. */
let buscadoEm = 0;
/** Quando a ultima busca COMECOU, com ou sem sucesso. Piso geral. */
let tentadoEm = 0;
/**
 * Quando a ultima busca DISPARADA POR UM KID DESCONHECIDO comecou.
 *
 * Contada a parte do `tentadoEm` de proposito: a busca da subida fria nao pode
 * consumir a janela da rebusca por rotacao, senao uma chave trocada logo depois
 * de o processo subir ficaria invisivel ate a janela passar — e enquanto isso
 * todo cliente levaria 403.
 */
let rebuscadoEm = 0;
/** Busca em andamento, compartilhada: N requisicoes simultaneas = 1 ida. */
let emVoo = null;

/** Injetavel so para teste (mesmo padrao do `buscar` em conta.routes.js). */
let buscar = (...args) => globalThis.fetch(...args);

function urlDoJwks() {
  const base = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  return base ? base + CAMINHO_JWKS : null;
}

/**
 * O algoritmo sai da CHAVE, nunca do cabecalho do token.
 *
 * Esta funcao e metade da defesa contra alg-confusion: o que ela devolve e o
 * unico valor que entra em `algorithms` no `jwt.verify`. Se o token disser
 * outra coisa, o jsonwebtoken responde "invalid algorithm" e acabou.
 */
function algoritmoDaChave(chave) {
  if (chave.asymmetricKeyType === "ec") {
    // So P-256. ES384/ES512 pediriam curvas que o Supabase nao emite, e uma
    // curva nao conferida faria `alg` e chave discordarem em silencio.
    return chave.asymmetricKeyDetails?.namedCurve === "prime256v1" ? "ES256" : null;
  }
  if (chave.asymmetricKeyType === "rsa") return "RS256";
  return null;
}

/**
 * Uma entrada do JWKS vira KeyObject — ou e descartada, sem derrubar o resto.
 *
 * `crypto.createPublicKey({ key: jwk, format: "jwk" })` do proprio Node da
 * conta da forma que o Supabase publica (kty/crv/x/y, com `alg`, `kid`, `use`,
 * `ext` e `key_ops` sobrando). Nao ha por que instalar biblioteca de JWKS.
 */
function converterChave(jwk) {
  if (!jwk || typeof jwk !== "object") return null;
  if (typeof jwk.kid !== "string" || !jwk.kid) return null;
  // `use: "enc"` e chave de cifra, nao de assinatura. Ausente = assinatura.
  if (jwk.use && jwk.use !== "sig") return null;

  let chave;
  try {
    chave = createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    return null;
  }

  const algoritmo = algoritmoDaChave(chave);
  if (!algoritmo || !ALGORITMOS_ACEITOS.has(algoritmo)) return null;
  // Se a propria JWKS declara `alg`, ele tem de bater com o que a chave e. Uma
  // divergencia aqui e chave mal publicada, e usar a chave assim mesmo seria
  // deixar quem publica escolher o algoritmo por outra porta.
  if (jwk.alg && jwk.alg !== algoritmo) return null;

  return [jwk.kid, { chave, algoritmo }];
}

/**
 * O Kong do stack self-hosted pode exigir `apikey` em `/auth/v1/*`.
 *
 * O `kong.yml` atual publica a rota do JWKS ABERTA, e o Supabase hospedado
 * tambem responde sem credencial — mas um stack com `kong.yml` anterior a essa
 * rota devolveria 401, e 401 aqui viraria 503 sem explicacao. Mandar a chave
 * quando ela existe custa nada e fecha esse caso. Ela vai para a NOSSA
 * instancia, o mesmo destino para onde a exclusao de conta ja manda a
 * `service_role`.
 */
function cabecalhosDaBusca() {
  const cabecalhos = { Accept: "application/json" };
  const chave =
    process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (chave) cabecalhos.apikey = chave;
  return cabecalhos;
}

async function buscarConjunto(url) {
  let resposta;
  try {
    resposta = await buscar(url, {
      headers: cabecalhosDaBusca(),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (erro) {
    throw new JwksIndisponivel(`${url} não respondeu (${erro.message})`);
  }

  // 404 e RESPOSTA, nao falha: e uma instancia sem endpoint de JWKS (GoTrue
  // anterior a ele). Conjunto vazio, guardado como qualquer outro — assim a
  // ausencia nao vira uma ida por requisicao, e um token assimetrico ali vira
  // 403 ("nao ha chave sua aqui"), que e a verdade.
  if (resposta.status === 404) return new Map();
  if (!resposta.ok) {
    throw new JwksIndisponivel(`${url} respondeu HTTP ${resposta.status}`);
  }

  let corpo;
  try {
    corpo = await resposta.json();
  } catch {
    throw new JwksIndisponivel(`${url} não devolveu JSON`);
  }
  if (!corpo || !Array.isArray(corpo.keys)) {
    throw new JwksIndisponivel(`${url} devolveu um corpo sem "keys"`);
  }

  const novo = new Map();
  for (const jwk of corpo.keys) {
    const entrada = converterChave(jwk);
    if (entrada) novo.set(entrada[0], entrada[1]);
  }
  return novo;
}

function garantirBusca(url) {
  if (emVoo) return emVoo;
  tentadoEm = Date.now();
  emVoo = buscarConjunto(url)
    .then((novo) => {
      conjunto = novo;
      buscadoEm = Date.now();
      return novo;
    })
    .finally(() => {
      emVoo = null;
    });
  return emVoo;
}

/**
 * A chave publica de um `kid`, ou `null` se a instancia nao publica esse kid.
 *
 * `null` e 403 (o token nao e desta instancia); `JwksIndisponivel` e 503 (nao
 * sabemos, e nao saber nunca pode virar "entra").
 */
async function chavePorKid(kid) {
  const url = urlDoJwks();
  if (!url) throw new JwksIndisponivel("SUPABASE_URL não está definida");

  const agora = Date.now();

  // (1) Nunca tivemos conjunto nenhum. Nao ha o que responder sem buscar, e a
  //     busca da subida fria nao espera piso — o piso limita REBUSCA. Se a
  //     ultima tentativa falhou ha pouco, porem, nao se insiste: erra fechado
  //     com 503, sem transformar cada requisicao numa ida ao GoTrue caido.
  if (!conjunto) {
    if (!emVoo && agora - tentadoEm < INTERVALO_MINIMO_ENTRE_BUSCAS_MS) {
      throw new JwksIndisponivel(
        "a última busca falhou há pouco; aguardando a janela para tentar de novo",
      );
    }
    await garantirBusca(url);
    return conjunto?.get(kid) ?? null;
  }

  const vencido = agora - buscadoEm >= VALIDADE_MS;
  const desconhecido = !conjunto.has(kid);
  if (!vencido && !desconhecido) return conjunto.get(kid);

  // (2) Ou o conjunto venceu (renovacao de rotina), ou o `kid` nao esta nele
  //     (rotacao — ou um `kid` inventado por quem chama). As duas coisas pedem
  //     uma busca, cada uma com sua janela.
  const renovacaoDeRotina = agora - tentadoEm >= INTERVALO_MINIMO_ENTRE_BUSCAS_MS;
  const rebuscaPorKid =
    desconhecido && agora - rebuscadoEm >= INTERVALO_MINIMO_ENTRE_BUSCAS_MS;

  if (renovacaoDeRotina || rebuscaPorKid) {
    if (desconhecido) rebuscadoEm = agora;
    try {
      await garantirBusca(url);
    } catch (erro) {
      // Com um conjunto antigo em maos, seguimos com ele. Rotacao no GoTrue
      // nao invalida a chave anterior no mesmo instante, e derrubar a loja
      // inteira porque o JWKS piscou seria pior do que aceitar um conjunto de
      // dez minutos atras.
      console.warn(`Segue valendo o JWKS anterior: ${erro.message}`);
    }
  }

  return conjunto.get(kid) ?? null;
}

/**
 * Busca o conjunto na subida. Devolve QUANTAS chaves utilizaveis existem.
 *
 * Serve a duas coisas: aquecer o cache (a primeira requisicao autenticada nao
 * paga a ida) e dar a `ambiente.js` a unica resposta que decide se um deploy
 * sem `SUPABASE_JWT_SECRET` consegue verificar alguma coisa.
 */
async function aquecerCache() {
  const url = urlDoJwks();
  if (!url) throw new JwksIndisponivel("SUPABASE_URL não está definida");
  const novo = await garantirBusca(url);
  return novo.size;
}

module.exports = {
  chavePorKid,
  aquecerCache,
  urlDoJwks,
  JwksIndisponivel,
  CAMINHO_JWKS,
  /** Costura de teste. Nada em `src/` fora dos testes deve tocar aqui. */
  paraTestes: {
    definirBuscador(fn) {
      buscar = fn || ((...args) => globalThis.fetch(...args));
    },
    limpar() {
      conjunto = null;
      buscadoEm = 0;
      tentadoEm = 0;
      rebuscadoEm = 0;
      emVoo = null;
    },
    estado: () => ({
      chaves: conjunto ? [...conjunto.keys()] : null,
      buscadoEm,
      tentadoEm,
    }),
  },
};
