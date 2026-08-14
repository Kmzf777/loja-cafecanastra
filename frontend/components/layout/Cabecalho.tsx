import Link from "next/link";
import { Serra } from "@/components/marca/Serra";

/**
 * estetica.md §5.8.
 *
 * Barra de aviso em fuligem (36px, Martian Mono 12px) + header em cal (72px).
 * Logo a ESQUERDA, nao centralizado — decisao deliberada do §2: o lockup da
 * Canastra e largo, e centralizar so funciona para logotipo estreito.
 *
 * Sem blur nem glassmorphism (§5.8): fundo cal solido e filete inferior.
 *
 * PROVISORIO: o §1 pede tres SVGs (completo / reduzido / icone). Existe apenas
 * `logo-canastra.png`, raster 3508x2481. Aqui usamos o lockup completo reduzido,
 * o que desperdica banda e area vazia — o logo reduzido (serra + "CANASTRA" em
 * grotesca condensada) resolve, mas depende da vetorizacao.
 */

const NAV = [
  { href: "/cafes", rotulo: "Cafés" },
  { href: "/clube", rotulo: "Assinatura" },
  { href: "/a-serra", rotulo: "A Serra" },
];

export function Cabecalho() {
  return (
    <header>
      <div className="bg-fuligem text-cal">
        <p className="mx-auto flex h-9 max-w-[1440px] items-center justify-center gap-3 px-5 text-center font-dado text-[11px] leading-none tracking-[0.06em] md:px-10">
          Torrado sob demanda
          <span aria-hidden className="text-fuligem-55">
            ·
          </span>
          Frete grátis acima de R$ 149
        </p>
      </div>

      <div className="sticky top-0 z-40 border-b border-fuligem-20 bg-cal">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-6 px-5 md:px-10">
          {/* Logo REDUZIDO (§1): serra + "CANASTRA" em grotesca condensada.
              O lockup completo tem proporcao ~3:2 com muita area vazia e fica
              ilegivel em 44px de altura — por isso o documento pede tres
              versoes. O lockup completo vive no rodape, em tamanho generoso. */}
          <Link
            href="/"
            aria-label="Café Canastra — página inicial"
            className="flex items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
          >
            <Serra aria-hidden className="h-4 w-11 text-fuligem" strokeWidth={2} />
            <span className="text-[19px] font-bold uppercase leading-none tracking-[0.14em] md:text-[21px]">
              Canastra
            </span>
          </Link>

          <nav aria-label="Principal">
            <ul className="flex items-center gap-6 md:gap-8">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-[13px] font-semibold uppercase tracking-[0.12em] transition-colors hover:text-vermelho focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
                  >
                    {item.rotulo}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* A "mao" aparecendo uma vez: o traco da serra fecha o header. */}
        <Serra
          aria-hidden
          className="h-1.5 w-full text-fuligem-20"
          strokeWidth={1}
        />
      </div>
    </header>
  );
}
