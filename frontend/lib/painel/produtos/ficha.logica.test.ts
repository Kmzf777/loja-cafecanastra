import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ABAS,
  ABA_DO_CAMPO,
  FORMULARIO_VAZIO,
  LIMITE_DE_IMAGEM_BYTES,
  abasComErro,
  abasComMudanca,
  camposMudados,
  corpoDoProduto,
  estaSujo,
  formularioDoProduto,
  lerAba,
  margem,
  medidasDaForma,
  paraNumero,
  recusaDaImagem,
  recusaDoCusto,
  validar,
  type FormularioDoProduto,
} from "./ficha.logica";
import type { ProdutoDoPainel } from "./produtos.logica";

const DA_API: ProdutoDoPainel = {
  product_id: "11111111-1111-4111-8111-111111111111",
  sku: "classico-graos-250",
  name: "Canastra Clássico em grãos 250 g",
  size: "250 g",
  category: "Especial",
  // O `pg` devolve `numeric` como STRING, com as casas do tipo.
  price: "59.90",
  image: "https://res.cloudinary.com/x/canastra_produtos/a.jpg",
  timestamp: null,
  quantity: 12,
  description: "Doce, com corpo médio.",
  weight: "1.200",
  width: "24.00",
  height: "9.00",
  length: "31.00",
};

const BOM: FormularioDoProduto = {
  nome: "Café",
  sku: "sku-1",
  embalagem: "250 g",
  categoria: "Especial",
  preco: "59,90",
  estoque: "12",
  descricao: "",
  peso: "1,2",
  largura: "24",
  altura: "9",
  comprimento: "31",
};

describe("formularioDoProduto", () => {
  it("traz os onze campos, com o ponto do banco virado vírgula", () => {
    expect(formularioDoProduto(DA_API)).toEqual({
      nome: "Canastra Clássico em grãos 250 g",
      sku: "classico-graos-250",
      embalagem: "250 g",
      categoria: "Especial",
      preco: "59,90",
      estoque: "12",
      descricao: "Doce, com corpo médio.",
      peso: "1,200",
      largura: "24,00",
      altura: "9,00",
      comprimento: "31,00",
    });
  });

  /** `null` no banco é campo em branco no formulário, e nunca a string "null"
   *  — que é o que sai de um `String(valor)` desatento e o que o backend
   *  gravaria de volta como texto. */
  it("null vira campo vazio, nunca a palavra null", () => {
    const f = formularioDoProduto({ ...DA_API, size: null, category: null, description: null });
    expect(f.embalagem).toBe("");
    expect(f.categoria).toBe("");
    expect(f.descricao).toBe("");
  });

  /**
   * O CADASTRO NOVO NASCE COM OS PADRÕES DA CAIXA VISÍVEIS. São os mesmos
   * números que o backend aplicaria — a diferença, que é o ponto inteiro desta
   * tela, é que aqui eles estão na tela, onde dá para conferir antes de salvar.
   */
  it("o formulário vazio já mostra a caixa padrão", () => {
    expect(FORMULARIO_VAZIO.peso).toBe("0,3");
    expect(FORMULARIO_VAZIO.largura).toBe("20");
    expect(FORMULARIO_VAZIO.altura).toBe("5");
    expect(FORMULARIO_VAZIO.comprimento).toBe("20");
  });
});

describe("paraNumero", () => {
  it("aceita vírgula e ponto", () => {
    expect(paraNumero("59,90")).toBe(59.9);
    expect(paraNumero("59.90")).toBe(59.9);
  });

  /** `Number("")` é `0`, e um zero silencioso num campo de preço publica um
   *  café de graça. Vazio é NaN, e NaN vira erro de campo. */
  it("vazio é NaN, nunca zero", () => {
    expect(paraNumero("")).toBeNaN();
    expect(paraNumero("   ")).toBeNaN();
  });

  it("lixo é NaN", () => {
    expect(paraNumero("undefined")).toBeNaN();
  });
});

