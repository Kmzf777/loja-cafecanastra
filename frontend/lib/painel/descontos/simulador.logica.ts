import { formatarCentavos, reaisParaCentavos } from "../dinheiro";
import type {
  CarrinhoDaSimulacao,
  ItemDaSimulacao,
  MeioDePagamento,
  ProdutoDoSeletor,
  RespostaDaSimulacao,
} from "./contrato";
import { soDigitos } from "./formulario.logica";

/**
 * O simulador de carrinho — a montagem da pergunta, e a leitura da resposta.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE MÓDULO NÃO FAZ, E É A COISA MAIS IMPORTANTE SOBRE ELE: ele NÃO
 * calcula desconto nenhum.
 *
 * O cálculo é de `backend/src/utils/motor.js` — a mesma função que o checkout
 * chama para cobrar, com os mesmos 27 casos de tabela-verdade. Reimplementar a
 * conta no navegador daria duas cópias, e duas cópias divergem: a do painel
 * mostraria R$ 12,00 enquanto a do checkout cobra R$ 10,80, e a que o gestor vê
 * deixaria de ser a que cobra. Um simulador que mente é pior que simulador
 * nenhum, porque autoriza a publicar a regra.
 *
 * A ÚNICA aritmética daqui é a SOMA DO CARRINHO — preço × quantidade —, que é
 * o enunciado da pergunta e não a resposta dela. O desconto vem inteiro do
 * servidor, e o "depois" da tela é uma subtração entre dois números que o
 * servidor devolveu.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A REGRA SIMULADA É A DO FORMULÁRIO, NÃO A DO BANCO.
 *
 * Simular só o que já foi salvo inverteria a razão de existir do simulador:
 * "regra de desconto é onde o erro custa dinheiro real, e a única defesa
 * honesta é mostrar o resultado ANTES de salvar". Então a rota de simulação
 * recebe o rascunho no corpo, monta a regra em memória no formato de
 * `carregarRegrasVigentes` e chama `calcularDescontos` sem escrever nada.
 */

/* ========================================================================== *
 * O carrinho de mentira
 * ========================================================================== */

export type ItemNoSimulador = {
  /** O `product_id` escolhido no seletor, ou "" para um item avulso. */
  produtoId: string;
  sku: string;
  categoria: string;
  precoReais: string;
  quantidade: string;
};

export type CarrinhoNoSimulador = {
  itens: ItemNoSimulador[];
  meioPagamento: MeioDePagamento | "";
  assinante: boolean;
  /** Vazio = frete ainda não cotado; nesse caso a classe `frete` do motor nem
   *  roda, e o simulador diz isso em vez de mostrar zero. */
  freteReais: string;
  freteEhMaisBarata: boolean;
  freteUf: string;
  freteCep: string;
};

export const ITEM_VAZIO: ItemNoSimulador = {
  produtoId: "",
  sku: "",
  categoria: "",
  precoReais: "",
  quantidade: "1",
};

export const CARRINHO_VAZIO: CarrinhoNoSimulador = {
  itens: [{ ...ITEM_VAZIO }],
  meioPagamento: "",
  assinante: false,
  freteReais: "",
  freteEhMaisBarata: true,
  freteUf: "",
  freteCep: "",
};

/** Um produto do catálogo vira uma linha do carrinho já preenchida — é o que
 *  faz o simulador ser usável sem digitar preço à mão, e o que impede o UUID
 *  digitado errado que "apontava para produto nenhum, sem erro em lugar
 *  algum". */
export function itemDoProduto(produto: ProdutoDoSeletor): ItemNoSimulador {
  return {
    produtoId: produto.product_id,
    sku: produto.sku ?? "",
    categoria: produto.category ?? "",
    precoReais:
      produto.price === null || produto.price === undefined ? "" : String(produto.price),
    quantidade: "1",
  };
}

/** O rótulo humano do produto no seletor — R23 vale aqui também: nunca UUID. */
export function rotuloDoProduto(produto: ProdutoDoSeletor): string {
  const nome = (produto.name ?? "").trim() || "Sem nome";
  const sku = (produto.sku ?? "").trim();
  return sku ? `${nome} · ${sku}` : nome;
}

