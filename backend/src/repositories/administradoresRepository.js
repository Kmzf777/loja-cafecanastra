"use strict";

const pool = require("../pgPool");
const { ehUuid } = require("../utils/formatoUuid");
const { registrar, ACOES, ENTIDADES } = require("../services/adminLog");

/**
 * Quem administra a loja — listar, promover e remover.
 *
 * ATÉ AQUI NÃO HAVIA CAMINHO NENHUM. A única escrita em `canastra.admins` no
 * repositório está no script de instalação (`db/seed.js`), e promover o segundo
 * gestor exigia abrir `psql` em PRODUÇÃO. Não é um recurso que faltava: é a
 * operação mais sensível da loja acontecendo fora de qualquer registro.
 *
 * A ESCRITA É SÓ DAQUI, e isso é herança de 0003:269 + 0035: `authenticated`
 * não tem INSERT/UPDATE/DELETE em `canastra.admins` e não há política de
 * escrita — as duas camadas negam, que é como tem de ser na tabela onde o
 * estrago é maior (um `UPDATE admins SET papel='dono' WHERE user_id=auth.uid()`
 * seria a auto-promoção que aquele REVOKE existe para impedir). O pool do
 * Express conecta como dono e passa; o porteiro é `isAdmin` na rota.
 */

/**
 * A lista fechada de `admins.papel` (0035), conferida ANTES do banco.
 *
 * O CHECK `admins_papel_valido` recusaria com 23514, que na tela vira "Erro
 * interno". A lista mapeia as telas que existem, e não uma hierarquia
 * inventada: `dono` (tudo, inclusive dinheiro), `gerente` (catálogo, promoção e
 * pedido) e `operador` (expedição, sem ver custo nem margem).
 */
const PAPEIS = Object.freeze(["dono", "gerente", "operador"]);

/**
 * A IRMÃ da `MENSAGEM_ULTIMO_ADMIN` de `conta.routes.js`, e é irmã e não cópia
 * de propósito: as duas barram o MESMO estado (a loja sem administrador), mas
 * pela porta oposta. Lá o gesto é apagar a CONTA, e a frase manda cadastrar
 * outro administrador antes de excluir-se; aqui o gesto é tirar o PAPEL, a
 * conta continua existindo, e "exclua sua conta" seria um conselho errado.
 * Mesmo diagnóstico, conserto diferente — texto diferente.
 */
const MENSAGEM_ULTIMO_ADMIN =
  "Esta é a única pessoa que administra a loja. Promova outro administrador " +
  "antes de remover este.";

class AdministradoresRepository {
  /**
   * A lista, com NOME e E-MAIL — não só o uuid.
   *
   * Um painel que mostrasse `dddddddd-0000-…` numa tela de "quem pode mexer na
   * loja" obrigaria a cruzar uuid com pessoa na mão, que é exatamente o gesto
   * que ninguém faz antes de clicar em remover. O e-mail vem de `auth.users`:
   * o pool conecta como dono do banco e lê `auth` sem cerimônia.
   */
  async listar() {
    const { rows } = await pool.query(
      `SELECT a.user_id, a.papel, a.criado_em,
              c.nome, u.email
         FROM canastra.admins a
         JOIN canastra.clientes c ON c.user_id = a.user_id
         LEFT JOIN auth.users u   ON u.id      = a.user_id
        ORDER BY a.criado_em ASC`,
    );
    return rows;
  }

