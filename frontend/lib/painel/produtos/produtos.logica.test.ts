import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  AVISO_SEM_SKU,
  MEDIDAS_PADRAO,
  POR_PAGINA,
  ROTA_DE_NOVO_PRODUTO,
  ROTA_DE_PRODUTOS,
  chipsDosProdutos,
  estadoCorrigido,
  identificarProduto,
  lerEstado,
  medidaEhOPadrao,
  montarConsulta,
  resumoDaCaixa,
  temFiltro,
  temSku,
  urlDaTela,
  urlDoProduto,
  type EstadoDosProdutos,
  type ProdutoDoPainel,
} from "./produtos.logica";

const VAZIO: EstadoDosProdutos = {
  busca: "",
  categoria: "",
  embalagem: "",
  novidade: "",
  pagina: 1,
};

function produto(parcial: Partial<ProdutoDoPainel> = {}): ProdutoDoPainel {
  return {
    product_id: "11111111-1111-4111-8111-111111111111",
    sku: "classico-graos-250",
    name: "Canastra Clássico em grãos 250 g",
    size: "250 g",
    category: "Especial",
    price: "59.90",
    image: null,
    timestamp: null,
    quantity: 12,
    description: null,
    // O `pg` devolve `numeric` como STRING, e é assim que estes campos chegam.
    weight: "0.300",
    width: "20.00",
    height: "5.00",
    length: "20.00",
    ...parcial,
  };
}

describe("MEDIDAS_PADRAO", () => {
  /**
   * O TESTE QUE IMPORTA DESTE ARQUIVO, e ele é de CONTRATO, não de unidade.
   *
   * `medidaEhOPadrao` não procura "um valor plausível": procura a IMPRESSÃO
   * DIGITAL do formulário legado, que é o conjunto exato dos quatro números que
   * o backend aplicava quando os campos não vinham. Se `MEDIDAS_PADRAO` mudar
   * lá e não aqui, o selo "Padrão" da lista para de aparecer — em silêncio,
   * sem erro em lugar nenhum, e justamente nos produtos que ele existe para
   * denunciar. É o mesmo molde de `lib/painel/status.ts`.
   */
  it("tem os mesmos quatro números de backend/src/repositories/dashboardRepository.js", () => {
    const fonte = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "backend",
        "src",
        "repositories",
        "dashboardRepository.js",
      ),
      "utf8",
    );

    const bloco = fonte.match(/MEDIDAS_PADRAO\s*=\s*\{([^}]*)\}/);
    expect(bloco).not.toBeNull();

    function doBackend(chave: string): number {
      const achado = bloco![1].match(new RegExp(`${chave}:\\s*([\\d.]+)`));
      expect(achado, `${chave} não achado em MEDIDAS_PADRAO do backend`).not.toBeNull();
      return Number(achado![1]);
    }

    expect(MEDIDAS_PADRAO.peso).toBe(doBackend("weight"));
    expect(MEDIDAS_PADRAO.largura).toBe(doBackend("width"));
    expect(MEDIDAS_PADRAO.altura).toBe(doBackend("height"));
    expect(MEDIDAS_PADRAO.comprimento).toBe(doBackend("length"));
  });
});

describe("medidaEhOPadrao", () => {
  it("reconhece o padrão vindo como STRING do pg — que é como ele chega", () => {
    expect(medidaEhOPadrao(produto())).toBe(true);
  });

  it("reconhece o padrão vindo como número", () => {
    expect(
      medidaEhOPadrao({ weight: 0.3, width: 20, height: 5, length: 20 }),
    ).toBe(true);
  });

  /**
   * O caso que decide o desenho: UM campo diferente já basta para não ser a
   * assinatura. Marcar por peso sozinho encheria a lista de alarme falso — 0,3
   * kg é o peso mais comum desta loja —, e alarme falso é como se ensina a
   * ignorar o alarme.
   */
  it.each([
    ["peso", { weight: "1.200" }],
    ["largura", { width: "30" }],
    ["altura", { height: "8" }],
    ["comprimento", { length: "25" }],
  ])("não marca quando só o %s é diferente", (_nome, diferenca) => {
    expect(medidaEhOPadrao(produto(diferenca as Partial<ProdutoDoPainel>))).toBe(false);
  });

  it("não marca quando alguma medida é ilegível", () => {
    expect(medidaEhOPadrao(produto({ weight: "" }))).toBe(false);
    expect(medidaEhOPadrao(produto({ width: "undefined" }))).toBe(false);
  });
});

