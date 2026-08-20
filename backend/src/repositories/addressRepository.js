const pool = require("../pgPool");
const { v4: uuidv4 } = require("uuid");

/**
 * Endereço de entrega, contra `canastra.enderecos`. Um endereço por cliente,
 * mantido por upsert: o UPDATE tenta primeiro e o INSERT cobre a primeira vez.
 *
 * O contrato HTTP fica em inglês (`zip_code`, `street`...) porque é o que
 * `frontend/lib/sacola/checkout.ts` e o checkout legado já consomem; o mapa
 * para as colunas em português vive nos SELECTs daqui.
 */

const COLUNAS_DO_CONTRATO = `
  endereco_id AS address_id,
  user_id,
  cep         AS zip_code,
  rua         AS street,
  numero      AS "number",
  complemento AS complement,
  bairro      AS neighborhood,
  cidade      AS city,
  estado      AS state,
  criado_em   AS created_at,
  atualizado_em AS updated_at
`;

class AddressRepository {
  async createAddress({
    userId,
    zipCode,
    street,
    number,
    complement,
    neighborhood,
    city,
    state,
  }) {
    // `atualizado_em = now()` é responsabilidade de quem escreve (0004): não
    // há trigger de moddatetime neste schema.
    const { rows: atualizadas } = await pool.query(
      `UPDATE canastra.enderecos
          SET cep = $1, rua = $2, numero = $3, complemento = $4,
              bairro = $5, cidade = $6, estado = $7, atualizado_em = now()
        WHERE user_id = $8::uuid
        RETURNING ${COLUNAS_DO_CONTRATO}`,
      [zipCode, street, number, complement, neighborhood, city, state, userId],
    );
    if (atualizadas.length > 0) return atualizadas[0];

    const { rows: inseridas } = await pool.query(
      `INSERT INTO canastra.enderecos
         (endereco_id, user_id, cep, rua, numero, complemento, bairro, cidade, estado)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${COLUNAS_DO_CONTRATO}`,
      [uuidv4(), userId, zipCode, street, number, complement, neighborhood, city, state],
    );
    return inseridas[0];
  }

  /**
   * Sem catch devolvendo null: um banco fora do ar aqui virava "cliente sem
   * endereço", e o checkout pedia o endereço de novo a quem já o tinha salvo.
   * Erro sobe e o controller responde 500.
   */
  async getAddressByUserId(userId) {
    const { rows } = await pool.query(
      `SELECT ${COLUNAS_DO_CONTRATO} FROM canastra.enderecos
        WHERE user_id = $1::uuid
        ORDER BY atualizado_em DESC
        LIMIT 1`,
      [userId],
    );
    return rows[0];
  }
}

module.exports = new AddressRepository();