describe("validar", () => {
  it("um formulário bom não tem erro", () => {
    expect(validar(BOM)).toEqual({});
  });

  it.each([
    ["nome curto", { nome: "C" }, "nome"],
    ["nome longo", { nome: "x".repeat(201) }, "nome"],
    ["preço vazio", { preco: "" }, "preco"],
    ["preço negativo", { preco: "-1" }, "preco"],
    ["preço acima do teto", { preco: "1000001" }, "preco"],
    ["estoque vazio", { estoque: "" }, "estoque"],
    ["estoque fracionado", { estoque: "1,5" }, "estoque"],
    ["estoque negativo", { estoque: "-1" }, "estoque"],
  ])("cobra %s", (_caso, mudanca, campo) => {
    const erros = validar({ ...BOM, ...(mudanca as Partial<FormularioDoProduto>) });
    expect(erros[campo as keyof FormularioDoProduto]).toBeTruthy();
  });

  /**
   * AS QUATRO MEDIDAS SÃO O DEFEITO MEDIDO DESTA TELA, e por isso a validação é
   * MAIS severa que a do backend: lá, campo em branco cai no valor atual do
   * banco (a rede de segurança da Onda 4); aqui, campo em branco é um formulário
   * incompleto. Uma caixa de 0 cm de altura também passa no backend
   * (`numeroPositivo` recusa negativo, não zero) e cotaria frete de um pacote
   * sem volume.
   */
  it.each(["peso", "largura", "altura", "comprimento"] as const)(
    "exige %s preenchido e maior que zero",
    (campo) => {
      expect(validar({ ...BOM, [campo]: "" })[campo]).toBeTruthy();
      expect(validar({ ...BOM, [campo]: "0" })[campo]).toBeTruthy();
      expect(validar({ ...BOM, [campo]: "-2" })[campo]).toBeTruthy();
    },
  );

  /** A frase diz o EFEITO, não só o formato: "é ele que cota o frete" é a única
   *  coisa que faz alguém parar para conferir o número. */
  it("a frase da medida diz para que ela serve", () => {
    expect(validar({ ...BOM, peso: "" }).peso).toContain("frete");
  });

  /** O SKU não é obrigatório no backend, e a tela não inventa uma exigência que
   *  bloquearia o cadastro herdado. O que ela faz é AVISAR — na ajuda do campo
   *  e no selo da lista. */
  it("SKU vazio não é erro de formulário", () => {
    expect(validar({ ...BOM, sku: "" })).toEqual({});
  });
});

describe("corpoDoProduto", () => {
  /**
   * A REGRA CENTRAL: `PUT /dashboard/:id` NÃO É PARCIAL. O `UPDATE` escreve
   * doze colunas sempre — `description` ausente vira `""`, `size` e `category`
   * ausentes viram NULL. Um payload "só o que mudou" apagaria a descrição de
   * todo café a cada correção de preço, e apagaria calado.
   */
  it("manda TODOS os campos do catálogo, inclusive os vazios", () => {
    const corpo = corpoDoProduto({ ...BOM, embalagem: "", categoria: "", descricao: "" });
    expect(corpo.size).toBe("");
    expect(corpo.category).toBe("");
    expect(corpo.description).toBe("");
  });

  /**
   * A EXCEÇÃO, E ELA É NO OUTRO SENTIDO: SKU vazio no corpo vira NULL na
   * coluna, e SKU nulo tira o café da vitrine — `repositorio.ts` casa por SKU e
   * descarta quem não tem. Apagar sem querer o conteúdo do campo e salvar não
   * pode tirar o produto da loja, então o campo em branco é OMITIDO.
   */
  it("omite o SKU vazio — omitir preserva, mandar vazio apagaria", () => {
    expect(corpoDoProduto({ ...BOM, sku: "" })).not.toHaveProperty("sku");
    expect(corpoDoProduto({ ...BOM, sku: "  " })).not.toHaveProperty("sku");
    expect(corpoDoProduto(BOM).sku).toBe("sku-1");
  });

  /** Do outro lado é `Number(...)`, e `Number("59,90")` é NaN — que cai no
   *  padrão sem reclamar. A tela mostra vírgula; o fio fala a língua do
   *  `Number`. */
  it("os números saem com ponto, nunca com a vírgula que se digita", () => {
    const corpo = corpoDoProduto(BOM);
    expect(corpo.price).toBe("59.9");
    expect(corpo.weight).toBe("1.2");
  });

  /** É esta linha que fecha o defeito: o formulário legado mandava os quatro
   *  sem ter input para nenhum, e `undefined` virava a string "undefined". */
  it("as quatro medidas vão SEMPRE, com os valores reais", () => {
    const corpo = corpoDoProduto(BOM);
    expect(corpo.weight).toBe("1.2");
    expect(corpo.width).toBe("24");
    expect(corpo.height).toBe("9");
    expect(corpo.length).toBe("31");
    expect(Object.values(corpo)).not.toContain("undefined");
  });

  it("o nome vai com trim — o backend conta os caracteres", () => {
    expect(corpoDoProduto({ ...BOM, nome: "  Café  " }).name).toBe("Café");
  });
});

