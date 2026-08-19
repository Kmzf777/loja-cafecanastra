const jwt = require("jsonwebtoken");
const pool = require("../pgPool");
const { chavePorKid, JwksIndisponivel } = require("../utils/chavesDoGoTrue");

/**
 * Quem esta chamando, segundo o GoTrue — e se essa pessoa e CLIENTE DESTA LOJA.
 *
 * O QUE MUDOU NA F2: o Express nao emite mais token. Quem emite e o GoTrue do
 * Supabase, e este middleware so verifica.
 *
 * O QUE MUDOU DEPOIS DELA, E POR QUE. A F2 fixou `algorithms: ["HS256"]` com
 * `SUPABASE_JWT_SECRET`, e para o alvo de producao isso esta certo: um stack
 * self-hosted tem um `JWT_SECRET` unico e o GoTrue assina HS256 com ele. Só que
 * o Supabase HOSPEDADO migrou para chaves de assinatura assimetricas — no
 * projeto de teste da loja, o access token de um usuario de verdade chega com
 * `{"alg":"ES256","kid":"b942219c-…"}` e o `/auth/v1/.well-known/jwks.json`
 * publica uma chave EC P-256. Contra aquele projeto, o middleware de HS256 puro
 * respondia 403 a TODA requisicao autenticada, e o log dizia so
 * `invalid signature` — que o runbook (§6) atribuia a um segredo errado. O
 * segredo estava certo; o algoritmo e que era outro.
 *
 * ENTAO SAO DOIS CAMINHOS, e nenhum dos dois e temporario:
 *   HS256 com `SUPABASE_JWT_SECRET`  -> a VPS self-hosted, o alvo de producao;
 *   ES256/RS256 pelo JWKS            -> o projeto hospedado, e para onde o
 *                                       Supabase esta levando todo mundo.
 * No projeto hospedado os dois convivem AGORA: as chaves de API `anon` e
 * `service_role` legadas ainda sao JWT HS256 do segredo legado, enquanto o
 * token do usuario ja e ES256.
 *
 * A ESCOLHA DO CAMINHO SAI DO `alg` DO TOKEN, E E SO ISSO QUE O `alg` DECIDE.
 * Ver `verificarToken` abaixo: o `alg` escolhe a CHAVE, e o algoritmo aceito e
 * derivado da chave escolhida, nunca do cabecalho. Um token forjado com
 * `alg: HS256` assinado com a chave PUBLICA como segredo de HMAC nao tem para
 * onde ir: ele cai no caminho do segredo, onde a unica chave e o
 * `SUPABASE_JWT_SECRET`, e a chave publica nunca e oferecida como segredo a
 * ninguem. (E se um dia alguem cruzar os fios, o proprio jsonwebtoken 9 recusa:
 * "secretOrPublicKey must be a symmetric key when using HS256".)
 *
 * NAO DA PARA "TENTAR O JWKS PRIMEIRO E CAIR PARA O SEGREDO". Num stack
 * self-hosted so com `GOTRUE_JWT_SECRET`, o endpoint de JWKS responde
 * `200 {"keys":[]}` — o handler do GoTrue pula toda chave HMAC de proposito —
 * ou 404, em versao anterior ao endpoint. Nao ha o que tentar la.
 *
 * ASSINATURA VALIDA NAO E PERTENCIMENTO, E ESTA CONTINUA SENDO A LINHA MAIS
 * IMPORTANTE DO ARQUIVO. A instancia Supabase da VPS e COMPARTILHADA com outros
 * projetos, e self-hosted nao e multi-projeto: existe um `auth.users` e um
 * segredo de JWT para todos. Um token emitido para outro projeto chega aqui com
 * assinatura perfeita, `sub` preenchido e `role: "authenticated"` —
 * indistinguivel de um cliente da loja, se a pergunta parar na assinatura. Por
 * isso, depois de verificar, este middleware confere o VINCULO: linha em
 * `canastra.clientes` (cliente) e linha em `canastra.admins` (administrador). E
 * a mesma premissa que sustenta toda a RLS de 0006 (`eh_cliente()` /
 * `eh_admin()`), aplicada do lado do Node.
 *
 * NAO ADIANTARIA CONFERIR `iss`: na VPS o emissor e o mesmo GoTrue para todos
 * os projetos da instancia. Nao ha nada NO TOKEN que separe um projeto do
 * outro — a separacao so existe no banco desta loja.
 *
 * UMA IDA AO BANCO POR REQUISICAO, E POR QUE ISSO E ACEITAVEL AQUI. As duas
 * perguntas (cliente? admin?) saem num unico SELECT, com dois EXISTS sobre
 * chave primaria: uma ida, dois index scans. Nenhum cache: `isAdmin` passa a
 * ler o resultado DESTE select, entao a alternativa "guardar em memoria por
 * alguns segundos" nao economizaria a ida — economizaria repeticao que nao
 * existe — e faria uma revogacao de administrador demorar a valer. Depois da
 * F4, o que sobra de autenticado neste servico e pagamento e pedido: poucas
 * requisicoes, todas ja com varias consultas proprias. (O JWKS, esse sim, tem
 * cache: e chave publica, muda em rotacao, e uma ida por requisicao a rede
 * seria inaceitavel.)
 */

