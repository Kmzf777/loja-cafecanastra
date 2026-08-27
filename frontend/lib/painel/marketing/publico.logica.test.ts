import { describe, it, expect } from "vitest";

import {
  LIMITE_DA_MENSAGEM,
  RESSALVAS_DO_DISPARADOR,
  URL_DO_DISPARADOR,
  contarExclusoes,
  montarPayloadDoDisparo,
  montarPublico,
  numeroParaDisparo,
  validarDisparo,
} from "./publico.logica";
import type { Consentimento } from "./consentimentos.logica";

let contador = 0;

function linha(sobrescreve: Partial<Consentimento> = {}): Consentimento {
  contador += 1;
  return {
    id: `cccccccc-cccc-cccc-cccc-${String(contador).padStart(12, "0")}`,
    user_id: null,
    email: `pessoa${contador}@exemplo.com`,
    telefone: "(35) 99999-8888",
    canal: "whatsapp",
    estado: "concedido",
    origem: "rodapé do site",
    texto_aceito: null,
    ip: null,
    criado_em: "2026-01-10T12:00:00.000Z",
    ...sobrescreve,
  };
}

/* ========================================================================== *
 * O número
 * ========================================================================== */

describe("numeroParaDisparo", () => {
  it("celular com DDD ganha o 55", () => {
    expect(numeroParaDisparo("(35) 99999-8888")).toBe("5535999998888");
    expect(numeroParaDisparo("35999998888")).toBe("5535999998888");
  });

  it("fixo com DDD (10 dígitos) também ganha o 55", () => {
    expect(numeroParaDisparo("3533211234")).toBe("553533211234");
  });

  it("quem já tem o 55 não ganha outro", () => {
    expect(numeroParaDisparo("5535999998888")).toBe("5535999998888");
    expect(numeroParaDisparo("+55 (35) 99999-8888")).toBe("5535999998888");
    expect(numeroParaDisparo("553533211234")).toBe("553533211234");
  });

  it("pontuação, espaço e o + são ignorados", () => {
    expect(numeroParaDisparo(" +55 35 9.9999-8888 ")).toBe("5535999998888");
  });

  /**
   * A RECUSA É O PONTO DESTA FUNÇÃO. Adivinhar o DDD de um número de 9 dígitos
   * produz um número VÁLIDO que pertence a OUTRA PESSOA — e o disparador aceita
   * qualquer coisa e não devolve quem não existe, então o erro é invisível.
   */
  it("menos de 10 dígitos é recusado — inventar DDD é escrever para outra pessoa", () => {
    expect(numeroParaDisparo("999998888")).toBeNull();
    expect(numeroParaDisparo("8888")).toBeNull();
  });

  it("mais de 13 dígitos é recusado, e não truncado", () => {
    expect(numeroParaDisparo("5535999998888999")).toBeNull();
  });

  it("12 ou 13 dígitos SEM o 55 na frente é recusado — não é número daqui", () => {
    expect(numeroParaDisparo("442071234567")).toBeNull();
    expect(numeroParaDisparo("1234567890123")).toBeNull();
  });

  it("vazio, nulo e texto sem dígito viram null", () => {
    expect(numeroParaDisparo("")).toBeNull();
    expect(numeroParaDisparo(null)).toBeNull();
    expect(numeroParaDisparo(undefined)).toBeNull();
    expect(numeroParaDisparo("sem número")).toBeNull();
  });
});

/* ========================================================================== *
 * O público
 * ========================================================================== */

