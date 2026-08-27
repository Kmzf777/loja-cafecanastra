"use client";

import Link from "next/link";

import { ETIQUETA, FOCO_INTERNO } from "@/components/painel/ui/estilos";
import { formatarCentavos } from "@/lib/painel/dinheiro";
import {
  FORMULAS,
  urlDaOrdenacao,
  type EstadoDoRelatorio,
} from "@/lib/painel/relatorios/relatorios.logica";

/**
 * A tabela ordenável dos relatórios.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ELA NÃO USA O PRIMITIVO `<Tabela>`.
 *
 * `<Tabela>` ordena AVISANDO: recebe `aoOrdenar`, um callback, e quem a usa
 * guarda a ordenação em estado. Aqui a ordenação vive na URL (R2) — clicar num
 * cabeçalho é NAVEGAR, e o cabeçalho tem de ser um `<a>` de verdade: o link
 * abre em nova aba, o "voltar" desfaz a ordenação, e o F5 mantém. Um `<button>`
 * com `router.push` perde as três coisas e transforma a tabela inteira numa
 * ilha de cliente com estado.
 *
 * O QUE ELA MANTÉM DO PRIMITIVO, porque é o que importa: `<table>` nativa (nada
 * de `role="grid"`, R24), `<th scope="col">` com `aria-sort` SEMPRE presente nas
 * colunas ordenáveis (inclusive como "none", senão o leitor de tela não sabe que
 * as outras também ordenam), `<th scope="row">` na primeira coluna com o
 * identificador humano (R23), `data-dado` no número, filete de 1px e o cabeçalho
 * grudado no topo.
 *
 * ISTO É UM PRIMITIVO NOVO E ELE MORA NA PASTA DESTA TELA de propósito — a regra
 * de isolamento da onda. Se a ordenação por URL virar padrão noutra tela, ele
 * sobe para `components/painel/ui/` numa consolidação, e não agora.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type ColunaDoRelatorio<L> = {
  chave: string;
  rotulo: string;
  dado?: boolean;
  /** A chave de `FORMULAS`. R29: a fórmula da métrica vive num tooltip, e é o
   *  que impede "o sistema está quebrado" quando o número diverge do extrato. */
  formula?: string;
  celula: (linha: L) => React.ReactNode;
};

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