/**
 * A ANON KEY E A SERVICE_ROLE KEY LEGADAS SAO JWT HS256 DO MESMO SEGREDO.
 *
 * Mandar a anon key publicada no front como `Authorization: Bearer` passa pelo
 * `jwt.verify` sem reclamar — ela e um token valido, so que sem `sub`. Sem esta
 * conferencia, `pool.query(..., [undefined])` levantaria erro de tipo (22P02)
 * e viraria 503, ou pior, um `sub` estranho entraria como identidade. Exigir
 * UUID no `sub` fecha as duas chaves de API de uma vez, porque nenhuma das duas
 * tem `sub`. Vale igual nos dois caminhos de verificacao.
 */
const FORMATO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Os unicos assimetricos aceitos — o que o Supabase emite (P-256 e RSA-2048). */
const ALGORITMOS_ASSIMETRICOS = new Set(["ES256", "RS256"]);

/**
 * Uma ida ao banco responde as duas perguntas. `admins` referencia `clientes`
 * (0002), entao admin implica cliente e a checagem de cliente basta para
 * decidir a entrada; `admin` viaja junto para `isAdmin` nao precisar de outra
 * consulta.
 */
const SQL_VINCULO = `
  SELECT
    EXISTS (SELECT 1 FROM canastra.clientes WHERE user_id = $1) AS cliente,
    EXISTS (SELECT 1 FROM canastra.admins   WHERE user_id = $1) AS admin
`;

/** Recusa de CREDENCIAL: 403. O token chegou, foi julgado, e nao serve. */
class TokenRecusado extends Error {
  constructor(codigo, motivo) {
    super(motivo);
    this.name = "TokenRecusado";
    this.codigo = codigo;
  }
}

/**
 * Recusa de CONFIGURACAO: 503. Nao e a credencial de quem chama que esta ruim —
 * e este servico que, do jeito que foi configurado, nao tem como julgar um
 * token dessa familia. A distincao e a mesma que o 503 da consulta de vinculo
 * ja fazia: "nao sei" nunca pode ser dito com a cara de "voce nao pode".
 */
class SemComoVerificar extends Error {
  constructor(codigo, motivo) {
    super(motivo);
    this.name = "SemComoVerificar";
    this.codigo = codigo;
  }
}

/**
 * Log de diagnostico com piso de tempo POR MOTIVO.
 *
 * O bug que originou tudo isto custou caro porque o log so dizia
 * `invalid signature`. As linhas abaixo existem para que a proxima vez diga
 * qual dos caminhos falhou e por que. O piso existe porque a entrada e
 * controlada por quem chama: sem ele, um atacante enche o disco de log com
 * tokens invalidos de graca.
 */
const ULTIMO_AVISO = new Map();
const INTERVALO_ENTRE_AVISOS_MS = 60_000;

function avisar(codigo, mensagem) {
  const agora = Date.now();
  if (agora - (ULTIMO_AVISO.get(codigo) || 0) < INTERVALO_ENTRE_AVISOS_MS) return;
  ULTIMO_AVISO.set(codigo, agora);
  console.warn(`[auth:${codigo}] ${mensagem}`);
}

/** Nada vindo do token entra no log sem passar por aqui. */
function higienizar(valor) {
  if (typeof valor !== "string" || !/^[\w.:+/-]{1,64}$/.test(valor)) return "<inválido>";
  return valor;
}

