// Catálogo real do Café Canastra.
//
// Substitui o antigo `mock.ts`, que trazia seis micro-lotes inventados
// (Casca d'Anta, Nascente, São Roque, Chapadão, Vargem, Porteira) com altitude,
// produtor, safra e pontuação SCA plausíveis mas falsos — o próprio arquivo
// avisava isso na primeira linha e pedia substituição antes de qualquer
// publicação.
//
// Os dados vêm de `data/catalogo-canastra.json`, na raiz do repositório, que é
// lido também pelo seed do banco (`backend/db/seed.js`). Uma fonte só para os
// dois: se a vitrine e o painel divergissem sobre o que a loja vende, o bug
// seria invisível até alguém comparar as duas telas lado a lado.
//
// PROPORÇÃO DE IMAGEM — pendência de acervo, não de código. As artes em
// public/ são 1:1 (500×500) e o card é 4:5 (estetica.md §8). Os campos w/h
// declaram 500×500 porque descrevem o arquivo real; declarar 4:5 num arquivo
// quadrado distorce a imagem e estoura o CLS, que o §10 exige abaixo de 0,05.

import bruto from "../../../data/catalogo-canastra.json";
import editorialTraduzido from "../../../data/catalogo-canastra.i18n.json";
import { dicionario } from "../i18n/dicionario";
import { LOCALES, LOCALE_PADRAO } from "../i18n/tipos";
import type { Locale } from "../i18n/tipos";
import { rotuloDaEmbalagem } from "./rotulos";
import type {
  Formato,
  FormatoEspecial,
  Kit,
  Linha,
  Lote,
  Preparo,
  PesoGramas,
  Variante,
} from "./tipos";

type ProdutoBruto = (typeof bruto.produtos)[number];
type LinhaBruta = (typeof bruto.linhas)[number];

/**
 * Receitas de preparo por perfil de torra.
 *
 * Isto é orientação de preparo, não dado de estoque: proporções, temperatura e
 * tempo são prática corrente de café especial, ajustadas ao corpo de cada
 * linha. Ficam separadas do JSON de catálogo justamente para não se
 * confundirem com o que foi extraído da loja.
 */
const PREPARO_INTENSO: Preparo[] = [
  { metodo: "coado-papel", proporcao: "1:15", gramas: 30, ml: 450, temperaturaC: 94, tempoSegundos: 180, moagem: "Média" },
  { metodo: "prensa-francesa", proporcao: "1:14", gramas: 32, ml: 450, temperaturaC: 94, tempoSegundos: 240, moagem: "Grossa" },
  { metodo: "italiana-moka", proporcao: "1:10", gramas: 18, ml: 180, temperaturaC: 96, tempoSegundos: 210, moagem: "Fina" },
];

const PREPARO_DELICADO: Preparo[] = [
  { metodo: "coado-papel", proporcao: "1:16", gramas: 28, ml: 450, temperaturaC: 92, tempoSegundos: 165, moagem: "Média-fina" },
  { metodo: "prensa-francesa", proporcao: "1:15", gramas: 30, ml: 450, temperaturaC: 92, tempoSegundos: 240, moagem: "Grossa" },
  { metodo: "aeropress", proporcao: "1:13", gramas: 16, ml: 210, temperaturaC: 88, tempoSegundos: 120, moagem: "Fina" },
];

/** Torra 1–2 pede receita delicada; 3–5 pede a intensa. */
const preparoDe = (pontoTorra: number) =>
  pontoTorra <= 2 ? PREPARO_DELICADO : PREPARO_INTENSO;

const ehPeso = (g: number): g is PesoGramas => g === 250 || g === 500 || g === 1000;

/**
 * Uma linha do catálogo bruto vira as variantes compráveis da PDP.
 *
 * UM SKU DE PACOTE, UMA VARIANTE. Até esta mudança, "moído" produzia SEIS — uma
 * por método de preparo — todas com o MESMO `skuLoja`, o mesmo preço e o mesmo
 * estoque, e o comentário daqui admitia isso sem tirar a consequência: a PDP
 * mostrava sete botões para dois produtos e o `productJsonLd` precisava
 * desduplicar as ofertas na saída. Os seis métodos continuam vivos onde sempre
 * pertenceram, na seção "Como preparar" (ver `Metodo` em tipos.ts).
 *
 * Kits ficam de fora: uma caixa com um pacote de cada linha não é variante de
 * nenhuma delas.
 */