  /**
   * Promove um CLIENTE DESTA LOJA.
   *
   * A cerca do "desta loja" é a mesma de `excluirClientePeloAdmin`: a instância
   * Supabase é COMPARTILHADA, e um uuid com conta em outro projeto da VPS
   * chegaria aqui com forma perfeita. A FK de `admins` para `clientes` já
   * recusaria com 23503 — a conferência antes existe para a resposta ser 404
   * com frase em vez de 500 com código de erro do Postgres.
   */
  async promover({ userId, papel = "dono", adminUserId }) {
    if (!ehUuid(userId)) {
      const erro = new Error("Identificador de administrador inválido.");
      erro.status = 400;
      throw erro;
    }
    if (!PAPEIS.includes(papel)) {
      const erro = new Error(`Papel inválido. Use um de: ${PAPEIS.join(", ")}.`);
      erro.status = 400;
      throw erro;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: conferencia } = await client.query(
        `SELECT
           EXISTS (SELECT 1 FROM canastra.clientes WHERE user_id = $1) AS eh_cliente,
           EXISTS (SELECT 1 FROM canastra.admins   WHERE user_id = $1) AS ja_eh_admin`,
        [userId],
      );
      if (!conferencia[0].eh_cliente) {
        const erro = new Error("Cliente não encontrado nesta loja.");
        erro.status = 404;
        throw erro;
      }
      if (conferencia[0].ja_eh_admin) {
        // 409 e não 200: o pedido está correto, é o estado que não deixa. Um
        // 200 mudo faria a tela anunciar uma promoção que não aconteceu — e o
        // papel de quem já é admin ficaria em silêncio no valor antigo.
        const erro = new Error("Esta pessoa já é administradora da loja.");
        erro.status = 409;
        throw erro;
      }

      const { rows } = await client.query(
        `INSERT INTO canastra.admins (user_id, papel)
         VALUES ($1::uuid, $2)
         RETURNING user_id, papel, criado_em`,
        [userId, papel],
      );

      await registrar(client, {
        adminUserId,
        acao: ACOES.ADMIN_PROMOVIDO,
        entidade: ENTIDADES.ADMIN,
        entidadeId: userId,
        // Criação tem só `depois` — é uma das três formas legítimas que a 0035
        // deixou sem CHECK de "pelo menos um".
        depois: { papel },
      });

      await client.query("COMMIT");
      return rows[0];
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      throw erro;
    } finally {
      client.release();
    }
  }

  /**
   * Remove, e AVISA ANTES DE TENTAR quando é o último.
   *
   * O trigger `admins_nunca_zero` (0002:118) recusa com 23001, e uma exceção do
   * Postgres subindo daqui viraria "Erro interno no servidor." — a frase de
   * servidor quebrado para uma regra de negócio que tem nome e conserto ("promova
   * outro antes"). A contagem vem na MESMA transação e com a linha travada:
   * conferir fora dela deixaria a corrida em que dois gestores removem um ao
   * outro ao mesmo tempo, e aí o 23001 é a última linha de defesa — por isso o
   * `catch` abaixo continua traduzindo o código, em vez de confiar na contagem.
   */
  async remover({ userId, adminUserId }) {
    if (!ehUuid(userId)) {
      const erro = new Error("Identificador de administrador inválido.");
      erro.status = 400;
      throw erro;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const alvo = await client.query(
        "SELECT user_id, papel FROM canastra.admins WHERE user_id = $1 FOR UPDATE",
        [userId],
      );
      if (!alvo.rows.length) {
        const erro = new Error("Esta pessoa não é administradora da loja.");
        erro.status = 404;
        throw erro;
      }

      const total = Number(
        (await client.query("SELECT count(*) FROM canastra.admins")).rows[0].count,
      );
      if (total <= 1) {
        const erro = new Error(MENSAGEM_ULTIMO_ADMIN);
        erro.status = 409;
        erro.chave = "message";
        throw erro;
      }

      await client.query("DELETE FROM canastra.admins WHERE user_id = $1", [userId]);

      await registrar(client, {
        adminUserId,
        acao: ACOES.ADMIN_REMOVIDO,
        entidade: ENTIDADES.ADMIN,
        entidadeId: userId,
        // Remoção tem só `antes`: é o que responde "que papel essa pessoa
        // tinha?" depois que a linha já não existe.
        antes: { papel: alvo.rows[0].papel },
      });

      await client.query("COMMIT");
      return { user_id: userId };
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      if (erro.code === "23001") {
        const traduzido = new Error(MENSAGEM_ULTIMO_ADMIN);
        traduzido.status = 409;
        traduzido.chave = "message";
        throw traduzido;
      }
      throw erro;
    } finally {
      client.release();
    }
  }
}

module.exports = new AdministradoresRepository();
module.exports.PAPEIS = PAPEIS;
module.exports.MENSAGEM_ULTIMO_ADMIN = MENSAGEM_ULTIMO_ADMIN;
