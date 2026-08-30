import { reaisParaCentavos } from "../dinheiro";
import type { ProdutoDoPainel } from "./produtos.logica";
import { identificarProduto } from "./produtos.logica";

/**
 * A EDIÇÃO EM LOTE de preço e de estoque — a decisão, sem React e sem fetch.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * R6: PREÇO E ESTOQUE NUNCA COM AUTOSAVE — e este módulo é o que torna a regra
 * cumprível em vez de uma boa intenção.
 *
 * "Uma vírgula errada publica R$ 5,90 no lugar de R$ 59,00." Num campo isolado o
 * estrago é um produto; num lote é o catálogo inteiro, de uma vez, e nada na
 * tela denuncia. A defesa não é confirmar ("Tem certeza?" não carrega
 * informação e treina a clicar em OK — R12): é MOSTRAR O RESULTADO ANTES. Por
 * isso a função central daqui não aplica nada, ela devolve a lista de
 * `de → para` linha a linha, e a tela desenha essa lista dentro da confirmação.
 *
 * É o mesmo princípio do simulador de carrinho da tela de Descontos: onde o
 * erro custa dinheiro real, a única defesa honesta é o resultado à vista.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE FALHA POR LINHA NÃO DERRUBA O LOTE. Cada previsão pode vir com um
 * `problema` (preço que ficaria negativo, teto do backend estourado), e a tela
 * mostra as duas listas juntas: o que vai mudar e o que vai ficar de fora, com
 * o motivo. Recusar o lote inteiro por causa de uma linha obrigaria o gestor a
 * caçar qual é — que é exatamente o trabalho que ele veio evitar.
 */

/** O que o preço em lote sabe fazer. */
export type ModoDePreco = "definir" | "percentual" | "valor";

/** O que o estoque em lote sabe fazer. */
export type ModoDeEstoque = "definir" | "somar" | "subtrair";

export const MODOS_DE_PRECO: { valor: ModoDePreco; rotulo: string; ajuda: string }[] = [
  {
    valor: "definir",
    rotulo: "Definir preço",
    ajuda: "Todos os marcados passam a valer este preço.",
  },
  {
    valor: "percentual",
    rotulo: "Ajustar em %",
    ajuda: "Positivo aumenta, negativo reduz. Ex.: -10 tira 10% de cada um.",
  },
  {
    valor: "valor",
    rotulo: "Ajustar em R$",
    ajuda: "Positivo soma, negativo subtrai o mesmo valor de cada um.",
  },
];

export const MODOS_DE_ESTOQUE: { valor: ModoDeEstoque; rotulo: string; ajuda: string }[] =
  [
    {
      valor: "definir",
      rotulo: "Definir estoque",
      ajuda: "Todos os marcados passam a ter esta quantidade.",
    },
    {
      valor: "somar",
      rotulo: "Entrou mercadoria",
      ajuda: "Soma a mesma quantidade ao estoque de cada um.",
    },
    {
      valor: "subtrair",
      rotulo: "Saiu mercadoria",
      ajuda: "Subtrai de cada um. Nenhum passa de zero para baixo.",
    },
  ];

/**
 * O TETO DE PREÇO É O DO BACKEND (`validarProduto`: "Preço acima do limite
 * permitido." acima de 1.000.000).
 *
 * Ele é conferido AQUI E LÁ de propósito, e não é redundância inútil: aqui ele
 * vira uma linha na prévia, antes de qualquer escrita, dizendo qual produto
 * ficaria de fora e por quê; lá ele é a garantia, porque uma Server Action é
 * superfície de rede e quem a invocar direto não passa por esta tela.
 */
export const PRECO_MAXIMO_REAIS = 1_000_000;

/** Uma linha da prévia: o que vai acontecer com UM produto. */
export type PrevisaoDePreco = {
  id: string;
  nome: string;
  /** Reais. */
  de: number;
  /** Reais. `null` quando a linha não pode ser aplicada. */
  para: number | null;
  /** A frase que explica por que esta linha fica de fora. */
  problema?: string;
};

export type PrevisaoDeEstoque = {
  id: string;
  nome: string;
  de: number;
  para: number | null;
  problema?: string;
};

/**
 * O número que a pessoa digitou — aceitando vírgula, que é como se escreve
 * dinheiro em português.
 *
 * Devolve `null` para o que não é número, e `null` é o que faz a tela não
 * habilitar o botão. Um `0` no lugar do `null` seria o defeito de `PUT /config`
 * outra vez: `Number('')` é `0`, e um `0` silencioso num "definir preço" zera o
 * catálogo marcado.
 */
