"use strict";

/**
 * Lembrete de carrinho abandonado.
 *
 * O QUE CONTA COMO ABANDONO: carrinho COM itens cuja última atividade
 * (`carrinhos.atualizado_em`) tem mais de ABANDONO_HORAS (default 24) e menos
 * de 7 dias, dono com e-mail no GoTrue e SEM lembrete anterior. Quem mantém
 * `atualizado_em` é a RPC `fundir_sacola` (0007), que roda a cada login — a
 * única escritora do carrinho do servidor nesta fase (`carrinho_itens` não tem
 * timestamp nenhum, 0004, e a sacola do dia a dia vive no localStorage). Ou
 * seja: pessoa entrou, a sacola fundiu, e ninguém comprou — o checkout APAGA
 * os itens, então carrinho com itens parado é venda que quase aconteceu.
 *
 * A janela de 7 dias é o outro lado da mesma moeda: religar o job depois de
 * um mês desligado NÃO pode despejar lembrete de sacola arqueológica — isso é
 * spam, não recuperação de venda.
 *
 * UM LEMBRETE POR EPISÓDIO DE ABANDONO — não por cliente para sempre: a marca
 * `lembrete_enviado_em` é gravada com `WHERE lembrete_enviado_em IS NULL`
 * (rowCount 0 = outra execução chegou antes), o e-mail sai com a marca ainda
 * não commitada, e falha no envio faz ROLLBACK — a marca volta a NULL e a
 * próxima hora tenta de novo. O episódio TERMINA NA COMPRA: o checkout
 * (`limparCarrinho`, PaymentController) apaga os itens e zera a marca, então
 * quem comprou e depois abandonou OUTRA sacola volta a ser elegível — uma
 * sacola nova é um abandono novo.
 *
 * A GARANTIA É AT-LEAST-ONCE, NÃO EXACTLY-ONCE, e o comentário assume isso em
 * vez de prometer demais: se o processo morrer na janela entre o envio
 * aceito pelo Resend e o COMMIT, a marca se perde com a conexão e a próxima
 * hora REENVIA — lembrete duplicado, raro e tolerável. O lado que a transação
 * garante de verdade é o outro, o que importa: nunca "lembrado sem e-mail"
 * (marca commitada só depois de o envio responder) e nunca dois envios por
 * duas execuções CONCORRENTES (a marca condicional serializa).
 *
 * DESVIO CONSCIENTE DA REGRA DA CASA: há uma chamada de REDE (o e-mail)
 * dentro da transação aberta — exatamente o que o checkout gasta comentários
 * proibindo. A diferença que paga o desvio: a trava aqui é a linha de UM
 * carrinho de UM cliente, que nenhum outro fluxo disputa (o checkout do
 * próprio dono esperaria alguns segundos no pior caso raríssimo); no
 * checkout, a trava era a prateleira inteira. Foi trocado deliberadamente:
 * prender uma linha fria por segundos compra a garantia de "nunca marcado
 * sem enviado", que vale mais.
 *
 * O cron NÃO liga sozinho: `iniciarCronDeAbandono()` só é chamado pelo
 * index.js quando ABANDONO_ATIVO=true (decisão 5 do plano mestre — integração
 * nova nasce desligada). Em teste, o cron nunca roda: `enviarLembretes` e
 * `selecionarAbandonados` são exercidas direto, com o envio injetado.
 */

const pool = require("../pgPool");

/** Horas de sacola parada antes de lembrar. Fora do range plausível, volta ao default. */
function horasConfiguradas(ambiente = process.env) {
  const n = Number(ambiente.ABANDONO_HORAS);
  return Number.isInteger(n) && n >= 1 && n <= 24 * 7 ? n : 24;
}

/**
 * Os carrinhos que merecem lembrete AGORA. Consulta pura (sem trava): a
 * decisão final é da marca condicional dentro da transação de envio — entre a
 * seleção e o UPDATE outra execução pode ter lembrado, e tudo bem.
 */
