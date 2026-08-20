import Image from "next/image";
import Link from "next/link";
import { Serra } from "@/components/marca/Serra";
import { AtalhosDoCliente } from "./AtalhosDoCliente";
import { AvisoFreteGratis } from "./AvisoFreteGratis";

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

/**
 * Caixa de busca — form GET puro para /cafes?q=…, submit nativo.
 *
 * Progressive enhancement de graça: sem JS o navegador monta a querystring e a
 * PLP (Server Component) filtra no servidor. Nenhum estado, nenhum onChange —
 * e o Cabecalho continua Server Component. O `id` distingue as duas instâncias
 * (barra desktop e painel mobile) para o htmlFor não duplicar, e o `rotulo`
 * distingue os dois landmarks `role="search"` para o leitor de tela — dois
 * landmarks iguais na mesma página obrigam a visitar ambos para saber qual é.
 */
function FormBusca({
  id,
  rotulo,
  className = "",
}: {
  id: string;
  rotulo: string;
  className?: string;
}) {
  return (
    <form
      action="/cafes"
      method="get"
      role="search"
      aria-label={rotulo}
      className={`flex items-stretch ${className}`}
    >
      <label htmlFor={id} className="sr-only">
        Buscar cafés
      </label>
      <input
        id={id}
        type="search"
        name="q"
        placeholder="Buscar café"
        autoComplete="off"
        className="h-11 w-full min-w-0 border border-r-0 border-fuligem-20 bg-cal-puro px-3 text-[14px] placeholder:text-fuligem-55 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      />
      <button
        type="submit"
        aria-label="Buscar"
        className="flex h-11 w-11 shrink-0 items-center justify-center border border-fuligem-20 text-fuligem-55 transition-colors hover:border-fuligem hover:text-fuligem focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      >
        <svg
          viewBox="0 0 20 20"
          aria-hidden
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <circle cx="9" cy="9" r="6" />
          <path d="m13.5 13.5 4.5 4.5" />
        </svg>
      </button>
    </form>
  );
}

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
          {/* O piso do frete grátis vem de GET /config e pode mudar sem
              deploy — só este trecho é ilha client; o separador vai junto
              porque a promessa inteira some quando o admin a desliga. */}
          <AvisoFreteGratis />
        </p>
      </div>

      <div className="sticky top-0 z-40 border-b border-fuligem-20 bg-cal">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-4 px-4 md:h-[92px] md:px-10">
          <Logo />

          {/* Navegacao de desktop */}
          <div className="hidden items-center gap-8 md:flex">
            <nav aria-label="Principal">
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
            <FormBusca id="busca-desktop" rotulo="Buscar cafés" className="w-56" />
            <AtalhosDoCliente />
          </div>

          {/* Em mobile a sacola fica FORA do acordeao: é o atalho que a pessoa
              mais procura e não pode depender de abrir o menu antes. */}
          <div className="flex items-center gap-2 md:hidden">
            <AtalhosDoCliente />

            {/* Acordeao de mobile — sem JS. O `md:hidden` mora só no <div>
                pai, que já esconde tudo isto no desktop. */}
            <details className="group [&[open]_.rotulo-abrir]:hidden [&[open]_.rotulo-fechar]:inline">
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
                  viewport: a barra de aviso muda de altura quando o texto
                  quebra em telas estreitas, entao qualquer deslocamento fixo
                  erraria. */}
              <nav
                aria-label="Principal"
                className="absolute inset-x-0 top-full z-50 flex h-[calc(100dvh-72px)] flex-col overflow-y-auto border-t border-fuligem-20 bg-cal"
              >
                {/* A busca abre o painel: quem toca em "Menu" no celular esta
                    procurando alguma coisa — o campo vem antes dos links. */}
                <div className="border-b border-fuligem-20 px-4 py-4">
                  <FormBusca id="busca-mobile" rotulo="Buscar cafés (menu)" />
                </div>
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

                {/* mt-auto empurra a assinatura para o rodape do painel: o
                    menu ocupa a tela inteira, entao o espaco vazio fica no
                    meio e nao entre o ultimo link e a serra. */}
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
