const OrderRepository = require("../repositories/ordersRepository");
const pool = require("../pgPool");
const { sendStatusEmail } = require("../utils/emailSender");
const { STATUS_VALIDOS } = require("../utils/statusDePedido");
const {
  lerItensDoPedido,
  aplicarTransicaoDeEstoque,
  DEVOLVEU,
  REBAIXOU,
} = require("../utils/estoque");
const cuponsRepository = require("../repositories/cuponsRepository");
const { gerarCsvDePedidos } = require("../utils/csvDePedidos");

/**
 * Os status validos vem do modulo unico (`utils/statusDePedido`), que e o
 * mesmo que o CHECK da migracao 0009 fixa — em portugues, decisao 1 do plano
 * mestre. O painel legado ainda envia o vocabulario antigo do MP ate a Onda
 * 2E; ate la, um `pending` responde 400 com a lista certa na mensagem, que e
 * o comportamento honesto (gravar traduzindo em silencio esconderia que o
 * painel esta desatualizado).
 */

/**
 * O :id da rota é validado ANTES do cast `::uuid` do Postgres: um id
 * malformado responderia 500 com 22P02, e a resposta certa para "isso não é
 * nem um id de pedido" é o mesmo 404 de "não existe".
 */
const FORMATO_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `de`/`ate` do export: ou ausente, ou exatamente YYYY-MM-DD. */
const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Le page/limit da query com piso, teto e valor padrao. */
function paginacao(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limitBruto = Number.parseInt(query.limit, 10) || 10;
  // Teto de 100: sem ele, `?limit=100000` faz o banco montar a tabela inteira
  // em memoria e serializar tudo numa resposta.
  const limit = Math.min(100, Math.max(1, limitBruto));
  return { page, limit };
}

class OrderController {
  async getUserOrders(req, res) {
    try {
      const { userId } = req.user;
      const orders = await OrderRepository.getOrdersByUser(userId);
      return res.json(orders);
    } catch (error) {
      console.error("Erro ao buscar pedidos:", error);
      return res
        .status(500)
        .json({ error: "Erro ao buscar histórico de pedidos." });
    }
  }

  /**
   * `GET /my-orders/:id` — o detalhe de UM pedido, para a página de
   * confirmação do checkout e para a conta do cliente.
   *
   * DONO OU ADMIN, E O RESTO RECEBE 404 — NUNCA 403. Um 403 para pedido de
   * terceiro confirmaria que aquele UUID existe, e ids de pedido circulam em
   * e-mail e URL: enumerá-los não pode render nem um bit de informação.
   * "Não é seu" e "não existe" respondem idêntico.
   */
  async getOrderDetail(req, res) {
    try {
      const { id } = req.params;
      if (!FORMATO_UUID.test(String(id || ""))) {
        return res.status(404).json({ error: "Pedido não encontrado." });
      }

      const order = await OrderRepository.getOrderDetail(id);
      const ehDono = order && order.user_id === req.user.userId;
      if (!order || (!ehDono && req.user.ehAdmin !== true)) {
        return res.status(404).json({ error: "Pedido não encontrado." });
      }

      return res.json({ order });
    } catch (error) {
      console.error("Erro ao buscar detalhe do pedido:", error);
      return res.status(500).json({ error: "Erro ao buscar o pedido." });
    }
  }