describe("montarPublico", () => {
  it("inclui quem consente hoje, com o número pronto para o disparador", () => {
    const publico = montarPublico([
      linha({ email: "ana@ex.com", telefone: "35999998888" }),
    ]);
    expect(publico.total).toBe(1);
    expect(publico.incluidos[0].numero).toBe("5535999998888");
    expect(publico.incluidos[0].identificacao).toBe("ana@ex.com");
    expect(publico.excluidos).toEqual([]);
  });

  /**
   * O DEFEITO MAIS CARO DESTA ÁREA, num teste: as duas linhas existem no banco
   * e as duas passam pelo filtro `estado=concedido` do backend se lidas cruas.
   * Só a segunda vale, e mandar mensagem para quem revogou é o que a LGPD
   * trata como violação.
   */
  it("quem revogou depois NÃO entra, mesmo tendo uma linha «concedido»", () => {
    const publico = montarPublico([
      linha({
        email: "ana@ex.com",
        estado: "concedido",
        criado_em: "2026-01-01T12:00:00.000Z",
      }),
      linha({
        email: "ana@ex.com",
        estado: "revogado",
        criado_em: "2026-03-01T12:00:00.000Z",
      }),
    ]);
    expect(publico.total).toBe(0);
    expect(publico.incluidos).toEqual([]);
    expect(publico.excluidos[0].motivo).toBe("consentimento_revogado");
  });

  it("quem revogou e concedeu de novo ENTRA, e entra uma vez só", () => {
    const publico = montarPublico([
      linha({ email: "ana@ex.com", estado: "concedido", criado_em: "2026-01-01T12:00:00.000Z" }),
      linha({ email: "ana@ex.com", estado: "revogado", criado_em: "2026-03-01T12:00:00.000Z" }),
      linha({ email: "ana@ex.com", estado: "concedido", criado_em: "2026-06-01T12:00:00.000Z" }),
    ]);
    expect(publico.total).toBe(1);
    expect(publico.excluidos).toEqual([]);
  });

  /** Consentir para e-mail não é consentir para WhatsApp. */
  it("consentimento de OUTRO canal não entra no público de WhatsApp", () => {
    const publico = montarPublico([
      linha({ canal: "email", estado: "concedido" }),
      linha({ canal: "sms", estado: "concedido" }),
    ]);
    expect(publico.total).toBe(0);
    // E nem sequer aparece nas exclusões: não é gente que ficou de fora do
    // público de WhatsApp, é gente que nunca esteve nele.
    expect(publico.excluidos).toEqual([]);
  });

  it("sem telefone na linha, exclusão explicada — não há para onde mandar", () => {
    const publico = montarPublico([linha({ telefone: null })]);
    expect(publico.excluidos[0].motivo).toBe("sem_telefone");
    expect(publico.excluidos[0].detalhe).toContain("rodapé do site");
  });

  it("telefone irreconhecível é outro motivo, e o detalhe mostra o que está gravado", () => {
    const publico = montarPublico([linha({ telefone: "9999" })]);
    expect(publico.excluidos[0].motivo).toBe("telefone_irreconhecivel");
    expect(publico.excluidos[0].detalhe).toContain("9999");
  });

  /**
   * "Sem telefone" e "telefone que não entendi" são problemas DIFERENTES e com
   * consertos diferentes: um é cadastro em branco, o outro é cadastro errado.
   * Um motivo só faria a lista de coisas a arrumar apontar para o lugar errado.
   */
  it("distingue «sem telefone» de «telefone irreconhecível»", () => {
    const publico = montarPublico([
      linha({ telefone: null }),
      linha({ telefone: "   " }),
      linha({ telefone: "12345" }),
    ]);
    const motivos = publico.excluidos.map((e) => e.motivo).sort();
    expect(motivos).toEqual([
      "sem_telefone",
      "sem_telefone",
      "telefone_irreconhecivel",
    ]);
  });

  /**
   * Duas pessoas, dois consentimentos, um telefone só — acontece com casal, com
   * telefone comercial e com quem se cadastrou duas vezes. Sem dedupe, aquele
   * número recebe a mesma promoção duas vezes.
   */
  it("o mesmo número por dois titulares entra UMA vez, e o segundo é explicado", () => {
    const publico = montarPublico([
      linha({ email: "ana@ex.com", telefone: "35999998888" }),
      linha({ email: "bia@ex.com", telefone: "(35) 99999-8888" }),
    ]);
    expect(publico.total).toBe(1);
    expect(publico.excluidos).toHaveLength(1);
    expect(publico.excluidos[0].motivo).toBe("numero_repetido");
    expect(publico.excluidos[0].identificacao).toBe("bia@ex.com");
  });

  it("grafias diferentes do mesmo número contam como repetido", () => {
    const publico = montarPublico([
      linha({ email: "a@ex.com", telefone: "35999998888" }),
      linha({ email: "b@ex.com", telefone: "+55 (35) 9 9999-8888" }),
    ]);
    expect(publico.total).toBe(1);
  });

  it("histórico vazio é público vazio, sem exclusão nenhuma", () => {
    expect(montarPublico([])).toEqual({ incluidos: [], excluidos: [], total: 0 });
  });

  /** Um público que muda de ordem entre dois cliques torna inútil a
   *  conferência antes de disparar. */
  it("é determinístico: a mesma entrada dá exatamente a mesma saída", () => {
    const historico = [
      linha({ email: "ana@ex.com", telefone: "35999990001" }),
      linha({ email: "bia@ex.com", telefone: "35999990002" }),
      linha({ email: "caio@ex.com", telefone: null }),
    ];
    expect(montarPublico(historico)).toEqual(montarPublico(historico));
  });

  it("cada incluído carrega a ORIGEM do consentimento que o autorizou", () => {
    const publico = montarPublico([
      linha({ telefone: "35999998888", origem: "formulário da feira de Piumhi" }),
    ]);
    expect(publico.incluidos[0].origem).toBe("formulário da feira de Piumhi");
  });
});

/* ========================================================================== *
 * A conta que a tela mostra
 * ========================================================================== */

