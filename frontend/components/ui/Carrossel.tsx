"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import useEmblaCarousel from "embla-carousel-react";

/**
 * O TRILHO ARRASTÁVEL DA HOME — e ele não sabe o que é um produto.
 *
 * DUAS CAMADAS, E A DE BAIXO É A QUE IMPORTA. A base é `overflow-x-auto` com
 * `scroll-snap`: arrasta nativo, com a inércia do próprio sistema, e funciona
 * com JavaScript desligado — que o §12 do estetica.md exige e que uma
 * biblioteca sozinha não daria. O Embla entra por cima e acrescenta o que o
 * scroll-snap puro não tem: arrasto por MOUSE no desktop, onde a pessoa não
 * pode empurrar a tela com o dedo.
 *
 * Se o Embla falhar em carregar, o trilho continua rolando. Essa é a razão da
 * ordem — biblioteca primeiro seria uma loja que depende de 5 KB para mostrar
 * o que vende.
 *
 * O RECORTE É O CONVITE. As larguras abaixo NUNCA fecham um número inteiro de
 * cards na tela: sobra sempre uma fração cortada na borda direita, e é ela que
 * diz "tem mais". Um trilho que fecha certo parece grade, e ninguém arrasta uma
 * grade. O teste ao lado trava isso.
 */

export const LARGURA_DO_SLIDE = {
  /** 1 card inteiro + ~0,7 do segundo — o que o briefing pediu. */
  telefone: "58%",
  /** 2 inteiros + fração. */
  tablet: "38%",
  /** 3 inteiros + fração. */
  desktop: "26%",
} as const;

/**
 * §9 do estetica.md torna o movimento reduzido OBRIGATÓRIO, e aqui ele tem
 * duas consequências: o Embla anima o arrasto com `duration`, e o botão de
 * seta rola com `scroll-behavior`. Zerar só um deixaria metade do movimento de
 * pé para quem pediu que ele parasse.
 */
function useMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState(false);

  useEffect(() => {
    const consulta = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduzido(consulta.matches);
    const aoMudar = (e: MediaQueryListEvent) => setReduzido(e.matches);
    consulta.addEventListener("change", aoMudar);
    return () => consulta.removeEventListener("change", aoMudar);
  }, []);

  return reduzido;
}

/**
 * A ROLAGEM NATIVA SAI QUANDO O EMBLA ENTRA, e esta é a única decisão deste
 * arquivo que o plano não previu.
 *
 * As duas camadas movem o MESMO trilho por mecanismos diferentes: o navegador
 * empurra o `scrollLeft` da caixa, e o Embla translada o `<ul>` por
 * `transform`. Ligadas ao mesmo tempo elas SOMAM deslocamento — dá para andar
 * o dobro do trilho, sobra vazio na borda direita, e `canScrollNext()` passa a
 * responder sobre uma posição que não é a que está na tela.
 *
 * A troca acontece SÓ depois de o Embla existir, e é isso que mantém intacta a
 * promessa da camada de baixo: no HTML do servidor, com JavaScript desligado ou
 * se o Embla falhar em carregar, o valor continua sendo `auto` e o dedo
 * arrasta. Depois que ele carrega, quem arrasta é ele — inclusive no toque.
 */
const TRILHO_SEM_JS =
  "overflow-x-auto snap-x snap-mandatory scroll-smooth motion-reduce:scroll-auto";
const TRILHO_COM_EMBLA = "overflow-hidden";

