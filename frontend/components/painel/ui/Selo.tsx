import type { ReactNode } from "react";
import type { TomDeStatus } from "@/lib/painel/status";
import { ETIQUETA } from "./estilos";

/**
 * O filete de cada tom — e por que a cor para no filete.
 *
 * A TINTA É FULIGEM EM TODOS ELES, e isso é uma medição, não um gosto:
 * `--color-alerta` (#B87514) sobre `--color-cal-puro` dá 3,6:1, abaixo dos
 * 4,5:1 que a WCAG 1.4.3 exige de texto pequeno — e selo é o menor texto do
 * painel. Pintar a palavra do tom deixaria "Pendente" ilegível para quem tem
 * baixa visão em toda tabela de pedidos do sistema.
 *
 * Com a cor só no filete, os quatro tons ficam em ~16:1 e nada se perde: o
 * SIGNIFICADO nunca esteve na cor, está na palavra ("Cancelado", "Entregue") —
 * que é precisamente o que a WCAG 1.4.1 exige e o que o R22 quer dizer com
 * "densidade alta e COR ESCASSA". O filete é reforço, não é o canal.
 */
const FILETES: Record<TomDeStatus, string> = {
  sucesso: "border-sucesso",
  alerta: "border-alerta",
  erro: "border-vermelho",
  neutro: "border-fuligem-20",
};

/**
 * O selo de status — filete, nunca preenchimento.
 *
 * Recebe `tom` já resolvido (`tomDoStatus(pedido.status)`) e o rótulo como
 * filho (`rotuloDoStatus(pedido.status)`). O componente NÃO conhece a lista de
 * status de propósito: ela vive em `lib/painel/status.ts`, que é comparada com
 * `backend/src/utils/statusDePedido.js` lendo o arquivo do disco, e cujo topo
 * avisa "não copie esta lista para dentro de componente nenhum — foi assim que
 * ela virou três cópias". Por isso a importação daqui é `import type`: zero
 * acoplamento em tempo de execução.
 *
 * Serve a qualquer coisa com estado, não só a pedido — assinatura, campanha,
 * cupom. É por isso que a prop é `tom` e não `status`.
 */
export function Selo({
  tom = "neutro",
  children,
  className = "",
}: {
  tom?: TomDeStatus;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      /* `py-[3px]` e não `py-1`: a linha da tabela é comprimida (R22), e o selo
         precisa caber na altura de uma célula sem esticá-la. O alvo de toque de
         44px não se aplica — selo não é alvo, não é clicável. */
      className={`inline-flex items-center rounded-cx border px-2 py-[3px] text-[11px] leading-none text-fuligem ${ETIQUETA} ${FILETES[tom]} ${className}`}
    >
      {children}
    </span>
  );
}