describe("contarExclusoes", () => {
  it("agrupa por motivo e traz a frase que explica cada um", () => {
    const publico = montarPublico([
      linha({ email: "a@ex.com", estado: "revogado" }),
      linha({ email: "b@ex.com", estado: "revogado" }),
      linha({ email: "c@ex.com", telefone: null }),
    ]);
    const conta = contarExclusoes(publico.excluidos);
    expect(conta).toEqual([
      {
        motivo: "consentimento_revogado",
        frase: expect.stringContaining("Revogou"),
        quantidade: 2,
      },
      {
        motivo: "sem_telefone",
        frase: expect.stringContaining("telefone"),
        quantidade: 1,
      },
    ]);
  });

  /** Um zero desenhado é ruído: "0 números repetidos" não é informação. */
  it("motivo sem ninguém não aparece na conta", () => {
    expect(contarExclusoes([])).toEqual([]);
  });

  it("o revogado vem PRIMEIRO — é o único que não é problema a consertar", () => {
    const publico = montarPublico([
      linha({ email: "a@ex.com", telefone: "123" }),
      linha({ email: "b@ex.com", estado: "revogado" }),
    ]);
    expect(contarExclusoes(publico.excluidos)[0].motivo).toBe("consentimento_revogado");
  });
});

/* ========================================================================== *
 * O disparo
 * ========================================================================== */

describe("validarDisparo", () => {
  const comUm = montarPublico([linha({ telefone: "35999998888" })]);

  it("mensagem escrita e público com gente: nada a reclamar", () => {
    expect(validarDisparo("Café novo na loja!", comUm)).toEqual({});
  });

  it("mensagem em branco reprova", () => {
    expect(validarDisparo("   ", comUm).mensagem).toBeTruthy();
  });

  it("acima do limite reprova, e a frase diz o tamanho e o limite", () => {
    const erro = validarDisparo("a".repeat(LIMITE_DA_MENSAGEM + 1), comUm).mensagem!;
    expect(erro).toContain(String(LIMITE_DA_MENSAGEM + 1));
    expect(erro).toContain(String(LIMITE_DA_MENSAGEM));
  });

  it("exatamente no limite passa", () => {
    expect(validarDisparo("a".repeat(LIMITE_DA_MENSAGEM), comUm).mensagem).toBeUndefined();
  });

  /**
   * R14 — `{ numeros: [] }` seria aceito pelo webhook sem reclamar, a tela
   * diria "enviado", e o gestor concluiria que o WhatsApp não funciona. O pior
   * estado não é lento, é "não sei se aconteceu".
   */
  it("público vazio é ERRO, e não um disparo de zero mensagens", () => {
    const vazio = montarPublico([]);
    const erro = validarDisparo("Olá", vazio).publico!;
    expect(erro).toContain("consentimento");
  });

  it("os dois problemas são relatados juntos, e não um de cada vez", () => {
    const erros = validarDisparo("", montarPublico([]));
    expect(erros.mensagem).toBeTruthy();
    expect(erros.publico).toBeTruthy();
  });
});

describe("montarPayloadDoDisparo", () => {
  it("manda exatamente as duas chaves que o webhook lê", () => {
    const publico = montarPublico([linha({ telefone: "35999998888" })]);
    expect(Object.keys(montarPayloadDoDisparo("Oi", publico)).sort()).toEqual([
      "mensagem",
      "numeros",
    ]);
  });

  it("os números vão na mesma ordem em que a tela os mostrou", () => {
    const publico = montarPublico([
      linha({ email: "a@ex.com", telefone: "35999990001" }),
      linha({ email: "b@ex.com", telefone: "35999990002" }),
    ]);
    expect(montarPayloadDoDisparo("Oi", publico).numeros).toEqual([
      "5535999990001",
      "5535999990002",
    ]);
  });

  it("a mensagem vai aparada", () => {
    const publico = montarPublico([linha({ telefone: "35999998888" })]);
    expect(montarPayloadDoDisparo("  Oi  ", publico).mensagem).toBe("Oi");
  });

  it("quem foi excluído não aparece no corpo do disparo", () => {
    const publico = montarPublico([
      linha({ email: "a@ex.com", telefone: "35999990001" }),
      linha({ email: "b@ex.com", estado: "revogado", telefone: "35999990002" }),
    ]);
    expect(montarPayloadDoDisparo("Oi", publico).numeros).toEqual(["5535999990001"]);
  });
});

/* ========================================================================== *
 * As ressalvas que a tela precisa dizer
 * ========================================================================== */

describe("as ressalvas do disparador", () => {
  /**
   * Elas são CONSTANTES e não texto solto no JSX porque são a parte da tela
   * que não pode se perder numa refatoração de layout: são as duas coisas que
   * a spec §4.6 registra como "não resolvidas", e a tela é o único lugar onde
   * o gestor vai encontrá-las.
   */
  it("são duas, e nomeiam a falta de autenticação e a API não-oficial", () => {
    expect(RESSALVAS_DO_DISPARADOR).toHaveLength(2);
    expect(RESSALVAS_DO_DISPARADOR[0]).toMatch(/autentica/i);
    expect(RESSALVAS_DO_DISPARADOR[1]).toMatch(/não-oficial|nao-oficial/i);
  });

  it("o endereço do disparador é o que o front do Disparador já usa", () => {
    expect(URL_DO_DISPARADOR).toBe(
      "https://webhook.canastrainteligencia.com/webhook/disparador",
    );
  });
});
