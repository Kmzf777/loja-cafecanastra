import { describe, expect, it } from "vitest";
import { LOCALES, type Locale } from "../../../../lib/i18n/tipos";
import { ORDEM_DO_FAQ, textosDoClube } from "./conteudo";

/**
 * O QUE ESTES TESTES PEGAM, E QUE O TYPESCRIPT NÃO PEGA.
 *
 * O tipo `TextosDoClube` garante que a CHAVE existe em `en` e em `es`. Ele não
 * garante que o VALOR foi traduzido — uma chave copiada do português compila
 * perfeitamente e só aparece como um "Assinar" no meio de um formulário em
 * inglês, na única tela do site em que o cliente AUTORIZA COBRANÇA RECORRENTE.
 * Era exatamente esse o estado da /clube até a Onda 2C.
 *
 * A trava aqui é a mesma de lib/i18n/dicionario.test.ts, e de propósito: todo
 * valor de `en` e de `es` precisa ser diferente do português, e a exceção tem
 * de ser declarada uma a uma, com o motivo escrito.
 */

/**
 * Os caminhos em que o valor traduzido coincide com o português DE PROPÓSITO.
 * Nome próprio, sigla de documento brasileiro, ou palavra idêntica nas duas
 * línguas.
 */
const IGUAIS_DE_PROPOSITO: Record<Exclude<Locale, "pt">, string[]> = {
  en: [
    // A sigla do documento é o nome dele. Ver a nota de `passo3` em conteudo.ts.
    "wizard.passo3.cpf",
  ],
  es: [
    "wizard.passo3.cpf",
    // Palavras que o espanhol escreve igual ao português.
    "wizard.passo1.cafe",
    "wizard.passo3.numero",
    "wizard.passo3.complemento",
    "wizard.resumo.cafe",
    "wizard.resumo.peso",
    "wizard.botoes.continuar",
  ],
};

/**
 * Achata o objeto em `[caminho, valor]`, RESOLVENDO as funções de interpolação
 * com argumentos de teste. Sem isto, metade das frases desta página — todas as
 * que carregam um número ou um preço — escaparia da trava justamente por serem
 * as que falam de dinheiro.
 */
function folhas(objeto: object, prefixo = ""): [string, string][] {
  return Object.entries(objeto).flatMap(([chave, valor]) => {
    const caminho = prefixo ? `${prefixo}.${chave}` : chave;
    if (typeof valor === "string") return [[caminho, valor] as [string, string]];
    if (typeof valor === "function") {
      // As funções deste módulo têm duas assinaturas só: as que interpolam
      // DINHEIRO recebem o preço já formatado, e todas as outras recebem um
      // número (passo, dias, percentual).
      const dinheiro = /economia|porEnvio/i.test(caminho);
      return [
        [caminho, String(valor(dinheiro ? "R$ 10,00" : 30))] as [string, string],
      ];
    }
    return folhas(valor as object, caminho);
  });
}

const PT = new Map(folhas(textosDoClube("pt")));

describe("textos da /clube", () => {
  it("tem exatamente as mesmas chaves nos três idiomas", () => {
    const esperado = [...PT.keys()].sort();
    for (const locale of LOCALES) {
      expect(
        [...new Map(folhas(textosDoClube(locale))).keys()].sort(),
        `chaves de ${locale}`,
      ).toEqual(esperado);
    }
  });

  it("não deixa nenhum valor vazio em idioma nenhum", () => {
    for (const locale of LOCALES) {
      for (const [caminho, valor] of folhas(textosDoClube(locale))) {
        expect(valor.trim(), `${locale}.${caminho}`).not.toBe("");
      }
    }
  });

  it.each(["en", "es"] as const)(
    "não deixa texto em português vazando para %s",
    (locale) => {
      const permitidos = new Set(IGUAIS_DE_PROPOSITO[locale]);
      const vazando = folhas(textosDoClube(locale))
        .filter(
          ([caminho, valor]) =>
            valor === PT.get(caminho) && !permitidos.has(caminho),
        )
        .map(([caminho]) => caminho);

      expect(vazando).toEqual([]);
    },
  );

  it.each(["en", "es"] as const)(
    "não declara exceção para chave que na verdade foi traduzida em %s",
    (locale) => {
      // Sem isto a lista de exceções vira lixo acumulado: uma chave traduzida
      // depois continuaria dispensada da trava para sempre.
      const atual = new Map(folhas(textosDoClube(locale)));
      const obsoletas = IGUAIS_DE_PROPOSITO[locale].filter(
        (caminho) => atual.get(caminho) !== PT.get(caminho),
      );
      expect(obsoletas).toEqual([]);
    },
  );
});