export function TabelaDoRelatorio<L extends { chave: string }>({
  legenda,
  colunas,
  linhas,
  estado,
  totalCentavos,
}: {
  legenda: string;
  colunas: ColunaDoRelatorio<L>[];
  linhas: L[];
  estado: EstadoDoRelatorio;
  /**
   * O rodapé de soma, em CENTAVOS. Ele cai sob a ÚLTIMA coluna, e por isso os
   * relatórios desta tela põem o dinheiro por último — o que também é a ordem
   * de leitura certa: identificador, contagens, e o valor como desfecho.
   *
   * `undefined` quando somar não faz sentido: no relatório por status a coluna
   * de receita mistura pedido entregue com pedido cancelado, e o total seria um
   * número que não responde pergunta nenhuma.
   */
  totalCentavos?: number;
}) {
  return (
    <div className="w-full overflow-x-auto">
      {/* `border-separate border-spacing-0` e não o `border-collapse` padrão:
          com bordas colapsadas o filete pertence à TABELA e não acompanha o
          `<th>` grudado no topo — o cabeçalho rola e a linha embaixo dele fica
          para trás. */}
      <table className="w-full border-separate border-spacing-0 text-left">
        <caption className="sr-only">{legenda}</caption>
        <thead>
          <tr>
            {colunas.map((coluna) => {
              const ativa = estado.ordem === coluna.chave;
              return (
                <th
                  key={coluna.chave}
                  scope="col"
                  /* `aria-sort` existe em TODA coluna ordenável, inclusive como
                     "none": pô-lo só na ativa faria o leitor de tela não ter
                     como dizer que as outras também podem ser ordenadas. */
                  aria-sort={ativa ? ARIA_SORT[estado.direcao] : "none"}
                  className={`sticky top-0 z-10 border-b border-fuligem-20 bg-cal-puro p-0 ${
                    coluna.dado ? "text-right" : "text-left"
                  }`}
                >
                  <Link
                    href={urlDaOrdenacao(estado, coluna.chave)}
                    /* O padding sai do `<th>` e entra no link: é assim que a
                       célula fica comprimida (densidade) e o alvo de toque
                       chega aos 44px ao mesmo tempo (R22). */
                    className={`flex min-h-11 w-full items-center gap-1.5 px-3 py-2 transition-colors hover:bg-cal ${
                      coluna.dado ? "justify-end" : "justify-start"
                    } ${FOCO_INTERNO}`}
                    /*
                      R29: A FÓRMULA NUM TOOLTIP. O número desta coluna VAI
                      divergir do extrato do Mercado Pago, por desenho — a
                      receita aqui é o valor cobrado, com frete e sem descontar a
                      taxa da adquirente. Sem o rótulo, a conclusão é "o sistema
                      está quebrado".

                      É `title` e não um popover do Radix: `title` funciona sem
                      JavaScript, é lido pelo leitor de tela junto do nome do
                      link, e não transforma o cabeçalho num controle com estado.
                      A mesma fórmula aparece por extenso na ficha ao pé da tela,
                      para quem não usa mouse e nunca vê um `title`.
                    */
                    title={coluna.formula ? FORMULAS[coluna.formula] : undefined}
                  >
                    <span className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>
                      {coluna.rotulo}
                    </span>
                    {/* Decorativo: quem não enxerga já recebe a informação pelo
                        `aria-sort` do `<th>`, e ouvir "seta para cima" depois de
                        "ordenado crescente" é ouvir a mesma coisa duas vezes. */}
                    <span
                      aria-hidden="true"
                      className={`text-[10px] leading-none ${
                        ativa ? "text-fuligem" : "text-fuligem-55"
                      }`}
                    >
                      {ativa ? (estado.direcao === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </Link>
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody className="[&>tr:last-child>td]:border-b-0 [&>tr:last-child>th]:border-b-0">
          {linhas.map((linha) => (
            <tr key={linha.chave} className="transition-colors hover:bg-cal">
              {colunas.map((coluna, indice) =>
                /* R23: a primeira coluna é o identificador humano da linha, e
                   por isso é de fato o cabeçalho dela. Com `scope="row"` o
                   leitor de tela anuncia "Clássico 250g, Receita, R$ 1.200,00"
                   ao andar pela linha, em vez de "R$ 1.200,00" solto. */
                indice === 0 ? (
                  <th
                    key={coluna.chave}
                    scope="row"
                    className="border-b border-fuligem-20 px-3 py-2 text-left font-medium"
                  >
                    {coluna.celula(linha)}
                  </th>
                ) : (
                  <td
                    key={coluna.chave}
                    data-dado={coluna.dado ? "" : undefined}
                    className={`border-b border-fuligem-20 px-3 py-2 ${
                      coluna.dado ? "text-right" : "text-left"
                    }`}
                  >
                    {coluna.celula(linha)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>

        {/*
          O RODAPÉ DE SOMA É UM `<tfoot>` DE VERDADE, e não uma linha a mais no
          corpo: é o que faz o leitor de tela anunciá-lo como resumo em vez de
          como mais um produto chamado "Total". E é o número que o gestor confere
          contra outra fonte — sem ele, somar a coluna à mão é o gesto seguinte.
        */}
        {totalCentavos !== undefined && (
          <tfoot>
            <tr>
              <th
                scope="row"
                colSpan={colunas.length - 1}
                className={`border-t border-fuligem-20 px-3 py-2 text-left text-[11px] ${ETIQUETA} text-fuligem-55`}
              >
                Total no período
              </th>
              <td
                data-dado
                className="border-t border-fuligem-20 px-3 py-2 text-right font-medium"
              >
                {formatarCentavos(totalCentavos)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
