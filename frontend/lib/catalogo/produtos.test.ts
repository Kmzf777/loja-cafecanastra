import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import bruto from "../../../data/catalogo-canastra.json";
import traduzido from "../../../data/catalogo-canastra.i18n.json";
import {
  KITS_DA_LOJA,
  LOTES,
  MARCA,
  lotesDoLocale,
  nomeDoKitNaSacola,
  traduzirKit,
  traduzirLote,
} from "./produtos";
import { rotuloDaEmbalagem, rotuloDoAtributo, rotuloNota } from "./rotulos";
import { MOAGENS } from "./tipos";
import { dicionario } from "../i18n/dicionario";
import { LOCALES } from "../i18n/tipos";
import type { Locale } from "../i18n/tipos";

const PUBLIC = fileURLToPath(new URL("../../public/", import.meta.url));

/**
 * Le largura/altura de um PNG: bloco IHDR, bytes 16..23, big-endian. Sem
 * dependencia — um PNG valido sempre traz o IHDR como primeiro chunk.
 */
function dimensoesPng(caminho: string): { w: number; h: number } | null {
  const b = readFileSync(caminho);
  if (b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/**
 * O mesmo para JPEG, varrendo os marcadores ate o SOF (Start Of Frame).
 *
 * JPEG nao tem cabecalho de tamanho fixo: e uma sequencia de segmentos
 * `FF <marcador> <tamanho:2>`, e a altura/largura so aparecem no SOFn — o
 * unico marcador da familia C0..CF que NAO e tabela de Huffman (C4),
 * reinicio (C8) ou aritmetica (CC). Por isso o pulo e por `tamanho`, e nao
 * uma leitura de deslocamento fixo.
 *
 * Este formato entrou no acervo com as fotos de estudio do pacote
 * (`imagemEstudio`), que sao JPEG e nao PNG.
 */
function dimensoesJpeg(caminho: string): { w: number; h: number } | null {
  const b = readFileSync(caminho);
  if (b.readUInt16BE(0) !== 0xffd8) return null;

  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marcador = b[i + 1];
    const ehSof =
      marcador >= 0xc0 &&
      marcador <= 0xcf &&
      marcador !== 0xc4 &&
      marcador !== 0xc8 &&
      marcador !== 0xcc;
    if (ehSof) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

/**
 * Devolve null se o arquivo nao for PNG nem JPEG, e o teste trata isso como
 * falha explicita (ver comentario no caso de teste).
 */
function dimensoesDaImagem(caminho: string): { w: number; h: number } | null {
  return dimensoesPng(caminho) ?? dimensoesJpeg(caminho);
}

describe("dados brutos do catalogo (data/catalogo-canastra.json)", () => {
  it("tem sku unico por produto", () => {
    const skus = bruto.produtos.map((p) => p.sku);
    expect(new Set(skus).size).toBe(skus.length);
  });

  it("so aponta para linhas que existem", () => {
    const linhas = new Set(bruto.linhas.map((l) => l.slug));
    for (const p of bruto.produtos) {
      expect(linhas.has(p.linha), `${p.sku} aponta para linha "${p.linha}"`).toBe(true);
    }
  });

  it("declara procedencia em todo produto", () => {
    // A regra que separa este catalogo do mock anterior: nenhum dado entra sem
    // dizer de onde veio. Se alguem acrescentar um SKU sem `fonte`, o teste
    // falha antes de o dado chegar na vitrine.
    const validas = ["captura-loja", "pesquisa-web", "embalagem", "inferido"];
    for (const p of bruto.produtos) {
      expect(validas, `${p.sku} tem fonte "${p.fonte}"`).toContain(p.fonte);
    }
  });

  it("usa centavos inteiros e nao negativos", () => {
    for (const p of bruto.produtos) {
      expect(Number.isInteger(p.precoCentavos), `${p.sku}`).toBe(true);
      expect(p.precoCentavos, `${p.sku}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("so deixa preco zerado quando o produto esta esgotado", () => {
    // Preco 0 significa "a loja nao exibe valor porque acabou". Um produto
    // comprável com preço zero seria erro de digitação virando prejuízo.
    for (const p of bruto.produtos) {
      if (p.precoCentavos === 0) {
        expect(p.estoque, `${p.sku} tem preco 0 mas estoque ${p.estoque}`).toBe(0);
      }
    }
  });

  it("mantem os precos lidos na loja", () => {
    // Ancora contra edicao acidental: estes quatro valores foram lidos na tela
    // da loja real. Se mudarem, que seja de proposito.
    const porSku = new Map(bruto.produtos.map((p) => [p.sku, p.precoCentavos]));
    expect(porSku.get("classico-graos-250")).toBe(3970);
    expect(porSku.get("classico-graos-500")).toBe(6570);
    expect(porSku.get("classico-graos-1000")).toBe(10990);
    expect(porSku.get("microlote-graos-250")).toBe(4370);
  });

  it("tem a mesma contagem de 'em graos' que a categoria da loja", () => {
    // A loja mostra "Em grãos (9)" no filtro de categoria. Bater esse numero e
    // a evidencia mais barata de que nao falta nem sobra SKU nessa familia.
    const emGraos = bruto.produtos.filter((p) => p.formato === "graos");
    expect(emGraos).toHaveLength(9);
  });
});

describe("catalogo montado", () => {
  it("tem uma linha por familia real", () => {
    expect(LOTES.map((l) => l.slug).sort()).toEqual(
      ["canela", "classico", "microlote", "nectar-de-minas", "suave"].sort(),
    );
  });

  it("tem slugs unicos", () => {
    const slugs = LOTES.map((l) => l.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("declara a SCA de cada linha, e diz se e piso ou nota", () => {
    /**
     * O piso da coleção continua sendo 80 — é o que a embalagem dos pacotes
     * Canastra estampa. O que mudou é que DUAS linhas têm nota publicada pela
     * marca, e ela vence o piso:
     *
     *   Microlote ......... 86, e "80+" o subestimava;
     *   Néctar de Minas ... 75, e "80+" MENTIA. Abaixo de 80 não é café
     *                       especial pela definição da própria SCA — é
     *                       gourmet, que é o que a embalagem dele diz.
     *
     * Decimal continua proibido em todas: o mock antigo trazia 84,25 e 85,50,
     * pontuações que nenhuma prova de xícara desta casa produziu.
     */
    expect(MARCA.sca).toBe(80);

    const esperado: Record<string, { sca: number; exata: boolean }> = {
      classico: { sca: 80, exata: false },
      suave: { sca: 80, exata: false },
      canela: { sca: 80, exata: false },
      microlote: { sca: 86, exata: true },
      "nectar-de-minas": { sca: 75, exata: true },
    };

    for (const lote of LOTES) {
      expect(esperado[lote.slug], `${lote.slug} sem SCA declarada no teste`).toBeDefined();
      expect(lote.sca, lote.slug).toBe(esperado[lote.slug].sca);
      expect(lote.scaExata, lote.slug).toBe(esperado[lote.slug].exata);
      expect(Number.isInteger(lote.sca), lote.slug).toBe(true);
    }
  });

  it("o texto da torra e o ponto da escala nunca divergem", () => {
    // São duas representações do MESMO dado — o texto que a marca publica
    // ("Torra escura") e o 1-5 que desenha a barra do <PontoTorra>. Divergir
    // significa a barra contradizer a legenda ao lado dela, no mesmo card.
    for (const lote of LOTES) {
      expect(lote.torra, lote.slug).toBe(
        dicionario("pt").catalogo.pontoTorra[lote.pontoTorra],
      );
    }
  });

  it("declara procedencia em toda LINHA, com o vocabulario do _leia_me", () => {
    // A mesma regra que já vale para os produtos: nenhum dado editorial entra
    // sem dizer de onde veio. As descrições sensoriais, a torra, a intensidade
    // e a pontuação SCA passaram a vir do material da própria marca, e isso é
    // uma procedência nova — declarada no `_leia_me`, não improvisada aqui.
    const validas = Object.keys(bruto._leia_me.procedencia);
    expect(validas.length).toBeGreaterThan(0);
    for (const linha of bruto.linhas) {
      expect(validas, `${linha.slug} tem fonte "${linha.fonte}"`).toContain(linha.fonte);
    }
  });

  it("so usa moagens do contrato", () => {
    const validas = new Set<string>(MOAGENS);
    for (const lote of LOTES) {
      for (const v of lote.variantes) expect(validas.has(v.moagem)).toBe(true);
    }
  });

  it("tem ponto de torra entre 1 e 5", () => {
    for (const lote of LOTES) {
      expect(lote.pontoTorra).toBeGreaterThanOrEqual(1);
      expect(lote.pontoTorra).toBeLessThanOrEqual(5);
    }
  });

  it("so vende peso que a loja embala", () => {
    for (const lote of LOTES) {
      for (const v of lote.variantes) {
        expect([250, 500, 1000], `${v.sku}`).toContain(v.pesoGramas);
      }
    }
  });

  it("mantem a variante rastreavel ate o SKU da loja", () => {
    const skus = new Set(bruto.produtos.map((p) => p.sku));
    for (const lote of LOTES) {
      for (const v of lote.variantes) {
        expect(skus.has(v.skuLoja), `${v.sku} -> ${v.skuLoja}`).toBe(true);
      }
    }
  });

  it("gera UMA variante por SKU de pacote — moer nao multiplica produto", () => {
    // Este era o defeito estrutural: "moído" virava SEIS variantes, uma por
    // método de preparo, TODAS com o mesmo skuLoja, o mesmo preço e o mesmo
    // estoque. Moer é serviço, não outro produto. Se a multiplicação voltar, a
    // contagem aqui estoura antes de a PDP mostrar sete botões de novo.
    for (const lote of LOTES) {
      const skus = lote.variantes.map((v) => v.skuLoja);
      expect(new Set(skus).size, `${lote.slug} repete skuLoja`).toBe(skus.length);
    }
  });

  it("NENHUM skuLoja mudou: o conjunto e exatamente o do JSON", () => {
    // A trava que protege o caminho de venda. O `sku` da vitrine é chave de
    // combinação e pode mudar; o `skuLoja` é a identidade no banco, no Bling e
    // na nota fiscal — se um sumir ou aparecer aqui, alguém quebrou o
    // casamento por SKU de `aplicarDadosAoVivo` e a variante deixa de ter
    // preço, estoque e `produtoId`.
    const pesos = [250, 500, 1000];
    for (const lote of LOTES) {
      const doJson = (bruto.produtos as { sku: string; linha: string; formato: string; gramas: number; kit?: boolean }[])
        .filter(
          (p) =>
            p.linha === lote.slug &&
            !p.kit &&
            (p.formato === "graos" || p.formato === "moido") &&
            pesos.includes(p.gramas),
        )
        .map((p) => p.sku);

      expect(lote.variantes.map((v) => v.skuLoja).sort(), lote.slug).toEqual(
        [...doJson].sort(),
      );
    }
  });

  it("da a cada variante a moagem que o formato do pacote implica", () => {
    for (const lote of LOTES) {
      for (const v of lote.variantes) {
        expect(v.moagem, v.sku).toBe(v.formato === "graos" ? "grao" : "moido");
      }
    }
  });

  it("nao poe kit nos formatos especiais de linha nenhuma", () => {
    // Os kits de capsula tem `kit: true` E `formato: "capsula"` E uma linha
    // dominante — sem o filtro `!p.kit` em especiaisDa eles apareciam na PDP
    // do Classico como formato especial, duplicando o card da secao de kits.
    const skusDeKit = new Set(
      bruto.produtos.filter((p) => "kit" in p && p.kit).map((p) => p.sku),
    );
    expect(skusDeKit.size).toBeGreaterThan(0);
    for (const lote of LOTES) {
      for (const f of lote.formatosEspeciais) {
        expect(skusDeKit.has(f.sku), `${lote.slug} expõe o kit ${f.sku}`).toBe(false);
      }
    }
  });

  it("nao expoe mais campos de lavoura inventados", () => {
    // Guarda de regressao: altitude, produtor e safra por lote foram removidos
    // do contrato porque eram ficcao. Se voltarem, alguem os reintroduziu.
    for (const lote of LOTES) {
      expect(lote).not.toHaveProperty("lavoura");
      expect(lote.origem.regiao).toContain("Canastra");
    }
  });

  it("variedade e dado da MARCA, e nao de cada lote", () => {
    /**
     * O DEFEITO, E ELE ESTAVA NA TELA. `monta()` copiava
     * `bruto.marca.variedades` para `origem.variedades` de CADA lote, e a PDP
     * escrevia "Blend 100% arabica das variedades Araras, Caturra 2SL e
     * Paraiso" nas cinco linhas. Araras, Caturra 2SL e Paraiso sao o que a
     * CASA planta — dado da marca, declarado uma vez e explicado em
     * `marca.variedades_observacao`. Duas linhas nao alcancam essa fonte: o
     * Microlote e um lote separado por definicao, e o Nectar de Minas e marca
     * irma, com 75 pontos e pacote proprio. Nenhuma das duas tem composicao
     * publicada, e afirmar por heranca e inventar.
     *
     * A afirmacao continua viva onde e verdadeira: /a-serra le
     * `MARCA.variedades` e a apresenta como "As variedades da Canastra".
     */
    for (const lote of LOTES) {
      expect(lote.origem, lote.slug).not.toHaveProperty("variedades");
    }
    expect(MARCA.variedades.length).toBeGreaterThan(0);
    expect(MARCA.variedades).toContain("Araras");
  });

  it("tem alt text descritivo em toda foto", () => {
    for (const lote of LOTES) {
      expect(lote.fotos.sabor.alt.length).toBeGreaterThan(10);
      expect(lote.fotos.pacote.alt.length).toBeGreaterThan(10);
    }
  });

  // O w/h declarado e a caixa de layout que o next/image reserva. Se divergir
  // do arquivo real, a imagem distorce e o CLS estoura — estetica.md §10 exige
  // CLS < 0,05. Nem tsc nem next build enxergam esse erro; so este teste.
  it("declara w/h iguais ao arquivo real em public/", () => {
    for (const lote of LOTES) {
      for (const [papel, foto] of Object.entries(lote.fotos)) {
        if (!foto) continue;
        const onde = `${lote.slug}.${papel} (${foto.src})`;
        const caminho = join(PUBLIC, foto.src.replace(/^\//, ""));

        expect(existsSync(caminho), `${onde}: arquivo nao existe em public/`).toBe(true);

        // Falha de proposito se o ativo migrar para AVIF/WebP (previsto no §8):
        // e um lembrete para estender dimensoesDaImagem(), nao para apagar o
        // teste. Foi o que aconteceu com o JPEG das fotos de estudio.
        const real = dimensoesDaImagem(caminho);
        expect(real, `${onde}: nao e PNG nem JPEG — estenda dimensoesDaImagem() para o novo formato`).not.toBeNull();

        expect({ w: foto.w, h: foto.h }, `${onde}: dimensao declarada difere do arquivo`).toEqual(real);
      }
    }
  });
});

/**
 * O editorial em ingles e espanhol.
 *
 * A traducao vive num arquivo SEPARADO (data/catalogo-canastra.i18n.json)
 * porque catalogo-canastra.json e lido tambem por backend/db/seed.js: mexer na
 * forma dele arriscaria o caminho de venda para ganhar texto. Estes testes
 * guardam as duas pontas — o que o arquivo de traducao pode conter, e o que a
 * fusao faz com ele.
 */

/**
 * As linhas do arquivo de traducao.
 *
 * O ARQUIVO GANHOU SECOES, e este `Object.entries` deixou de filtrar `_leia_me`
 * por causa disso: os slugs de linha moravam na raiz, ao lado da documentacao,
 * e agora ha `linhas` e `kits`. Um kit tem `sku` e nao `slug`, e por na mesma
 * gaveta duas chaves de espacos diferentes era esperar a primeira colisao.
 */
const TRADUZIDAS = Object.entries(traduzido.linhas) as [
  string,
  Record<string, Record<string, string | string[]>>,
][];

const TRADUZIDOS_KITS = Object.entries(traduzido.kits) as [
  string,
  Record<string, Record<string, string>>,
][];

/** Os idiomas que este arquivo traduz — o `pt` e a fonte, nao uma traducao. */
const IDIOMAS_TRADUZIDOS = LOCALES.filter((l) => l !== "pt");

const CAMPOS_PERMITIDOS = [
  "nome",
  "descricao",
  "torra",
  "corpo",
  "preparoSugerido",
  "notas",
  // A descricao do pacote ("Pacote preto"). Nenhuma tela a mostra sozinha: ela
  // e a metade variavel do alt de toda foto do catalogo.
  "embalagem",
];

describe("editorial traduzido (data/catalogo-canastra.i18n.json)", () => {
  it("traduz as cinco linhas, e nenhum slug que nao existe", () => {
    const doCatalogo = bruto.linhas.map((l) => l.slug).sort();
    expect(TRADUZIDAS.map(([slug]) => slug).sort()).toEqual(doCatalogo);
  });

  it("tem os dois idiomas em toda linha", () => {
    for (const [slug, porIdioma] of TRADUZIDAS) {
      expect(Object.keys(porIdioma).sort(), slug).toEqual([...IDIOMAS_TRADUZIDOS].sort());
    }
  });

  it("NAO tem chave `pt`: o portugues e a fonte, nao uma traducao", () => {
    // Uma chave `pt` aqui seria um segundo lugar para editar o mesmo texto, e
    // os dois divergiriam na primeira correcao — com a tela mostrando um e o
    // seed do banco o outro.
    for (const [slug, porIdioma] of TRADUZIDAS) {
      expect(Object.keys(porIdioma), slug).not.toContain("pt");
    }
  });

  it("so guarda texto: preco, estoque, SKU e produtoId ficam de fora", () => {
    // Preco e estoque sao o mesmo numero nos tres idiomas. Duplica-los aqui
    // criaria um segundo lugar onde o preco pode estar errado — e este e o
    // arquivo que ninguem relê, porque quase ninguem lê espanhol na revisao.
    for (const [slug, porIdioma] of TRADUZIDAS) {
      for (const [idioma, campos] of Object.entries(porIdioma)) {
        for (const campo of Object.keys(campos)) {
          expect(CAMPOS_PERMITIDOS, `${slug}.${idioma} traz o campo "${campo}"`).toContain(
            campo,
          );
        }
      }
    }
  });

  it("nao declara campo vazio — campo ausente cai para o pt, campo vazio mentiria", () => {
    for (const [slug, porIdioma] of TRADUZIDAS) {
      for (const [idioma, campos] of Object.entries(porIdioma)) {
        for (const [campo, valor] of Object.entries(campos)) {
          const onde = `${slug}.${idioma}.${campo}`;
          if (Array.isArray(valor)) {
            expect(valor.length, onde).toBeGreaterThan(0);
            for (const item of valor) expect(item.trim(), onde).not.toBe("");
          } else {
            expect(valor.trim(), onde).not.toBe("");
          }
        }
      }
    }
  });

  it("mantem a nota como CHAVE: kebab-case, minuscula, sem acento", () => {
    // A nota nao e texto de tela: e chave de filtro e de busca, e quem desenha
    // o rotulo e `rotuloNota()`. Uma nota traduzida como "Citrus finish" viraria
    // um valor de filtro que nenhuma outra linha casa.
    for (const [slug, porIdioma] of TRADUZIDAS) {
      for (const [idioma, campos] of Object.entries(porIdioma)) {
        const notas = campos.notas as string[] | undefined;
        if (!notas) continue;
        for (const nota of notas) {
          expect(nota, `${slug}.${idioma}: "${nota}"`).toMatch(/^[a-z]+(-[a-z]+)*$/);
        }
      }
    }
  });

  it("traduz a MESMA quantidade de notas que o portugues declara", () => {
    // Perder uma nota na travessia e o erro silencioso perfeito: a xicara
    // passa a prometer menos em ingles do que em portugues, e nada quebra.
    for (const [slug, porIdioma] of TRADUZIDAS) {
      const pt = bruto.linhas.find((l) => l.slug === slug);
      expect(pt, slug).toBeDefined();
      for (const [idioma, campos] of Object.entries(porIdioma)) {
        const notas = campos.notas as string[] | undefined;
        if (!notas) continue;
        expect(notas.length, `${slug}.${idioma}`).toBe(pt!.notas.length);
      }
    }
  });

  it("a nota traduzida atravessa rotuloNota() sem voltar em portugues", () => {
    /**
     * ARMADILHA REAL, e foi o unico defeito que este teste pegou antes do
     * codigo: `rotuloNota()` e um mapa em portugues (rotulos.ts), e ele e
     * aplicado em QUALQUER idioma. Se o espanhol de "melaço" fosse gravado
     * como `melaco`, o mapa devolveria "Melaço" — portugues, com cedilha, na
     * ficha em espanhol. `melaza` passa longe do mapa e cai no fallback, que
     * so capitaliza. As chaves aqui foram escolhidas por isso, nao por acaso.
     */
    const esperado: Record<string, Record<string, string>> = {
      en: {
        caramel: "Caramel",
        chocolate: "Chocolate",
        citrus: "Citrus",
        cinnamon: "Cinnamon",
        cocoa: "Cocoa",
        molasses: "Molasses",
      },
      es: {
        caramelo: "Caramelo",
        chocolate: "Chocolate",
        citrico: "Cítrico",
        canela: "Canela",
        cacao: "Cacao",
        melaza: "Melaza",
      },
    };

    for (const [slug, porIdioma] of TRADUZIDAS) {
      for (const [idioma, campos] of Object.entries(porIdioma)) {
        const notas = campos.notas as string[] | undefined;
        if (!notas) continue;
        for (const nota of notas) {
          const rotulo = esperado[idioma]?.[nota];
          expect(rotulo, `${slug}.${idioma}: nota "${nota}" sem rotulo conferido`).toBeDefined();
          expect(rotuloNota(nota, idioma as Locale), `${slug}.${idioma}.${nota}`).toBe(
            rotulo,
          );
        }
      }
    }
  });

  it("a torra traduzida descreve o MESMO ponto da escala 1-5", () => {
    // A ESCALA ESTA ESCRITA A MAO AQUI DE PROPOSITO, e nao lida do dicionario:
    // um teste que le a mesma tabela que verifica nao prova nada. Este e o
    // oraculo independente, e ele cobra DOIS lados — o editorial traduzido
    // (data/catalogo-canastra.i18n.json) e, no caso abaixo, o proprio
    // dicionario. A escala nao muda de idioma: uma torra 5 e escura em
    // qualquer lingua, e uma traducao distraida que escrevesse "Medium roast"
    // no Classico faria a barra contradizer a legenda ao lado dela.
    const escala: Record<Locale, Record<number, string>> = {
      pt: {
        1: "Torra clara",
        2: "Torra clara-média",
        3: "Torra média",
        4: "Torra média-escura",
        5: "Torra escura",
      },
      en: {
        1: "Light roast",
        2: "Light-medium roast",
        3: "Medium roast",
        4: "Medium-dark roast",
        5: "Dark roast",
      },
      es: {
        1: "Tueste claro",
        2: "Tueste claro-medio",
        3: "Tueste medio",
        4: "Tueste medio-oscuro",
        5: "Tueste oscuro",
      },
    };

    for (const idioma of IDIOMAS_TRADUZIDOS) {
      for (const lote of lotesDoLocale(idioma)) {
        expect(lote.torra, `${lote.slug}.${idioma}`).toBe(escala[idioma][lote.pontoTorra]);
      }
    }

    // E o dicionario, que e de onde a PLP e o <PontoTorra> tiram a legenda,
    // diz a MESMA coisa que o editorial. Se as duas se separarem, a barra
    // passa a contradizer o texto da torra no mesmo card.
    for (const idioma of LOCALES) {
      for (const ponto of [1, 2, 3, 4, 5] as const) {
        expect(
          dicionario(idioma).catalogo.pontoTorra[ponto],
          `${idioma}.${ponto}`,
        ).toBe(escala[idioma][ponto]);
      }
    }
  });
});

describe("fusao do editorial traduzido", () => {
  it("'pt' devolve os proprios LOTES, sem copia nem sobreposicao", () => {
    // O portugues e a FONTE. Se a fusao produzisse um objeto novo para o pt,
    // haveria duas versoes do mesmo lote em memoria e um dia elas divergiriam.
    const pt = lotesDoLocale("pt");
    expect(pt).toHaveLength(LOTES.length);
    pt.forEach((lote, i) => expect(lote, lote.slug).toBe(LOTES[i]));
  });

  it("troca descricao, torra, corpo, preparo e notas nos dois idiomas", () => {
    for (const idioma of IDIOMAS_TRADUZIDOS) {
      const porSlug = new Map(lotesDoLocale(idioma).map((l) => [l.slug, l]));
      for (const [slug, porIdioma] of TRADUZIDAS) {
        const lote = porSlug.get(slug);
        expect(lote, `${slug}.${idioma}`).toBeDefined();
        for (const [campo, valor] of Object.entries(porIdioma[idioma])) {
          // `embalagem` nao e campo de `Lote` e por isso nao se compara aqui:
          // ela nao vai para a tela sozinha, vai costurada no alt da foto. Quem
          // a cobra e o caso logo abaixo.
          if (campo === "embalagem") continue;
          expect(lote![campo as "descricao"], `${slug}.${idioma}.${campo}`).toEqual(valor);
        }
      }
    }
  });

  it("a embalagem traduzida chega ao alt, e nao a lugar nenhum alem dele", () => {
    // O unico consumidor de `embalagem` e o texto alternativo. Se um dia ela
    // ganhar uma tela, este teste e o lugar de dizer isso.
    for (const idioma of IDIOMAS_TRADUZIDOS) {
      const porSlug = new Map(lotesDoLocale(idioma).map((l) => [l.slug, l]));
      for (const [slug, porIdioma] of TRADUZIDAS) {
        const embalagem = porIdioma[idioma].embalagem as string | undefined;
        expect(embalagem, `${slug}.${idioma} sem embalagem traduzida`).toBeTruthy();
        const lote = porSlug.get(slug)!;
        expect(lote.fotos.sabor.alt, `${slug}.${idioma}`).toContain(embalagem!);
        expect(lote.fotos.pacote.alt, `${slug}.${idioma}`).toContain(embalagem!);
        expect(lote).not.toHaveProperty("embalagem");
      }
    }
  });

  it("campo sem traducao CAI PARA O PT, nunca para vazio", () => {
    /**
     * O caso vivo e o `nome`: nome de linha e nome proprio e nenhuma linha o
     * traduz — "Canastra Clássico" e o que esta impresso no pacote. O contrato
     * aceita traduzir nome; a ausencia dele em todas as cinco e o que faz este
     * teste medir a queda de verdade, e nao um caso de laboratorio.
     */
    for (const idioma of IDIOMAS_TRADUZIDOS) {
      const lotes = lotesDoLocale(idioma);
      lotes.forEach((lote, i) => {
        expect(lote.nome, `${lote.slug}.${idioma}`).toBe(LOTES[i].nome);
        expect(lote.nome.trim(), `${lote.slug}.${idioma}`).not.toBe("");
      });
    }
  });

  it("linha sem traducao NENHUMA devolve o texto em portugues", () => {
    /**
     * O dia em que uma sexta linha entrar no catalogo, ela aparece em ingles
     * com o EDITORIAL em portugues — e nao com a ficha em branco.
     *
     * A ASERCAO ERA DE IDENTIDADE (`toBe`) E DEIXOU DE SER, de proposito. Fora
     * do portugues a fusao sempre reconstroi, porque o rotulo da embalagem e o
     * alt da foto nao vem do editorial por linha: vem do dicionario, chaveados,
     * e sair cedo por falta de editorial era exatamente o que deixava
     * "Display com 10 sachês" numa pagina em ingles. O que este teste protege e
     * o texto, e ele continua caindo inteiro para o portugues.
     */
    const semTraducao = { ...LOTES[0], slug: "linha-que-ainda-nao-foi-traduzida" };
    for (const idioma of LOCALES) {
      const fundido = traduzirLote(semTraducao, idioma);
      for (const campo of ["nome", "descricao", "torra", "corpo", "preparoSugerido"] as const) {
        expect(fundido[campo], `${idioma}.${campo}`).toBe(semTraducao[campo]);
      }
      expect(fundido.notas, idioma).toEqual(semTraducao.notas);
    }
    // E o portugues continua devolvendo o PROPRIO objeto: e o que garante que
    // exista uma versao so do catalogo em pt na memoria.
    expect(traduzirLote(semTraducao, "pt")).toBe(semTraducao);
  });

  it("nao toca em preco, estoque, SKU, produtoId nem no rotulo gravado", () => {
    /**
     * A fusao e de TEXTO DE TELA. Se ela reconstruisse as variantes, o preco ao
     * vivo do banco voltaria para o do JSON no exato momento em que a pessoa
     * muda de idioma.
     *
     * E O `rotuloEmbalagem` ESTA PROTEGIDO POR ESTA MESMA ASERCAO, de proposito.
     * Ele parece texto e e dado GRAVADO: vai para o `size` e para o nome do item
     * da sacola, que e pt-BR por decisao (spec §1), sobrevive no localStorage
     * ate a sessao seguinte, e vira `item_name` no GA4. Traduzi-lo aqui faria a
     * sacola mostrar a etiqueta na lingua de ontem e o relatorio contar o mesmo
     * SKU tres vezes. Quem mostra na tela traduz na hora de mostrar, com
     * `rotuloDaEmbalagem()`.
     */
    for (const idioma of LOCALES) {
      lotesDoLocale(idioma).forEach((lote, i) => {
        expect(lote.variantes, `${lote.slug}.${idioma}`).toEqual(LOTES[i].variantes);
        expect(lote.formatosEspeciais, `${lote.slug}.${idioma}`).toEqual(
          LOTES[i].formatosEspeciais,
        );
        expect(lote.sca, `${lote.slug}.${idioma}`).toBe(LOTES[i].sca);
        expect(lote.pontoTorra, `${lote.slug}.${idioma}`).toBe(LOTES[i].pontoTorra);
      });
    }
  });

  it("preserva o preco ao vivo quando traduz um lote ja fundido pelo repositorio", () => {
    // A ordem real e: repositorio sobrepoe o comercial do banco, a pagina
    // traduz. Se `traduzirLote` lesse o JSON de novo em vez de receber o lote
    // pronto, o preco do painel sumiria da vitrine em ingles.
    const comPrecoDoBanco = {
      ...LOTES[0],
      variantes: LOTES[0].variantes.map((v) => ({
        ...v,
        preco: 12345,
        produtoId: "id-do-banco",
      })),
    };

    const emIngles = traduzirLote(comPrecoDoBanco, "en");

    expect(emIngles.variantes.every((v) => v.preco === 12345)).toBe(true);
    expect(emIngles.variantes.every((v) => v.produtoId === "id-do-banco")).toBe(true);
    expect(emIngles.descricao).not.toBe(LOTES[0].descricao);
  });

  it("nunca deixa um campo de texto vazio em idioma nenhum", () => {
    for (const idioma of LOCALES) {
      for (const lote of lotesDoLocale(idioma)) {
        for (const campo of ["nome", "descricao", "torra", "corpo", "preparoSugerido"] as const) {
          expect(lote[campo].trim(), `${lote.slug}.${idioma}.${campo}`).not.toBe("");
        }
        expect(lote.notas.length, `${lote.slug}.${idioma}.notas`).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * O DADO DO CATALOGO CHEGANDO CRU EM PORTUGUES NA TELA EM INGLES.
 *
 * Era o maior vazamento que sobrou depois de a interface inteira ser traduzida,
 * e o padrao era sempre o mesmo: a moldura fala ingles e o dado ao lado dela
 * nao. Medido em /en/cafes servido de verdade — "Caixa com 1 pacote de 250 g de
 * cada", "Cápsula Compatível Nespresso", "Especial", "Gourmet", "de 5".
 *
 * O CONSERTO TEM DUAS METADES, E ESTE BLOCO GUARDA A COSTURA DAS DUAS:
 *
 *   CHAVE, no JSON de catalogo — `rotuloChave` por produto e
 *   `marca.atributosChaves`. Sao aditivas: `backend/db/seed.js` nao le nenhuma
 *   das duas, e por isso `instalacao-completa.sql` nao muda.
 *
 *   TEXTO, no dicionario — `catalogo.embalagem` e `catalogo.atributo`, onde o
 *   TypeScript cobra os tres idiomas e chave faltando quebra o build.
 *
 * O QUE PODE DAR ERRADO, E SO ISTO SEGURA: as duas metades se soltarem. O JSON
 * continua sendo o oraculo do portugues, porque e ele que o seed grava no banco
 * e e do banco que o checkout rele o item na hora de cobrar; se o dicionario
 * discordar dele, a tela passa a dizer uma coisa e a nota fiscal outra, sem
 * erro nenhum no caminho.
 */
describe("chave no catalogo, texto no dicionario", () => {
  const EMBALAGENS_PT = dicionario("pt").catalogo.embalagem as Record<string, string>;
  const ATRIBUTOS_PT = dicionario("pt").catalogo.atributo as Record<string, string>;

  it("todo produto declara `rotuloChave`, em kebab-case", () => {
    for (const p of bruto.produtos) {
      expect(p.rotuloChave, `${p.sku} sem rotuloChave`).toBeTruthy();
      expect(p.rotuloChave, p.sku).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("o portugues do dicionario e IDENTICO ao rotulo do JSON", () => {
    // O JSON manda: e o `rotuloEmbalagem` dele que o seed grava em
    // `canastra.produtos.tamanho`, e e de la que o PaymentController rele o
    // item ao fechar o pedido. Uma virgula de diferenca aqui e a vitrine
    // dizendo uma coisa e a nota fiscal dizendo outra.
    for (const p of bruto.produtos) {
      expect(EMBALAGENS_PT[p.rotuloChave], `${p.sku} (${p.rotuloChave})`).toBe(
        p.rotuloEmbalagem,
      );
    }
  });

  it("nao guarda rotulo que produto nenhum usa", () => {
    // Chave sem consumidor e promessa de um produto que nao existe, e ela
    // sobrevive a remocao do SKU sem que nada quebre.
    const emUso = new Set(bruto.produtos.map((p) => p.rotuloChave));
    for (const chave of Object.keys(EMBALAGENS_PT)) {
      expect(emUso.has(chave), `catalogo.embalagem.${chave} nao e usada`).toBe(true);
    }
  });

  it("o rotulo sai traduzido nos tres idiomas, nunca em kebab-case", () => {
    for (const chave of Object.keys(EMBALAGENS_PT)) {
      for (const idioma of LOCALES) {
        const rotulo = rotuloDaEmbalagem(
          { rotuloChave: chave, rotuloEmbalagem: "NUNCA DEVERIA APARECER" },
          idioma,
        );
        expect(rotulo.trim(), `${idioma}.${chave}`).not.toBe("");
        expect(rotulo, `${idioma}.${chave}`).not.toBe(chave);
        expect(rotulo, `${idioma}.${chave}`).not.toBe("NUNCA DEVERIA APARECER");
      }
    }
  });

  it("sem chave, o rotulo fica no portugues que o item ja carrega", () => {
    // A variante montada a mao (fixture de teste, calculo do Clube) nao tem
    // chave para declarar. Cair no proprio `rotuloEmbalagem` e o contrato — e e
    // o que impede um "pacote-250g" de aparecer na tela.
    expect(rotuloDaEmbalagem({ rotuloEmbalagem: "Pacote com 250 g" }, "en")).toBe(
      "Pacote com 250 g",
    );
    expect(
      rotuloDaEmbalagem(
        { rotuloChave: "embalagem-que-ninguem-cadastrou", rotuloEmbalagem: "250 g" },
        "en",
      ),
    ).toBe("250 g");
  });

  it("os atributos da marca e as chaves andam na mesma ordem", () => {
    expect(MARCA.atributosChaves).toHaveLength(MARCA.atributos.length);
    MARCA.atributosChaves.forEach((chave, i) => {
      expect(chave, `atributo ${i}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(ATRIBUTOS_PT[chave], `${chave} (posicao ${i})`).toBe(MARCA.atributos[i]);
    });
  });

  it("nao guarda atributo que a marca nao declara", () => {
    const declarados = new Set<string>(MARCA.atributosChaves);
    for (const chave of Object.keys(ATRIBUTOS_PT)) {
      expect(declarados.has(chave), `catalogo.atributo.${chave} nao e da marca`).toBe(
        true,
      );
    }
  });

  it("o lote guarda a CHAVE do atributo, nunca o texto", () => {
    // O defeito exato: `origem.atributos` trazia "100% arábica" e a
    // <FichaLavoura> o imprimia cru, embaixo de um rotulo ja traduzido.
    for (const lote of LOTES) {
      expect(lote.origem.atributos, lote.slug).toEqual(MARCA.atributosChaves);
      for (const chave of lote.origem.atributos) {
        expect(chave, `${lote.slug}.${chave}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
    }
  });

  it("o atributo sai no idioma de quem le", () => {
    expect(rotuloDoAtributo("sem-gluten", "pt")).toBe("Sem glúten");
    expect(rotuloDoAtributo("sem-gluten", "en")).toBe("Gluten free");
    expect(rotuloDoAtributo("sem-gluten", "es")).toBe("Sin gluten");
    // `Zero carbon` e nao `carbon neutral`: neutralidade por compensacao e
    // outra afirmacao, e a marca nao a publica.
    expect(rotuloDoAtributo("carbono-zero", "en")).toBe("Zero carbon");
  });
});

describe("o rotulo de embalagem: portugues no dado, idioma da pagina na tela", () => {
  it("todo item vendavel do catalogo carrega a chave do rotulo", () => {
    // Sem a chave o item nao tem como ser traduzido na hora de desenhar, e o
    // sintoma seria silencioso: um rotulo em portugues no meio da lista.
    for (const lote of LOTES) {
      for (const item of [...lote.variantes, ...lote.formatosEspeciais]) {
        expect(item.rotuloChave, `${item.sku} sem rotuloChave`).toBeTruthy();
      }
    }
    for (const kit of KITS_DA_LOJA) {
      expect(kit.rotuloChave, `${kit.sku} sem rotuloChave`).toBeTruthy();
    }
  });

  it("o dado gravado NAO muda de idioma", () => {
    // A trava do caminho de venda: e este texto que vai para a sacola e para o
    // GA4. Se ele mudar com o idioma da vitrine, a sacola pt-BR passa a mostrar
    // "250 g bag" e o relatorio conta o mesmo SKU em tres linhas.
    for (const idioma of LOCALES) {
      lotesDoLocale(idioma).forEach((lote, i) => {
        for (const [j, item] of lote.variantes.entries()) {
          expect(item.rotuloEmbalagem, `${item.sku}.${idioma}`).toBe(
            LOTES[i].variantes[j].rotuloEmbalagem,
          );
        }
      });
    }
  });

  it("o bloco 'tambem nesta linha' da PDP nao volta em portugues", () => {
    // O caso medido: o rotulo e o UNICO texto daquela lista, e chegava cru —
    // "Display com 10 sachês", "1 caixa — 10 cápsulas". A PDP o desenha com
    // `rotuloDaEmbalagem(f, locale)`, que e o que este caso exercita.
    const suave = LOTES.find((l) => l.slug === "suave")!;
    expect(
      suave.formatosEspeciais.map((f) => rotuloDaEmbalagem(f, "en")),
    ).toContain("Display box with 10 sachets");

    const classico = LOTES.find((l) => l.slug === "classico")!;
    expect(
      classico.formatosEspeciais.map((f) => rotuloDaEmbalagem(f, "es")),
    ).toContain("1 caja — 10 cápsulas");
    expect(
      classico.formatosEspeciais.map((f) => rotuloDaEmbalagem(f, "pt")),
    ).toContain("1 caixa — 10 cápsulas");
  });
});

describe("o alt de toda foto", () => {
  const classicoDe = (idioma: Locale) =>
    lotesDoLocale(idioma).find((l) => l.slug === "classico")!;

  it("fala o idioma da pagina, com o nome proprio intacto", () => {
    expect(classicoDe("pt").fotos.sabor.alt).toBe(
      "Pacote preto do Canastra Clássico sobre fundo claro",
    );
    expect(classicoDe("en").fotos.sabor.alt).toBe(
      "Black bag of Canastra Clássico on a light background",
    );
    expect(classicoDe("es").fotos.sabor.alt).toBe(
      "Bolsa negra de Canastra Clássico sobre fondo claro",
    );
    expect(classicoDe("en").fotos.pacote.alt).toBe("Black bag of Canastra Clássico");
  });

  it("nunca deixa um espaco reservado do molde por preencher", () => {
    // `{embalagem}` na tela e pior que portugues: e o molde vazando.
    for (const idioma of LOCALES) {
      for (const lote of lotesDoLocale(idioma)) {
        for (const foto of [lote.fotos.sabor, lote.fotos.pacote]) {
          expect(foto.alt, `${lote.slug}.${idioma}`).not.toContain("{");
          expect(foto.alt.length, `${lote.slug}.${idioma}`).toBeGreaterThan(10);
        }
      }
    }
  });

  it("o alt do pacote nao afirma peso nenhum", () => {
    // Ele dizia "de 250 g" em TODA linha, inclusive no Nectar de Minas, que so
    // existe em 1 kg. Peso e do SKU, e ele esta no rotulo ao lado.
    for (const idioma of LOCALES) {
      for (const lote of lotesDoLocale(idioma)) {
        expect(lote.fotos.pacote.alt, `${lote.slug}.${idioma}`).not.toMatch(
          /\d+\s?(g|kg)\b/i,
        );
      }
    }
  });
});

describe("kits traduzidos", () => {
  it("a secao `kits` do arquivo aponta exatamente para os kits do catalogo", () => {
    const doCatalogo = KITS_DA_LOJA.map((k) => k.sku).sort();
    expect(TRADUZIDOS_KITS.map(([sku]) => sku).sort()).toEqual(doCatalogo);
  });

  it("tem os dois idiomas em todo kit, e so o campo `nome`", () => {
    // Preco, estoque e SKU ficam de fora pelo mesmo motivo das linhas: sao o
    // mesmo numero nos tres idiomas.
    for (const [sku, porIdioma] of TRADUZIDOS_KITS) {
      expect(Object.keys(porIdioma).sort(), sku).toEqual([...IDIOMAS_TRADUZIDOS].sort());
      for (const [idioma, campos] of Object.entries(porIdioma)) {
        expect(Object.keys(campos), `${sku}.${idioma}`).toEqual(["nome"]);
        expect(campos.nome.trim(), `${sku}.${idioma}`).not.toBe("");
      }
    }
  });

  it("mantem o ' - ' que o card usa para quebrar titulo e complemento", () => {
    // Sem o separador o <CardKit> perde o complemento e fica com um titulo de
    // duas linhas — o mesmo desenho que o nome capturado da loja tem em pt.
    for (const [sku, porIdioma] of TRADUZIDOS_KITS) {
      for (const [idioma, campos] of Object.entries(porIdioma)) {
        expect(campos.nome, `${sku}.${idioma}`).toContain(" - ");
      }
    }
  });

  it("traduz o nome do kit que a PLP vende, e o rotulo se traduz na tela", () => {
    const kit = KITS_DA_LOJA.find(
      (k) => k.sku === "kit-canela-classico-suave-moido-3x250",
    )!;

    const en = traduzirKit(kit, "en");
    expect(en.nome).toBe(
      "Canastra Specialty Coffee Canela, Clássico and Suave, Ground - Box with one 250 g bag of each",
    );
    expect(rotuloDaEmbalagem(en, "en")).toBe("Box with one 250 g bag of each");

    const es = traduzirKit(kit, "es");
    expect(es.nome).toContain("Caja con 1 bolsa de 250 g de cada");
    expect(rotuloDaEmbalagem(es, "es")).toBe("Caja con 1 bolsa de 250 g de cada");
  });

  it("nao toca em preco, estoque, produtoId nem no rotulo gravado", () => {
    // O kit chega do repositorio com o comercial do banco ja aplicado. Se a
    // traducao o reconstruisse do JSON, o preco do painel sumiria de /en — e o
    // rotulo fica em portugues pela mesma razao das variantes: e o que o card
    // poe na sacola.
    const kit = { ...KITS_DA_LOJA[0], preco: 12345, produtoId: "id-do-banco" };
    for (const idioma of LOCALES) {
      const fundido = traduzirKit(kit, idioma);
      expect(fundido.preco, idioma).toBe(12345);
      expect(fundido.produtoId, idioma).toBe("id-do-banco");
      expect(fundido.estoque, idioma).toBe(kit.estoque);
      expect(fundido.skuLoja, idioma).toBe(kit.skuLoja);
      expect(fundido.rotuloEmbalagem, idioma).toBe(kit.rotuloEmbalagem);
    }
  });

  it("'pt' devolve o proprio kit", () => {
    for (const kit of KITS_DA_LOJA) {
      expect(traduzirKit(kit, "pt"), kit.sku).toBe(kit);
    }
  });

  it("o nome que entra na SACOLA fica em portugues, mesmo vindo do kit traduzido", () => {
    /**
     * A trava do caminho de venda no lado dos kits. O card tem o kit traduzido
     * na mao e e dele que sai o titulo da tela; passar o objeto errado para a
     * sacola seria o erro mais facil de cometer e o mais dificil de ver — o
     * sintoma so aparece na sessao seguinte, numa sacola pt-BR mostrando
     * "Box with one 250 g bag of each", e no GA4 contando o mesmo SKU tres
     * vezes. `nomeDoKitNaSacola` reprocura pelo `sku` justamente por isso.
     */
    const kit = KITS_DA_LOJA[0];
    const esperado = `${kit.nome.split(" - ")[0]} — ${kit.rotuloEmbalagem}`;
    for (const idioma of LOCALES) {
      expect(nomeDoKitNaSacola(traduzirKit(kit, idioma)), idioma).toBe(esperado);
    }
    expect(esperado).toContain("Caixa com 1 pacote de 250 g de cada");
  });

  it("kit sem nome traduzido cai para o portugues, e o rotulo continua traduzivel", () => {
    // As duas portas sao independentes: o nome vem do arquivo de traducao (por
    // sku), o rotulo vem do dicionario (por chave). Um kit novo entra em /en com
    // o nome em portugues e a etiqueta ja certa — nunca com a etiqueta vazia.
    const semTraducao = { ...KITS_DA_LOJA[0], sku: "kit-que-ninguem-traduziu" };
    const en = traduzirKit(semTraducao, "en");
    expect(en.nome).toBe(semTraducao.nome);
    expect(rotuloDaEmbalagem(en, "en")).toBe("Box with one 250 g bag of each");
  });
});
