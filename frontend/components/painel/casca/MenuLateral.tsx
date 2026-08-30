"use client";

import { useId, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Serra } from "@/components/marca/Serra";
import { ETIQUETA, FOCO_CLARO } from "../ui/estilos";
import { LEGADO, MENU, itemAtivo, legadoAtivo } from "./menu.logica";

/**
 * O menu lateral — a âncora escura do painel.
 *
 * É `"use client"` por UM motivo só: `usePathname`. Nada mais aqui tem estado,
 * evento ou efeito. A decisão de qual item está aceso NÃO mora neste arquivo —
 * ela é `itemAtivo`, em `menu.logica.ts`, sem React e testada como função. Aqui
 * só se desenha o que ela devolveu (spec §2.8).
 *
 * FUNDO FULIGEM, E ISSO É A TESE DO PRODUTO. O §2.5 da spec: "o menu lateral é
 * a âncora escura; é a verdade do produto". O resto do painel é cal — a barra
 * escura é o que diz, sem uma palavra, onde termina a navegação e começa o
 * trabalho. É também a única superfície escura do sistema, e por isso a única
 * que precisa do anel de foco invertido (`FOCO_CLARO`).
 *
 * RÓTULO SEMPRE JUNTO DO ÍCONE — R20, e são três razões somadas: ícone sozinho
 * não é compreendido sem tooltip (que não existe no toque), tem alvo menor pela
 * lei de Fitts, e não ENSINA o vocabulário do sistema a quem está aprendendo.
 * Um painel de loja é operado por gente que entra nele uma vez por semana.
 *
 * OS PICTOGRAMAS SÃO DESENHADOS À MÃO, e não vêm da `lucide-react` que já está
 * no `package.json`. É a mesma decisão de `app/[locale]/(vitrine)/bio/page.tsx`
 * ("sem biblioteca de ícone: as duas setas são SVG de traço fino, como os
 * pictogramas do §5.5"): o traço de 1,5px em geometria reta é da casa, e um
 * conjunto de ícones de biblioteca traz junto o arredondado genérico que o
 * `estetica.md` §2 rejeita nominalmente como "o default de IA".
 */