function variantesDa(linha: LinhaBruta): Variante[] {
  const out: Variante[] = [];

  for (const p of bruto.produtos as ProdutoBruto[]) {
    if (p.linha !== linha.slug) continue;
    if ("kit" in p && p.kit) continue;
    if (p.formato !== "graos" && p.formato !== "moido") continue;
    if (!ehPeso(p.gramas)) continue;

    const base = {
      skuLoja: p.sku,
      formato: p.formato as Formato,
      pesoGramas: p.gramas,
      pacotes: p.pacotes,
      rotuloEmbalagem: p.rotuloEmbalagem,
      rotuloChave: p.rotuloChave,
      preco: p.precoCentavos,
      estoque: p.estoque,
    };

    // O `sku` da vitrine continua sendo `<skuLoja>-<moagem>`: é chave de
    // combinação da PDP, e mantê-lo derivado do skuLoja é o que deixa a
    // rastreabilidade legível num console.log.
    const moagem = p.formato === "graos" ? "grao" : "moido";
    out.push({ ...base, sku: `${p.sku}-${moagem}`, moagem });
  }

  return out;
}

function especiaisDa(linha: LinhaBruta): FormatoEspecial[] {
  // `!p.kit` pela MESMA razão de variantesDa: kit não é formato de linha
  // nenhuma. Sem o filtro, os kits de cápsula (kit: true, formato: capsula,
  // linha classico) apareciam DUPLICADOS na PDP do Clássico — uma vez como
  // formato especial, outra como card na seção "Kits e caixas" da PLP.
  return (bruto.produtos as ProdutoBruto[])
    .filter(
      (p) =>
        p.linha === linha.slug &&
        !("kit" in p && p.kit) &&
        (p.formato === "drip" || p.formato === "capsula"),
    )
    .map((p) => ({
      sku: p.sku,
      skuLoja: p.sku,
      formato: p.formato as "drip" | "capsula",
      nome: p.nome,
      rotuloEmbalagem: p.rotuloEmbalagem,
      rotuloChave: p.rotuloChave,
      unidades: "unidades" in p ? (p.unidades as number) : 0,
      preco: p.precoCentavos,
      estoque: p.estoque,
    }));
}

/**
 * O texto alternativo de uma foto, no idioma da página.
 *
 * ELE ERA UMA FRASE COSTURADA EM PORTUGUÊS AQUI DENTRO, sem locale nenhum:
 * "Pacote preto do Canastra Clássico sobre fundo claro" era o que a leitora de
 * tela ouvia em /en/cafes, e o mesmo texto ia para `og:image:alt` e
 * `twitter:image:alt`. Agora a frase é MOLDE do dicionário (`catalogo.alt`) e
 * as duas peças variáveis entram por nome: a descrição do pacote, que se traduz
 * no editorial por linha, e o nome, que é próprio e não se traduz em nenhuma.
 *
 * A substituição é de UMA passada de propósito: encadear dois `.replace` faria
 * o segundo procurar dentro do texto que o primeiro acabou de inserir.
 */
function alt(
  papel: "sabor" | "pacote",
  embalagem: string,
  nome: string,
  locale: Locale,
): string {
  const pecas: Record<string, string> = { embalagem, nome };
  return dicionario(locale).catalogo.alt[papel].replace(
    /\{(embalagem|nome)\}/g,
    (_, chave: string) => pecas[chave],
  );
}

/**
 * A descrição do pacote em português, por slug — a metade variável do alt.
 *
 * Vive num mapa daqui, e não em `Lote`, porque nenhuma tela a mostra sozinha:
 * pôr no contrato um campo que só este arquivo lê é prometer um elemento de
 * tela que não existe. O idioma dela chega pelo editorial traduzido.
 */
const EMBALAGEM_PT = new Map(bruto.linhas.map((l) => [l.slug, l.embalagem]));

