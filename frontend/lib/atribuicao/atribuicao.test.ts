import { describe, it, expect } from "vitest";
import {
  JANELA_DE_ATRIBUICAO_MS,
  TETO_DE_CARACTERES,
  corpoDeAtribuicao,
  decidirGravacao,
  derivarCanal,
  lerChegada,
  limparValor,
  temMarcadorDeCampanha,
  type Atribuicao,
} from "./atribuicao";

/**
 * A captura de origem, e o que ela recusa.
 *
 * O dado é PERECÍVEL — não há como reconstruir depois de onde veio uma venda,
 * nem pelo Mercado Pago nem pelo Bling —, então errar aqui não é um relatório
 * feio: é um relatório impossível de corrigir.
 */

const AGORA = 1_772_000_000_000;
const LOJA = "https://cafecanastra.com";

describe("lerChegada — o que a URL do navegador diz", () => {
  it("colhe os cinco utm e os dois identificadores de clique", () => {
    const a = lerChegada({
      url: `${LOJA}/cafes?utm_source=instagram&utm_medium=social&utm_campaign=black&utm_content=carrossel&utm_term=cafe+especial&gclid=Cj0KAQ&fbclid=IwAR1`,
      agoraMs: AGORA,
    });
    expect(a).toMatchObject({
      utm_source: "instagram",
      utm_medium: "social",
      utm_campaign: "black",
      utm_content: "carrossel",
      utm_term: "cafe especial",
      gclid: "Cj0KAQ",
      fbclid: "IwAR1",
      landing_page: "/cafes",
      capturadaEm: AGORA,
    });
  });

  it("URL sem parâmetro nenhum ainda registra a chegada, como 'direto'", () => {
    const a = lerChegada({ url: `${LOJA}/`, agoraMs: AGORA });
    expect(a).toMatchObject({ canal: "direto", landing_page: "/" });
    expect(a).not.toHaveProperty("utm_source");
    expect(a).not.toHaveProperty("referrer");
  });

  it("REFERRER DO PRÓPRIO SITE NÃO É REFERRER", () => {
    // Sem isto, clicar de /cafes para /cafes/classico faria a loja indicar a si
    // mesma e todo pedido viraria 'indicacao' no relatório.
    const a = lerChegada({
      url: `${LOJA}/cafes/classico`,
      referrer: `${LOJA}/cafes`,
      agoraMs: AGORA,
    });
    expect(a).not.toHaveProperty("referrer");
    expect(a!.canal).toBe("direto");
  });

  it("A QUERY STRING NÃO ATRAVESSA — nem na landing, nem no referrer (LGPD)", () => {
    // A landing de um anúncio carrega o mesmo gclid por construção. Redigir a
    // coluna `gclid` e deixar o identificador na URL ao lado é o que a 0033
    // chama de teatro de privacidade. Todo parâmetro que importa já tem coluna.
    const a = lerChegada({
      url: `${LOJA}/cafes?utm_source=google&gclid=Cj0KAQ`,
      referrer: "https://www.google.com/search?q=cafe+canastra&gclid=Cj0KAQ",
      agoraMs: AGORA,
    });
    expect(a!.landing_page).toBe("/cafes");
    expect(a!.landing_page).not.toContain("gclid");
    expect(a!.referrer).toBe("https://www.google.com/search");
    expect(a!.referrer).not.toContain("?");
  });

  it("apara espaço e corta o valor patológico, sem recusar o pedido", () => {
    const a = lerChegada({
      url: `${LOJA}/?utm_source=${"x".repeat(5000)}&utm_medium=%20%20`,
      agoraMs: AGORA,
    });
    // Cortar, e não recusar: um CHECK aqui produziria PEDIDO PERDIDO com o
    // cliente já no cartão, não um relatório melhor (0033).
    expect(a!.utm_source).toHaveLength(TETO_DE_CARACTERES);
    expect(a).not.toHaveProperty("utm_medium");
  });

  it("NÃO minusculiza: a canonização é de quem escreve no banco", () => {
    const a = lerChegada({
      url: `${LOJA}/?utm_campaign=BlackFriday26`,
      agoraMs: AGORA,
    });
    expect(a!.utm_campaign).toBe("BlackFriday26");
  });

  it("URL ilegível não produz atribuição em vez de estourar", () => {
    expect(lerChegada({ url: "isto não é uma url", agoraMs: AGORA })).toBeNull();
  });

  it("referrer ilegível é ignorado, e a chegada segue", () => {
    const a = lerChegada({
      url: `${LOJA}/`,
      referrer: "://quebrado",
      agoraMs: AGORA,
    });
    expect(a!.canal).toBe("direto");
  });
});

