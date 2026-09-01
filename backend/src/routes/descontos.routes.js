const { Router } = require("express");

const descontosRepository = require("../repositories/descontosRepository");
const isAuthenticated = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");

const descontosRoutes = Router();

/**
 * As rotas de administração do motor de promoção — as sete tabelas de
 * `0032_motor_de_promocao.sql` pela porta do painel.
 *
 * O QUE ELAS FECHAM: a Onda 3 criou as tabelas e a Onda 4 escreveu o motor
 * (`utils/motor.js` + `repositories/motorRepository.js`), mas nenhum caminho do
 * Express falava com `canastra.promocoes` nova — `promotions.routes.js` continua
 * servindo a tabela LEGADA (`promocoes_legado`), que é outra coisa e que o
 * checkout ainda usa. A tela de Descontos já existia, escrita contra
 * `frontend/lib/painel/descontos/contrato.ts`, e degradava com frase porque
 * cada uma destas rotas respondia 404.
 *
 * TUDO AQUI É SÓ DE ADMIN. Nenhuma destas rotas tem metade pública: a lista de
 * códigos é o mapa de descontos da loja, e ela não sai por um GET — é o mesmo
 * recorte que a política `anon` de 0032 faz, deixando `metodo = 'automatico'`
 * visível para a vitrine e os códigos fora.
 *
 * Os guardas vêm sempre nesta ordem porque `isAdmin` lê `req.user.ehAdmin`, que
 * só existe depois de `isAuthenticated` consultar `canastra.admins`. Invertidos,
 * `isAdmin` veria `req.user` indefinido e responderia 403 a todo mundo — falha
 * fechada, então o erro apareceria como "o painel não salva" e não como
 * vazamento.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A ORDEM DE REGISTRO É LOAD-BEARING, DUAS VEZES.
 *
 * Dentro deste arquivo: `POST /admin/descontos/simular` está declarado ANTES de
 * qualquer caminho com `:id`. Invertidos, "simular" casaria como identificador,
 * `ehUuid` o recusaria e a simulação responderia 400 — um erro que pareceria da
 * regra, não do roteamento.
 *
 * Em `index.js`: o router é montado sem prefixo (caminhos absolutos `/admin/…`,
 * como `orders.routes.js`, `painel.routes.js` e `marketing.routes.js`) e entra
 * NO FIM. Três pares já quebram se invertidos nesta API (`/dashboard/summary`
 * antes de `/dashboard/:id`, `/admin/orders/export` antes de
 * `/admin/orders/:id`, `/users/me` antes de `/users/:id`), e acrescentar no fim
 * é o que garante não deslocar nenhum deles.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * OS DOIS GESTOS QUE NÃO SÃO EDIÇÃO DE FORMULÁRIO TÊM ROTA PRÓPRIA —
 * `PATCH /:id/habilitada` e `POST /:id/arquivar`. Se ligar/desligar passasse
 * pelo `PUT` total, ligar uma regra expirada exigiria montar o objeto inteiro a
 * partir da linha da LISTA, que não tem escopo nem faixas, e o `PUT` obediente
 * apagaria as duas.
 */

/**
 * A tradução de erro→resposta, num lugar só.
 *
 * `erro.status` é posto pelo repositório quando a culpa é do PEDIDO (400, 404,
 * 409) e a mensagem é para ser LIDA — o painel a mostra inteira. Sem esse
 * recorte, um percentual acima de 90 e um banco fora do ar responderiam a mesma
 * coisa, e as frases do servidor SÃO o diagnóstico do gestor.
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
 * Simular — antes de qualquer `:id`, e sem escrever nada
 * -------------------------------------------------------------------------- */

/**
 * `POST` apesar de ser leitura pura: o carrinho não cabe numa query string, e
 * carrinho de teste não se guarda em cache. A rota recebe o RASCUNHO da regra,
 * monta-a em memória no formato de `carregarRegrasVigentes` e chama
 * `calcularDescontos` — simular só o que já foi salvo inverteria a razão de
 * existir do simulador.
 */
descontosRoutes.post("/admin/descontos/simular", ...admin, (req, res) => {
  try {
    const corpo = req.body || {};
    return res.json(
      descontosRepository.simular({ regra: corpo.regra, carrinho: corpo.carrinho }),
    );
  } catch (erro) {
    return responderErro(res, erro, "simular o desconto");
  }
});

/* --------------------------------------------------------------------------
 * A lista e a ficha
 * -------------------------------------------------------------------------- */

descontosRoutes.get("/admin/descontos", ...admin, async (req, res) => {
  try {
    return res.json(await descontosRepository.listar(req.query));
  } catch (erro) {
    return responderErro(res, erro, "listar os descontos");
  }
});

descontosRoutes.get("/admin/descontos/:id", ...admin, async (req, res) => {
  try {
    return res.json(await descontosRepository.buscar(req.params.id));
  } catch (erro) {
    return responderErro(res, erro, "buscar a regra de desconto");
  }
});

/* --------------------------------------------------------------------------
 * Criar e editar
 * -------------------------------------------------------------------------- */

descontosRoutes.post("/admin/descontos", ...admin, async (req, res) => {
  try {
    const regra = await descontosRepository.criar({
      dados: req.body || {},
      adminUserId: autor(req),
    });
    return res.status(201).json(regra);
  } catch (erro) {
    return responderErro(res, erro, "criar a regra de desconto");
  }
});

descontosRoutes.put("/admin/descontos/:id", ...admin, async (req, res) => {
  try {
    const regra = await descontosRepository.atualizar({
      id: req.params.id,
      dados: req.body || {},
      adminUserId: autor(req),
    });
    return res.json(regra);
  } catch (erro) {
    return responderErro(res, erro, "salvar a regra de desconto");
  }
});

/* --------------------------------------------------------------------------
 * Ligar, desligar, arquivar
 * -------------------------------------------------------------------------- */

descontosRoutes.patch("/admin/descontos/:id/habilitada", ...admin, async (req, res) => {
  try {
    const regra = await descontosRepository.alternar({
      id: req.params.id,
      habilitada: (req.body || {}).habilitada,
      adminUserId: autor(req),
    });
    return res.json(regra);
  } catch (erro) {
    return responderErro(res, erro, "ligar ou desligar a regra");
  }
});

/**
 * `POST` e não `DELETE`, e a escolha é a doutrina R13 virando verbo: não existe
 * exclusão de promoção nesta loja. `promocao_resgates` referencia a regra com
 * `ON DELETE RESTRICT` e a 0032 revoga DELETE — uma rota `DELETE` prometeria o
 * que o banco recusa, e só falharia nas regras que já foram usadas, isto é, nas
 * que mais importam.
 */
descontosRoutes.post("/admin/descontos/:id/arquivar", ...admin, async (req, res) => {
  try {
    const regra = await descontosRepository.arquivar({
      id: req.params.id,
      adminUserId: autor(req),
    });
    return res.json(regra);
  } catch (erro) {
    return responderErro(res, erro, "arquivar a regra");
  }
});

descontosRoutes.post("/admin/descontos/:id/desarquivar", ...admin, async (req, res) => {
  try {
    const regra = await descontosRepository.desarquivar({
      id: req.params.id,
      adminUserId: autor(req),
    });
    return res.json(regra);
  } catch (erro) {
    return responderErro(res, erro, "desarquivar a regra");
  }
});

module.exports = descontosRoutes;
