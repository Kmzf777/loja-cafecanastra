"use client";

import type { ReactNode } from "react";
import { ETIQUETA, FOCO_INTERNO } from "./estilos";

export type Coluna<L> = {
  /** O que vai para `aoOrdenar`. É a chave da REGRA de ordenação, não do dado. */
  chave: string;
  rotulo: string;
  /** Coluna de número, dinheiro, data ou código: ganha `data-dado` (que o
   *  globals.css converte em monoespaçada com numeral tabular) e alinha à
   *  direita. R23 — comparar valores vira comparar posição, não comprimento. */
  dado?: boolean;
  ordenavel?: boolean;
  celula: (linha: L) => ReactNode;
};

export type Ordenacao = { chave: string; direcao: "asc" | "desc" };

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

/**
 * A tabela do painel — `<table>` nativa, e por que não `role="grid"`.
 *
 * R24, e a spec §2.7 repete: adotar `role="grid"` obriga a implementar
 * navegação 2D por setas, roving tabindex e virtualização acessível À MÃO. Com
 * `<table>`, `<th scope>`, `<button>` e `aria-sort`, o teclado e o leitor de
 * tela funcionam de graça, e continuam funcionando quando alguém mexer aqui
 * daqui a um ano sem ter lido nada disto.
 *
 * A TABELA NÃO ORDENA. Ela avisa qual coluna foi pedida e desenha o `aria-sort`
 * do estado que recebeu. Qual comparador, o que fazer com nulo, se a ordenação
 * é estável — isso é regra de negócio, e a spec §2.8 manda regra de negócio
 * morar num `*.logica.ts` puro, testado sem DOM. Uma tabela que ordena por
 * conta própria esconde essa regra dentro de um componente onde ela não pode
 * ser testada direito.
 *
 * A TABELA TAMBÉM NÃO DESENHA O VAZIO. Zero linhas aqui é só zero linhas;
 * distinguir "não há pedidos" de "não consegui perguntar" é o trabalho do
 * <EstadoDaTela>, e é o defeito mais caro do painel legado.
 */
export function Tabela<L>({
  legenda,
  colunas,
  linhas,
  chaveDaLinha,
  ordenacao,
  aoOrdenar,
  className = "",
}: {
  /** O nome da tabela para quem não a vê. Vai num <caption> visualmente oculto:
   *  o título já está visível na <Ficha> que a contém, mas um leitor de tela
   *  que salte direto para a tabela precisa ouvir de que tabela se trata. */
  legenda: string;
  colunas: Coluna<L>[];
  linhas: L[];
  chaveDaLinha: (linha: L) => string;
  ordenacao?: Ordenacao;
  aoOrdenar?: (chave: string) => void;
  className?: string;
}) {
  return (
    /* O scroll horizontal mora AQUI e não no <table>: a tabela precisa poder
       ser mais larga que a tela sem empurrar a página inteira para o lado. */
    <div className={`w-full overflow-x-auto ${className}`}>
      {/* `border-separate border-spacing-0` e não o `border-collapse` padrão:
          com bordas colapsadas o navegador atribui o filete à TABELA, e o filete
          do <th> fixo não acompanha a rolagem — o cabeçalho gruda no topo e a
          linha embaixo dele fica para trás. Separadas, cada célula pinta o
          próprio filete e ele viaja junto. */}
      <table className="w-full border-separate border-spacing-0 text-left">
        <caption className="sr-only">{legenda}</caption>
        <thead>
          <tr>
            {colunas.map((coluna) => {
              /* "Ordenável" é `ordenavel` E ter para quem avisar. Sem
                 `aoOrdenar`, um botão de ordenação seria um controle que não
                 faz nada e um `aria-sort` que promete o que a tela não cumpre —
                 a mesma doutrina do <EstadoDaTela>, que não desenha "Tentar de
                 novo" quando ninguém lhe deu o que tentar. */
              const podeOrdenar = Boolean(coluna.ordenavel && aoOrdenar);
              const ativa = ordenacao?.chave === coluna.chave;
              const rotulo = (
                <span className={`text-[11px] ${ETIQUETA} text-fuligem-55`}>{coluna.rotulo}</span>
              );
              return (
                <th
                  key={coluna.chave}
                  scope="col"
                  /* `aria-sort` só existe em coluna ordenável — e nela existe
                     SEMPRE, inclusive como "none". Pôr o atributo só na coluna
                     ativa faz o leitor de tela não ter como dizer que as outras
                     também podem ser ordenadas. */
                  aria-sort={podeOrdenar ? (ativa ? ARIA_SORT[ordenacao.direcao] : "none") : undefined}
                  className={`sticky top-0 z-10 border-b border-fuligem-20 bg-cal-puro ${
                    coluna.dado ? "text-right" : "text-left"
                  } ${podeOrdenar ? "p-0" : "px-3 py-2"}`}
                >
                  {podeOrdenar && aoOrdenar ? (
                    /* O padding sai do <th> e entra no <button> — é assim que a
                       célula fica comprimida (R22) e o alvo de toque chega aos
                       44px ao mesmo tempo: o botão preenche a célula inteira em
                       vez de ser um pedacinho de texto dentro dela. */
                    <button
                      type="button"
                      onClick={() => aoOrdenar(coluna.chave)}
                      className={`flex min-h-11 w-full items-center gap-1.5 px-3 py-2 transition-colors hover:bg-cal ${
                        coluna.dado ? "justify-end" : "justify-start"
                      } ${FOCO_INTERNO}`}
                    >
                      {rotulo}
                      {/* Decorativo e `aria-hidden`: quem não enxerga já recebe
                          a mesma informação pelo `aria-sort` do <th>, e ouvir
                          "seta para cima" depois de "ordenado crescente" é
                          ouvir a mesma coisa duas vezes. */}
                      <span
                        aria-hidden="true"
                        className={`text-[10px] leading-none ${
                          ativa ? "text-fuligem" : "text-fuligem-55"
                        }`}
                      >
                        {ativa ? (ordenacao.direcao === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  ) : (
                    rotulo
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        {/* O filete da ÚLTIMA linha sai: a <Ficha> que envolve a tabela já
            desenha o seu, e dois filetes de 1px encostados viram um de 2px que
            não combina com nenhum outro da tela. */}
        <tbody className="[&>tr:last-child>td]:border-b-0 [&>tr:last-child>th]:border-b-0">
          {linhas.map((linha) => (
            <tr key={chaveDaLinha(linha)} className="transition-colors hover:bg-cal">
              {colunas.map((coluna, indice) =>
                /* R23: a primeira coluna é o identificador HUMANO da linha
                   (número do pedido + nome, nunca UUID), então ela é de fato o
                   cabeçalho da linha. Com `scope="row"`, o leitor de tela
                   anuncia "Maria Souza, Total, R$ 128,00" ao andar pela linha,
                   em vez de "R$ 128,00" solto, sem dizer de quem. */
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
      </table>
    </div>
  );
}