export function Carrossel({
  rotulo,
  children,
  className = "",
}: {
  /**
   * O nome da região para leitor de tela — normalmente o título da seção.
   * Obrigatório: uma região sem nome é pior que nenhuma região, porque ela
   * aparece na lista de marcos como "region" e não diz de quê.
   */
  rotulo: string;
  children: ReactNode;
  className?: string;
}) {
  const reduzido = useMovimentoReduzido();
  const [refDoTrilho, embla] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    dragFree: false,
    duration: reduzido ? 0 : 22,
  });

  const [temAnterior, setTemAnterior] = useState(false);
  const [temProximo, setTemProximo] = useState(false);

  const aoSelecionar = useCallback(() => {
    if (!embla) return;
    setTemAnterior(embla.canScrollPrev());
    setTemProximo(embla.canScrollNext());
  }, [embla]);

  useEffect(() => {
    if (!embla) return;
    aoSelecionar();
    embla.on("select", aoSelecionar);
    embla.on("reInit", aoSelecionar);
    return () => {
      embla.off("select", aoSelecionar);
      embla.off("reInit", aoSelecionar);
    };
  }, [embla, aoSelecionar]);

  return (
    <div className={`relative ${className}`}>
      {/*
        `role="region"` com nome: quem navega por marcos acha o trilho e sabe
        de que ele é. O trilho em si é focável por teclado (`tabIndex={0}`)
        porque um container que rola precisa poder receber as setas do teclado
        — sem isso, quem não usa mouse não alcança o que está cortado.
      */}
      <div
        ref={refDoTrilho}
        role="region"
        aria-label={rotulo}
        tabIndex={0}
        className={`${embla ? TRILHO_COM_EMBLA : TRILHO_SEM_JS} [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho`}
      >
        <ul className="flex gap-4 md:gap-6">{children}</ul>
      </div>

      {/*
        AS SETAS SÃO SÓ DE DESKTOP, e a ausência no telefone é a decisão: lá o
        dedo já arrasta, e duas setas de 44px roubariam largura do card que a
        pessoa veio ver. Aparecem só quando há para onde ir — seta desabilitada
        permanente é ruído que ensina a ignorar o controle.
      */}
      {embla ? (
        <div className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden items-center justify-between lg:flex">
          <SetaDoCarrossel
            direcao="anterior"
            visivel={temAnterior}
            aoClicar={() => embla.scrollPrev()}
            rotulo={rotulo}
          />
          <SetaDoCarrossel
            direcao="proximo"
            visivel={temProximo}
            aoClicar={() => embla.scrollNext()}
            rotulo={rotulo}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * 44×44 é o piso do §10, e `pointer-events-auto` reativa o clique dentro do
 * container que o desliga — é ele que deixa o arrasto passar por baixo das
 * setas em vez de morrer nelas.
 */
function SetaDoCarrossel({
  direcao,
  visivel,
  aoClicar,
  rotulo,
}: {
  direcao: "anterior" | "proximo";
  visivel: boolean;
  aoClicar: () => void;
  rotulo: string;
}) {
  if (!visivel) return <span aria-hidden className="h-11 w-11" />;

  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-label={
        direcao === "anterior" ? `${rotulo}: anterior` : `${rotulo}: próximo`
      }
      className="pointer-events-auto flex h-11 w-11 items-center justify-center border border-fuligem-20 bg-cal-puro text-fuligem transition-[border-color,box-shadow,transform] duration-[200ms] ease-canastra hover:-translate-y-0.5 hover:border-vermelho hover:shadow-[3px_3px_0_var(--color-fuligem)] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
    >
      <span aria-hidden className="text-[18px] leading-none">
        {direcao === "anterior" ? "‹" : "›"}
      </span>
    </button>
  );
}

/**
 * Um slide. Existe como componente para que as três larguras vivam num lugar
 * só — três seções repetindo as mesmas classes divergiriam na primeira vez que
 * alguém ajustasse uma delas.
 *
 * AS CLASSES SÃO LITERAIS E TÊM DE SER: o Tailwind varre o código-fonte em
 * tempo de build e só gera o utilitário que encontrar escrito. Uma classe
 * montada em tempo de execução a partir de `LARGURA_DO_SLIDE` produziria um
 * nome que não existe no CSS, e o slide nasceria sem largura nenhuma — sem
 * erro, sem aviso, com o trilho desmontado na tela.
 *
 * Por isso `LARGURA_DO_SLIDE` lá em cima é DOCUMENTAÇÃO, não fonte. O que
 * impede as duas metades de divergirem é o teste ao lado, que renderiza este
 * componente e confere que cada valor da constante aparece no markup.
 */
export function SlideDoCarrossel({ children }: { children: ReactNode }) {
  return (
    <li className="snap-start shrink-0 basis-[58%] sm:basis-[38%] lg:basis-[26%]">
      {children}
    </li>
  );
}
