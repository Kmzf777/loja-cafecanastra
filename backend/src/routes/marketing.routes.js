const { Router } = require("express");

const marketingRepository = require("../repositories/marketingRepository");
const isAuthenticated = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");

const marketingRoutes = Router();

/**
 * O CRUD das três tabelas da migração 0033: campanhas, consentimentos e envios.
 *
 * TUDO AQUI É SÓ DE ADMIN, e nenhuma dessas tabelas tem leitura pública —
 * `consentimentos` e `envios` carregam e-mail e telefone de gente, e a spec
 * §3.10 os nomeia junto de `promocao_resgates` e `admin_log` como as tabelas
 * que `anon` nunca alcança. Uma rota pública aqui seria a lista de contatos da
 * loja saindo por um GET.
 *
 * O ROUTER É MONTADO SEM PREFIXO (caminhos absolutos `/admin/...`), como
 * `orders.routes.js` e `painel.routes.js`, e entra NO FIM de `index.js`: a
 * ordem de registro é load-bearing nesta API, e acrescentar no fim é o que
 * garante não deslocar nenhum dos três pares que quebram se invertidos.
 *
 * Os guardas vêm sempre nesta ordem — `isAdmin` lê `req.user.ehAdmin`, que só
 * existe depois de `isAuthenticated` consultar `canastra.admins`.
 */

/**
 * A tradução de erro→resposta, num lugar só.
 *
 * `erro.status` é posto pelo repositório quando a culpa é do PEDIDO (400, 404,
 * 409) e a mensagem é para ser LIDA. Sem esse recorte, um canal fora da lista e
 * um banco fora do ar responderiam a mesma coisa — e as frases do servidor SÃO
 * o diagnóstico do gestor.
 */
function responderErro(res, erro, contexto) {
  if (erro.status) {
    return res.status(erro.status).json({ error: erro.message });
  }
  console.error(`Erro em ${contexto}:`, erro);
  return res.status(500).json({ error: `Erro ao ${contexto}.` });
}

const admin = [isAuthenticated, isAdmin];
const autor = (req) => req.user?.userId ?? null;

/* --------------------------------------------------------------------------
 * Campanhas
 * -------------------------------------------------------------------------- */

marketingRoutes.get("/admin/campanhas", ...admin, async (req, res) => {
  try {
    return res.json(await marketingRepository.listarCampanhas(req.query));
  } catch (erro) {
    return responderErro(res, erro, "listar campanhas");
  }
});

/**
 * 201 quando criou, 200 quando ATUALIZOU a campanha que já tinha esta UTM.
 * A distinção não é enfeite: reimportar a planilha do anúncio é o gesto normal,
 * e a tela precisa saber se acabou de criar uma campanha nova ou de sobrescrever
 * uma que já estava rodando.
 */
marketingRoutes.post("/admin/campanhas", ...admin, async (req, res) => {
  try {
    const { campanha, criou } = await marketingRepository.salvarCampanha({
      dados: req.body || {},
      adminUserId: autor(req),
    });
    return res.status(criou ? 201 : 200).json(campanha);
  } catch (erro) {
    return responderErro(res, erro, "salvar a campanha");
  }
});

marketingRoutes.patch("/admin/campanhas/:id", ...admin, async (req, res) => {
  try {
    const campanha = await marketingRepository.atualizarCampanha({
      id: req.params.id,
      dados: req.body || {},
      adminUserId: autor(req),
    });
    return res.json(campanha);
  } catch (erro) {
    return responderErro(res, erro, "atualizar a campanha");
  }
});

/* --------------------------------------------------------------------------
 * Consentimentos
 * -------------------------------------------------------------------------- */

marketingRoutes.get("/admin/consentimentos", ...admin, async (req, res) => {
  try {
    return res.json(await marketingRepository.listarConsentimentos(req.query));
  } catch (erro) {
    return responderErro(res, erro, "listar consentimentos");
  }
});

/**
 * NÃO HÁ PATCH NEM DELETE DE CONSENTIMENTO, e a ausência é a decisão: a tabela é
 * o HISTÓRICO da autorização — é ela que responde "com base em quê vocês me
 * mandaram esta mensagem em março?". Revogar é uma linha NOVA com
 * `estado = 'revogado'`; editar a antiga apagaria a prova do que valia antes.
 */
marketingRoutes.post("/admin/consentimentos", ...admin, async (req, res) => {
  try {
    const consentimento = await marketingRepository.registrarConsentimento({
      dados: req.body || {},
      adminUserId: autor(req),
    });
    return res.status(201).json(consentimento);
  } catch (erro) {
    return responderErro(res, erro, "registrar o consentimento");
  }
});

/* --------------------------------------------------------------------------
 * Envios
 * -------------------------------------------------------------------------- */

marketingRoutes.get("/admin/envios", ...admin, async (req, res) => {
  try {
    return res.json(await marketingRepository.listarEnvios(req.query));
  } catch (erro) {
    return responderErro(res, erro, "listar envios");
  }
});

marketingRoutes.post("/admin/envios", ...admin, async (req, res) => {
  try {
    const envio = await marketingRepository.criarEnvio({
      dados: req.body || {},
      adminUserId: autor(req),
    });
    return res.status(201).json(envio);
  } catch (erro) {
    return responderErro(res, erro, "criar o envio");
  }
});

marketingRoutes.patch("/admin/envios/:id", ...admin, async (req, res) => {
  try {
    const envio = await marketingRepository.atualizarEnvio({
      id: req.params.id,
      dados: req.body || {},
      adminUserId: autor(req),
    });
    return res.json(envio);
  } catch (erro) {
    return responderErro(res, erro, "atualizar o envio");
  }
});

module.exports = marketingRoutes;
