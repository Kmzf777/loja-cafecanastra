"use strict";

const pool = require("../pgPool");

/**
 * O CPF (e o NOME) DA CONTA, num lugar só.
 *
 * Esta função morou dentro do PaymentController até a revisão transversal da
 * F7. Ela saiu de lá porque ganhou um SEGUNDO chamador — a adesão do Clube
 * (POST /clube/assinar) —, e a alternativa era copiar quinze linhas que
 * decidem dado fiscal: o dia em que o UNIQUE de `clientes.cpf` (0002) mudasse
 * de recusa, ou o dia em que a loja passasse a aceitar CNPJ, uma das cópias
 * ficaria para trás em silêncio. O checkout continua com o comportamento
 * IDÊNTICO ao de antes da extração — a suíte dele é o juiz.
 *
 * POR QUE OS DOIS CHAMADORES PRECISAM DELA
 *   · o checkout, porque o Mercado Pago exige `payer.identification` e a
 *     entrega precisa de um destinatário identificado;
 *   · o Clube, porque toda cobrança recorrente vira pedido de venda no Bling e
 *     `garantirContatoNoBling` recusa (422) pedido sem CPF — um assinante sem
 *     CPF geraria pedidos insincronizáveis, sem NF-e, para sempre.
 *
 * DOIS EXPORTS, UMA CONSULTA
 *   O checkout também precisa do NOME do cliente (para `payer.first_name` /
 *   `last_name` que vão ao antifraude do Mercado Pago), e até a revisão que
 *   trouxe este comentário ele lia isso com uma SEGUNDA query — mesma tabela,
 *   mesma linha, mesmo request, só para não alargar o contrato de
 *   `garantirCpf` (ver abaixo por que isso importava). Dois round-trips onde
 *   um bastava, no hot path do checkout.
 *
 *   `garantirCpfENome` é a função de verdade: faz UMA consulta, com as duas
 *   colunas, e devolve `{ cpf, nome }`. `garantirCpf` é um WRAPPER FINO sobre
 *   ela — chama `garantirCpfENome` e devolve só o `cpf` — para o Clube, que
 *   só precisa do CPF, continuar vendo exatamente o contrato de sempre. Nada
 *   no comportamento do Clube muda: mesma persistência, mesmo 23505 virando
 *   400, mesmo valor de retorno.
 *
 * O CONTRATO DE `garantirCpf` (inalterado, é o que o Clube usa)
 *   garantirCpf(userId, identification) => Promise<string | null>
 *
 * O CONTRATO DE `garantirCpfENome` (o que o checkout usa)
 *   garantirCpfENome(userId, identification) => Promise<{ cpf: string | null, nome: string | null }>
 *
 *   Nos dois, `identification` é o objeto do Mercado Pago (`{ type, number }`)
 *   porque foi dele que a função nasceu e é ele que o checkout tem em mãos;
 *   quem só tem o número passa `{ number: cpf }` (o `type` assume "CPF").
 *
 *   CPF de 11 dígitos no argumento é PERSISTIDO antes de qualquer conferência —
 *   e a partir daí a conta tem CPF para sempre, que é o que faz a próxima
 *   compra (e a próxima adesão) não pedirem o número de novo. Qualquer outra
 *   coisa (vazio, curto, CNPJ) é ignorada em silêncio: a função devolve o CPF
 *   (e o nome) que a conta JÁ tinha, ou `null` para os dois.
 *
 *   `cpf: null` (ou o `garantirCpf` que devolve `null` puro) significa "esta
 *   conta não tem CPF nenhum" — e é o chamador que decide a frase e o código
 *   HTTP disso, porque o checkout e o Clube recusam com textos diferentes.
 *
 *   LANÇA com `status = 400` e `codigoPublico = "CPF_EM_USO"` quando o número
 *   já pertence a outra conta (23505 do UNIQUE de 0002). Um 500 sem explicação
 *   ali seria a pior resposta possível: quem digitou o CPF do irmão precisa
 *   saber que é isso, não "tente de novo".
 */
async function garantirCpfENome(userId, identification) {
  const tipo = String(identification?.type || "CPF").toUpperCase();
  const digitos = String(identification?.number || "").replace(/\D/g, "");

  if (tipo === "CPF" && digitos.length === 11) {
    try {
      await pool.query(
        "UPDATE canastra.clientes SET cpf = $1 WHERE user_id = $2::uuid",
        [digitos, userId],
      );
    } catch (err) {
      if (err.code === "23505") {
        // O UNIQUE de `clientes.cpf` (0002): este numero ja pertence a outra
        // conta. Recusar com frase e melhor que um 500 sem explicacao.
        const erro = new Error("Este CPF já está cadastrado em outra conta.");
        erro.status = 400;
        erro.codigoPublico = "CPF_EM_USO";
        throw erro;
      }
      throw err;
    }
  }

  const { rows } = await pool.query(
    "SELECT cpf, nome FROM canastra.clientes WHERE user_id = $1::uuid",
    [userId],
  );
  return rows.length
    ? { cpf: rows[0].cpf, nome: rows[0].nome }
    : { cpf: null, nome: null };
}

/**
 * Wrapper fino sobre `garantirCpfENome`, para o Clube — que só quer o CPF —
 * continuar vendo o contrato de sempre: `Promise<string | null>`.
 */
async function garantirCpf(userId, identification) {
  const { cpf } = await garantirCpfENome(userId, identification);
  return cpf;
}

module.exports = { garantirCpf, garantirCpfENome };
