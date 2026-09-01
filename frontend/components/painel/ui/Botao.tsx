"use client";

import type { ComponentProps, ReactNode } from "react";
import { FOCO, ETIQUETA } from "./estilos";

type Variante = "primaria" | "secundaria" | "destrutiva";

/**
 * A caixa, igual nas três variantes.
 *
 * `min-h-11` são 44px — R22 manda comprimir o PADDING da célula e nunca o alvo
 * de toque, e 44px é o alvo mínimo da WCAG 2.2 (2.5.5). A densidade do painel
 * sai da célula da tabela e da entrelinha, não do botão.
 *
 * Caixa alta em 11px com entreletra aberta é a voz da etiqueta (estetica.md
 * §4.2) — a mesma do selo "SPECIALTY ESPECIAL SCA 80+" da embalagem. Num painel
 * que é etiqueta pura, o rótulo do botão é um carimbo, não uma frase.
 *
 * `rounded-bt` são os 2px do §4.3: "botões e inputs ficam em 2px para não cair
 * no jornal". Contêiner é `rounded-cx` (0px); controle é 2px.
 */
const CAIXA =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-bt px-4 " +
  `text-[11px] ${ETIQUETA} leading-none transition-colors duration-150 ` +
  "disabled:cursor-not-allowed disabled:opacity-40 " +
  FOCO;

/**
 * Três variantes, e a diferença entre elas é de PESO, não só de cor.
 *
 * `primaria` — fuligem sólido sobre cal. É a resolução do conflito de cor da
 * spec §2.5: na loja o vermelho é o acento de marca e vira o CTA; aqui ele é
 * reservado a erro e destruição (R21), então a ação primária do painel é o
 * preto. 16,4:1 de contraste, e nenhuma dúvida sobre onde clicar.
 *
 * `secundaria` — filete de 1px e nada mais. No hover o filete escurece de
 * `fuligem-20` para `fuligem`; ela NÃO se preenche de preto, porque um
 * secundário que vira sólido no hover se disfarça de primário justamente no
 * instante em que o ponteiro está em cima dele. O `bg-cal` do hover é a mesma
 * cal do fundo da página, dois pontos abaixo da cal-pura da ficha: separa o
 * "posso clicar" do "está desenhado" sem introduzir cor nenhuma.
 *
 * `destrutiva` — filete VERMELHO, e é aqui que mora o R11 ("peso e cor
 * diferentes"). A tentação é escrever `bg-vermelho text-white` e chamar de
 * pronto; isso faz "Excluir" ficar mais pesado que "Salvar" na mesma barra, e
 * um botão destrutivo que grita mais alto que a ação desejada é um convite ao
 * slip que o NN/g cataloga entre os dez piores erros de admin. Vermelho no
 * filete e na tinta avisa; preenchimento vermelho comanda.
 * O preenchimento vermelho fica guardado para o botão de confirmação DENTRO do
 * diálogo destrutivo, onde ele já não compete com nada.
 *
 * O hover dela aprofunda a TINTA (`vermelho-esc`, o token que a loja já usa em
 * hover/pressed), não acrescenta preenchimento — a primeira versão usava
 * `bg-vermelho/5`, e um wash de 5% não é nenhum dos tokens da casa: é uma cor
 * inventada no meio do caminho, exatamente o que a paleta fechada existe para
 * impedir.
 */
const VARIANTES: Record<Variante, string> = {
  primaria: "bg-fuligem text-cal hover:bg-fuligem-80",
  secundaria: "border border-fuligem-20 text-fuligem hover:border-fuligem hover:bg-cal",
  destrutiva: "border border-vermelho text-vermelho hover:border-vermelho-esc hover:text-vermelho-esc",
};

export function Botao({
  variante = "primaria",
  className = "",
  children,
  /**
   * O padrão é `button`, e não o `submit` do HTML.
   *
   * Dentro de um `<form>`, um `<button>` sem `type` submete — é o default da
   * especificação. É assim que um botão de "Filtrar" ou de "Adicionar linha"
   * vira um salvamento acidental, e o defeito não aparece em teste de unidade
   * nem em revisão: aparece quando o gestor perde o que digitou.
   */
  type = "button",
  ...props
}: {
  variante?: Variante;
  className?: string;
  children: ReactNode;
} & ComponentProps<"button">) {
  return (
    <button type={type} className={`${CAIXA} ${VARIANTES[variante]} ${className}`} {...props}>
      {children}
    </button>
  );
}
