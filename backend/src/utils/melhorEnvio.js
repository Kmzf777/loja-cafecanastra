"use strict";

/**
 * POR QUE A COTAÇÃO FALHOU — a pergunta que o log não respondia.
 *
 * O `ShippingController` logava `apiError.message`, e o que saía era
 * `Erro na API Melhor Envio: Request failed with status code 403`. Três causas
 * completamente diferentes produzem exatamente essa linha:
 *
 *   · o IP do servidor bloqueado no firewall do Melhor Envio (E-WAF-0003);
 *   · o token errado, expirado, ou de sandbox usado contra produção;
 *   · o CEP de origem malformado no `.env`.
 *
 * A primeira se resolve com o suporte do Melhor Envio, a segunda no painel de
 * aplicações, a terceira editando uma variável. **Nenhuma delas se resolve
 * olhando a outra** — e essa ambiguidade cobrou o preço dela em 16/09/2026: a
 * loja passou dias sem vender com "403" no log, e a suspeita natural (token
 * vencido) era a errada. Quando um token novo foi gerado, em 17/09, o 403
 * continuou — porque o bloqueio nunca tinha sido de credencial.
 *
 * O comentário do próprio `ShippingController` já avisava, sobre o CEP de
 * origem: *"o modo de falha é mudo do lado errado (…) e o log só ecoa o que a
 * API respondeu, sem apontar o `.env` como culpado. Custa uma linha fechar essa
 * porta; custa uma tarde descobrir por que ela estava aberta."* Este módulo é
 * essa linha, para as três portas.
 *
 * A REGRA MAIS ÚTIL DAQUI É A MAIS SIMPLES: **a API responde JSON.** Se voltou
 * HTML, quem respondeu não foi a API — foi a borda (firewall, balanceador,
 * página de manutenção), e discutir token nesse caso é procurar no lugar
 * errado. Medido em 17/09/2026: `sandbox.melhorenvio.com.br` devolve uma página
 * HTML com `E-WAF-0003` para o IP desta VPS, inclusive na home e inclusive sem
 * token nenhum.
 */

/** O código que o Melhor Envio usa para bloqueio de dispositivo/IP. */
const CODIGO_DE_BLOQUEIO = /E-WAF-\d+/;

/** Parece página em vez de resposta de API? */
function ehHtml(corpo) {
  if (typeof corpo !== "string") return false;
  return /^\s*<(!doctype|html)/i.test(corpo);
}

/**
 * Classifica a falha e devolve `{ causa, mensagem }`.
 *
 * `causa` é para o código (um dia pode virar métrica ou decisão); `mensagem` é
 * para a pessoa que vai ler o log às duas da manhã, e por isso ela diz também
 * o que **não** adianta fazer — trocar o token quando o problema é o IP é a
 * tentativa óbvia, e a que custa a noite.
 *
 * NUNCA LANÇA: uma função que existe para explicar erro não pode ser a próxima
 * causa de erro.
 */
function diagnosticarFalhaDeCotacao(erro) {
  const status = erro?.response?.status;
  const corpo = erro?.response?.data;
  const mensagemCrua = String(erro?.message || erro || "erro sem mensagem");

  const corpoTexto = typeof corpo === "string" ? corpo : "";
  const bloqueio = corpoTexto.match(CODIGO_DE_BLOQUEIO)?.[0];

  if (bloqueio) {
    return {
      causa: "ip-bloqueado",
      mensagem:
        `o Melhor Envio BLOQUEOU o IP deste servidor (${bloqueio}). ` +
        "Não é o token, e gerar um novo não resolve: a resposta é a mesma sem " +
        "credencial nenhuma. Peça a liberação ao suporte do Melhor Envio " +
        "informando o IP público desta máquina — ou use o host de produção, se " +
        "o bloqueio for só do sandbox.",
    };
  }

  if (ehHtml(corpoTexto)) {
    return {
      causa: "borda",
      mensagem:
        `o Melhor Envio respondeu uma PÁGINA HTML (status ${status ?? "?"}), não a API. ` +
        "Quem respondeu foi a borda deles — firewall, balanceador ou manutenção. " +
        "Procurar o problema no token ou no payload é procurar no lugar errado.",
    };
  }

  if (status === 401 || status === 403) {
    return {
      causa: "token",
      mensagem:
        `o Melhor Envio recusou a credencial (HTTP ${status}). Confira ` +
        "MELHOR_ENVIO_TOKEN: vencido, revogado, sem o escopo `shipping-calculate`, " +
        "ou de sandbox apontando para produção (e vice-versa — o par token/URL " +
        "tem de ser do MESMO ambiente, e MELHOR_ENVIO_URL é quem decide o ambiente).",
    };
  }

  if (status === 422 || status === 400) {
    return {
      causa: "dados",
      mensagem:
        `o Melhor Envio recusou os DADOS da cotação (HTTP ${status}). O suspeito ` +
        "número um é ZIPCODE_ORIGIN: um CEP escrito como \"38.402-330\" faz a " +
        "cotação inteira ser recusada. Depois dele, peso e dimensões do produto. " +
        `Resposta: ${JSON.stringify(corpo ?? "").slice(0, 300)}`,
    };
  }

  if (erro?.code === "ECONNABORTED" || /timeout/i.test(mensagemCrua)) {
    return {
      causa: "tempo",
      mensagem:
        `o Melhor Envio não respondeu no tempo (${mensagemCrua}). O sandbox deles ` +
        "já foi lento antes; em produção, desconfie da rede da VPS.",
    };
  }

  if (
    erro?.code === "ECONNREFUSED" ||
    erro?.code === "ENOTFOUND" ||
    erro?.code === "EAI_AGAIN"
  ) {
    return {
      causa: "rede",
      mensagem:
        `não foi possível ALCANÇAR o Melhor Envio (${erro.code}). Confira ` +
        "MELHOR_ENVIO_URL e a saída de rede desta máquina. Nos testes isto é " +
        "esperado: a porta fechada 127.0.0.1:9 existe justamente para provar " +
        "que nenhum caminho depende da rede.",
    };
  }

  return {
    causa: "desconhecida",
    mensagem: `o Melhor Envio falhou de um jeito não catalogado: ${mensagemCrua}`,
  };
}

module.exports = { diagnosticarFalhaDeCotacao };