export function lerNumero(bruto: string): number | null {
  const texto = String(bruto ?? "").trim().replace(",", ".");
  if (texto === "") return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

/**
 * Arredonda reais para duas casas SEM o erro do ponto flutuante.
 *
 * Reaproveita `reaisParaCentavos` de `lib/painel/dinheiro.ts`, que já resolve o
 * caso de 1.005 (onde `Math.round(n * 100)` dá 100.49999 e trunca para menos).
 * Escrever a conta de novo aqui seria manter duas versões da mesma correção,
 * uma delas errada — que é como a correção se desfaz.
 */
function reaisArredondados(valor: number): number {
  const centavos = reaisParaCentavos(valor);
  return centavos === null ? NaN : centavos / 100;
}

/**
 * A prévia do preço em lote.
 *
 * `valor` chega como o TEXTO do campo — a validação de "é número?" mora aqui,
 * junto da regra, e não espalhada pelo JSX.
 */
export function preverPrecos(
  linhas: ProdutoDoPainel[],
  modo: ModoDePreco,
  valorBruto: string,
): PrevisaoDePreco[] {
  const valor = lerNumero(valorBruto);
  if (valor === null) return [];

  return linhas.map((linha) => {
    const de = Number(linha.price);
    const nome = identificarProduto(linha);
    const base = { id: linha.product_id, nome, de };

    if (!Number.isFinite(de)) {
      return {
        ...base,
        de: NaN,
        para: null,
        problema: "O preço atual não é um número — abra a ficha deste produto.",
      };
    }

    const bruto =
      modo === "definir"
        ? valor
        : modo === "percentual"
          ? de * (1 + valor / 100)
          : de + valor;

    const para = reaisArredondados(bruto);

    if (!Number.isFinite(para)) {
      return { ...base, para: null, problema: "A conta não deu um número." };
    }
    if (para < 0) {
      return {
        ...base,
        para: null,
        // O backend recusa preço negativo, e um preço negativo ABATE do total
        // do pedido: é dinheiro saindo, não um campo inválido.
        problema: "Ficaria negativo.",
      };
    }
    if (para > PRECO_MAXIMO_REAIS) {
      return { ...base, para: null, problema: "Acima do teto de R$ 1.000.000." };
    }

    return { ...base, para };
  });
}

/**
 * A prévia do estoque em lote.
 *
 * O PISO EM ZERO NÃO É UM ERRO, É O COMPORTAMENTO. "Saiu mercadoria: 5" num
 * produto com 3 unidades tem uma resposta óbvia — fica zero —, e recusar a
 * linha inteira obrigaria o gestor a descobrir quais dos vinte marcados tinham
 * menos de cinco. É a mesma decisão do botão "−" do formulário legado, que
 * travava em 0 em vez de recusar o clique.
 */
export function preverEstoques(
  linhas: ProdutoDoPainel[],
  modo: ModoDeEstoque,
  valorBruto: string,
): PrevisaoDeEstoque[] {
  const valor = lerNumero(valorBruto);
  if (valor === null) return [];

  if (!Number.isInteger(valor)) {
    return linhas.map((linha) => ({
      id: linha.product_id,
      nome: identificarProduto(linha),
      de: Number(linha.quantity),
      para: null,
      problema: "O estoque é contado em unidades inteiras.",
    }));
  }

  return linhas.map((linha) => {
    const de = Number(linha.quantity);
    const nome = identificarProduto(linha);
    const base = { id: linha.product_id, nome, de };

    if (!Number.isInteger(de)) {
      return { ...base, de: NaN, para: null, problema: "O estoque atual não é um inteiro." };
    }

    const bruto =
      modo === "definir" ? valor : modo === "somar" ? de + valor : de - valor;

    if (modo === "definir" && bruto < 0) {
      return { ...base, para: null, problema: "Estoque não pode ser negativo." };
    }

    return { ...base, para: Math.max(0, bruto) };
  });
}

/** As linhas que de fato serão enviadas — as que têm `para`. */
export function aplicaveis<T extends { para: number | null }>(previsoes: T[]): T[] {
  return previsoes.filter((p) => p.para !== null);
}

/**
 * A frase do R25 — e ela é a razão de a seleção em massa não mentir.
 *
 * "seleção em massa distingue 'os 50 desta página' de 'os 1.284 do filtro' —
 * senão o lojista acha que arquivou 1.284 quando arquivou 50."
 *
 * NÃO EXISTE "MARCAR OS N DO FILTRO" NESTA TELA, e a ausência é deliberada: não
 * há rota de lote no backend (o preço vai por `PUT /dashboard/:id`, o estoque
 * por `PATCH /dashboard/:id/estoque`, um a um), então oferecer a marcação dos
 * 1.284 para depois agir sobre 20 seria exatamente a mentira que o R25 nomeia.
 * A frase diz o número do filtro para que ninguém confunda os dois — e diz que
 * a ação alcança só os marcados.
 */
export function resumoDaSelecao(
  marcados: number,
  naPagina: number,
  totalDoFiltro: number,
): string {
  if (marcados === 0) return "Nenhum produto marcado.";

  const produto = marcados === 1 ? "produto marcado" : "produtos marcados";
  const daPagina = `${marcados} ${produto} nesta página de ${naPagina}`;

  if (totalDoFiltro <= naPagina) return `${daPagina}.`;
  return `${daPagina}. O filtro alcança ${totalDoFiltro} — a ação vale só para os marcados.`;
}

/** Uma falha de UMA linha do lote, com o nome do produto e a frase do servidor. */
export type FalhaDoLote = { nome: string; frase: string };

/**
 * O PLACAR REAL do lote — nunca o pedido.
 *
 * É a mesma lição do `PATCH` em lote de avaliações, que devolve a contagem
 * efetivada: mostrar "20 produtos atualizados" quando três falharam mente sobre
 * a única coisa que a operação existe para informar. E as frases das falhas vêm
 * junto, com o nome do produto na frente — "Já existe um produto com este SKU."
 * sem dizer de qual produto obriga a abrir os vinte.
 */
export function resumoDoLote(atualizados: number, falhas: FalhaDoLote[]): string {
  const parte =
    atualizados === 1 ? "1 produto atualizado" : `${atualizados} produtos atualizados`;

  if (falhas.length === 0) return `${parte}.`;

  const detalhe = falhas.map((f) => `${f.nome}: ${f.frase}`).join(" · ");
  const quantos =
    falhas.length === 1 ? "1 ficou de fora" : `${falhas.length} ficaram de fora`;

  return `${parte}, ${quantos} — ${detalhe}`;
}
