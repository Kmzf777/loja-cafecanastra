import { describe, it, expect } from "vitest";
import { LOCALES } from "../../../../lib/i18n/tipos";
import {
  PRIVACIDADE,
  SECOES_DA_PRIVACIDADE,
  AVISO_DE_TRADUCAO,
  AVISO_JURIDICO,
  listasCom,
  paragrafosDa,
  textoCorrido,
} from "./conteudo";

/** A política inteira de um idioma, achatada. */
const tudo = (locale: (typeof LOCALES)[number]) =>
  PRIVACIDADE[locale].secoes.map(textoCorrido).join(" ");

/**
 * Esta página é a única do site que promete DIREITO, e direito prometido sem
 * porta é a mentira que este repositório inteiro persegue — a mesma que fez a
 * loja mandar o cliente escrever um e-mail para exercer a exclusão de conta que
 * `DELETE /auth/users/me` já cumpria sozinho em segundos.
 *
 * Os testes abaixo travam a fronteira entre o que o cliente FAZ sozinho e o que
 * ele PEDE, e travam a lista de quem recebe dado pessoal. Cada operador da
 * lista corresponde a código vivo:
 *
 *   Mercado Pago .... lib/sacola/cartao.ts + o preapproval do Clube
 *   Melhor Envio .... o cálculo de frete do checkout
 *   Resend .......... backend/src/config/mailer + utils/emailSender.js
 *   Bling ........... backend/src/services/blingPedidos.js
 *   Google Analytics  frontend/lib/analytics.ts, só após o banner
 */