function monta(linha: LinhaBruta): Lote {
  const pontoTorra = linha.pontoTorra as Lote["pontoTorra"];

  return {
    slug: linha.slug,
    nome: linha.nome,
    linha: linha.slug as Linha,
    notas: linha.notas,
    pontoTorra,
    // A SCA vem da LINHA, não da marca: `bruto.marca.sca` é o piso da coleção
    // e continua sendo, mas duas linhas têm nota própria publicada (86 e 75) e
    // a nota vence o piso. Ler a marca aqui é o que anunciava "SCA 80+" num
    // café de 75 pontos. Ver o comentário de `sca` em tipos.ts.
    sca: linha.sca,
    scaExata: linha.scaExata,
    descricao: linha.descricao,
    torra: linha.torra,
    corpo: linha.corpo,
    preparoSugerido: linha.preparoSugerido,
    // AS VARIEDADES NÃO ENTRAM AQUI, e isto é o conserto de um dado que se
    // espalhava sozinho. `bruto.marca.variedades` é dado da MARCA — as três
    // cultivares que a casa planta na serra, declaradas uma vez em
    // `marca.variedades_observacao`. Esta linha copiava a lista para CADA
    // lote, e a PDP então afirmava "Blend 100% arábica das variedades Araras,
    // Caturra 2SL e Paraíso" em todas as cinco, inclusive nas duas em que a
    // fonte não alcança: o Microlote é um lote separado por definição, e o
    // Néctar de Minas é marca irmã, com pacote e pontuação próprios. Nenhuma
    // das duas tem composição publicada, e afirmar por herança é inventar.
    // A afirmação continua onde é verdadeira: `/a-serra` lê `MARCA.variedades`
    // e a apresenta como o que ela é, "As variedades da Canastra".
    origem: {
      regiao: bruto.marca.origem,
      estado: "MG",
      // A CHAVE, NÃO O TEXTO — `carbono-zero`, e não "Carbono zero". A lista em
      // português continua em `marca.atributos`, que é o que o seed cola na
      // descrição de cada SKU; a de chaves é irmã dela, na mesma ordem, e o
      // texto de tela vem do dicionário. Ver `Origem` em tipos.ts.
      atributos: bruto.marca.atributosChaves,
    },
    fotos: {
      // FALLBACK: falta a foto de sabor — estetica.md §8 pede o ingrediente da
      // nota de degustação, não o pacote. Enquanto a produção não acontece, as
      // duas imagens são a mesma e o crossfade do card não aparece.
      sabor: {
        src: linha.imagem,
        alt: alt("sabor", linha.embalagem, linha.nome, LOCALE_PADRAO),
        w: 500,
        h: 500,
      },
      pacote: {
        src: linha.imagem,
        alt: alt("pacote", linha.embalagem, linha.nome, LOCALE_PADRAO),
        w: 500,
        h: 500,
      },
    },
    variantes: variantesDa(linha),
    formatosEspeciais: especiaisDa(linha),
    preparo: preparoDe(pontoTorra),
    // A loja real não vende assinatura; o Clube é proposta do projeto
    // (estetica.md §7.4). Oferecido nas duas linhas de pacote que existem em
    // todos os pesos — as únicas em que uma recorrência faz sentido hoje.
    assinatura:
      linha.slug === "classico" || linha.slug === "suave"
        ? { desconto: 0.1, frequenciasDias: [15, 30, 45] }
        : undefined,
  };
}

export const LOTES: Lote[] = bruto.linhas.map(monta);