/* ========================================================================== *
 * A soma — o enunciado, não a resposta
 * ========================================================================== */

function centavosDoItem(item: ItemNoSimulador): number {
  const preco = reaisParaCentavos(item.precoReais) ?? 0;
  const qtd = Number.parseInt(item.quantidade, 10);
  return preco * (Number.isFinite(qtd) && qtd > 0 ? qtd : 0);
}

export function subtotalDoCarrinho(carrinho: CarrinhoNoSimulador): number {
  return carrinho.itens.reduce((soma, item) => soma + centavosDoItem(item), 0);
}

/* ========================================================================== *
 * Validação
 * ========================================================================== */

export function validarCarrinho(carrinho: CarrinhoNoSimulador): Record<string, string> {
  const erros: Record<string, string> = {};

  const comAlgo = carrinho.itens.filter(
    (i) => i.precoReais.trim() !== "" || i.produtoId !== "" || i.sku.trim() !== "",
  );
  if (comAlgo.length === 0) {
    erros["itens.0.precoReais"] = "Ponha ao menos um item no carrinho de teste.";
  }

  carrinho.itens.forEach((item, i) => {
    const vazio =
      item.precoReais.trim() === "" && item.produtoId === "" && item.sku.trim() === "";
    if (vazio) return;

    const preco = reaisParaCentavos(item.precoReais);
    if (preco === null || preco <= 0) {
      erros[`itens.${i}.precoReais`] = "Preço unitário em reais, por exemplo 60,00.";
    }
    const qtd = Number.parseInt(item.quantidade, 10);
    if (!Number.isFinite(qtd) || qtd <= 0) {
      erros[`itens.${i}.quantidade`] = "Quantidade maior que zero.";
    }
  });

  if (carrinho.freteReais.trim() !== "") {
    const frete = reaisParaCentavos(carrinho.freteReais);
    if (frete === null || frete < 0) {
      erros.freteReais = "Valor do frete em reais, por exemplo 24,90.";
    }
  }

  const cep = soDigitos(carrinho.freteCep);
  if (cep && cep.length !== 8) {
    erros.freteCep = "Oito dígitos, ou deixe em branco.";
  }

  return erros;
}

/* ========================================================================== *
 * O payload
 * ========================================================================== */

export function montarCarrinho(carrinho: CarrinhoNoSimulador): CarrinhoDaSimulacao {
  const itens: ItemDaSimulacao[] = carrinho.itens
    .filter((i) => (reaisParaCentavos(i.precoReais) ?? 0) > 0)
    .map((i) => ({
      produtoId: i.produtoId || null,
      sku: i.sku.trim() || null,
      categoria: i.categoria.trim() || null,
      precoCentavos: reaisParaCentavos(i.precoReais) ?? 0,
      quantidade: Math.max(1, Number.parseInt(i.quantidade, 10) || 1),
    }));

  const freteCentavos = reaisParaCentavos(carrinho.freteReais);

  return {
    itens,
    // Regra com `meios_pagamento` preenchido NÃO se aplica a `null`: desconto
    // que depende do meio de pagamento só vale quando se sabe qual é. Por isso
    // "qualquer" no simulador é `null`, e não um meio escolhido por padrão.
    meioPagamento: carrinho.meioPagamento || null,
    assinante: carrinho.assinante,
    frete:
      freteCentavos !== null && freteCentavos > 0
        ? {
            valorCentavos: freteCentavos,
            ehMaisBarata: carrinho.freteEhMaisBarata,
            uf: carrinho.freteUf.trim().toUpperCase() || null,
            cep: soDigitos(carrinho.freteCep) || null,
          }
        : null,
  };
}

/* ========================================================================== *
 * A leitura da resposta
 * ========================================================================== */

export type LinhaDoResultado = {
  chave: string;
  rotulo: string;
  detalhe: string;
  valor: string;
};

export type ResumoDaSimulacao = {
  /** `true` quando o motor devolveu zero ajustes — o caso que mais precisa de
   *  frase, porque "R$ 0,00" e "não se aplica" parecem a mesma coisa e não são. */
  semEfeito: boolean;
  linhas: LinhaDoResultado[];
  subtotalAntes: string;
  descontoTotal: string;
  subtotalDepois: string;
  /** `null` quando o frete não foi cotado no carrinho de teste — e aí a classe
   *  `frete` do motor nem roda. Zero e "não cotado" não são a mesma coisa. */
  freteDepois: string | null;
  totalDepois: string;
};