describe("resumoDaCaixa", () => {
  it("escreve com vírgula decimal e com as unidades juntas", () => {
    expect(resumoDaCaixa(produto())).toBe("0,3 kg · 20×5×20 cm");
  });

  /**
   * MEIA MEDIDA É PIOR QUE NENHUMA, porque parece completa: uma linha
   * "0,3 kg · 20××20 cm" seria lida como uma caixa sem altura em vez de como
   * um dado que não deu para ler.
   */
  it("cai inteira para o travessão quando qualquer uma é ilegível", () => {
    expect(resumoDaCaixa(produto({ height: "" }))).toBe("—");
    expect(resumoDaCaixa(produto({ weight: "undefined" }))).toBe("—");
  });
});

describe("lerEstado", () => {
  it("lê os quatro filtros e a página", () => {
    expect(
      lerEstado({
        q: "classico",
        categoria: "Especial",
        embalagem: "250 g",
        novidade: "novos",
        pagina: "3",
      }),
    ).toEqual({
      busca: "classico",
      categoria: "Especial",
      embalagem: "250 g",
      novidade: "novos",
      pagina: 3,
    });
  });

  it("sem parâmetro nenhum, é o estado vazio na página 1", () => {
    expect(lerEstado({})).toEqual(VAZIO);
  });

  /** `?novidade=qualquercoisa` não pode virar um filtro que o backend não
   *  entende — `onlyNew=qualquercoisa` seria ignorado lá e o chip mentiria
   *  aqui, dizendo que há um recorte que não existe. */
  it("recusa um recorte de destaque que não existe", () => {
    expect(lerEstado({ novidade: "inventado" }).novidade).toBe("");
  });

  /** `?q=a&q=b` acontece por link mal colado. Ambiguidade cai no padrão em vez
   *  de escolher uma das duas — senão a tela mostra um filtro que não é o que
   *  está na barra de endereço. */
  it("parâmetro repetido cai no padrão, não escolhe um dos dois", () => {
    expect(lerEstado({ q: ["a", "b"] }).busca).toBe("");
    expect(lerEstado({ pagina: ["2", "9"] }).pagina).toBe(1);
  });

  it("página inválida vira 1", () => {
    expect(lerEstado({ pagina: "0" }).pagina).toBe(1);
    expect(lerEstado({ pagina: "-4" }).pagina).toBe(1);
    expect(lerEstado({ pagina: "abc" }).pagina).toBe(1);
  });
});

describe("montarConsulta", () => {
  it("sem filtro, manda só página e limite — e o limite é sempre explícito", () => {
    // O padrão do backend é 10, e uma tela que pagina de 20 em 20 mostrando 10
    // linhas é uma tela que discorda do próprio rodapé.
    expect(montarConsulta(VAZIO)).toBe(`/dashboard?page=1&limit=${POR_PAGINA}`);
  });

  /** A tela fala "embalagem" e o contrato fala `size`. A tradução acontece num
   *  lugar só; espalhada por cada link ela divergiria no primeiro descuido. */
  it("traduz embalagem para `size` e categoria para `category`", () => {
    const url = montarConsulta({ ...VAZIO, embalagem: "250 g", categoria: "Especial" });
    expect(url).toContain("size=250+g");
    expect(url).toContain("category=Especial");
    expect(url).not.toContain("embalagem=");
  });

  it("`q` vai CRU — o backend é quem limpa a pontuação de cada termo", () => {
    expect(montarConsulta({ ...VAZIO, busca: "café & cia" })).toContain(
      "q=caf%C3%A9+%26+cia",
    );
  });

  it("traduz o recorte de destaque nos dois sentidos", () => {
    expect(montarConsulta({ ...VAZIO, novidade: "novos" })).toContain("onlyNew=true");
    expect(montarConsulta({ ...VAZIO, novidade: "novos" })).not.toContain("onlyOld");
    expect(montarConsulta({ ...VAZIO, novidade: "antigos" })).toContain("onlyOld=true");
  });
});

describe("urlDaTela", () => {
  it("estado vazio é a rota limpa — sem `?pagina=1`", () => {
    // Duas URLs para a mesma tela são duas entradas no histórico e dois
    // favoritos que o gestor não sabe distinguir.
    expect(urlDaTela(VAZIO)).toBe(ROTA_DE_PRODUTOS);
    expect(urlDaTela({})).toBe(ROTA_DE_PRODUTOS);
  });

  it("carrega os filtros junto ao virar a página", () => {
    const url = urlDaTela({ ...VAZIO, busca: "classico", categoria: "Especial", pagina: 3 });
    expect(url).toContain("q=classico");
    expect(url).toContain("categoria=Especial");
    expect(url).toContain("pagina=3");
  });

  it("o id do produto vive na URL, nunca em memória", () => {
    expect(urlDoProduto("abc")).toBe(`${ROTA_DE_PRODUTOS}/abc`);
    expect(ROTA_DE_NOVO_PRODUTO).toBe(`${ROTA_DE_PRODUTOS}/novo`);
  });
});