/**
 * O MESMO catálogo, em inglês e espanhol.
 *
 * A tradução mora fora de `data/catalogo-canastra.json` de propósito: aquele
 * arquivo é lido também por `backend/db/seed.js`, e mudar a forma dele para
 * caber três idiomas arriscaria o caminho de venda — seed, preço, SKU, nota
 * fiscal — para ganhar texto. `data/catalogo-canastra.i18n.json` entra por
 * fora, indexado por slug de linha e por sku de kit; se ele sumir, a loja
 * continua vendendo, em português.
 *
 * O QUE FICOU DE FORA DELE, e a divisão é deliberada: o rótulo de embalagem e
 * o selo da marca são vocabulário FECHADO, repetido em dezenas de SKUs, e por
 * isso vivem no dicionário — chaveados por `rotuloChave` e por
 * `marca.atributosChaves`, onde o TypeScript cobra os três idiomas. Frase de
 * produto (a descrição da linha, o nome do kit) fica no arquivo de tradução;
 * palavra de catálogo fica no dicionário.
 *
 * O DESENHO É O DE `aplicarDadosAoVivo()` em repositorio.ts, e isso não é
 * coincidência: lá o comercial do banco vence o editorial do JSON campo a
 * campo, e o que não veio fica como estava. Aqui o texto traduzido vence o
 * português campo a campo, e o que não veio fica em português. Duas camadas,
 * uma regra só — e ela é a razão de o idioma nunca produzir tela vazia.
 *
 * As duas camadas COMPÕEM, nesta ordem: o repositório sobrepõe preço e estoque,
 * a página traduz o texto. Por isso `traduzirLote` recebe o lote pronto em vez
 * de reler o JSON — reler devolveria o preço de ontem a quem trocou de idioma.
 */

/**
 * O que muda de idioma, e só isso.
 *
 * `nome` está no contrato mas nenhuma linha o usa: nome de linha é nome
 * próprio, e "Canastra Clássico" é o que está impresso no pacote que chega na
 * casa da pessoa. Fica aqui porque um dia pode haver um nome que se traduza —
 * e porque é ele que dá o caso vivo de queda para o português no teste.
 *
 * Preço, estoque, SKU e `produtoId` NÃO entram: são o mesmo número nos três
 * idiomas, e um segundo lugar para editá-los é um segundo lugar onde eles
 * podem estar errados.
 */
type CampoDeLote = Pick<
  Lote,
  "nome" | "descricao" | "torra" | "corpo" | "preparoSugerido" | "notas"
>;

/**
 * `embalagem` não é campo de `Lote` e por isso entra por fora do `Pick`: ela
 * não é lida por tela nenhuma, é a peça variável do alt (ver `EMBALAGEM_PT`).
 */
type EditorialTraduzido = Partial<CampoDeLote> & { embalagem?: string };

const CAMPOS_TRADUZIVEIS: readonly (keyof CampoDeLote)[] = [
  "nome",
  "descricao",
  "torra",
  "corpo",
  "preparoSugerido",
  "notas",
];

type TraducoesPorSlug = Record<string, Partial<Record<Locale, EditorialTraduzido>>>;

/** Só o `nome` — o resto do kit é número, e número não tem idioma. */
type TraducoesDeKit = Record<string, Partial<Record<Locale, { nome?: string }>>>;

// A conversão passa por `unknown` porque o TypeScript infere do JSON um tipo
// literal, com exatamente os cinco slugs e os dois idiomas que o arquivo tem
// hoje; o mapa que este módulo quer é aberto, porque a busca é por slug de
// catálogo e o que não estiver traduzido tem de cair para o português em vez
// de virar erro de compilação.
const TRADUCOES = editorialTraduzido.linhas as unknown as TraducoesPorSlug;

/**
 * O nome das caixas que misturam linhas, em inglês e espanhol.
 *
 * Indexado pelo `sku` do kit e não por slug: kit não é linha, e o `sku` é a
 * chave estável que ele já tem. Ver `traduzirKit`.
 */
const TRADUCOES_DE_KIT = editorialTraduzido.kits as unknown as TraducoesDeKit;

/** Campo ausente, string em branco ou lista vazia são a mesma coisa: não há tradução. */
function temConteudo(valor: string | string[] | undefined): boolean {
  if (valor === undefined) return false;
  return Array.isArray(valor) ? valor.length > 0 : valor.trim().length > 0;
}

