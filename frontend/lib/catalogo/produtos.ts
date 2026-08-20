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
import type {
  Formato,
  FormatoEspecial,
  Kit,
  Linha,
  Lote,
  Moagem,
  Preparo,
  PesoGramas,
  Variante,
} from "./tipos";

type ProdutoBruto = (typeof bruto.produtos)[number];
type LinhaBruta = (typeof bruto.linhas)[number];

/** Métodos que a casa mói sob demanda a partir do mesmo SKU "moído". */
const METODOS: Moagem[] = [
  "espresso", "coado-papel", "coador-pano",
  "prensa-francesa", "italiana-moka", "aeropress",
];

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
 * "em grãos" produz uma variante (moagem = grão). "moído" produz seis — uma por
 * método — todas apontando para o MESMO `skuLoja`, com o mesmo preço e o mesmo
 * estoque, porque na loja é um produto só. Kits ficam de fora: uma caixa com um
 * pacote de cada linha não é uma variante de nenhuma delas.
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
      preco: p.precoCentavos,
      estoque: p.estoque,
    };

    if (p.formato === "graos") {
      out.push({ ...base, sku: `${p.sku}-grao`, moagem: "grao" });
    } else {
      for (const moagem of METODOS) {
        out.push({ ...base, sku: `${p.sku}-${moagem}`, moagem });
      }
    }
  }

  return out;
}

function especiaisDa(linha: LinhaBruta): FormatoEspecial[] {
  return (bruto.produtos as ProdutoBruto[])
    .filter(
      (p) =>
        p.linha === linha.slug && (p.formato === "drip" || p.formato === "capsula"),
    )
    .map((p) => ({
      sku: p.sku,
      skuLoja: p.sku,
      formato: p.formato as "drip" | "capsula",
      nome: p.nome,
      rotuloEmbalagem: p.rotuloEmbalagem,
      unidades: "unidades" in p ? (p.unidades as number) : 0,
      preco: p.precoCentavos,
      estoque: p.estoque,
    }));
}

function alt(linha: LinhaBruta, papel: "sabor" | "pacote"): string {
  const onde = papel === "sabor" ? "sobre fundo claro" : "de 250 g";
  return `${linha.embalagem} do ${linha.nome} ${onde}`;
}

function monta(linha: LinhaBruta): Lote {
  const pontoTorra = linha.pontoTorra as Lote["pontoTorra"];

  return {
    slug: linha.slug,
    nome: linha.nome,
    linha: linha.slug as Linha,
    notas: linha.notas,
    pontoTorra,
    sca: bruto.marca.sca,
    descricao: linha.descricao,
    torra: linha.torra,
    corpo: linha.corpo,
    preparoSugerido: linha.preparoSugerido,
    origem: {
      regiao: bruto.marca.origem,
      estado: "MG",
      variedades: bruto.marca.variedades,
      atributos: bruto.marca.atributos,
    },
    fotos: {
      // FALLBACK: falta a foto de sabor — estetica.md §8 pede o ingrediente da
      // nota de degustação, não o pacote. Enquanto a produção não acontece, as
      // duas imagens são a mesma e o crossfade do card não aparece.
      sabor: { src: linha.imagem, alt: alt(linha, "sabor"), w: 500, h: 500 },
      pacote: { src: linha.imagem, alt: alt(linha, "pacote"), w: 500, h: 500 },
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
