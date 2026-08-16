import Image from "next/image";
import Link from "next/link";
import { Serra } from "@/components/marca/Serra";

/**
 * estetica.md §5.8 e §10.
 *
 * Mobile-first: a navegacao nasce como acordeao em tela cheia e so vira barra
 * horizontal a partir de `md`. O §10 pede exatamente isso ("Mega menu ->
 * acordeao em tela cheia").
 *
 * O menu usa <details>/<summary>, nao estado de React. Tres razoes: funciona
 * com JS desabilitado (§12), ja vem com semantica de expandido/recolhido e
 * navegacao por teclado, e mantem o Cabecalho como Server Component — o header
 * nao entra no bundle de JS da rota.
 *
 * LARGURA DO LOGO: o ativo e 3508x2481. Sem `w-[...]` explicito no <img>, o
 * flex do header passa a ser dimensionado pela largura intrinseca da imagem e
 * o documento inteiro estoura 3.126px em mobile — `max-width:100%` nao salva,
 * porque a referencia dele e o pai, que por sua vez depende do filho. Por isso
 * a largura e fixada aqui, e a altura acompanha.
 */

const NAV = [
  { href: "/cafes", rotulo: "Cafés" },
  { href: "/clube", rotulo: "Assinatura" },
  { href: "/a-serra", rotulo: "A Serra" },
];

function Logo() {
  return (
    <Link
      href="/"
      aria-label="Café Canastra — página inicial"
      className="flex shrink-0 items-center focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
    >
      <Image
        src="/logo-canastra.png"
        alt="Café Canastra, desde 1985"
        width={3508}
        height={2481}
        priority
        sizes="(min-width: 768px) 150px, 108px"
        className="h-auto w-[108px] object-contain md:w-[150px]"
      />
    </Link>
  );
}

export function Cabecalho() {
  return (
    <header>
      {/* Barra de aviso — §5.8 */}
      <div className="bg-fuligem text-cal">
        <p className="mx-auto flex min-h-9 max-w-[1440px] flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-4 py-2 text-center font-dado text-[10px] leading-tight tracking-[0.04em] sm:text-[11px] md:px-10">
          <span>Torrado sob demanda</span>
          <span aria-hidden className="text-fuligem-55">
            ·
          </span>
          <span>Frete grátis acima de R$ 149</span>
        </p>
      </div>

      <div className="sticky top-0 z-40 border-b border-fuligem-20 bg-cal">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-4 px-4 md:h-[92px] md:px-10">
          <Logo />

          {/* Navegacao de desktop */}
          <nav aria-label="Principal" className="hidden md:block">
            <ul className="flex items-center gap-8">
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

          {/* Acordeao de mobile — sem JS */}
          <details className="group md:hidden [&[open]_.rotulo-abrir]:hidden [&[open]_.rotulo-fechar]:inline">
            <summary
              className="flex h-11 min-w-11 cursor-pointer list-none items-center gap-2 border border-fuligem-20 px-3 text-[12px] font-semibold uppercase tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
              aria-label="Abrir menu"
            >
              <span aria-hidden className="flex w-4 flex-col gap-[3px]">
                <span className="h-px w-full bg-fuligem" />
                <span className="h-px w-full bg-fuligem" />
                <span className="h-px w-full bg-fuligem" />
              </span>
              <span className="rotulo-abrir">Menu</span>
              <span className="rotulo-fechar hidden">Fechar</span>
            </summary>

            {/* Painel ancorado ao proprio header (`top-full`), e nao a
                viewport: a barra de aviso muda de altura quando o texto quebra
                em telas estreitas, entao qualquer deslocamento fixo erraria. */}
            <nav
              aria-label="Principal"
              className="absolute inset-x-0 top-full z-50 flex h-[calc(100dvh-72px)] flex-col overflow-y-auto border-t border-fuligem-20 bg-cal"
            >
              <ul className="flex flex-col">
                {NAV.map((item) => (
                  <li key={item.href} className="border-b border-fuligem-20">
                    <Link
                      href={item.href}
                      className="flex min-h-[64px] items-center justify-between px-5 text-[20px] font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-vermelho"
                    >
                      {item.rotulo}
                      <span aria-hidden className="font-dado text-fuligem-55">
                        →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>

              {/* mt-auto empurra a assinatura para o rodape do painel: o menu
                  ocupa a tela inteira, entao o espaco vazio fica no meio e nao
                  entre o ultimo link e a serra. */}
              <div className="mt-auto px-4 pb-10 pt-8">
                <Serra
                  aria-hidden
                  className="h-10 w-full text-fuligem-20"
                  strokeWidth={1.5}
                />
                <p className="mt-6 font-dado text-[11px] uppercase tracking-[0.1em] text-fuligem-55">
                  Serra da Canastra · Minas Gerais
                </p>
              </div>
            </nav>
          </details>
        </div>

        <Serra
          aria-hidden
          className="h-1.5 w-full text-fuligem-20"
          strokeWidth={1}
        />
      </div>
    </header>
  );
}
