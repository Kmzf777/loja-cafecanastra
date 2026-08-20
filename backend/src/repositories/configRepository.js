const pool = require("../pgPool");

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

  async updateConfig(req, res) {
    const { site_title, whatsapp_number, announcement_bar } = req.body;

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
    if (req.body.frete_gratis_minimo_centavos !== undefined) {
      freteGratis = Number(req.body.frete_gratis_minimo_centavos);
      if (!Number.isInteger(freteGratis) || freteGratis < 0) {
        return res.status(400).json({
          error:
            "frete_gratis_minimo_centavos precisa ser um inteiro em centavos, zero ou maior (zero desliga o frete grátis).",
        });
      }
    }

    try {
      // Garante a linha 1 antes do UPDATE: numa instalação em que o seed ainda
      // não rodou, o UPDATE da versão antiga era um no-op silencioso e o admin
      // "salvava" configurações que não iam a lugar nenhum.
      await pool.query(
        "INSERT INTO canastra.config_loja (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
      );

      // CADA campo é condicional, não só os banners: um PUT parcial (o painel
      // salvando só o piso do frete grátis, por exemplo) não pode NULAR o
      // título, o WhatsApp e a barra de aviso que não vieram no corpo.
      const atribuicoes = ["atualizado_em = now()"];
      const values = [];
      const atribui = (coluna, valor) => {
        if (valor === undefined) return;
        values.push(valor);
        atribuicoes.push(`${coluna} = $${values.length}`);
      };

      atribui("titulo_site", site_title);
      atribui("whatsapp", whatsapp_number);
      atribui("barra_de_aviso", announcement_bar);
      atribui("banner_desktop", bannerDesktop);
      atribui("banner_mobile", bannerMobile);
      atribui("frete_gratis_minimo_centavos", freteGratis);

      await pool.query(
        `UPDATE canastra.config_loja SET ${atribuicoes.join(", ")} WHERE id = 1`,
        values,
      );

      res.json({ message: "Configurações atualizadas!" });
    } catch (err) {
      // O objeto de erro do pg carrega SQL e nome de coluna; ao navegador vai
      // só a frase, o resto fica no log.
      console.error("updateConfig:", err);
      res.status(500).json({ error: "Erro ao atualizar configs" });
    }
  }
}

module.exports = new ConfigRepository();
