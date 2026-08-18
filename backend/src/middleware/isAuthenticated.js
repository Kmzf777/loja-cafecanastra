const jwt = require("jsonwebtoken");
const pool = require("../pgPool");

/**
 * Quem esta chamando, segundo o GoTrue — e se essa pessoa e CLIENTE DESTA LOJA.
 *
 * O QUE MUDOU NA F2: o Express nao emite mais token. Quem emite e o GoTrue do
 * Supabase, e este middleware so verifica. O segredo, entao, deixa de ser
 * `JWT_SECRET` (nosso) e passa a ser `SUPABASE_JWT_SECRET` — o mesmo
 * `JWT_SECRET` do stack self-hosted, o valor que o GoTrue usa para assinar e
 * que o PostgREST usa para verificar. Nao ha chave assimetrica aqui: as chaves
 * de assinatura ECC/JWKS sao recurso da plataforma hospedada; um stack
 * self-hosted assina em HS256 com esse segredo unico.
 *
 * ASSINATURA VALIDA NAO E PERTENCIMENTO, E ESTA E A LINHA MAIS IMPORTANTE DO
 * ARQUIVO. A instancia Supabase da VPS e COMPARTILHADA com outros projetos, e
 * self-hosted nao e multi-projeto: existe um `auth.users` e um segredo de JWT
 * para todos. Um token emitido para outro projeto chega aqui com assinatura
 * perfeita, `sub` preenchido e `role: "authenticated"` — indistinguivel de um
 * cliente da loja, se a pergunta parar na assinatura. Por isso, depois de
 * verificar, este middleware confere o VINCULO: linha em `canastra.clientes`
 * (cliente) e linha em `canastra.admins` (administrador). E a mesma premissa
 * que sustenta toda a RLS de 0006 (`eh_cliente()` / `eh_admin()`), aplicada do
 * lado do Node.
 *
 * NAO ADIANTARIA CONFERIR `iss`: o emissor e o mesmo GoTrue para todos os
 * projetos da instancia. Nao ha nada NO TOKEN que separe um projeto do outro —
 * a separacao so existe no banco desta loja.
 *
 * UMA IDA AO BANCO POR REQUISICAO, E POR QUE ISSO E ACEITAVEL AQUI. As duas
 * perguntas (cliente? admin?) saem num unico SELECT, com dois EXISTS sobre
 * chave primaria: uma ida, dois index scans. Nenhum cache: `isAdmin` passa a
 * ler o resultado DESTE select, entao a alternativa "guardar em memoria por
 * alguns segundos" nao economizaria a ida — economizaria repeticao que nao
 * existe — e faria uma revogacao de administrador demorar a valer. Depois da
 * F4, o que sobra de autenticado neste servico e pagamento e pedido: poucas
 * requisicoes, todas ja com varias consultas proprias.
 */

/**
 * A ANON KEY E A SERVICE_ROLE KEY SAO JWT ASSINADOS COM ESTE MESMO SEGREDO.
 *
 * Mandar a anon key publicada no front como `Authorization: Bearer` passa pelo
 * `jwt.verify` sem reclamar — ela e um token valido, so que sem `sub`. Sem esta
 * conferencia, `pool.query(..., [undefined])` levantaria erro de tipo (22P02)
 * e viraria 503, ou pior, um `sub` estranho entraria como identidade. Exigir
 * UUID no `sub` fecha as duas chaves de API de uma vez, porque nenhuma das duas
 * tem `sub`.
 */
const FORMATO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function authenticateToken(req, res, next) {
  const cabecalho = req.headers["authorization"];
  const token = /^Bearer\s+(\S+)\s*$/i.exec(cabecalho || "")?.[1];
  if (!token) return res.sendStatus(401);

  let claims;
  try {
    // `algorithms` fixo e obrigatorio: sem isso o jsonwebtoken aceita o algoritmo
    // que vier no cabecalho do proprio token. E a familia de ataques "alg
    // confusion" — trocar para "none", ou fazer um token assinado com HMAC ser
    // verificado contra uma chave publica RSA. Aqui so HS256 vale, que e o que o
    // GoTrue self-hosted emite.
    claims = jwt.verify(token, process.env.SUPABASE_JWT_SECRET, {
      algorithms: ["HS256"],
    });
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
    return res.sendStatus(err.name === "TokenExpiredError" ? 401 : 403);
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