  /**
   * `GET /admin/orders/export?de=YYYY-MM-DD&ate=YYYY-MM-DD` — o CSV que o
   * gestor abre no Excel. Filtro opcional dos dois lados; formato inválido é
   * 400 com frase, não um filtro silenciosamente ignorado (que exportaria a
   * base inteira achando que filtrou).
   */
  async exportOrdersCsv(req, res) {
    try {
      const { de, ate } = req.query;
      for (const [nome, valor] of [["de", de], ["ate", ate]]) {
        if (valor !== undefined && !FORMATO_DATA.test(String(valor))) {
          return res.status(400).json({
            error: `Parâmetro "${nome}" inválido: use o formato YYYY-MM-DD.`,
          });
        }
      }

      const pedidos = await OrderRepository.getOrdersForExport({ de, ate });
      const csv = gerarCsvDePedidos(pedidos);

      const sufixo = [de ? `de-${de}` : null, ate ? `ate-${ate}` : null]
        .filter(Boolean)
        .join("-");
      const nomeDoArquivo = sufixo ? `pedidos-${sufixo}.csv` : "pedidos.csv";

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${nomeDoArquivo}"`,
      );
      return res.send(csv);
    } catch (error) {
      console.error("Erro ao exportar pedidos:", error);
      return res.status(500).json({ error: "Erro ao exportar pedidos." });
    }
  }

  async getAllOrdersAdmin(req, res) {
    try {
      const { page, limit } = paginacao(req.query);
      const orders = await OrderRepository.getAllOrders(page, limit);
      return res.json(orders);
    } catch (error) {
      console.error("Erro ao buscar pedidos do admin:", error);
      return res
        .status(500)
        .json({ error: "Erro ao buscar pedidos do admin." });
    }
  }

  async updateStatus(req, res) {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const { status: newStatus, trackingCode } = req.body;

      if (!STATUS_VALIDOS.includes(newStatus)) {
        return res.status(400).json({
          error: `Status inválido. Use um de: ${STATUS_VALIDOS.join(", ")}.`,
        });
      }

      /**
       * Devolver/retirar estoque e mudar o status precisam ser atomicos, e
       * agora SAO: a leitura do pedido entra na mesma transacao, com FOR
       * UPDATE (a versao anterior lia fora e atualizava o status por OUTRA
       * conexao — a transacao de estoque nao cobria o proprio UPDATE de
       * status, e uma falha no meio movimentava estoque DE NOVO na proxima
       * tentativa).
       */
      await client.query("BEGIN");

      const { rows } = await client.query(
        `SELECT pedido_id AS order_id, status, itens AS items, user_id,
                total AS total_amount, cupom_codigo AS coupon_code
           FROM canastra.pedidos
          WHERE pedido_id = $1::uuid
            FOR UPDATE`,
        [id],
      );
      if (!rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Pedido não encontrado" });
      }
      const order = rows[0];
      const currentStatus = order.status;

      /**
       * A MOVIMENTAÇÃO DE ESTOQUE VEM DO MÓDULO ÚNICO (utils/estoque.js) — o
       * painel tinha CÓPIA PRÓPRIA desta lógica, que é exatamente o que o
       * módulo existe para impedir. As regras coincidiam por sorte, e a linha
       * onde elas divergiam de fato era a de baixo: o webhook devolvia o uso
       * do cupom na travessia ativo→cancelado e o painel não — e o painel é o
       * caminho MAIS usado pelo gestor.
       *
       * O helper decide a travessia, itera em ordem canônica (o painel mudando
       * um pedido enquanto um checkout reserva os mesmos produtos em ordem
       * oposta seria deadlock 40P01) e diz o que fez.
       */
      const items = lerItensDoPedido(order.items, "Painel");
      const movimento = await aplicarTransicaoDeEstoque(
        client,
        items,
        currentStatus,
        newStatus,
      );

      if (movimento === DEVOLVEU) {
        /**
         * O USO DO CUPOM VOLTA JUNTO COM O ESTOQUE, na MESMA transação — a
         * mesma regra do webhook do Mercado Pago (ver receiveWebhook): a venda
         * morreu, e um cupom de limite 50 "gasto" em pedidos cancelados
         * esgotaria a campanha sem vender nada.
         *
         * `devolverUsoPorCodigo` (e não `devolverUso`) porque o pedido guarda a
         * FOTOGRAFIA do código, não o id do cupom — e porque ela NÃO engole
         * erro: aqui a devolução vive dentro da transação, e um erro engolido
         * dentro de transação envenena tudo que vier depois (25P02). O erro
         * sobe, vira ROLLBACK + 500, e o gestor tenta de novo.
         *
         * `false` = nenhuma linha casou (cupom renomeado depois da venda, ou
         * contador já em zero). Não é falha da transição — loga e segue.
         */
        if (order.coupon_code) {
          const devolveu = await cuponsRepository.devolverUsoPorCodigo(
            order.coupon_code,
            client,
          );
          if (!devolveu) {
            console.warn(
              `CUPOM: uso do cupom "${order.coupon_code}" (pedido ${order.order_id}) ` +
                "não pôde ser devolvido — código renomeado ou contador zerado. " +
                "Confira o contador manualmente.",
            );
          }
        }
      } else if (movimento === REBAIXOU) {
        /**
         * O caminho de volta NÃO re-reserva o uso do cupom, pela MESMA razão do
         * webhook: re-incrementar às cegas (`usos + 1`) poderia ESTOURAR o
         * limite — a vaga devolvida no cancelamento pode já ter sido consumida
         * por outro pedido nesse meio tempo — e recusar a reativação de um
         * pedido por causa de contador de campanha seria deixar o marketing
         * mandar no dinheiro. O contador fica 1 abaixo do real para este cupom;
         * divergência conhecida, logada e conferível no painel.
         */
        if (order.coupon_code) {
          console.warn(
            `CUPOM: pedido ${order.order_id} voltou a ativo com o cupom ` +
              `"${order.coupon_code}" ja devolvido — o contador de usos ` +
              "fica 1 abaixo do real para este cupom (divergência conhecida, " +
              "não re-reservamos às cegas para não estourar o limite).",
          );
        }
      }

      const updated = await OrderRepository.updateOrderStatus(
        id,
        newStatus,
        trackingCode,
        client,
      );

      await client.query("COMMIT");

      // E-mail depois do COMMIT e sem travar a resposta: avisar o cliente e
      // importante, mas o provedor estar fora nao pode fazer o admin achar que
      // a mudanca de status falhou — ela ja esta gravada.
      sendStatusEmail(order, newStatus, trackingCode).catch((e) =>
        console.error("Falha ao enviar e-mail de status:", e.message),
      );

      return res.json(updated);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Erro ao atualizar status do pedido:", error);
      return res.status(500).json({ error: "Erro ao atualizar status." });
    } finally {
      client.release();
    }
  }
}

module.exports = new OrderController();
