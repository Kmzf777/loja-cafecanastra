const pool = require("../pgPool");
const { registrar, ACOES, ENTIDADES } = require("../services/adminLog");

/**
 * A linha única de `canastra.config_loja`, no contrato que o painel legado já
 * consome (`site_title`, `whatsapp_number`, `announcement_bar`, banners).
 *
 * `frete_gratis_minimo_centavos` (0009) sai no GET com o nome do banco mesmo:
 * é campo NOVO — não há consumidor legado a preservar — e o plano mestre pede
 * que a barra do Cabeçalho e a barra de progresso leiam exatamente esse valor.
 */

const COLUNAS_DO_CONTRATO = `
  id,
  banner_desktop,
  banner_mobile,
  titulo_site    AS site_title,
  whatsapp       AS whatsapp_number,
  barra_de_aviso AS announcement_bar,
  frete_gratis_minimo_centavos,
  atualizado_em  AS updated_at
`;

class ConfigRepository {
  async getConfig() {
    const res = await pool.query(
      `SELECT ${COLUNAS_DO_CONTRATO} FROM canastra.config_loja WHERE id = 1`,
    );
    return res.rows[0];
  }

  /**
   * CAMPO EM BRANCO É AUSÊNCIA, NÃO É VALOR — e é esta distinção que é o
   * conserto.
   *
   * O corpo do PUT chega por MULTIPART: um campo que o formulário envia vazio
   * vale `''`, que não é `undefined` e portanto atravessava a condicional do
   * `atribui()` abaixo. Para texto isso já apagava título e barra de aviso; para
   * `frete_gratis_minimo_centavos` é pior, porque a validação APROVAVA:
   * `Number('')` é `0`, `Number.isInteger(0)` é `true` e `0 < 0` é falso — o
   * piso do frete grátis virava zero e a loja INTEIRA passava a dar frete
   * grátis, disparado por qualquer outro campo que o painel estivesse salvando.
   *
   * Quem quiser mesmo zerar o piso manda `0` (ou `"0"`) explícito: `'0'` não é
   * `''`, então passa por aqui e chega ao banco. O preço desta regra é que
   * ESVAZIAR um texto (limpar a barra de aviso, por exemplo) deixou de ser
   * possível por campo em branco — apagar por engano é o erro caro, e apagar de
   * propósito precisa de um caminho explícito, que hoje não existe.
   *
   * `null` entra junto: a coluna do frete é `NOT NULL DEFAULT 14900` (0009), e
   * um JSON com `null` só produziria 23502 — nunca é pedido de zerar.
   */
  static ehAusencia(valor) {
    if (valor === undefined || valor === null) return true;
    return typeof valor === "string" && valor.trim() === "";
  }

