import type { ReactNode } from "react";

/**
 * Moldura das paginas institucionais.
 *
 * Medida de leitura de 62ch (estetica.md §4.2: 60-72 caracteres, nunca
 * full-width). O corpo em Archivo, os titulos de secao em Archivo 600 — a
 * Redaction so entra acima de 40px, o que aqui vale apenas para o <h1>.
 */
export function PaginaTexto({
  titulo,
  atualizacao,
  children,
}: {
  titulo: string;
  atualizacao: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-10 md:px-10 md:py-20">
      <h1 className="font-titulo text-[clamp(2.25rem,5vw,3.75rem)] leading-none">
        {titulo}
      </h1>
      <p className="mt-4 font-dado text-[12px] uppercase tracking-[0.1em] text-fuligem-55">
        Atualizado em {atualizacao}
      </p>

      <div
        className="
          mt-10 max-w-[62ch] text-[17px] leading-relaxed text-fuligem-80
          [&_h2]:mt-10 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:uppercase
          [&_h2]:tracking-[0.14em] [&_h2]:text-fuligem
          [&_p]:mt-4 [&_ul]:mt-4 [&_ul]:space-y-2 [&_li]:pl-5 [&_li]:relative
          [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:content-['—']
          [&_li]:before:text-fuligem-55
          [&_a]:text-vermelho [&_a]:underline [&_a]:underline-offset-4
        "
      >
        {children}
      </div>
    </div>
  );
}

/** Aviso honesto: o texto abaixo nao passou por revisao juridica. */
export function AvisoJuridico() {
  return (
    <p className="mt-10 max-w-[62ch] border border-alerta/40 bg-alerta/5 p-4 text-[14px] leading-relaxed text-fuligem-80">
      <strong className="font-semibold text-fuligem">
        Texto provisório, ainda sem revisão jurídica.
      </strong>{" "}
      Este conteúdo é um esqueleto para desenvolvimento e não deve ir ao ar como
      documento legal do Café Canastra sem passar por um advogado — em especial
      nos pontos de LGPD, direito de arrependimento e política de trocas.
    </p>
  );
}