describe("derivarCanal — a origem em uma palavra", () => {
  it("identificador de clique é sempre 'pago' — foi dinheiro", () => {
    expect(derivarCanal({ gclid: "Cj0" })).toBe("pago");
    expect(derivarCanal({ fbclid: "IwAR" })).toBe("pago");
  });

  it("mídia paga pelo utm_medium, nas grafias que o mercado usa", () => {
    for (const meio of ["cpc", "CPC", "ppc", "paid_social", "paid-social", "display", "cpm", "remarketing"]) {
      expect(derivarCanal({ utm_medium: meio })).toBe("pago");
    }
  });

  it("buscador sem anúncio é 'organico', inclusive nos domínios de país", () => {
    expect(derivarCanal({ hostDoReferrer: "www.google.com.br" })).toBe("organico");
    expect(derivarCanal({ hostDoReferrer: "duckduckgo.com" })).toBe("organico");
    expect(derivarCanal({ hostDoReferrer: "br.search.yahoo.com" })).toBe("organico");
  });

  it("O CLIQUE PAGO GANHA DO BUSCADOR — anúncio no Google não é orgânico", () => {
    // A ordem das perguntas é a decisão: confundir as duas faz o relatório de
    // retorno sobre investimento mentir para os dois lados.
    expect(
      derivarCanal({ gclid: "Cj0", hostDoReferrer: "www.google.com" }),
    ).toBe("pago");
  });

  it("veio de fora sem ser busca nem anúncio: 'indicacao'", () => {
    expect(derivarCanal({ hostDoReferrer: "instagram.com" })).toBe("indicacao");
    // QR code na embalagem: nenhum referrer, mas alguém fez campanha.
    expect(derivarCanal({ utm_source: "embalagem" })).toBe("indicacao");
  });

  it("sem nada é 'direto' — a pessoa digitou o endereço", () => {
    expect(derivarCanal({})).toBe("direto");
  });
});

describe("decidirGravacao — de quem é a venda", () => {
  const semMarcador: Atribuicao = { canal: "direto", capturadaEm: AGORA };
  const comMarcador: Atribuicao = {
    canal: "pago",
    utm_source: "google",
    capturadaEm: AGORA,
  };

  it("chegada com campanha sempre grava, mesmo por cima de outra", () => {
    const anterior: Atribuicao = {
      canal: "indicacao",
      utm_source: "instagram",
      capturadaEm: AGORA - 1000,
    };
    expect(decidirGravacao(anterior, comMarcador, AGORA)).toBe(comMarcador);
  });

  it("A NAVEGAÇÃO INTERNA NÃO APAGA A CAMPANHA — é o 'primeiro contato'", () => {
    // O utm só existe na URL da primeira página. Sem esta regra ele seria
    // apagado no primeiro clique, e nenhuma venda teria origem.
    const guardada: Atribuicao = {
      canal: "pago",
      utm_source: "google",
      gclid: "Cj0",
      capturadaEm: AGORA - 60_000,
    };
    expect(decidirGravacao(guardada, semMarcador, AGORA)).toBeNull();
  });

  it("sem nada guardado, grava até a chegada sem marcador", () => {
    // Senão 'direto', 'organico' e 'indicacao' nunca existiriam no relatório e
    // toda venda pareceria vir de anúncio.
    expect(decidirGravacao(null, semMarcador, AGORA)).toBe(semMarcador);
  });

  it("passada a janela de 30 dias, a chegada nova recomeça a contagem", () => {
    const velha: Atribuicao = {
      canal: "pago",
      gclid: "Cj0",
      capturadaEm: AGORA - JANELA_DE_ATRIBUICAO_MS - 1,
    };
    // Sem a janela, o relatório de campanha ficaria melhor quanto mais VELHO
    // fosse o clique.
    expect(decidirGravacao(velha, semMarcador, AGORA)).toBe(semMarcador);
  });

  it("dentro da janela por um milissegundo ainda não vence", () => {
    const quase: Atribuicao = {
      canal: "pago",
      gclid: "Cj0",
      capturadaEm: AGORA - JANELA_DE_ATRIBUICAO_MS,
    };
    expect(decidirGravacao(quase, semMarcador, AGORA)).toBeNull();
  });
});

describe("corpoDeAtribuicao — o que viaja no checkout", () => {
  it("manda as dez colunas, sem os campos vazios", () => {
    const a = lerChegada({
      url: `${LOJA}/cafes?utm_source=google&utm_medium=cpc&gclid=Cj0`,
      referrer: "https://www.google.com/",
      agoraMs: AGORA,
    });
    expect(corpoDeAtribuicao(a)).toEqual({
      utm_source: "google",
      utm_medium: "cpc",
      canal: "pago",
      referrer: "https://www.google.com/",
      landing_page: "/cafes",
      gclid: "Cj0",
    });
  });

  it("`capturadaEm` NÃO viaja — não há coluna, e é o relógio do cliente", () => {
    const a = lerChegada({ url: `${LOJA}/`, agoraMs: AGORA });
    expect(corpoDeAtribuicao(a)).not.toHaveProperty("capturadaEm");
  });

  it("sem atribuição nenhuma devolve null, e o corpo não carrega objeto vazio", () => {
    expect(corpoDeAtribuicao(null)).toBeNull();
  });
});

describe("as duas funções de apoio", () => {
  it("limparValor devolve undefined para vazio, nulo e só espaço", () => {
    expect(limparValor(undefined)).toBeUndefined();
    expect(limparValor(null)).toBeUndefined();
    expect(limparValor("   ")).toBeUndefined();
    expect(limparValor(" x ")).toBe("x");
  });

  it("temMarcadorDeCampanha vê os sete campos que identificam campanha", () => {
    expect(temMarcadorDeCampanha({ canal: "direto", capturadaEm: 0 })).toBe(false);
    expect(
      temMarcadorDeCampanha({ canal: "direto", utm_term: "x", capturadaEm: 0 }),
    ).toBe(true);
    expect(
      temMarcadorDeCampanha({ canal: "direto", fbclid: "x", capturadaEm: 0 }),
    ).toBe(true);
  });
});