/**
 * `jwt.verify` com o algoritmo FIXADO pelo chamador, nunca lido do token.
 *
 * `TokenExpiredError` atravessa intacto: vencido e 401, e so este ponto sabe
 * distinguir. Todo o resto vira 403 com um codigo que diz qual caminho falhou.
 */
function verificarAssinatura(token, chave, algoritmo, codigo) {
  try {
    return jwt.verify(token, chave, { algorithms: [algoritmo] });
  } catch (erro) {
    if (erro.name === "TokenExpiredError") throw erro;
    throw new TokenRecusado(codigo, erro.message);
  }
}

/**
 * O `alg` do cabecalho escolhe a CHAVE. A chave escolhe o algoritmo aceito.
 *
 * Esse e o desenho inteiro, e e o que fecha a familia alg-confusion com duas
 * familias de chave em cena ao mesmo tempo:
 *
 *  - `alg: HS256` -> unica chave possivel: `SUPABASE_JWT_SECRET`, e o algoritmo
 *    passado ao `jwt.verify` e a constante "HS256". A chave publica do JWKS nao
 *    e alcancavel por este ramo, entao um token HMAC assinado com ela (o ataque
 *    classico) nao tem contra o que ser conferido a nao ser o segredo, que o
 *    atacante nao tem.
 *  - `alg: ES256|RS256` -> a chave vem do JWKS pelo `kid`, e o algoritmo vem de
 *    `algoritmoDaChave(chave)` — do TIPO DA CHAVE, nao do cabecalho. Um token
 *    que diga ES256 contra um `kid` de chave RSA e recusado com
 *    "invalid algorithm"; um que diga HS256 nem chega aqui.
 *  - qualquer outro `alg` (inclusive "none", HS512, PS256) -> recusado antes de
 *    qualquer chave ser tocada.
 */
async function verificarToken(token) {
  let cabecalho;
  try {
    cabecalho = jwt.decode(token, { complete: true })?.header;
  } catch {
    cabecalho = null;
  }
  if (!cabecalho || typeof cabecalho.alg !== "string") {
    throw new TokenRecusado("malformado", "não deu para ler o cabeçalho do token");
  }

  if (cabecalho.alg === "HS256") {
    const segredo = process.env.SUPABASE_JWT_SECRET;
    if (!segredo) {
      // Nao e 403: nada foi julgado. Este deploy nao tem o segredo, e sem ele
      // nenhum token HS256 pode ser aceito NEM recusado com conhecimento de
      // causa. Em producao o `ambiente.js` garante ao menos um caminho vivo,
      // entao chegar aqui e deploy quebrado — e 503 e o que diz isso.
      throw new SemComoVerificar(
        "hs256-sem-segredo",
        "chegou token HS256 e SUPABASE_JWT_SECRET não está definida. " +
          "Se a instância assina em ES256/RS256, este token é uma chave de API legada; " +
          "se ela assina em HS256, falta a variável.",
      );
    }
    return verificarAssinatura(token, segredo, "HS256", "assinatura-hs256");
  }

  if (!ALGORITMOS_ASSIMETRICOS.has(cabecalho.alg)) {
    throw new TokenRecusado(
      "alg-nao-suportado",
      `token com alg=${higienizar(cabecalho.alg)}; só HS256, ES256 e RS256 são verificáveis aqui`,
    );
  }

  const kid = typeof cabecalho.kid === "string" ? cabecalho.kid : "";
  if (!kid) {
    throw new TokenRecusado(
      "sem-kid",
      `token ${cabecalho.alg} sem "kid": não há como saber qual chave publicada o assinou`,
    );
  }

  // `chavePorKid` lanca `JwksIndisponivel` (503) quando nao SABE, e devolve
  // null quando SABE que a instancia nao publica este kid (403).
  const entrada = await chavePorKid(kid);
  if (!entrada) {
    throw new TokenRecusado(
      "kid-desconhecido",
      `nenhuma chave publicada no JWKS da instância tem kid=${higienizar(kid)}`,
    );
  }

  return verificarAssinatura(token, entrada.chave, entrada.algoritmo, "assinatura-jwks");
}

