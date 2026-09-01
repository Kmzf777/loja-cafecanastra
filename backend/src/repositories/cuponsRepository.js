const pool = require("../pgPool");

/**
 * Cupons, contra `canastra.cupons` (0010).
 *
 * Diferente dos repositórios herdados do painel legado, o contrato HTTP dos
 * cupons foi fixado JÁ em português (plano mestre, onda 2F): as colunas do
 * banco e os campos do JSON coincidem, então não há mapa de alias aqui.
 *
 * NENHUM MÉTODO ENGOLE ERRO — mesma regra de ordersRepository: erro sobe,
 * vira resposta no controller e aparece no log.
 */

const COLUNAS = `
  id, codigo, tipo, valor, descricao, minimo_centavos,
  limite_usos, usos, ativo, inicio_em, fim_em
`;

class CuponsRepository {
  /**
   * O cupom de um código, exatamente como gravado. Quem chama já normalizou
   * (trim + maiúsculo): a busca é por igualdade e o CHECK de 0010 garante que
   * só existe maiúsculo no banco.
   */
  async buscarPorCodigo(codigo, client = pool) {
    const { rows } = await client.query(
      `SELECT ${COLUNAS} FROM canastra.cupons WHERE codigo = $1 LIMIT 1`,
      [codigo],
    );
    return rows[0];
  }

  /** A lista do painel, mais novo primeiro. */
  async listar() {
    const { rows } = await pool.query(
      `SELECT ${COLUNAS} FROM canastra.cupons ORDER BY criado_em DESC`,
    );
    return rows;
  }

  /**
   * Cria e devolve a linha. Código repetido estoura 23505 — o controller traduz.
   *
   * `client` OPCIONAL pelo mesmo motivo de `reservarUso` logo abaixo, e desde a
   * Onda 4 por mais um: o controller abre uma transação para gravar o cupom e a
   * linha de `admin_log` juntos. Sem o parâmetro, o INSERT sairia commitado
   * sozinho e o registro de quem criou a campanha ficaria numa transação
   * separada — que é a que pode falhar.
   */
  async criar({
    codigo,
    tipo,
    valor,
    descricao = null,
    minimoCentavos = 0,
    limiteUsos = null,
    inicioEm = null,
    fimEm = null,
    client = pool,
  }) {
    const { rows } = await client.query(
      `INSERT INTO canastra.cupons
         (codigo, tipo, valor, descricao, minimo_centavos, limite_usos, inicio_em, fim_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLUNAS}`,
      [codigo, tipo, valor, descricao, minimoCentavos, limiteUsos, inicioEm, fimEm],
    );
    return rows[0];
  }

  /**
   * Atualização PARCIAL: só as colunas presentes em `campos` mudam. O SET é
   * montado de uma lista fechada de colunas — nada do corpo da requisição
   * vira nome de coluna, então não há injeção por chave.
   *
   * `usos` NÃO é editável por aqui de propósito: o contador pertence ao
   * checkout (reservarUso/devolverUso); um painel que o reescrevesse zeraria
   * a trava de esgotamento sem querer.
   */
  async atualizar(id, campos, client = pool) {
    const EDITAVEIS = {
      codigo: "codigo",
      tipo: "tipo",
      valor: "valor",
      descricao: "descricao",
      minimo_centavos: "minimo_centavos",
      limite_usos: "limite_usos",
      ativo: "ativo",
      inicio_em: "inicio_em",
      fim_em: "fim_em",
    };

    const sets = [];
    const valores = [];
    for (const [chave, coluna] of Object.entries(EDITAVEIS)) {
      if (chave in campos) {
        valores.push(campos[chave]);
        sets.push(`${coluna} = $${valores.length}`);
      }
    }
    if (sets.length === 0) return this.buscarPorId(id);

    // Regra de 0004/0005: não há trigger de moddatetime — quem escreve carimba.
    sets.push("atualizado_em = now()");
    valores.push(id);

    const { rows } = await client.query(
      `UPDATE canastra.cupons SET ${sets.join(", ")}
        WHERE id = $${valores.length}::uuid
        RETURNING ${COLUNAS}`,
      valores,
    );
    return rows[0];
  }

  async buscarPorId(id) {
    const { rows } = await pool.query(
      `SELECT ${COLUNAS} FROM canastra.cupons WHERE id = $1::uuid`,
      [id],
    );
    return rows[0];
  }

  /**
   * A TRAVA DO ESGOTAMENTO. Incremento atômico: a MESMA linha de SQL que soma
   * o uso é a que confere o limite, então dois checkouts simultâneos no último
   * uso serializam na linha do cupom e o segundo recebe `false` — antes de
   * cobrar, porque isto roda DENTRO da transação de reserva de estoque do
   * checkout (por isso `client` é obrigatório: rodar no pool deixaria o
   * incremento fora do ROLLBACK que devolve a reserva).
   */
  async reservarUso(id, client) {
    const { rowCount } = await client.query(
      `UPDATE canastra.cupons
          SET usos = usos + 1, atualizado_em = now()
        WHERE id = $1::uuid
          AND ativo
          AND (limite_usos IS NULL OR usos < limite_usos)`,
      [id],
    );
    return rowCount === 1;
  }

  /**
   * Compensação: devolve um uso reservado quando a cobrança não saiu (mesma
   * família de `devolverEstoque` no PaymentController — UPDATE solto, cada um
   * commita sozinho, porque compensação não pode depender de uma transação
   * que talvez já tenha morrido). O `WHERE usos > 0` protege o CHECK de 0010:
   * uma devolução a mais vira no-op, não 23514.
   */
  async devolverUso(id, conexao = pool) {
    try {
      await conexao.query(
        `UPDATE canastra.cupons
            SET usos = usos - 1, atualizado_em = now()
          WHERE id = $1::uuid AND usos > 0`,
        [id],
      );
    } catch (err) {
      // Perder a devolução não pode derrubar o resto da compensação; fica no
      // log como divergência de contador para conferência manual.
      console.error(`CUPOM: falha ao devolver uso do cupom ${id}:`, err.message);
    }
  }

  /**
   * A variante do WEBHOOK: mesma devolução, por CÓDIGO (o pedido guarda a
   * fotografia `cupom_codigo`, não o id) e SEM engolir erro — o oposto
   * deliberado de `devolverUso`. Lá, engolir é correto porque a compensação
   * roda fora de transação e não pode abortar as irmãs; aqui a devolução vive
   * DENTRO da transação do webhook, e um erro engolido dentro de transação
   * envenena tudo que vier depois (25P02) além de commitar meia-verdade — o
   * erro tem de subir, virar ROLLBACK + 500, e o MP reenvia.
   *
   * Devolve `false` (sem lançar) quando nenhuma linha casou: cupom renomeado
   * depois da venda ou contador já em zero. Isso não é falha da transição de
   * status — quem chama loga a divergência e segue.
   */
  async devolverUsoPorCodigo(codigo, client) {
    const { rowCount } = await client.query(
      `UPDATE canastra.cupons
          SET usos = usos - 1, atualizado_em = now()
        WHERE codigo = $1 AND usos > 0`,
      [codigo],
    );
    return rowCount === 1;
  }
}

module.exports = new CuponsRepository();
