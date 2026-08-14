// DADOS PROVISÓRIOS. Altitude, pontuação SCA, variedade, processo, safra e
// produtor são plausíveis mas NÃO são reais. Substituir por dados de lote
// verdadeiros antes de qualquer publicação — estetica.md §6 é explícito:
// sem altitude real o eixo da serra vira ficção e a marca perde credibilidade.
//
// DIVERGÊNCIA DE PROPORÇÃO — não se corrige aqui. O estetica.md §8 especifica
// 4:5 para foto de produto e de sabor; os ativos que existem em public/ são
// 1:1 (500x500). Os campos w/h abaixo declaram 500x500 porque descrevem o
// arquivo real — declarar 4:5 num arquivo quadrado distorce a imagem e estoura
// o CLS, que o §10 exige abaixo de 0,05. Quem construir o <CardCafe> vai
// desenhar um card 4:5 e receber imagem quadrada: decida o enquadramento
// (object-fit / crop) ciente disso. A correção de verdade é a produção
// fotográfica descrita no §8, não código.

import type { Lote, Moagem, PesoGramas } from "./tipos";

const PRECO_BASE: Record<PesoGramas, number> = { 250: 4200, 500: 7600, 1000: 14200 };

const MOAGENS_PADRAO: Moagem[] = [
  "grao", "espresso", "coado-papel", "coador-pano",
  "prensa-francesa", "italiana-moka", "aeropress",
];

/** Matriz completa moagem x peso. A PDP desabilita o que nao existir. */
function variantes(slug: string, fator = 1): Lote["variantes"] {
  const out: Lote["variantes"] = [];
  for (const moagem of MOAGENS_PADRAO) {
    for (const peso of [250, 500, 1000] as PesoGramas[]) {
      out.push({
        sku: `${slug}-${moagem}-${peso}`,
        moagem,
        pesoGramas: peso,
        preco: Math.round(PRECO_BASE[peso] * fator),
        estoque: 20,
      });
    }
  }
  return out;
}

