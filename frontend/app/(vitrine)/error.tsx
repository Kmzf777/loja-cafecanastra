"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * estetica.md §11 — o erro explica e resolve; nunca pede desculpa, nunca mostra
 * stack trace ao cliente. Uma acao concreta, sempre.
 */
export default function ErroVitrine({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-20 md:px-10 md:py-28">
      <h1 className="max-w-[20ch] titulo-secao text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.05]">
        Não foi possível carregar esta página.
      </h1>
      <p className="mt-5 max-w-[56ch] text-[17px] leading-relaxed text-fuligem-80">
        A conexão pode ter caído no meio do caminho. Tentar de novo costuma
        resolver.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button
          onClick={reset}
          className="h-12 rounded-bt bg-vermelho px-6 text-[13px] font-semibold uppercase tracking-[0.08em] text-white transition-colors hover:bg-vermelho-esc focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-fuligem"
        >
          Tentar de novo
        </button>
        <Link
          href="/cafes"
          className="flex h-12 items-center rounded-bt border border-current px-6 text-[13px] font-semibold uppercase tracking-[0.08em] transition-colors hover:bg-fuligem hover:text-cal focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
        >
          Ir para os cafés
        </Link>
      </div>
      {error.digest ? (
        <p className="mt-8 font-dado text-[12px] text-fuligem-55">
          Código: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
