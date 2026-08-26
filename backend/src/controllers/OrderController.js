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
const { registrar, ACOES, ENTIDADES } = require("../services/adminLog");
// A MESMA forma de UUID de `dashboardRepository`, `conta.routes` e
// `lgpd.routes`. O `FORMATO_UUID` local abaixo continua servindo ao
// `/my-orders/:id`, que responde 404 (e nao 400) para id malformado.
const { ehUuid } = require("../utils/formatoUuid");

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

/**
 * O teto de linhas e o periodo maximo da exportacao, com knob de ambiente.
 *
 * SAO LIDOS A CADA CHAMADA, e nao congelados no require: e o que permite subir
 * o teto em producao sem deploy quando o gestor precisa de um relatorio anual —
 * e e o que deixa o teste exercitar a recusa sem inserir 5000 pedidos.
 *
 * 5000 linhas e ~1 MB de CSV com CPF e e-mail dentro; 366 dias e um ano
 * fechado, que e o maior relatorio que alguem pede sem pensar duas vezes.
 */
const numeroDoAmbiente = (nome, padrao) => {
  const n = Number.parseInt(process.env[nome], 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
};
const tetoDeLinhas = () => numeroDoAmbiente("PEDIDOS_EXPORT_TETO", 5000);
const diasMaximos = () => numeroDoAmbiente("PEDIDOS_EXPORT_DIAS_MAX", 366);

/**
 * Le `status`, `de`, `ate` e `q` da query da listagem.
 *
 * FILTRO INVALIDO RECUSA COM FRASE, e nao e preciosismo: um `?status=delivered`
 * (o vocabulario antigo do MP, que o painel legado ainda fala em tres lugares)
 * ignorado em silencio devolveria a base inteira com a tela mostrando "filtrado
 * por entregue" — a mesma classe de mentira que a validacao de data do export
 * ja fecha. A lista valida vai na frase porque e ela que diz o que fazer.
 *
 * Devolve `{ filtro }` ou `{ erro }`.
 */
function filtroDeLista(query) {
  const filtro = {};

  const statusBruto = String(query.status || "").trim();
  if (statusBruto) {
    // Uma virgula separa: a tela de expedicao pergunta "aprovado,enviado" numa
    // ida so, e sem isto ela faria duas e somaria os totais no navegador.
    const pedidos = statusBruto.split(",").map((s) => s.trim()).filter(Boolean);
    const invalido = pedidos.find((s) => !STATUS_VALIDOS.includes(s));
    if (invalido) {
      return {
        erro: `Status inválido: "${invalido}". Use um de: ${STATUS_VALIDOS.join(", ")}.`,
      };
    }
    filtro.status = pedidos;
  }

  for (const nome of ["de", "ate"]) {
    const valor = query[nome];
    if (valor === undefined || valor === "") continue;
    if (!FORMATO_DATA.test(String(valor))) {
      return { erro: `Parâmetro "${nome}" inválido: use o formato YYYY-MM-DD.` };
    }
    filtro[nome] = String(valor);
  }

  const q = String(query.q || "").trim();
  if (q) filtro.q = q;

  return { filtro };
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

      /**
       * AS TRES CERCAS DE UM ARQUIVO COM CPF E E-MAIL DE TODO MUNDO.
       *
       * Ate a Onda 4 este botao baixava a base INTEIRA quando as duas datas
       * ficavam vazias — sem confirmacao, sem teto e sem registro nenhum. Nao e
       * hipotese: a memoria do projeto ja lista CSVs de dados pessoais no
       * historico do Git desta loja.
       *
       *  1. SEM DATAS EXIGE `confirmar=true`. Nao e um dialogo bonito, e a
       *     unica forma de a confirmacao valer para QUALQUER cliente da rota
       *     (a tela, o curl, o script) e nao so para o botao que a tela desenha.
       *  2. TETO DE LINHAS, conferido por contagem ANTES de montar o arquivo —
       *     descobrir que era grande demais depois de ja ter carregado tudo na
       *     memoria do processo, com CPF dentro, nao seria descobrir nada.
       *  3. PERIODO MAXIMO, que e a cerca que o gestor esbarra primeiro e a
       *     unica que ensina o caminho ("peca por mes").
       *
       * As tres recusam com FRASE e numero. "Erro ao exportar" mandaria abrir
       * chamado por algo que se resolve trocando a data.
       */
      const periodoInteiro = !de && !ate;
      if (periodoInteiro && String(req.query.confirmar) !== "true") {
        return res.status(400).json({
          error:
            "Sem período, a exportação baixa a base inteira — com CPF e e-mail de " +
            "todos os clientes. Informe de/ate ou repita com confirmar=true.",
        });
      }

      if (de && ate) {
        const dias =
          Math.round(
            (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000,
          ) + 1;
        if (dias > diasMaximos()) {
          return res.status(400).json({
            error:
              `O período pedido tem ${dias} dias, acima do máximo de ${diasMaximos()}. ` +
              "Exporte em partes menores.",
          });
        }
      }

      const linhas = await OrderRepository.contarPedidosParaExport({ de, ate });
      if (linhas > tetoDeLinhas()) {
        return res.status(400).json({
          error:
            `A exportação alcançaria ${linhas} pedidos, acima do teto de ` +
            `${tetoDeLinhas()}. Reduza o período.`,
        });
      }

      const pedidos = await OrderRepository.getOrdersForExport({ de, ate });
      const csv = gerarCsvDePedidos(pedidos);

      /**
       * O REGISTRO VEM ANTES DO ARQUIVO, e essa ordem e a decisao: uma falha em
       * gravar a auditoria recusa a exportacao (500 no catch) em vez de entregar
       * o CSV sem rastro. E requisito de prestacao de contas da LGPD (art. 6º,
       * X), nao capricho — "quem baixou a base inteira?" e a pergunta que a
       * 0035 nomeia como a mais urgente da tabela.
       *
       * Pelo pool, e nao numa transacao: nao ha o que desfazer numa LEITURA, e
       * a linha ja esta commitada quando o arquivo sai.
       */
      await registrar(pool, {
        adminUserId: req.user?.userId ?? null,
        acao: ACOES.PEDIDOS_EXPORTADOS,
        entidade: ENTIDADES.PEDIDOS,
        // Sem `entidade_id`: exportacao de LISTA nao tem um id, e exigir um
        // obrigaria a inventar. O filtro usado mora no `depois`, que e o que
        // responde "baixou a base inteira ou so a semana?".
        depois: {
          de: de || null,
          ate: ate || null,
          linhas,
          confirmada: periodoInteiro,
        },
      });

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
      const { filtro, erro } = filtroDeLista(req.query);
      if (erro) return res.status(400).json({ error: erro });

      const orders = await OrderRepository.getAllOrders(page, limit, filtro);
      return res.json(orders);
    } catch (error) {
      console.error("Erro ao buscar pedidos do admin:", error);
      return res
        .status(500)
        .json({ error: "Erro ao buscar pedidos do admin." });
    }
  }

  /**
   * `GET /admin/orders/:id` — o detalhe do pedido para o painel.
   *
   * MALFORMADO NAO E INEXISTENTE, e aqui a distincao vale mais que no
   * `/my-orders/:id` logo acima: la tudo responde 404 porque um 403 confirmaria
   * a existencia de pedido alheio a quem enumera ids; aqui quem pergunta JA
   * passou por `isAdmin` e ve a base inteira, entao esconder a diferenca so
   * atrapalharia o proprio gestor ("nao existe" manda procurar no lugar errado
   * quando o que houve foi um id truncado no copiar e colar).
   */
  async getOrderByIdAdmin(req, res) {
    try {
      const { id } = req.params;
      if (!ehUuid(id)) {
        return res.status(400).json({ error: "Identificador de pedido inválido." });
      }

      const order = await OrderRepository.getOrderForAdmin(id);
      if (!order) return res.status(404).json({ error: "Pedido não encontrado." });

      // `{ order }` e nao a linha crua: a MESMA forma de `/my-orders/:id`, para
      // as duas telas de detalhe lerem a resposta do mesmo jeito.
      return res.json({ order });
    } catch (error) {
      console.error("Erro ao buscar pedido do admin:", error);
      return res.status(500).json({ error: "Erro ao buscar o pedido." });
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

      /**
       * A AUDITORIA ENTRA NA TRANSACAO DA ACAO, com o `client`: ou a mudanca de
       * status e o registro dela acontecem juntos, ou nenhum dos dois. Um
       * INSERT depois do COMMIT sumiria justamente quando a rede caisse no meio
       * — que e quando alguem iria procurar o registro.
       *
       * `antes`/`depois` guardam o status, e nao a linha inteira: `itens` e
       * `endereco_json` levariam dado pessoal do cliente para dentro do log a
       * cada mudanca de status, criando mais uma copia para redigir. O que
       * responde "quem mudou este pedido para cancelado?" e o par de status.
       */
      await registrar(client, {
        adminUserId: req.user?.userId ?? null,
        acao: ACOES.PEDIDO_STATUS_ALTERADO,
        entidade: ENTIDADES.PEDIDO,
        entidadeId: id,
        antes: { status: currentStatus },
        depois: { status: newStatus, codigo_rastreio: trackingCode ?? null },
      });

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