  async updateConfig(req, res) {
    const { site_title, whatsapp_number, announcement_bar } = req.body;
    const ehAusencia = ConfigRepository.ehAusencia;

    const bannerDesktop = req.files?.banner_desktop
      ? req.files.banner_desktop[0].path
      : undefined;
    const bannerMobile = req.files?.banner_mobile
      ? req.files.banner_mobile[0].path
      : undefined;

    /**
     * O piso do frete grátis é opcional no corpo (o painel só passa a enviá-lo
     * na Onda 2E), mas quando vier tem de ser inteiro não-negativo — o CHECK
     * do banco recusaria de qualquer forma; validar aqui devolve 400 com
     * frase em vez de 500 com SQLSTATE.
     */
    let freteGratis;
    if (!ehAusencia(req.body.frete_gratis_minimo_centavos)) {
      freteGratis = Number(req.body.frete_gratis_minimo_centavos);
      if (!Number.isInteger(freteGratis) || freteGratis < 0) {
        return res.status(400).json({
          error:
            "frete_gratis_minimo_centavos precisa ser um inteiro em centavos, zero ou maior (zero desliga o frete grátis).",
        });
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Garante a linha 1 antes do UPDATE: numa instalação em que o seed ainda
      // não rodou, o UPDATE da versão antiga era um no-op silencioso e o admin
      // "salvava" configurações que não iam a lugar nenhum.
      await client.query(
        "INSERT INTO canastra.config_loja (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
      );

      // O `antes` da configuração da LOJA INTEIRA. É a linha que responde "quem
      // desligou o frete grátis?" — a pergunta que a 0035 nomeia, e cuja
      // resposta hoje não existe em lugar nenhum. Travada, para o `antes` ser o
      // valor que ESTE salvamento substituiu.
      const anterior = (
        await client.query(
          `SELECT ${COLUNAS_DO_CONTRATO} FROM canastra.config_loja
            WHERE id = 1 FOR UPDATE`,
        )
      ).rows[0];

      // CADA campo é condicional, não só os banners: um PUT parcial (o painel
      // salvando só o piso do frete grátis, por exemplo) não pode NULAR o
      // título, o WhatsApp e a barra de aviso que não vieram no corpo.
      const atribuicoes = ["atualizado_em = now()"];
      const values = [];
      const atribui = (coluna, valor) => {
        if (ehAusencia(valor)) return;
        values.push(valor);
        atribuicoes.push(`${coluna} = $${values.length}`);
      };

      atribui("titulo_site", site_title);
      atribui("whatsapp", whatsapp_number);
      atribui("barra_de_aviso", announcement_bar);
      atribui("banner_desktop", bannerDesktop);
      atribui("banner_mobile", bannerMobile);
      atribui("frete_gratis_minimo_centavos", freteGratis);

      const atualizado = (
        await client.query(
          `UPDATE canastra.config_loja SET ${atribuicoes.join(", ")} WHERE id = 1
         RETURNING ${COLUNAS_DO_CONTRATO}`,
          values,
        )
      ).rows[0];

      /**
       * O LOG GUARDA SÓ O QUE MUDOU DE FATO, dos dois lados.
       *
       * Este PUT é parcial de um jeito peculiar (campo em branco é ausência,
       * ver acima), então gravar o corpo recebido registraria intenção e não
       * efeito. Comparar a linha antes com a linha depois é o que responde a
       * pergunta que faz esta rota valer um log: "quem zerou o piso do frete
       * grátis?" — um `0` ali libera frete grátis para a loja inteira, e hoje
       * não há em lugar nenhum um registro de quem o escreveu.
       */
      const mudou = {};
      for (const coluna of Object.keys(atualizado)) {
        // `updated_at` é o alias de `atualizado_em`, que muda em TODO
        // salvamento por construção — incluí-lo faria todo PUT parecer uma
        // alteração, inclusive o que não mudou nada.
        if (coluna === "updated_at" || coluna === "id") continue;
        if (String(anterior?.[coluna] ?? "") !== String(atualizado[coluna] ?? "")) {
          mudou[coluna] = true;
        }
      }
      const campos = Object.keys(mudou);

      if (campos.length) {
        await registrar(client, {
          adminUserId: req.user?.userId ?? null,
          acao: ACOES.CONFIG_ALTERADA,
          entidade: ENTIDADES.CONFIG_LOJA,
          // A linha 1, sempre — `entidade_id` é `text` justamente porque nem
          // toda entidade tem uuid, e `config_loja` é o exemplo que a 0035 dá.
          entidadeId: "1",
          antes: Object.fromEntries(campos.map((c) => [c, anterior?.[c] ?? null])),
          depois: Object.fromEntries(campos.map((c) => [c, atualizado[c]])),
        });
      }

      await client.query("COMMIT");
      res.json({ message: "Configurações atualizadas!" });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      // O objeto de erro do pg carrega SQL e nome de coluna; ao navegador vai
      // só a frase, o resto fica no log.
      console.error("updateConfig:", err);
      res.status(500).json({ error: "Erro ao atualizar configs" });
    } finally {
      client.release();
    }
  }
}

module.exports = new ConfigRepository();
