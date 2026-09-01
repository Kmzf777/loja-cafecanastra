import Link from "next/link";
import type { ReactNode } from "react";

import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";

/**
 * O <Botao> desta casa, mas NAVEGANDO — e por que ele não é uma variante do
 * <Botao> nem um `<Botao onClick={router.push}>`.
 *
 * "Novo produto" leva a uma ROTA (`/dashboard/produtos/novo`), e rota se alcança
 * com `<a href>`. Um `<button onClick>` que empurra o router perde três coisas
 * de graça do navegador: abrir em outra aba com Ctrl+clique, copiar o endereço,
 * e funcionar antes de o JavaScript carregar. Além disso arrastaria a página
 * inteira para `"use client"` por causa de um `onClick` — que é como um painel
 * de Server Components vira um SPA sem ninguém ter decidido isso (spec §2.3).
 *
 * ELE É LOCAL A ESTA TELA DE PROPÓSITO, e está no relatório como candidato a
 * consolidação. As classes são as mesmas de `ui/Botao.tsx` (variante primária),
 * copiadas e não importadas porque `CAIXA` e `VARIANTES` não são exportados de
 * lá — e esta onda não edita os primitivos, para duas telas nascendo em paralelo
 * não colidirem no mesmo arquivo. Se um segundo `LinkDeAcao` aparecer noutra
 * tela, é sinal de que a variante pertence ao <Botao>.
 */
export function LinkDeAcao({
  href,
  children,
  variante = "primaria",
}: {
  href: string;
  children: ReactNode;
  variante?: "primaria" | "secundaria";
}) {
  const caixa =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-bt px-4 " +
    `text-[11px] ${ETIQUETA} leading-none transition-colors duration-150 ${FOCO}`;

  const pele =
    variante === "primaria"
      ? "bg-fuligem text-cal hover:bg-fuligem-80"
      : "border border-fuligem-20 text-fuligem hover:border-fuligem hover:bg-cal";

  return (
    <Link href={href} className={`${caixa} ${pele}`}>
      {children}
    </Link>
  );
}