/**
 * Sobrepõe o editorial traduzido sobre UM lote, campo a campo.
 *
 * Recebe o lote já montado — inclusive com preço e estoque do banco, se o
 * repositório já os aplicou — e devolve O PRÓPRIO OBJETO no português. Isso não
 * é micro-otimização: é o que garante que exista uma versão só do catálogo em
 * pt na memória.
 *
 * FORA DO PORTUGUÊS ELE SEMPRE RECONSTRÓI, mesmo sem editorial traduzido, por
 * causa do ALT DAS FOTOS: o alt não vem do arquivo de tradução, é frase montada
 * do molde do dicionário, e sair cedo por falta de editorial era o que deixava
 * "Pacote preto do Canastra Clássico sobre fundo claro" no `og:image:alt` de
 * uma página em inglês.
 *
 * O QUE ELE NÃO TOCA, E A OMISSÃO É DELIBERADA: o `rotuloEmbalagem` das
 * variantes e dos formatos especiais. Aquele campo é dado GRAVADO — vai para o
 * `size` e para o nome do item da sacola, que é pt-BR por decisão (spec §1), e
 * para o `item_name` do GA4. Quem o mostra na tela o traduz na hora de mostrar,
 * com `rotuloDaEmbalagem()`; ver a nota daquela função.
 */
export function traduzirLote(lote: Lote, locale: Locale): Lote {
  if (locale === LOCALE_PADRAO) return lote;

  const traducao = TRADUCOES[lote.slug]?.[locale];
  const fundido: Lote = { ...lote };

  for (const campo of CAMPOS_TRADUZIVEIS) {
    const valor = traducao?.[campo];
    if (!temConteudo(valor)) continue;
    // `Object.assign` em vez de `fundido[campo] = valor`: `campo` percorre as
    // chaves de um `Pick` de `Lote`, então os tipos casam campo a campo — mas
    // o TypeScript não consegue provar isso dentro do laço, e a alternativa
    // seria um cast por campo.
    Object.assign(fundido, { [campo]: valor });
  }

  // O ALT SE REMONTA, não se sobrepõe: ele é frase costurada de `embalagem` e
  // `nome`, e as duas peças acabaram de mudar de idioma. Só `sabor` e `pacote`
  // — as duas fotos que o catálogo produz hoje e as duas chaves que o molde
  // tem; `terreiro` e `moido` seguem como estavam se um dia existirem.
  const embalagem = temConteudo(traducao?.embalagem)
    ? (traducao?.embalagem as string)
    : EMBALAGEM_PT.get(lote.slug);
  if (embalagem) {
    fundido.fotos = { ...lote.fotos };
    for (const papel of ["sabor", "pacote"] as const) {
      fundido.fotos[papel] = {
        ...lote.fotos[papel],
        alt: alt(papel, embalagem, fundido.nome, locale),
      };
    }
  }

  return fundido;
}

/**
 * O NOME do kit no idioma da página, e ele tem UM chamador só: o `<CardKit>`.
 *
 * A linha tem página própria e é a página que a traduz, antes de entregá-la ao
 * card; o kit não tem página nenhuma — a única superfície dele no site é o card
 * da seção "Kits e caixas", que já recebe o `locale` da PLP. Traduzir ali é
 * traduzir no único lugar que sabe o idioma, e é o que evita um
 * `listarKits(locale)` no repositório, onde idioma não é assunto: aquela camada
 * existe para casar preço e estoque com o banco.
 *
 * SÓ O NOME. O `rotuloEmbalagem` do kit é dado gravado, como o das variantes, e
 * o card o traduz na hora de desenhar — o que ele põe na sacola continua sendo
 * o português. Ver `rotuloDaEmbalagem()` em rotulos.ts.
 */
export function traduzirKit(kit: Kit, locale: Locale): Kit {
  if (locale === LOCALE_PADRAO) return kit;

  const nome = TRADUCOES_DE_KIT[kit.sku]?.[locale]?.nome;
  if (!temConteudo(nome)) return kit;
  return { ...kit, nome: nome as string };
}

/**
 * O nome com que o kit entra na SACOLA — e ele é sempre em português.
 *
 * Mesma decisão que `PainelCompra` já documenta para a moagem, e a razão é que
 * este texto não é tela: fica gravado no `localStorage`, volta na sessão
 * seguinte, viaja para `canastra.carrinho_itens` na fusão e vira `item_name` no
 * GA4. Uma sacola pt-BR (spec §1) mostrando a etiqueta na língua em que a
 * pessoa navegava ontem é confusão; um relatório com o mesmo SKU em três
 * idiomas é o mesmo produto contado três vezes.
 *
 * ELA REPROCURA O KIT PELO `sku` EM VEZ DE CONFIAR NO QUE RECEBE, e é isso que
 * a torna uma garantia em vez de uma convenção: o card tem o kit traduzido na
 * mão, e passar o objeto errado seria o erro mais fácil do mundo de cometer e o
 * mais difícil de ver. Kit fora do catálogo (fixture) cai no que veio.
 */