describe("estadoCorrigido", () => {
  /** O favorito velho: `?pagina=9` num catálogo que encolheu. Sem a trava, a
   *  tela desenha "nenhum resultado para este filtro", que se lê como "o filtro
   *  não achou nada" e não como "esta página não existe". */
  it("prende a página na última que existe", () => {
    expect(estadoCorrigido({ ...VAZIO, pagina: 9 }, 25).pagina).toBe(2);
  });

  it("catálogo vazio ainda tem a página 1", () => {
    expect(estadoCorrigido({ ...VAZIO, pagina: 4 }, 0).pagina).toBe(1);
  });
});

describe("chipsDosProdutos", () => {
  it("sem filtro, nenhum chip", () => {
    expect(chipsDosProdutos(VAZIO)).toEqual([]);
    expect(temFiltro(VAZIO)).toBe(false);
  });

  it("um chip por dimensão ativa", () => {
    const chips = chipsDosProdutos({
      busca: "classico",
      categoria: "Especial",
      embalagem: "250 g",
      novidade: "novos",
      pagina: 2,
    });
    expect(chips.map((c) => c.chave)).toEqual(["q", "categoria", "embalagem", "novidade"]);
  });

  /**
   * A REGRA QUE O R3 EXISTE PARA GARANTIR: tirar um filtro estando na página 4
   * e continuar na 4 é o jeito mais rápido de fazer uma lista sem filtro
   * parecer vazia.
   */
  it("todo href de remoção volta para a página 1", () => {
    const chips = chipsDosProdutos({
      busca: "classico",
      categoria: "Especial",
      embalagem: "250 g",
      novidade: "antigos",
      pagina: 7,
    });
    for (const chip of chips) {
      expect(chip.href).not.toContain("pagina=");
    }
  });

  it("remover um filtro preserva os outros", () => {
    const chips = chipsDosProdutos({ ...VAZIO, busca: "classico", categoria: "Especial" });
    const daBusca = chips.find((c) => c.chave === "q")!;
    expect(daBusca.href).toContain("categoria=Especial");
    expect(daBusca.href).not.toContain("q=");
  });

  /** O chip mostra o que a PESSOA digitou: ela precisa reconhecer o próprio
   *  texto para saber o que está removendo. */
  it("o valor do chip de busca é o texto digitado", () => {
    const [chip] = chipsDosProdutos({ ...VAZIO, busca: "Café Clássico" });
    expect(chip.valor).toBe("Café Clássico");
  });

  it("o recorte de destaque vira palavra, não `onlyNew`", () => {
    const [chip] = chipsDosProdutos({ ...VAZIO, novidade: "novos" });
    expect(chip.valor).toBe("Destacados há 5 dias");
  });
});

describe("identificarProduto", () => {
  it("é o nome — R23, nunca o UUID", () => {
    expect(identificarProduto(produto())).toBe("Canastra Clássico em grãos 250 g");
  });

  /** Cadastro herdado sem nome existe. Aí o SKU É o identificador humano,
   *  porque é por ele que o café aparece na vitrine e no Bling. */
  it("cai no SKU quando não há nome", () => {
    expect(identificarProduto({ name: "  ", sku: "classico-250" })).toBe("classico-250");
  });

  it("sem nenhum dos dois, diz que não há — não devolve célula vazia", () => {
    expect(identificarProduto({ name: null, sku: null })).toBe("Sem nome");
  });
});

describe("temSku", () => {
  it("espaço em branco não é SKU", () => {
    expect(temSku({ sku: "   " })).toBe(false);
    expect(temSku({ sku: null })).toBe(false);
    expect(temSku({ sku: "classico-250" })).toBe(true);
  });

  /** A frase diz a CONSEQUÊNCIA e não a ausência: "não informado" não faz
   *  ninguém ir preencher; "não aparece na loja" faz. */
  it("o aviso fala do efeito na loja, não do campo vazio", () => {
    expect(AVISO_SEM_SKU).toContain("loja");
  });
});
