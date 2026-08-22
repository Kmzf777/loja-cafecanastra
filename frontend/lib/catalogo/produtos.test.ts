import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import bruto from "../../../data/catalogo-canastra.json";
import traduzido from "../../../data/catalogo-canastra.i18n.json";
import { LOTES, MARCA, lotesDoLocale, traduzirLote } from "./produtos";
import { PONTO_TORRA, rotuloNota } from "./rotulos";
import { MOAGENS } from "./tipos";
import { LOCALES } from "../i18n/tipos";
import type { Locale } from "../i18n/tipos";

const PUBLIC = fileURLToPath(new URL("../../public/", import.meta.url));

/**
 * Le largura/altura do bloco IHDR de um PNG — bytes 16..23, big-endian.
 * Sem dependencia: um PNG valido sempre traz o IHDR como primeiro chunk.
 * Devolve null se o arquivo nao for PNG, e o teste trata isso como falha
 * explicita (ver comentario no caso de teste).
 */
function dimensoesPng(caminho: string): { w: number; h: number } | null {
  const b = readFileSync(caminho);
  if (b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
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
      expect(lote.torra, lote.slug).toBe(PONTO_TORRA[lote.pontoTorra]);
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
    const validas = new Set(MOAGENS.map((m) => m.valor));
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
      expect(lote.origem.variedades.length).toBeGreaterThan(0);
    }
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
        // e um lembrete para estender dimensoesPng(), nao para apagar o teste.
        const real = dimensoesPng(caminho);
        expect(real, `${onde}: nao e PNG — estenda dimensoesPng() para o novo formato`).not.toBeNull();

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

/** Os slugs do arquivo de traducao, sem as chaves de documentacao (`_leia_me`). */
const TRADUZIDAS = Object.entries(traduzido).filter(([k]) => !k.startsWith("_")) as [
  string,
  Record<string, Record<string, string | string[]>>,
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
          expect(rotuloNota(nota), `${slug}.${idioma}.${nota}`).toBe(rotulo);
        }
      }
    }
  });

  it("a torra traduzida descreve o MESMO ponto da escala 1-5", () => {
    // O irmao em portugues deste teste ("o texto da torra e o ponto da escala
    // nunca divergem") compara com PONTO_TORRA, que e um mapa em portugues e
    // mora em rotulos.ts. A escala nao muda de idioma: uma torra 5 e escura em
    // qualquer lingua, e uma traducao distraida que escrevesse "Medium roast"
    // no Classico faria a barra contradizer a legenda ao lado dela.
    const escala: Record<Locale, Record<number, string>> = {
      pt: PONTO_TORRA,
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
          expect(lote![campo as "descricao"], `${slug}.${idioma}.${campo}`).toEqual(valor);
        }
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

  it("linha sem traducao NENHUMA devolve o lote em portugues", () => {
    // O dia em que uma sexta linha entrar no catalogo, ela aparece em ingles
    // com o texto em portugues — e nao com a ficha em branco.
    const semTraducao = { ...LOTES[0], slug: "linha-que-ainda-nao-foi-traduzida" };
    for (const idioma of LOCALES) {
      expect(traduzirLote(semTraducao, idioma), idioma).toBe(semTraducao);
    }
  });

  it("nao toca em preco, estoque, SKU nem produtoId", () => {
    // A fusao e de TEXTO. Se ela reconstruisse as variantes, o preco ao vivo
    // do banco voltaria para o do JSON no exato momento em que a pessoa muda
    // de idioma.
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
