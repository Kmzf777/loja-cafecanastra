"use client";

import Link from "next/link";
import { useSacola } from "@/lib/sacola/sacola";

/**
 * Sacola e conta no cabeçalho.
 *
 * Ilha client dentro de um header que é Server Component. A separação é
 * deliberada: o contador da sacola depende de estado do navegador, mas o resto
 * do header (logo, navegação, menu em <details>) continua fora do bundle de JS,
 * que é o que o comentário no topo de Cabecalho.tsx protege.
 *
 * Antes desta peça não havia link para entrar em lugar nenhum da vitrine: as
 * rotas /account e /account/login existiam e só eram alcançadas por quem
 * digitasse a URL ou fosse empurrado pelo guard do painel.
 */
export function AtalhosDoCliente() {
  const { quantidadeTotal } = useSacola();

  return (
    <div className="flex items-center gap-1">
      <Link
        href="/account"
        className="flex h-11 items-center px-3 text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors hover:text-vermelho focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      >
        Conta
      </Link>

      <Link
        href="/sacola"
        // O rótulo acessível carrega a contagem: o número ao lado do texto é
        // visual, e sem isto o leitor de tela anuncia só "Sacola".
        aria-label={
          quantidadeTotal > 0
            ? `Sacola com ${quantidadeTotal} ${quantidadeTotal === 1 ? "item" : "itens"}`
            : "Sacola vazia"
        }
        className="flex h-11 items-center gap-2 border border-fuligem-20 px-3 text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors hover:border-fuligem focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      >
        Sacola
        {quantidadeTotal > 0 ? (
          <span
            aria-hidden
            className="inline-flex min-w-5 items-center justify-center bg-vermelho px-1.5 font-dado text-[11px] leading-5 text-white"
          >
            {quantidadeTotal}
          </span>
        ) : null}
      </Link>
    </div>
  );
}