const NOME_DO_ALVO: Record<string, string> = {
  item: "no item",
  pedido: "no pedido",
  frete: "no frete",
};

/**
 * A resposta do motor virada em tela.
 *
 * O "DEPOIS" É UMA SUBTRAÇÃO ENTRE DOIS NÚMEROS DO SERVIDOR, e não um segundo
 * cálculo: `subtotalCentavos` e `totalCentavos` vieram os dois de lá. Se um dia
 * a soma dos ajustes deixar de bater com a diferença, é sinal de que o motor
 * mudou — e a tela mostra o que o motor disse, não o que ela acha.
 */
export function resumoDaSimulacao(
  resposta: RespostaDaSimulacao,
): ResumoDaSimulacao {
  const ajustes = resposta.ajustes ?? [];
  const subtotal = resposta.subtotalCentavos ?? 0;
  const total = resposta.totalCentavos ?? 0;

  const linhas: LinhaDoResultado[] = ajustes.map((ajuste) => ({
    chave: `${ajuste.sequencia}`,
    rotulo: ajuste.rotulo || "Desconto",
    detalhe: [
      NOME_DO_ALVO[ajuste.alvo] ?? ajuste.alvo,
      ajuste.alvoRef ? `· ${ajuste.alvoRef}` : "",
      ajuste.codigo ? `· código ${ajuste.codigo}` : "",
    ]
      .filter(Boolean)
      .join(" "),
    // O sinal de menos é parte do número: um desconto listado como "12,00" no
    // meio de uma coluna de valores é lido como acréscimo na diagonal.
    valor: `− ${formatarCentavos(ajuste.valorCentavos)}`,
  }));

  return {
    semEfeito: ajustes.length === 0,
    linhas,
    subtotalAntes: formatarCentavos(subtotal),
    descontoTotal: formatarCentavos(total),
    subtotalDepois: formatarCentavos(Math.max(0, subtotal - total)),
    freteDepois:
      resposta.freteFinalCentavos === null || resposta.freteFinalCentavos === undefined
        ? null
        : formatarCentavos(resposta.freteFinalCentavos),
    totalDepois: formatarCentavos(
      Math.max(0, subtotal - total) + (resposta.freteFinalCentavos ?? 0),
    ),
  };
}

/**
 * A FRASE DO SIMULADOR — a que o plano da onda pediu por escrito: "num carrinho
 * com 2× Clássico 250g = R$ 120, esta regra desconta R$ 12,00".
 *
 * Ela existe porque uma tabela de ajustes responde "o quê" e não responde "e
 * daí". Uma linha em português, com o carrinho e o número, é o que o gestor
 * lê em voz alta para conferir se é o que ele quis.
 */
export function fraseDoResultado(
  carrinho: CarrinhoNoSimulador,
  produtos: ProdutoDoSeletor[],
  resposta: RespostaDaSimulacao,
): string {
  const porId = new Map(produtos.map((p) => [p.product_id, p]));
  const partes = carrinho.itens
    .filter((i) => (reaisParaCentavos(i.precoReais) ?? 0) > 0)
    .map((i) => {
      const qtd = Math.max(1, Number.parseInt(i.quantidade, 10) || 1);
      const produto = i.produtoId ? porId.get(i.produtoId) : undefined;
      const nome = (produto?.name ?? "").trim() || i.sku.trim() || "item";
      return `${qtd}× ${nome}`;
    });

  const carrinhoEmTexto = partes.length ? partes.join(", ") : "carrinho vazio";
  const subtotal = formatarCentavos(resposta.subtotalCentavos ?? 0);
  const total = resposta.totalCentavos ?? 0;

  if (total <= 0) {
    return `Num carrinho com ${carrinhoEmTexto} = ${subtotal}, esta regra não desconta nada.`;
  }
  return `Num carrinho com ${carrinhoEmTexto} = ${subtotal}, esta regra desconta ${formatarCentavos(total)}.`;
}