async function selecionarAbandonados(conexao, horas) {
  const { rows } = await conexao.query(
    `SELECT c.carrinho_id,
            c.user_id,
            u.email,
            COALESCE(cl.nome, 'Cliente') AS nome,
            json_agg(json_build_object(
              'nome', ci.nome,
              'quantidade', ci.quantidade
            )) AS itens
       FROM canastra.carrinhos c
       JOIN canastra.carrinho_itens ci ON ci.carrinho_id = c.carrinho_id
       JOIN auth.users u               ON u.id = c.user_id
       LEFT JOIN canastra.clientes cl  ON cl.user_id = c.user_id
      WHERE c.lembrete_enviado_em IS NULL
        AND u.email IS NOT NULL
        AND c.atualizado_em <= now() - make_interval(hours => $1)
        AND c.atualizado_em >  now() - interval '7 days'
      GROUP BY c.carrinho_id, c.user_id, u.email, cl.nome
      ORDER BY c.atualizado_em`,
    [horas],
  );
  return rows;
}

/**
 * Uma rodada completa: seleciona, e para cada carrinho marca-e-envia numa
 * transação própria. Transação POR CARRINHO, não uma para o lote: o Resend
 * recusando o e-mail 7 não pode desfazer os 6 lembretes que já saíram.
 *
 * `enviar` é injetável para teste; em produção é o sendCartReminderEmail do
 * Resend (require tardio, para o teste do job nem carregar o mailer).
 */
async function enviarLembretes({ conexao = pool, horas, enviar } = {}) {
  const horasEfetivas = horas ?? horasConfiguradas();
  const enviarEfetivo =
    enviar ?? require("../utils/emailSender").sendCartReminderEmail;

  const candidatos = await selecionarAbandonados(conexao, horasEfetivas);
  let enviados = 0;

  for (const carrinho of candidatos) {
    const client = await conexao.connect();
    try {
      await client.query("BEGIN");

      // A marca condicional É a eleição de quem envia. De propósito NÃO
      // escreve `atualizado_em`: aquela coluna responde "quando o CLIENTE
      // mexeu por último" e é o critério da própria seleção — o lembrete não
      // é atividade do cliente. (Desvio consciente da regra geral de 0005;
      // a coluna não mente porque este UPDATE não altera a sacola.)
      const marca = await client.query(
        `UPDATE canastra.carrinhos
            SET lembrete_enviado_em = now()
          WHERE carrinho_id = $1
            AND lembrete_enviado_em IS NULL`,
        [carrinho.carrinho_id],
      );
      if (marca.rowCount === 0) {
        await client.query("ROLLBACK");
        continue;
      }

      // O envio acontece COM a marca pendente: se lançar, o catch abaixo
      // desfaz a marca e a próxima hora tenta de novo.
      await enviarEfetivo({
        email: carrinho.email,
        nome: carrinho.nome,
        itens: carrinho.itens,
      });

      await client.query("COMMIT");
      enviados += 1;
    } catch (erro) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(
        `Lembrete do carrinho ${carrinho.carrinho_id} não saiu (fica para a próxima hora):`,
        erro.message,
      );
    } finally {
      client.release();
    }
  }

  return { candidatos: candidatos.length, enviados };
}

/**
 * Liga o cron de hora em hora. Chamado SÓ pelo index.js, SÓ com
 * ABANDONO_ATIVO=true. O catch é a rede do processo: uma rodada quebrada
 * (banco reiniciando, por exemplo) loga e espera a próxima — um job de
 * lembrete jamais derruba a loja.
 */
function iniciarCronDeAbandono() {
  const cron = require("node-cron");
  const horas = horasConfiguradas();
  cron.schedule("0 * * * *", () => {
    enviarLembretes({ horas })
      .then(({ candidatos, enviados }) => {
        if (candidatos > 0) {
          console.log(
            `Carrinho abandonado: ${enviados}/${candidatos} lembrete(s) enviados.`,
          );
        }
      })
      .catch((erro) => {
        console.error("Rodada de carrinho abandonado falhou:", erro.message);
      });
  });
  console.log(
    `Carrinho abandonado LIGADO: lembrete após ${horas}h de sacola parada, verificação de hora em hora.`,
  );
}

module.exports = {
  selecionarAbandonados,
  enviarLembretes,
  iniciarCronDeAbandono,
  horasConfiguradas,
};