export const LOTES: Lote[] = [
  {
    slug: "casca-danta",
    nome: "Casca d'Anta",
    linha: "classico",
    notas: ["rapadura", "castanha-do-para", "cacau"],
    pontoTorra: 3,
    sca: 84.25,
    descricao: "1.320 metros. Noite fria, grão doce.",
    lavoura: {
      altitude: 1320,
      variedade: "Catuaí Amarelo 62",
      processo: "Natural",
      safra: 2025,
      produtor: "Sítio Boa Vista",
      municipio: "São Roque de Minas — MG",
    },
    fotos: {
      // FALLBACK: falta a foto de sabor — estetica.md §8
      sabor: { src: "/cafe-classico.png", alt: "Pacote preto do Café Canastra Clássico sobre fundo claro", w: 500, h: 500 },
      pacote: { src: "/cafe-classico.png", alt: "Pacote preto do Café Canastra Clássico, 250 g", w: 500, h: 500 },
    },
    variantes: variantes("casca-danta", 1.05),
    preparo: [
      { metodo: "coado-papel", proporcao: "1:15", gramas: 30, ml: 450, temperaturaC: 94, tempoSegundos: 180, moagem: "Média" },
      { metodo: "prensa-francesa", proporcao: "1:14", gramas: 32, ml: 450, temperaturaC: 93, tempoSegundos: 240, moagem: "Grossa" },
    ],
    assinatura: { desconto: 0.1, frequenciasDias: [15, 30, 45] },
  },
  {
    slug: "nascente",
    nome: "Nascente",
    linha: "suave",
    notas: ["mel", "jabuticaba", "laranja-da-terra"],
    pontoTorra: 2,
    sca: 85.5,
    descricao: "1.250 metros. Água fria da nascente, acidez limpa.",
    lavoura: {
      altitude: 1250,
      variedade: "Bourbon Amarelo",
      processo: "Cereja descascado",
      safra: 2025,
      produtor: "Fazenda Água Limpa",
      municipio: "Vargem Bonita — MG",
    },
    fotos: {
      // FALLBACK: falta a foto de sabor — estetica.md §8
      sabor: { src: "/cafe-suave.png", alt: "Pacote branco do Café Canastra Suave sobre fundo claro", w: 500, h: 500 },
      pacote: { src: "/cafe-suave.png", alt: "Pacote branco do Café Canastra Suave, 250 g", w: 500, h: 500 },
    },
    variantes: variantes("nascente", 1.12),
    preparo: [
      { metodo: "coado-papel", proporcao: "1:16", gramas: 28, ml: 450, temperaturaC: 92, tempoSegundos: 165, moagem: "Média-fina" },
      { metodo: "prensa-francesa", proporcao: "1:15", gramas: 30, ml: 450, temperaturaC: 92, tempoSegundos: 240, moagem: "Grossa" },
      { metodo: "aeropress", proporcao: "1:13", gramas: 16, ml: 210, temperaturaC: 88, tempoSegundos: 120, moagem: "Fina" },
    ],
    assinatura: { desconto: 0.1, frequenciasDias: [15, 30, 45] },
  },
  {
    slug: "sao-roque",
    nome: "São Roque",
    linha: "classico",
    notas: ["doce-de-leite", "amendoim-torrado", "chocolate-meio-amargo"],
    pontoTorra: 4,
    sca: 83,
    descricao: "1.180 metros. Torra mais escura, corpo cheio.",
    lavoura: {
      altitude: 1180,
      variedade: "Mundo Novo",
      processo: "Natural",
      safra: 2025,
      produtor: "Sítio Três Barras",
      municipio: "São Roque de Minas — MG",
    },
    fotos: {
      // FALLBACK: falta a foto de sabor — estetica.md §8
      sabor: { src: "/cafe-classico.png", alt: "Pacote preto do Café Canastra Clássico sobre fundo claro", w: 500, h: 500 },
      pacote: { src: "/cafe-classico.png", alt: "Pacote preto do Café Canastra Clássico, 500 g", w: 500, h: 500 },
    },
    variantes: variantes("sao-roque", 1),
    preparo: [
      { metodo: "coado-papel", proporcao: "1:15", gramas: 30, ml: 450, temperaturaC: 94, tempoSegundos: 180, moagem: "Média" },
      { metodo: "prensa-francesa", proporcao: "1:14", gramas: 32, ml: 450, temperaturaC: 94, tempoSegundos: 240, moagem: "Grossa" },
      { metodo: "italiana-moka", proporcao: "1:10", gramas: 18, ml: 180, temperaturaC: 96, tempoSegundos: 210, moagem: "Fina" },
    ],
    assinatura: { desconto: 0.1, frequenciasDias: [15, 30, 45] },
  },
  {
    slug: "chapadao",
    nome: "Chapadão",
    linha: "suave",
    notas: ["cana", "pessego", "amendoa"],
    pontoTorra: 2,
    sca: 82.75,
    descricao: "1.150 metros no alto do chapadão. Xícara leve, final doce.",
    lavoura: {
      altitude: 1150,
      variedade: "Catuaí Vermelho 144",
      processo: "Cereja descascado",
      safra: 2025,
      produtor: "Fazenda do Chapadão",
      municipio: "Delfinópolis — MG",
    },
    fotos: {
      // FALLBACK: falta a foto de sabor — estetica.md §8
      sabor: { src: "/cafe-suave.png", alt: "Pacote branco do Café Canastra Suave sobre fundo claro", w: 500, h: 500 },
      pacote: { src: "/cafe-suave.png", alt: "Pacote branco do Café Canastra Suave, 500 g", w: 500, h: 500 },
    },
    variantes: variantes("chapadao", 0.98),
    preparo: [
      { metodo: "coado-papel", proporcao: "1:16", gramas: 28, ml: 450, temperaturaC: 93, tempoSegundos: 170, moagem: "Média" },
      { metodo: "prensa-francesa", proporcao: "1:15", gramas: 30, ml: 450, temperaturaC: 92, tempoSegundos: 240, moagem: "Grossa" },
    ],
    assinatura: { desconto: 0.1, frequenciasDias: [15, 30, 45] },
  },
  {
    slug: "vargem",
    nome: "Vargem",
    linha: "aromatizado",
    notas: ["canela", "rapadura", "baunilha"],
    pontoTorra: 3,
    sca: 81.5,
    descricao: "1.020 metros. Canela em pau moída junto com o grão.",
    lavoura: {
      altitude: 1020,
      variedade: "Catuaí Amarelo 62",
      processo: "Natural",
      safra: 2025,
      produtor: "Sítio da Vargem",
      municipio: "Vargem Bonita — MG",
    },
    fotos: {
      // FALLBACK: falta a foto de sabor — estetica.md §8
      sabor: { src: "/cafe-canela.png", alt: "Pacote do Café Canastra com canela sobre fundo claro", w: 500, h: 500 },
      pacote: { src: "/cafe-canela.png", alt: "Pacote do Café Canastra com canela, 250 g", w: 500, h: 500 },
    },
    variantes: variantes("vargem", 1.08),
    preparo: [
      { metodo: "coado-papel", proporcao: "1:15", gramas: 30, ml: 450, temperaturaC: 93, tempoSegundos: 180, moagem: "Média" },
      { metodo: "prensa-francesa", proporcao: "1:14", gramas: 32, ml: 450, temperaturaC: 93, tempoSegundos: 240, moagem: "Grossa" },
    ],
    assinatura: { desconto: 0.1, frequenciasDias: [15, 30, 45] },
  },
  {
    slug: "porteira",
    nome: "Porteira",
    linha: "aromatizado",
    notas: ["milho-torrado", "cacau", "cravo"],
    pontoTorra: 5,
    sca: 80.25,
    descricao: "900 metros, pé da serra. Torra escura, café de coador de pano.",
    lavoura: {
      altitude: 900,
      variedade: "Mundo Novo",
      processo: "Natural",
      safra: 2025,
      produtor: "Sítio da Porteira",
      municipio: "São João Batista do Glória — MG",
    },
    fotos: {
      // FALLBACK: falta a foto de sabor — estetica.md §8
      sabor: { src: "/cafe-canela.png", alt: "Pacote do Café Canastra aromatizado sobre fundo claro", w: 500, h: 500 },
      pacote: { src: "/cafe-canela.png", alt: "Pacote do Café Canastra aromatizado, 1 kg", w: 500, h: 500 },
    },
    variantes: variantes("porteira", 0.92),
    preparo: [
      { metodo: "coado-papel", proporcao: "1:14", gramas: 32, ml: 450, temperaturaC: 95, tempoSegundos: 190, moagem: "Média-grossa" },
      { metodo: "prensa-francesa", proporcao: "1:13", gramas: 34, ml: 450, temperaturaC: 95, tempoSegundos: 240, moagem: "Grossa" },
      { metodo: "coador-pano", proporcao: "1:14", gramas: 32, ml: 450, temperaturaC: 95, tempoSegundos: 210, moagem: "Média-grossa" },
    ],
    assinatura: { desconto: 0.1, frequenciasDias: [15, 30, 45] },
  },
];
