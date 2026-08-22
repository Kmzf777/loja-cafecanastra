import { describe, it, expect } from "vitest";
import { LOCALES } from "../../../../lib/i18n/tipos";
import {
  TERMOS,
  SECOES_DOS_TERMOS,
  AVISO_DE_TRADUCAO,
  AVISO_JURIDICO,
  paragrafosDa,
  textoCorrido,
} from "./conteudo";

/** O documento inteiro de um idioma, achatado — a forma que os testes leem. */
const tudo = (locale: (typeof LOCALES)[number]) =>
  TERMOS[locale].secoes.map(textoCorrido).join(" ");

/**
 * Texto jurídico é o conteúdo mais fácil de estragar sem ninguém perceber: uma
 * cláusula apagada não quebra build, não gera erro de tipo, e a página continua
 * bonita e omissa. Pior aqui do que na /historia — lá o prejuízo é editorial,
 * aqui é a loja deixando de dizer por escrito o que ela cobra, quando entrega e
 * como se desiste da compra.
 *
 * Por isso os testes abaixo travam as PROMESSAS, não a redação: os prazos, o
 * foro, o direito de arrependimento, os nomes que não se traduzem e — o mais
 * importante — a condicional do meio de pagamento.
 */

describe("conteúdo dos Termos de uso", () => {
  it("existe nos três idiomas do site", () => {
    for (const locale of LOCALES) {
      expect(TERMOS[locale], locale).toBeDefined();
    }
  });

  /**
   * As âncoras são as MESMAS nos três idiomas porque um link compartilhado
   * (`/en/termos-de-uso#trocas-e-devolucoes`) tem de cair na mesma cláusula que
   * o português. Por isso elas são constante única, fora do texto traduzido —
   * mesma decisão da /historia.
   */
  it("tem as mesmas seções, na mesma ordem, nos três idiomas", () => {
    for (const locale of LOCALES) {
      const secoes = TERMOS[locale].secoes;
      expect(secoes.length, locale).toBe(SECOES_DOS_TERMOS.length);
      expect(
        secoes.map((s) => s.ancora),
        locale,
      ).toEqual([...SECOES_DOS_TERMOS]);
    }
  });

  it("nenhuma seção chega vazia na tela", () => {
    for (const locale of LOCALES) {
      for (const secao of TERMOS[locale].secoes) {
        const onde = `${locale}/${secao.ancora}`;
        expect(secao.titulo.trim(), onde).not.toBe("");
        expect(secao.blocos.length, onde).toBeGreaterThan(0);
        expect(paragrafosDa(secao).length, onde).toBeGreaterThan(0);
        expect(textoCorrido(secao).trim(), onde).not.toBe("");
      }
    }
  });

  /**
   * A CLÁUSULA CONDICIONAL, e a razão de ela ser testada em todos os idiomas.
   *
   * A seção de pagamento não afirma o meio: ela carrega um trecho `conforme`
   * que o build resolve contra a chave do Mercado Pago (ver pagamento.ts). Uma
   * tradução distraída que "limpe" o trecho e escreva "Pix e cartão de crédito"
   * direto na frase transforma a página num build que promete cartão sem ter
   * cartão. Este teste é a cerca.
   */
  it("mantém o meio de pagamento condicionado à chave do Mercado Pago, nos três idiomas", () => {
    for (const locale of LOCALES) {
      const secao = TERMOS[locale].secoes.find((s) => s.ancora === "pedidos-e-pagamento");
      expect(secao, locale).toBeDefined();

      const condicionais = paragrafosDa(secao!)
        .flatMap((p) => (typeof p === "string" ? [] : p))
        .filter((t) => typeof t !== "string" && "conforme" in t);

      expect(condicionais.length, locale).toBe(1);
      const cond = condicionais[0] as { sim: string; nao: string };
      expect(cond.sim.trim(), locale).not.toBe("");
      expect(cond.nao.trim(), locale).not.toBe("");
      // A variante SEM chave não pode mencionar cartão em idioma nenhum — é
      // exatamente a mentira que a condicional existe para impedir.
      expect(cond.nao.toLowerCase(), locale).not.toMatch(/cart[ãa]o|card|tarjeta/);
    }
  });

  /**
   * Nomes próprios e números não se traduzem, e são o que dá endereço legal ao
   * documento. Sem a razão social, os Termos não dizem com quem o cliente
   * contratou; sem o foro, não dizem onde se discute.
   *
   * A razão social e o endereço vêm do site institucional (`app/termos-uso` e
   * `app/politica-privacidade` de github.com/Kmzf777/cafecanastrablog), única
   * fonte publicada da marca. O CNPJ NÃO entra: nenhuma das duas páginas o
   * declara, e número de inscrição é o último campo que se deve chutar.
   */
  it("nomeia a empresa, o foro e o canal de contato em todos os idiomas", () => {
    for (const locale of LOCALES) {
      const texto = TERMOS[locale].secoes.map(textoCorrido).join(" ");
      expect(texto, `${locale} · razão social`).toContain("Boaventura Cafés Especiais");
      expect(texto, `${locale} · foro`).toContain("Uberlândia");
      expect(texto, `${locale} · e-mail`).toContain("comercial@cafecanastra.com");
      expect(texto, `${locale} · CNPJ inventado`).not.toMatch(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    }
  });

  /**
   * As quatro promessas operacionais que a loja de fato cumpre, e que a
   * tradução não pode perder: o prazo de arrependimento do CDC, o dia da torra,
   * quem calcula o frete e quem processa o pagamento.
   */
  it("preserva os prazos e os prestadores em todos os idiomas", () => {
    for (const locale of LOCALES) {
      const texto = TERMOS[locale].secoes.map(textoCorrido).join(" ");
      expect(texto, `${locale} · arrependimento`).toMatch(/\b7\b/);
      expect(texto, `${locale} · Mercado Pago`).toContain("Mercado Pago");
      expect(texto, `${locale} · Melhor Envio`).toContain("Melhor Envio");
    }
  });

  /**
   * O Clube cobra sozinho, todo mês, do cartão de quem assinou. Em documento de
   * consumo isso é a informação que mais precisa estar escrita — e escrita em
   * destaque, que é o que o trecho `forte` faz na tela.
   */
  it("mantém a recorrência do Clube em destaque nos três idiomas", () => {
    for (const locale of LOCALES) {
      const secao = TERMOS[locale].secoes.find((s) => s.ancora === "clube");
      expect(secao, locale).toBeDefined();
      const fortes = paragrafosDa(secao!)
        .flatMap((p) => (typeof p === "string" ? [] : p))
        .filter((t) => typeof t !== "string" && "forte" in t);
      expect(fortes.length, locale).toBeGreaterThan(0);
    }
  });

  /**
   * Até a Onda 3C, `en` e `es` eram o MESMO objeto do `pt` — e a página avisava
   * isso na tela. A reversão acidental para `= pt` não quebra tipo nem build:
   * ela só entrega um documento em português a quem escolheu inglês, e sem o
   * aviso, que sumiu junto. Este teste é o que sobra guardando essa porta.
   */
  it("os três idiomas são documentos distintos, e não o português servido três vezes", () => {
    expect(tudo("en")).not.toBe(tudo("pt"));
    expect(tudo("es")).not.toBe(tudo("pt"));
    expect(tudo("en")).not.toBe(tudo("es"));
  });

  /**
   * A REGRA QUE MAIS IMPORTA NUMA TRADUÇÃO JURÍDICA: a compra é regida pela lei
   * brasileira, e a tradução não pode trocar de lei junto com o idioma. Nomear
   * "GDPR" numa política em inglês ou "EU consumer law" nos termos daria ao
   * leitor um direito que esta loja não dá e este foro não julga — e é
   * exatamente o erro que uma tradução bem-intencionada comete sozinha.
   */
  it("nomeia a lei brasileira nos três idiomas, e não invoca lei estrangeira", () => {
    for (const locale of LOCALES) {
      const texto = tudo(locale);
      expect(texto, `${locale} · CDC`).toContain("Código de Defesa do Consumidor");
      expect(texto, `${locale} · lei estrangeira`).not.toMatch(
        /GDPR|CCPA|Uniform Commercial Code|EU (consumer )?law|derecho de la UE/i,
      );
    }
  });

  /**
   * Os números do Clube são cláusula, não redação: a frequência da cobrança, o
   * desconto e a idade mínima. Tradução mexe em palavra; se mexer em número, a
   * loja passa a prometer coisa diferente em cada idioma.
   */
  it("preserva os números do Clube em todos os idiomas", () => {
    for (const locale of LOCALES) {
      const secao = TERMOS[locale].secoes.find((s) => s.ancora === "clube");
      const texto = textoCorrido(secao!);
      for (const numero of ["15", "30", "45", "10%"]) {
        expect(texto, `${locale} · ${numero}`).toContain(numero);
      }
    }
  });

  /**
   * O `<AvisoJuridico>` fica nos TRÊS idiomas — foi condição explícita do plano
   * (Onda 3C) e é a única frase da página que o leitor precisa entender antes
   * de confiar no resto. Como o componente compartilhado só fala português,
   * en/es dependem destes dois textos; se um deles esvaziar, a página em inglês
   * perde o aviso sem que nada mais quebre.
   */
  it("carrega o aviso jurídico e a cláusula de prevalência em inglês e espanhol", () => {
    for (const locale of ["en", "es"] as const) {
      expect(AVISO_JURIDICO[locale].forte.trim(), locale).not.toBe("");
      expect(AVISO_JURIDICO[locale].texto.trim(), locale).not.toBe("");
      expect(AVISO_DE_TRADUCAO[locale], locale).toMatch(/portug/i);
    }
  });

  it("tem título, descrição de metadata e data de atualização em cada idioma", () => {
    for (const locale of LOCALES) {
      expect(TERMOS[locale].meta.titulo, locale).toContain("Canastra");
      // O limite prático do snippet do Google: acima disso a frase é cortada.
      expect(TERMOS[locale].meta.descricao.length, locale).toBeLessThanOrEqual(160);
      expect(TERMOS[locale].meta.descricao.length, locale).toBeGreaterThan(50);
      expect(TERMOS[locale].atualizacao.trim(), locale).not.toBe("");
    }
    expect(TERMOS.pt.atualizacao).toBe("agosto de 2026");
  });
});
