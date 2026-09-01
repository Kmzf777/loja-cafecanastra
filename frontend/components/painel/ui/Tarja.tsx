"use client";

import type { ReactNode } from "react";
import { FOCO } from "./estilos";

type Tom = "erro" | "alerta" | "sucesso" | "aviso";

const TONS: Record<Tom, { borda: string; texto: string; papel: "alert" | "status" }> = {
  erro: { borda: "border-vermelho", texto: "text-vermelho", papel: "alert" },
  // Filete no ocre da marca, texto no tom escuro: `--color-alerta` sobre
  // cal-puro dá 3,60:1, que passa na WCAG 1.4.11 (3:1, elemento não-textual)
  // e reprova na 1.4.3 (4,5:1, texto pequeno). `--color-alerta-esc` dá 4,87:1.
  alerta: { borda: "border-alerta", texto: "text-alerta-esc", papel: "status" },
  sucesso: { borda: "border-sucesso", texto: "text-sucesso", papel: "status" },
  aviso: { borda: "border-fuligem-20", texto: "text-fuligem-55", papel: "status" },
};

/**
 * A tarja — e por que ela NÃO é um toast.
 *
 * R9 da pesquisa: erro nunca é toast. Flash que some sozinho pode não ser
 * anunciado por leitor de tela, desaparece para quem usa ampliação, e não tem
 * como ser relido por quem olhou tarde. "Se a informação só existe no toast,
 * ela não existe."
 *
 * `role="alert"` só para erro. Em `status` o leitor de tela anuncia sem
 * interromper o que a pessoa está fazendo — usar `alert` para tudo treina o
 * usuário a ignorar a região inteira.
 *
 * Filete à esquerda e nada mais: sem fundo colorido, sem sombra, sem ícone
 * decorativo. A cor faz o trabalho e o texto carrega o diagnóstico.
 *
 * O filete é de 2px, e é a única exceção ao 1px do estetica.md §4.4 nesta
 * pasta: aqui ele não separa superfícies, ele CARREGA o significado (é o único
 * elemento colorido do componente). Encostado no filete de 1px da <Ficha> que
 * quase sempre a contém, 1px não se distinguiria da moldura.
 */
export function Tarja({
  tom = "erro",
  children,
  onFechar,
}: {
  tom?: Tom;
  children: ReactNode;
  onFechar?: () => void;
}) {
  const t = TONS[tom];
  return (
    <div
      role={t.papel}
      className={`flex items-start gap-3 border-l-2 ${t.borda} rounded-cx bg-cal-puro px-4 py-3`}
    >
      <p className={`flex-1 ${t.texto}`}>{children}</p>
      {onFechar && (
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar aviso"
          /* R22 — "comprima o padding, nunca o alvo de toque". As margens
             negativas de -12px devolvem exatamente o `py-3` do contêiner, de
             modo que o botão chegue aos 44px do alvo SEM engordar a tarja: a
             altura dele passa a contar como os mesmos 20px da linha de texto. */
          className={`-my-3 -mr-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center text-fuligem-55 transition-colors hover:text-fuligem ${FOCO}`}
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );
}