export function nomeDoKitNaSacola(kit: Kit): string {
  const emPortugues = KITS_DA_LOJA.find((k) => k.sku === kit.sku) ?? kit;
  return `${emPortugues.nome.split(" - ")[0]} — ${emPortugues.rotuloEmbalagem}`;
}

const LOTES_POR_IDIOMA = Object.fromEntries(
  LOCALES.map((locale) => [locale, LOTES.map((l) => traduzirLote(l, locale))]),
) as Record<Locale, Lote[]>;

/**
 * O catálogo inteiro num idioma. Para `pt` são os próprios `LOTES`.
 *
 * Quem já tem o lote na mão — a PDP, que o recebeu do repositório com preço ao
 * vivo — usa `traduzirLote`. Esta função é para quem parte do catálogo.
 */
export function lotesDoLocale(locale: Locale): Lote[] {
  return LOTES_POR_IDIOMA[locale];
}

/** Dados institucionais verificados, para as páginas de marca. */
export const MARCA = bruto.marca;

/** Caixas que misturam linhas — não pertencem a nenhuma PDP isolada. */
export const KITS = (bruto.produtos as ProdutoBruto[]).filter(
  (p) => "kit" in p && p.kit,
);

/**
 * Os mesmos kits, no formato que a vitrine vende.
 *
 * Até aqui `KITS` era só o filtro bruto do JSON, sem superfície de venda
 * nenhuma. Este mapeamento os põe no mesmo vocabulário comercial das
 * variantes (`preco`/`estoque`/`skuLoja`) para que `listarKits()` no
 * repositório aplique preço e estoque ao vivo pelo MESMO mecanismo — e para
 * que o CardKit não precise conhecer o JSON cru.
 *
 * A imagem vem da linha dominante do kit: os kits não têm foto própria no
 * acervo, e inventar uma seria pior do que reusar a arte real do pacote.
 */
export const KITS_DA_LOJA: Kit[] = KITS.map((p) => ({
  sku: p.sku,
  skuLoja: p.sku,
  nome: p.nome,
  rotuloEmbalagem: p.rotuloEmbalagem,
  rotuloChave: p.rotuloChave,
  formato: p.formato as Formato,
  linha: p.linha as Linha,
  imagem:
    bruto.linhas.find((l) => l.slug === p.linha)?.imagem ??
    "/logo-canastra.png",
  preco: p.precoCentavos,
  estoque: p.estoque,
  pacotes: p.pacotes,
  ...("unidades" in p ? { unidades: p.unidades as number } : {}),
}));

/**
 * O array cru de produtos do catálogo, com os campos de curadoria.
 *
 * `LOTES` e `KITS_DA_LOJA` já derivam daqui, mas os dois PERDEM O SKU
 * INDIVIDUAL no caminho: o lote agrupa as variantes de uma linha, e o kit só
 * enxerga o que tem `kit: true`. A home vende SKU — "Clássico em Grãos 250 g",
 * com preço exato e botão — e por isso precisa da lista antes do agrupamento.
 *
 * `lib/catalogo/curadoria.ts` é o único consumidor, e ele não deveria conhecer
 * a forma do JSON: por isso a exportação é daqui, que é onde o JSON já é lido.
 */
export type ProdutoDoCatalogo = ProdutoBruto & {
  maisVendido?: number;
  escolhaDoProdutor?: number;
  kit?: boolean;
  unidades?: number;
};

export const PRODUTOS: ProdutoDoCatalogo[] =
  bruto.produtos as ProdutoDoCatalogo[];

/** A arte da linha a que um SKU pertence — os SKUs não têm foto própria. */
export function imagemDoProduto(p: ProdutoDoCatalogo): string {
  return (
    bruto.linhas.find((l) => l.slug === p.linha)?.imagem ?? "/logo-canastra.png"
  );
}
