"use client";

import { formatarCentavos } from "@/lib/painel/dinheiro";
import type {
  LinhaPorCupom,
  LinhaPorDia,
  LinhaPorProduto,
  LinhaPorStatus,
} from "@/lib/painel/relatorios/relatorios.logica";

import type { ColunaDoRelatorio } from "./TabelaDoRelatorio";

/**
 * As colunas dos quatro relatórios.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTE ARQUIVO É `"use client"` PORQUE `celula` É UMA FUNÇÃO, e função não
 * atravessa a fronteira Server→Client. Declarar estas listas dentro da
 * `page.tsx` (que é Server Component) faz o React lançar
 *
 *     Functions cannot be passed directly to Client Components…
 *
 * em tempo de EXECUÇÃO — e o `next build` não pega, porque toda rota sob
 * `/dashboard` é dinâmica. A tela ficaria em branco na frente do gestor. Já
 * aconteceu nesta reescrita, com as telas de Clientes e Assinaturas.
 *
 * O DINHEIRO É SEMPRE A ÚLTIMA COLUNA, nos três relatórios que somam: é sob ela
 * que o `<tfoot>` da `<TabelaDoRelatorio>` põe o total, e é a ordem de leitura
 * certa — identificador, contagens, e o valor como desfecho.
 *
 * `formula` aponta para uma entrada de `FORMULAS` (R29). Toda coluna de DINHEIRO
 * tem uma, porque é sobre dinheiro que a divergência com o extrato do Mercado
 * Pago acontece; as de contagem têm quando "contar o quê" não é óbvio.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const COLUNAS_DE_PRODUTO: ColunaDoRelatorio<LinhaPorProduto>[] = [
  { chave: "nome", rotulo: "Produto", celula: (l) => l.nome },
  {
    chave: "unidades",
    rotulo: "Unidades",
    dado: true,
    formula: "unidades",
    celula: (l) => l.unidades,
  },
  {
    chave: "pedidos",
    rotulo: "Pedidos",
    dado: true,
    formula: "pedidos",
    celula: (l) => l.pedidos,
  },
  {
    chave: "receita",
    rotulo: "Receita",
    dado: true,
    /* A fórmula desta coluna NÃO é a mesma da receita do pedido: aqui é preço
       do item × quantidade, SEM frete. Por isso a soma desta tabela é menor que
       o faturamento do período — e é exatamente o tipo de diferença que vira
       "o relatório não fecha" quando ninguém a declara. */
    formula: "receitaPorProduto",
    celula: (l) => formatarCentavos(l.receitaCentavos),
  },
];

export const COLUNAS_DE_CUPOM: ColunaDoRelatorio<LinhaPorCupom>[] = [
  { chave: "codigo", rotulo: "Cupom", celula: (l) => l.codigo },
  {
    chave: "pedidos",
    rotulo: "Pedidos",
    dado: true,
    formula: "pedidos",
    celula: (l) => l.pedidos,
  },
  {
    chave: "desconto",
    rotulo: "Desconto dado",
    dado: true,
    formula: "desconto",
    celula: (l) => formatarCentavos(l.descontoCentavos),
  },
  {
    chave: "receita",
    rotulo: "Receita",
    dado: true,
    formula: "receita",
    celula: (l) => formatarCentavos(l.receitaCentavos),
  },
];

export const COLUNAS_DE_DIA: ColunaDoRelatorio<LinhaPorDia>[] = [
  /* O rótulo é `diaBr` (dd/mm/aaaa, R31) e a ORDENAÇÃO é pela chave ISO — se
     fosse pelo texto brasileiro, 01/09 viria antes de 02/08. A separação vive
     em `valorDaColuna`, no módulo puro, com teste. */
  { chave: "dia", rotulo: "Dia", celula: (l) => l.diaBr },
  {
    chave: "pedidos",
    rotulo: "Pedidos",
    dado: true,
    formula: "pedidos",
    celula: (l) => l.pedidos,
  },
  {
    chave: "receita",
    rotulo: "Receita",
    dado: true,
    formula: "receita",
    celula: (l) => formatarCentavos(l.receitaCentavos),
  },
];

export const COLUNAS_DE_STATUS: ColunaDoRelatorio<LinhaPorStatus>[] = [
  // O RÓTULO em português, e nunca o valor cru do banco — mas o valor continua
  // sendo o que trafega. Traduzir o VALOR é o defeito que os 9 status já
  // custaram a esta casa uma vez.
  { chave: "status", rotulo: "Status", celula: (l) => l.rotulo },
  {
    chave: "pedidos",
    rotulo: "Pedidos",
    dado: true,
    formula: "pedidos",
    celula: (l) => l.pedidos,
  },
  {
    chave: "receita",
    rotulo: "Valor",
    dado: true,
    formula: "receita",
    celula: (l) => formatarCentavos(l.receitaCentavos),
  },
];