describe("estaSujo / camposMudados", () => {
  it("igual não está sujo", () => {
    expect(estaSujo(BOM, { ...BOM })).toBe(false);
    expect(camposMudados(BOM, { ...BOM })).toEqual([]);
  });

  it("um campo diferente já suja, e diz qual", () => {
    expect(estaSujo(BOM, { ...BOM, preco: "60" })).toBe(true);
    expect(camposMudados(BOM, { ...BOM, preco: "60", peso: "2" })).toEqual([
      "preco",
      "peso",
    ]);
  });
});

describe("as abas", () => {
  it("são quatro, na ordem do trabalho", () => {
    expect(ABAS.map((a) => a.chave)).toEqual(["venda", "conteudo", "fiscal", "seo"]);
  });

  it("todo campo do formulário mora numa aba", () => {
    for (const campo of Object.keys(BOM) as (keyof FormularioDoProduto)[]) {
      expect(ABA_DO_CAMPO[campo], `${campo} sem aba`).toBeTruthy();
    }
  });

  /** As medidas ficam em "Fiscal" porque é onde se procura peso — é dele que
   *  saem a nota e a etiqueta dos Correios. */
  it("as quatro medidas estão na aba fiscal", () => {
    expect(ABA_DO_CAMPO.peso).toBe("fiscal");
    expect(ABA_DO_CAMPO.largura).toBe("fiscal");
    expect(ABA_DO_CAMPO.altura).toBe("fiscal");
    expect(ABA_DO_CAMPO.comprimento).toBe("fiscal");
  });

  /**
   * O MODO DE FALHA QUE ESTE MAPA FECHA: o gestor clica em Salvar, a tarja diz
   * "confira os campos marcados", e o campo marcado está numa aba FECHADA —
   * nada muda na tela e ele clica de novo até desistir.
   */
  it("abasComErro devolve as abas na ORDEM DA TELA, para o salto ir à primeira", () => {
    const erros = validar({ ...BOM, peso: "", nome: "" });
    expect(abasComErro(erros)).toEqual(["venda", "fiscal"]);
  });

  it("abasComMudanca marca onde há trabalho pendente", () => {
    expect(abasComMudanca(BOM, { ...BOM, descricao: "nova", altura: "10" })).toEqual([
      "conteudo",
      "fiscal",
    ]);
  });

  it("lerAba aceita só as quatro, e o resto cai em venda", () => {
    expect(lerAba("fiscal")).toBe("fiscal");
    expect(lerAba("inventada")).toBe("venda");
    expect(lerAba(undefined)).toBe("venda");
    // `?aba=a&aba=b` por link mal colado: ambiguidade cai no padrão.
    expect(lerAba(["fiscal", "seo"])).toBe("venda");
  });
});