async function authenticateToken(req, res, next) {
  const cabecalho = req.headers["authorization"];
  const token = /^Bearer\s+(\S+)\s*$/i.exec(cabecalho || "")?.[1];
  if (!token) return res.sendStatus(401);

  let claims;
  try {
    claims = await verificarToken(token);
  } catch (err) {
    /**
     * Token EXPIRADO responde 401, nao 403.
     *
     * Os dois casos sao diferentes e o cliente trata cada um de um jeito:
     * 401 = "sua credencial venceu, renove"; 403 = "sua credencial vale mas
     * voce nao pode isso". A distincao sobreviveu a troca de emissor e continua
     * carregando peso: o `supabase-js` renova sozinho pelo refresh token e
     * repete a chamada quando ve 401, e nao tem o que fazer com 403 alem de
     * desistir. Com 403 para tudo, o access token de uma hora vencia e a tela
     * parava de carregar dados no meio da sessao, sem mensagem e sem
     * redirecionar para o login.
     *
     * O `typ` que separava access de refresh saiu: o refresh token do GoTrue
     * nao e JWT, e uma string opaca que so o GoTrue entende, e portanto nunca
     * passa por `jwt.verify` aqui.
     */
    if (err.name === "TokenExpiredError") return res.sendStatus(401);

    /**
     * 503 quando NAO DEU PARA CONFERIR, 403 quando CONFERIU E NAO PASSOU.
     *
     * JWKS fora do ar e falha de infraestrutura, exatamente como o banco fora
     * do ar mais abaixo: quem chama pode ter uma credencial impecavel e mesmo
     * assim nao ser possivel dizer. Responder 403 ali manda o cliente
     * (e quem depura) investigar a conta, que e o caminho errado — e foi
     * justamente o custo do bug que este arquivo acabou de consertar.
     */
    if (err instanceof JwksIndisponivel || err instanceof SemComoVerificar) {
      avisar(err.codigo || "jwks-indisponivel", err.message);
      return res.status(503).json({
        message: "Não consegui verificar sua credencial agora. Tente de novo em instantes.",
      });
    }

    if (err instanceof TokenRecusado) avisar(err.codigo, err.message);
    return res.sendStatus(403);
  }

  const sub = typeof claims.sub === "string" ? claims.sub : "";
  if (!FORMATO_UUID.test(sub)) return res.sendStatus(403);

  // `role` so serve para RECUSAR, nunca para conceder: quem consegue assinar um
  // token escreve o papel que quiser nele. Recusar o que nao for
  // "authenticated" barra as chaves de API da instancia (`anon`,
  // `service_role`) sendo usadas como credencial de pessoa.
  if (claims.role && claims.role !== "authenticated") return res.sendStatus(403);

  let vinculo;
  try {
    const { rows } = await pool.query(SQL_VINCULO, [sub]);
    vinculo = rows[0];
  } catch (erro) {
    // Banco fora do ar NAO pode virar "entra sem conferir": sem resposta, a
    // pergunta do vinculo esta em aberto e a unica resposta segura e recusar.
    // 503 e nao 500 porque e falha de infraestrutura e passageira — quem chama
    // pode tentar de novo, e o monitoramento distingue isso de uma recusa.
    console.error("Falha ao conferir vínculo do cliente:", erro.message);
    return res.status(503).json({
      message: "Não consegui confirmar sua conta agora. Tente de novo em instantes.",
    });
  }

  if (!vinculo.cliente) {
    // Token legitimo de OUTRO projeto da instancia, ou conta que se cadastrou no
    // GoTrue e ainda nao virou cliente (e-mail nao confirmado — ver
    // `canastra.garantir_cliente`, migracao 0008). A mensagem existe porque este
    // 403 e indistinguivel de "assinatura invalida" no log de quem depura, e o
    // sintoma na loja e "entrei mas nao vejo nada".
    return res.status(403).json({
      message: "Sua conta ainda não está vinculada a esta loja.",
    });
  }

  /**
   * `userId` mantem o nome antigo de proposito: PaymentController,
   * OrderController e AddressController leem `req.user.userId`, e essa e a
   * identidade que amarra o pedido a quem esta logado (ver o comentario "A
   * IDENTIDADE VEM DO TOKEN" em PaymentController).
   *
   * `ehAdmin` vem do BANCO, nunca de claim. E o que `isAdmin` le.
   */
  req.user = {
    userId: sub,
    email: typeof claims.email === "string" ? claims.email : null,
    ehAdmin: vinculo.admin === true,
  };

  next();
}

module.exports = authenticateToken;