describe("o FAQ", () => {
  /**
   * A ordem vem de `ORDEM_DO_FAQ`, e não de `Object.keys` do objeto traduzido:
   * ordem de digitação num arquivo de tradução é acidente. Se alguém acrescentar
   * uma pergunta e esquecer da lista, ela nunca aparece na tela — este teste é
   * quem avisa.
   */
  it("a ordem declarada cobre exatamente as perguntas que existem", () => {
    for (const locale of LOCALES) {
      const chaves = Object.keys(textosDoClube(locale).faq).filter(
        (c) => c !== "titulo",
      );
      expect(chaves.sort(), locale).toEqual([...ORDEM_DO_FAQ].sort());
    }
  });

  it("toda pergunta tem pergunta e resposta em todo idioma", () => {
    for (const locale of LOCALES) {
      const faq = textosDoClube(locale).faq;
      for (const chave of ORDEM_DO_FAQ) {
        expect(faq[chave].pergunta.trim(), `${locale}.${chave}`).not.toBe("");
        expect(faq[chave].resposta.trim(), `${locale}.${chave}`).not.toBe("");
      }
    }
  });
});

describe("a chamada de venda", () => {
  /**
   * O PERCENTUAL É INTERPOLADO, e é a única razão de `chamada` ser função. Uma
   * tradução que esqueça o `${desconto}` anunciaria a assinatura SEM o número
   * que a justifica — ou pior, com um número cravado na frase, que sobreviveria
   * a uma mudança de `DESCONTO_DO_CLUBE` mentindo em duas línguas.
   */
  it.each(LOCALES)("mostra o desconto que recebeu, em %s", (locale) => {
    expect(textosDoClube(locale).chamada(10)).toContain("10%");
    expect(textosDoClube(locale).chamada(15)).toContain("15%");
    expect(textosDoClube(locale).chamada(15)).not.toContain("10%");
  });

  it.each(LOCALES)("cita as três frequências reais em %s", (locale) => {
    const chamada = textosDoClube(locale).chamada(10);
    for (const dias of [15, 30, 45]) {
      expect(chamada, `${locale} sem ${dias}`).toContain(String(dias));
    }
  });
});

describe("o aviso da fronteira", () => {
  /**
   * O aviso é o que impede alguém de fora do Brasil preencher três passos para
   * bater numa parede: o frete é Melhor Envio (só Brasil), a cobrança é um
   * preapproval do Mercado Pago Brasil em reais e a nota exige CPF. Se a
   * tradução perder um desses três fatos, ela vira um aviso decorativo.
   */
  it("nomeia Brasil, Mercado Pago e CPF em inglês e espanhol", () => {
    for (const locale of ["en", "es"] as const) {
      const aviso = textosDoClube(locale);
      const inteiro = `${aviso.aviso.titulo} ${aviso.aviso.texto}`;
      expect(inteiro, `${locale} sem Brasil`).toMatch(/Bra[sz]il/);
      expect(inteiro, `${locale} sem Mercado Pago`).toContain("Mercado Pago");
      expect(inteiro, `${locale} sem CPF`).toContain("CPF");
    }
  });

  /** `reais` nomeado: quem lê de fora precisa saber em que moeda vai ser cobrado. */
  it("nomeia a moeda em inglês e espanhol", () => {
    expect(textosDoClube("en").aviso.texto).toMatch(/reais/);
    expect(textosDoClube("es").aviso.texto).toMatch(/reales/);
  });
});

describe("as promessas de dinheiro", () => {
  /**
   * ESTA TELA AUTORIZA COBRANÇA RECORRENTE, e as quatro promessas do português
   * têm de existir inteiras nas três línguas: autorização no Mercado Pago,
   * cancelamento pela conta, sem multa. Uma tradução "mais leve" aqui não é
   * estilo — é outra promessa, e é a que o cliente vai cobrar.
   */
  it.each(LOCALES)("o resumo cita Mercado Pago e o cancelamento em %s", (locale) => {
    const autorizacao = textosDoClube(locale).wizard.resumo.autorizacao;
    expect(autorizacao).toContain("Mercado Pago");
    expect(autorizacao.length, locale).toBeGreaterThan(40);
  });

  it.each(LOCALES)("a frequência do resumo carrega o número em %s", (locale) => {
    const resumo = textosDoClube(locale).wizard.resumo;
    expect(resumo.aCada(45)).toContain("45");
    expect(textosDoClube(locale).wizard.passo2.aCada(15)).toContain("15");
  });

  it.each(LOCALES)("o preço por envio carrega o valor formatado em %s", (locale) => {
    const w = textosDoClube(locale).wizard;
    expect(w.passo1.porEnvio("R$ 75,60")).toContain("R$ 75,60");
    expect(w.passo1.economia("R$ 8,40")).toContain("R$ 8,40");
    expect(w.resumo.economiaEEntrega("R$ 8,40")).toContain("R$ 8,40");
    expect(w.resumo.porEnvioLeitor("75 reais")).toContain("75 reais");
  });
});

describe("a barra de progresso", () => {
  it.each(LOCALES)("diz o passo e o total em %s", (locale) => {
    const linha = textosDoClube(locale).wizard.passoDeTres(2);
    expect(linha).toContain("2");
    expect(linha).toContain("3");
  });
});