describe("conteúdo da Política de privacidade", () => {
  it("existe nos três idiomas do site", () => {
    for (const locale of LOCALES) {
      expect(PRIVACIDADE[locale], locale).toBeDefined();
    }
  });

  it("tem as mesmas seções, na mesma ordem, nos três idiomas", () => {
    for (const locale of LOCALES) {
      const secoes = PRIVACIDADE[locale].secoes;
      expect(secoes.length, locale).toBe(SECOES_DA_PRIVACIDADE.length);
      expect(
        secoes.map((s) => s.ancora),
        locale,
      ).toEqual([...SECOES_DA_PRIVACIDADE]);
    }
  });

  it("nenhuma seção chega vazia na tela", () => {
    for (const locale of LOCALES) {
      for (const secao of PRIVACIDADE[locale].secoes) {
        const onde = `${locale}/${secao.ancora}`;
        expect(secao.titulo.trim(), onde).not.toBe("");
        expect(secao.blocos.length, onde).toBeGreaterThan(0);
        expect(paragrafosDa(secao).length, onde).toBeGreaterThan(0);
        expect(textoCorrido(secao).trim(), onde).not.toBe("");
      }
    }
  });

  /**
   * OMITIR UM DESTINATÁRIO É A FALHA MAIS GRAVE POSSÍVEL AQUI: a pessoa fica
   * sem saber que a loja entregou o CPF dela a um terceiro. Os nomes são razão
   * social e não se traduzem — é por isso que o teste vale nos três idiomas.
   */
  it("nomeia todos os operadores que recebem dado pessoal, em todos os idiomas", () => {
    for (const locale of LOCALES) {
      const texto = PRIVACIDADE[locale].secoes.map(textoCorrido).join(" ");
      for (const operador of [
        "Mercado Pago",
        "Melhor Envio",
        "Resend",
        "Bling",
        "Google Analytics",
      ]) {
        expect(texto, `${locale} · ${operador}`).toContain(operador);
      }
    }
  });

  /**
   * A FRONTEIRA. Três direitos têm porta na tela e o cliente exerce sozinho; os
   * outros são pedido por e-mail, atendido em até 15 dias. Escrever um dos
   * "pedidos" como se fosse botão inventa uma porta; escrever um dos "sozinho"
   * como pedido esconde uma que existe. As duas listas são estrutura (o `papel`
   * do bloco), não prosa, e por isso podem ser contadas.
   */
  it("separa o que o cliente faz sozinho do que ele precisa pedir", () => {
    for (const locale of LOCALES) {
      const secao = PRIVACIDADE[locale].secoes.find((s) => s.ancora === "direitos");
      expect(secao, locale).toBeDefined();
      expect(listasCom(secao!, "sozinho").length, `${locale} · sozinho`).toBe(3);
      expect(listasCom(secao!, "pedindo").length, `${locale} · pedindo`).toBeGreaterThanOrEqual(3);
      expect(textoCorrido(secao!), `${locale} · prazo`).toMatch(/\b15\b/);
    }
  });

  /**
   * A porta da exclusão é `/account` → "Encerrar minha conta"
   * (components/conta/EncerrarConta.tsx). O link precisa estar no conteúdo, e
   * não escrito à mão na página, senão a tradução perde o caminho e o direito
   * volta a ser um e-mail.
   */
  it("aponta para a conta como caminho da exclusão, nos três idiomas", () => {
    for (const locale of LOCALES) {
      const secao = PRIVACIDADE[locale].secoes.find((s) => s.ancora === "direitos");
      const destinos = listasCom(secao!, "sozinho")
        .flatMap((item) => (typeof item === "string" ? [] : item))
        .filter((t) => typeof t !== "string" && "href" in t)
        .map((t) => (t as { href: string }).href);
      expect(destinos, locale).toContain("/account");
    }
  });

  /**
   * As duas revogações de consentimento não são texto: são componentes que
   * agem na hora (FormDescadastroNewsletter e BotaoReverCookies). A página que
   * PROMETE a escolha é a página onde ela se exerce — se a chave sumir do
   * conteúdo, o widget some da tela e sobra a promessa.
   */
  it("carrega os dois widgets de consentimento, nos três idiomas", () => {
    for (const locale of LOCALES) {
      const blocos = PRIVACIDADE[locale].secoes.flatMap((s) => s.blocos);

      const formularios = blocos.filter(
        (b) => "formulario" in b && b.formulario === "descadastro-newsletter",
      );
      expect(formularios.length, `${locale} · descadastro`).toBe(1);

      const temBotao = PRIVACIDADE[locale].secoes.some((s) =>
        paragrafosDa(s).some(
          (p) =>
            typeof p !== "string" &&
            p.some((t) => typeof t !== "string" && "acao" in t && t.acao === "rever-cookies"),
        ),
      );
      expect(temBotao, `${locale} · rever cookies`).toBe(true);
    }
  });

  /**
   * A retenção descrita aqui tem de bater, linha a linha, com o que a rota de
   * exclusão faz de verdade (a lista `O_QUE_ACONTECE` de EncerrarConta.tsx). A
   * avaliação que continua no ar assinada como "Cliente Canastra" é a parte que
   * ninguém espera ouvir — e justamente por isso a que não pode faltar.
   */
  it("descreve a retenção com as palavras do que o backend faz", () => {
    for (const locale of LOCALES) {
      const secao = PRIVACIDADE[locale].secoes.find((s) => s.ancora === "retencao");
      expect(textoCorrido(secao!), `${locale} · avaliações`).toContain("Cliente Canastra");
    }
  });

  /** Transferência internacional é dever de informação (LGPD art. 33). */
  it("avisa que dois operadores ficam fora do Brasil", () => {
    for (const locale of LOCALES) {
      const secao = PRIVACIDADE[locale].secoes.find((s) => s.ancora === "fora-do-brasil");
      const texto = textoCorrido(secao!);
      expect(texto, `${locale} · Resend`).toContain("Resend");
      expect(texto, `${locale} · Google`).toContain("Google");
    }
  });

  it("indica a ANPD como canal de reclamação em todos os idiomas", () => {
    for (const locale of LOCALES) {
      const texto = PRIVACIDADE[locale].secoes.map(textoCorrido).join(" ");
      expect(texto, locale).toContain("ANPD");
      expect(texto, `${locale} · e-mail`).toContain("comercial@cafecanastra.com");
    }
  });

  /** Mesma porta guardada nos Termos — ver a nota lá. */
  it("os três idiomas são documentos distintos", () => {
    expect(tudo("en")).not.toBe(tudo("pt"));
    expect(tudo("es")).not.toBe(tudo("pt"));
    expect(tudo("en")).not.toBe(tudo("es"));
  });

  /**
   * A LGPD NÃO VIRA GDPR AO CRUZAR A FRONTEIRA. É a substituição mais provável
   * numa política de privacidade traduzida para o inglês, e a mais danosa: o
   * catálogo de direitos não é o mesmo, a autoridade não é a mesma, e quem
   * lesse acabaria exercendo na ANPD um direito que ela não concede. A lei que
   * protege quem compra aqui é brasileira, e é ela que a página nomeia.
   */
  it("nomeia a LGPD e a ANPD nos três idiomas, e nunca o regulamento europeu", () => {
    for (const locale of LOCALES) {
      const texto = tudo(locale);
      expect(texto, `${locale} · LGPD`).toMatch(/LGPD|Lei Geral de Proteção de Dados/);
      expect(texto, `${locale} · ANPD`).toContain("ANPD");
      expect(texto, `${locale} · lei estrangeira`).not.toMatch(
        /GDPR|CCPA|General Data Protection Regulation/i,
      );
    }
  });

  /**
   * O aviso jurídico fica nos três idiomas (condição do plano), e em en/es ele
   * depende destes textos porque o componente compartilhado só fala português.
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
      expect(PRIVACIDADE[locale].meta.titulo, locale).toContain("Canastra");
      expect(PRIVACIDADE[locale].meta.descricao.length, locale).toBeLessThanOrEqual(160);
      expect(PRIVACIDADE[locale].meta.descricao.length, locale).toBeGreaterThan(50);
      expect(PRIVACIDADE[locale].atualizacao.trim(), locale).not.toBe("");
    }
    expect(PRIVACIDADE.pt.atualizacao).toBe("agosto de 2026");
  });
});