/** O traço dos pictogramas: 1,5px, reto, `currentColor` — §5.5. */
function Pictograma({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/**
 * O desenho de cada item, indexado pelo href.
 *
 * INDEXADO PELO HREF, e não guardado dentro do `MENU`, porque `menu.logica.ts`
 * é dado e não desenho — pôr JSX lá dentro obrigaria o módulo puro a importar
 * React e o tiraria do ambiente `node` em que ele é testado. O preço é uma
 * estrutura paralela que pode divergir, e por isso existe um teste que exige um
 * pictograma para CADA item do menu: quem acrescentar uma área e esquecer o
 * desenho vê vermelho, não um buraco na barra.
 */
const PICTOGRAMAS: Record<string, ReactNode> = {
  // Início — os quatro blocos de um painel.
  "/dashboard": (
    <>
      <path d="M2.5 2.5h4.5v4.5H2.5z" />
      <path d="M9 2.5h4.5v4.5H9z" />
      <path d="M2.5 9h4.5v4.5H2.5z" />
      <path d="M9 9h4.5v4.5H9z" />
    </>
  ),
  // Pedidos — a caixa fechada, vista de canto.
  "/dashboard/pedidos": (
    <>
      <path d="M8 1.8 14 5v6l-6 3.2L2 11V5z" />
      <path d="M2 5l6 3.2L14 5" />
      <path d="M8 8.2v6" />
    </>
  ),
  // Assinaturas — o ciclo que se repete.
  "/dashboard/assinaturas": (
    <>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.9-4.2" />
      <path d="M13.6 1.6v3h-3" />
    </>
  ),
  // Descontos — a etiqueta pendurada.
  "/dashboard/descontos": (
    <>
      <path d="M8.6 1.6H14.4v5.8L7.5 14.3 1.7 8.5z" />
      <circle cx="11.3" cy="4.4" r="1" />
    </>
  ),
  // Produtos — o pacote de café, com o vinco do topo.
  "/dashboard/produtos": (
    <>
      <path d="M3.5 5.2h9v9.3h-9z" />
      <path d="M3.5 5.2 5 1.5h6l1.5 3.7" />
      <path d="M6.5 8.4h3" />
    </>
  ),
  // Avaliações — a estrela, que é literalmente o que se modera.
  "/dashboard/avaliacoes": (
    <path d="M8 1.9l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.7l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
  ),
  // Marketing — o alcance que sai do ponto.
  "/dashboard/marketing": (
    <>
      <path d="M2 6.2h3l6-3.4v10.4l-6-3.4H2z" />
      <path d="M12.8 5.4a3.6 3.6 0 0 1 0 5.2" />
    </>
  ),
  // Vitrine — a loja vista da rua, com o toldo.
  "/dashboard/vitrine": (
    <>
      <path d="M2.4 6.2h11.2v8.1H2.4z" />
      <path d="M1.4 6.2 3 1.7h10l1.6 4.5" />
      <path d="M6.4 14.3V9.6h3.2v4.7" />
    </>
  ),
  // Relatórios — a barra ordenada, o único gráfico que o R30 deixa de pé.
  "/dashboard/relatorios": (
    <>
      <path d="M1.8 14.2h12.4" />
      <path d="M4.4 14.2V8" />
      <path d="M8 14.2V3.4" />
      <path d="M11.6 14.2V10" />
    </>
  ),
  // Clientes — duas pessoas, porque cliente no plural é o que a tela lista.
  "/dashboard/clientes": (
    <>
      <path d="M6 2.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8z" />
      <path d="M1.6 14.2a4.4 4.4 0 0 1 8.8 0" />
      <path d="M11 3.3a2.4 2.4 0 0 1 0 4.4" />
      <path d="M12.2 9.9a4.4 4.4 0 0 1 2.2 4.3" />
    </>
  ),
  // Administradores — a chave da loja, deitada. NÃO são duas pessoas (é o
  // desenho de Clientes) nem uma engrenagem: o que distingue esta área não é
  // quem são, é o que elas têm na mão.
  "/dashboard/administradores": (
    <>
      <circle cx="4.2" cy="8" r="2.4" />
      <path d="M6.6 8h7.6" />
      <path d="M11.4 8v2.4" />
      <path d="M13.6 8v2.4" />
    </>
  ),
  // Ajustes — os cursores de régua, não a engrenagem de todo mundo.
  "/dashboard/ajustes": (
    <>
      <path d="M1.8 5h12.4" />
      <path d="M1.8 11h12.4" />
      <path d="M4.4 3.4v3.2" />
      <path d="M10.4 9.4v3.2" />
    </>
  ),
  // Painel antigo — a caixa de arquivo morto.
  [LEGADO.href]: (
    <>
      <path d="M1.8 2.6h12.4v3.2H1.8z" />
      <path d="M3.2 5.8v7.6h9.6V5.8" />
      <path d="M6.4 8.8h3.2" />
    </>
  ),
};

/**
 * A caixa do item, IGUAL nos dois estados — a cor mora só nas variantes.
 *
 * Nem `text-*` nem `border-*` aparecem aqui de propósito. Uma cor na base e
 * outra na variante são duas declarações da MESMA propriedade, e quem desempata
 * é a ordem em que o Tailwind emitiu as classes na folha, não a ordem em que
 * elas aparecem no `class` — o override funciona num caso e falha em outro, sem
 * erro nenhum. Cada estado abaixo escreve as suas cores por inteiro.
 *
 * `min-h-11` são os 44px do R22: "comprima o padding da célula, NUNCA o alvo de
 * toque". A densidade do painel sai da tabela, não da navegação.
 *
 * `border-l-2` existe nos DOIS estados — transparente quando inativo — para que
 * acender um item não empurre o texto 2px para a direita. Deslocamento no
 * hover/foco é o tipo de tremor que ninguém sabe nomear e todo mundo sente.
 */
const ITEM =
  "flex min-h-11 items-center gap-3 rounded-cx border-l-2 px-4 text-[13px] " +
  `leading-tight transition-colors duration-150 ${FOCO_CLARO}`;

/**
 * O aceso: filete de CAL, fundo um passo mais claro e peso maior.
 *
 * Três sinais somados, e nenhum deles é só a cor — WCAG 1.4.1. O filete é cal
 * e não juta porque a juta aparece uma vez só nesta barra, na serra: o
 * `estetica.md` §3 dá à "mão" ~20% da tela e o painel é etiqueta pura, então a
 * cor de território fica reservada à marca e a navegação inteira se resolve em
 * cal sobre fuligem.
 */
const ITEM_ACESO = "border-cal bg-fuligem-80 font-semibold text-cal";

/** O apagado escreve em `fuligem-20` — 11,3:1 sobre o fuligem, que é tinta
 *  legível e não "texto desbotado". No hover ele sobe para cal (16,5:1). */
const ITEM_APAGADO =
  "border-transparent text-fuligem-20 hover:bg-fuligem-80 hover:text-cal";

function ItemDoMenu({
  href,
  rotulo,
  aceso,
}: {
  href: string;
  rotulo: string;
  aceso: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        /**
         * `aria-current="page"` e não `aria-selected` nem uma classe só: é o
         * único sinal que o leitor de tela anuncia ("página atual") sem que
         * nada precise ser inventado. Exatamente UM por vez — é o que o teste
         * verifica, porque dois "página atual" na mesma tela é pior que nenhum.
         */
        aria-current={aceso ? "page" : undefined}
        className={`${ITEM} ${aceso ? ITEM_ACESO : ITEM_APAGADO}`}
      >
        <Pictograma>{PICTOGRAMAS[href]}</Pictograma>
        <span>{rotulo}</span>
      </Link>
    </li>
  );
}

export function MenuLateral() {
  const caminho = usePathname() ?? "/dashboard";
  const aceso = itemAtivo(caminho);
  const noLegado = legadoAtivo(caminho);
  const idBase = useId();

  return (
    <nav
      aria-label="Seções do painel"
      /**
       * `md:sticky md:h-screen`: no desktop a barra fica parada enquanto a
       * tabela rola — navegação que some quando se desce a lista obriga a
       * subir de volta para trocar de tela.
       *
       * NO TELEFONE ELA VIRA UMA FAIXA NO TOPO, e os itens embrulham em linha
       * (`flex-wrap`) em vez de empilhar: treze itens empilhados seriam treze
       * telas de rolagem antes do conteúdo. O painel é ferramenta de mesa —
       * isto é degradação honesta, não é a versão móvel que o produto merece.
       */
      className="flex w-full shrink-0 flex-col bg-fuligem text-cal md:sticky md:top-0 md:h-screen md:w-60 md:self-start md:overflow-y-auto"
    >
      {/*
        A MARCA — uma das TRÊS aparições da "mão" no painel inteiro (spec §2.5:
        login, menu lateral e estado vazio; em nenhum outro lugar). A serra vem
        em `currentColor`, e o `text-juta` a pinta com o kraft do §3 — a única
        cor de território desta barra. Achatada em 16px de altura ela é o
        "divisor de pincelada" do §4.4, que ali é especificado entre 12 e 20px.
      */}
      <div className="border-b border-fuligem-80 px-4 pb-4 pt-5">
        <p className={`text-[13px] ${ETIQUETA} text-cal`}>Café Canastra</p>
        <p className={`mt-1 text-[10px] ${ETIQUETA} text-fuligem-20`}>
          Painel de gestão
        </p>
        <Serra className="mt-3 h-4 w-full text-juta" strokeWidth={1} />
      </div>

      <div className="flex-1 py-2">
        {MENU.map((grupo, indice) => {
          const idDoTitulo = `${idBase}-grupo-${indice}`;
          return (
            <div
              key={grupo.titulo ?? "raiz"}
              /* O filete entre grupos é `fuligem-80` — um passo acima do fundo,
                 o suficiente para separar e não o bastante para virar uma
                 grade. Ele só existe a partir do segundo grupo: uma linha antes
                 do primeiro item duplicaria o filete da marca logo acima. */
              className={indice > 0 ? "mt-2 border-t border-fuligem-80 pt-3" : ""}
            >
              {grupo.titulo && (
                <h2
                  id={idDoTitulo}
                  className={`px-4 pb-1 text-[10px] ${ETIQUETA} text-fuligem-20`}
                >
                  {grupo.titulo}
                </h2>
              )}
              <ul
                /* `aria-labelledby` e não `aria-label`: o título já está na
                   tela, e repeti-lo numa string separada é a segunda cópia que
                   um dia discorda da primeira. */
                {...(grupo.titulo ? { "aria-labelledby": idDoTitulo } : {})}
                className="flex flex-wrap gap-x-1 md:block"
              >
                {grupo.itens.map((item) => (
                  <ItemDoMenu
                    key={item.href}
                    href={item.href}
                    rotulo={item.rotulo}
                    aceso={aceso === item.href}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/*
        A SAÍDA DE EMERGÊNCIA, e ela é temporária por desenho.

        Nesta onda as telas novas ainda não existem: sem este link, o gestor
        abre o painel e não tem como chegar ao único lugar onde ele consegue
        despachar um pedido. Fica separado por um filete e no rodapé porque não
        é uma área do produto — é o andaime. A Onda 6 apaga `frontend/legacy/`
        e leva este bloco junto.
      */}
      <div className="border-t border-fuligem-80 py-2">
        <ul className="md:block">
          <ItemDoMenu href={LEGADO.href} rotulo={LEGADO.rotulo} aceso={noLegado} />
        </ul>
      </div>
    </nav>
  );
}