describe("recusaDaImagem", () => {
  /**
   * AS FRASES SÃO AS DO SERVIDOR, PALAVRA POR PALAVRA — e este teste as compara
   * com o arquivo do backend lido do disco. Duas redações para a mesma recusa
   * fazem o gestor achar que são dois problemas; e o limite de 5 MB escrito em
   * dois lugares diverge no dia em que alguém mexer num só.
   */
  it("usa o mesmo limite de bytes de backend/src/middleware/erroDeUpload.js", () => {
    const fonte = readFileSync(
      join(__dirname, "..", "..", "..", "..", "backend", "src", "middleware", "erroDeUpload.js"),
      "utf8",
    );
    const achado = fonte.match(/LIMITE_DE_TAMANHO_BYTES\s*=\s*([\d\s*]+);/);
    expect(achado).not.toBeNull();
    // `5 * 1024 * 1024` lido do arquivo, multiplicado à mão. `eval` daria o
    // mesmo número por um caminho que ninguém quer ver num teste.
    const doBackend = achado![1]
      .split("*")
      .map((parte) => Number(parte.trim()))
      .reduce((a, b) => a * b, 1);
    expect(LIMITE_DE_IMAGEM_BYTES).toBe(doBackend);
  });

  it("repete a frase de formato do fileFilter do multer", () => {
    const fonte = readFileSync(
      join(__dirname, "..", "..", "..", "..", "backend", "src", "middleware", "multer.js"),
      "utf8",
    );
    const recusa = recusaDaImagem({ size: 10, type: "image/heic" });
    expect(recusa).not.toBeNull();
    expect(fonte).toContain(recusa!);
  });

  it("aceita os quatro formatos da casa", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/avif"]) {
      expect(recusaDaImagem({ size: 1000, type })).toBeNull();
    }
  });

  it("recusa acima de 5 MB, com o número na frase", () => {
    const recusa = recusaDaImagem({ size: LIMITE_DE_IMAGEM_BYTES + 1, type: "image/png" });
    expect(recusa).toContain("5 MB");
  });

  it("exatamente no limite passa — o backend usa `>`", () => {
    expect(recusaDaImagem({ size: LIMITE_DE_IMAGEM_BYTES, type: "image/png" })).toBeNull();
  });
});

describe("recusaDoCusto", () => {
  it("espelha o teto do backend", () => {
    expect(recusaDoCusto("0")).toBeNull();
    expect(recusaDoCusto("1000000")).toBeNull();
    expect(recusaDoCusto("1000001")).toContain("teto");
    expect(recusaDoCusto("-1")).toContain("negativo");
    expect(recusaDoCusto("")).toContain("reais");
  });
});

describe("margem", () => {
  it("responde em reais e em pontos percentuais", () => {
    const m = margem("100", "40")!;
    expect(m.reais).toBe(60);
    expect(m.percentual).toBeCloseTo(60);
  });

  /**
   * `null` PARA OS DOIS CASOS DE AUSÊNCIA, e de propósito: custo zero é o
   * DEFAULT da coluna, ou seja "nunca foi informado". Um "100% de margem" ali
   * seria uma afirmação inventada a partir da falta de dado — e margem é número
   * de decisão.
   */
  it("custo zero não vira 100% de margem", () => {
    expect(margem("100", "0")).toBeNull();
  });

  it("preço zero não calcula", () => {
    expect(margem("0", "10")).toBeNull();
  });

  it("entrada ilegível não calcula", () => {
    expect(margem("abc", "10")).toBeNull();
  });
});

describe("medidasDaForma", () => {
  /**
   * O AVISO OLHA A TELA, NÃO O BANCO. A versão anterior comparava o produto que
   * o servidor mandou: quem corrigisse o peso continuaria lendo "as quatro
   * medidas estão nos valores padrão" com o campo já corrigido à frente, até
   * salvar e recarregar. Um aviso que não acompanha a correção ensina a ignorar
   * o aviso.
   */
  it("converte a vírgula do formulário no número que a comparação usa", () => {
    expect(
      medidasDaForma({ ...BOM, peso: "0,3", largura: "20", altura: "5", comprimento: "20" }),
    ).toEqual({ weight: 0.3, width: 20, height: 5, length: 20 });
  });

  it("campo vazio vira NaN, e NaN nunca casa com o padrão", () => {
    expect(medidasDaForma({ ...BOM, peso: "" }).weight).toBeNaN();
  });
});
