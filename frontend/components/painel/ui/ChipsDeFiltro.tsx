import Link from "next/link";

import type { ChipDeFiltro } from "@/lib/painel/filtros";
import { ETIQUETA, FOCO } from "./estilos";

/**
 * Os filtros ativos, visíveis e removíveis — R3.
 *
 * O PORQUÊ, LITERAL DA PESQUISA: "filtro esquecido é lido como 'sumiu meu
 * pedido'". Um filtro que só existe na barra de endereço é invisível para quem
 * voltou de outra tela, abriu um favorito ou recebeu o link de alguém — e a
 * conclusão de quem vê uma lista curta sem entender por quê nunca é "há um
 * filtro ligado", é "o painel perdeu meus dados". A partir daí ele deixa de
 * confiar na lista inteira.
 *
 * R3 PEDE TRÊS COISAS, E AS TRÊS ESTÃO AQUI: o chip removível, a CONTAGEM de
 * quantos filtros estão ligados, e o "Limpar tudo" — porque tirar cinco filtros
 * um a um é cinco recarregamentos de página para chegar onde um clique chega.
 *
 * SEM FILTRO, NÃO RENDERIZA NADA. Uma barra vazia dizendo "0 filtros" ocupa uma
 * faixa da tela em todas as visitas para informar a ausência de informação — e
 * a densidade do painel (spec §2.5) é feita de não gastar linha com nada.
 *
 * SÃO LINKS, NÃO BOTÕES, pela mesma razão da `<Paginacao>`: remover um filtro é
 * navegar para a lista sem ele. Isso deixa rastro no histórico (o Voltar
 * RECOLOCA o filtro, que é o que se espera de um desfazer) e dispensa
 * JavaScript — o componente não é `"use client"`.
 */
export function ChipsDeFiltro({
  chips,
  hrefLimpar,
  className = "",
}: {
  chips: ChipDeFiltro[];
  /** A lista sem filtro nenhum. */
  hrefLimpar: string;
  className?: string;
}) {
  if (chips.length === 0) return null;

  return (
    <div
      /* `role="group"` com nome: os chips são um conjunto, e um leitor de tela
         que caia no meio deles precisa saber que aqueles links removem filtros
         em vez de navegarem para outra tela. */
      role="group"
      aria-label="Filtros aplicados"
      className={`flex flex-wrap items-center gap-2 ${className}`}
    >
      <p className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>
        {/*
          A CONTAGEM É `data-dado` como todo número do painel (R23), e a palavra
          concorda com ela: "1 filtro" e "2 filtros". Plural errado num painel
          que o gestor lê cem vezes por dia é a diferença entre uma ferramenta e
          um protótipo.
        */}
        <span data-dado>{chips.length}</span>{" "}
        {chips.length === 1 ? "filtro" : "filtros"}
      </p>

      <ul className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <li key={chip.chave}>
            <Link
              href={chip.href}
              /*
                O `aria-label` NOMEIA O QUE SAI, e não diz só "remover". R11/R12
                valem para o destrutivo e a lição é a mesma aqui: um controle
                cujo nome não carrega o objeto obriga quem não vê a tela a
                adivinhar qual dos quatro chips está sob o cursor.
              */
              aria-label={`Remover filtro ${chip.dimensao}: ${chip.valor}`}
              /* `min-h-11` — R22. O chip é pequeno de propósito (densidade),
                 mas o alvo continua nos 44px. */
              className={`inline-flex min-h-11 items-center gap-2 rounded-bt border border-fuligem-20 px-3 text-[13px] transition-colors hover:border-fuligem hover:bg-cal ${FOCO}`}
            >
              <span className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>
                {chip.dimensao}
              </span>
              {/*
                O VALOR NÃO É CAIXA ALTA. A voz da etiqueta nomeia a dimensão;
                o valor é DADO — "maria" digitado em minúscula tem de reaparecer
                em minúscula, senão o gestor não reconhece o que ele mesmo
                escreveu. `truncate` com teto de 24 caracteres porque uma busca
                colada pode ser longa e um chip que cresce sem limite empurra o
                "Limpar tudo" para fora da tela — que é justamente a saída de
                quem se perdeu no filtro.
              */}
              <span className="max-w-[24ch] truncate">{chip.valor}</span>
              <span aria-hidden="true" className="text-fuligem-55">
                ✕
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <Link
        href={hrefLimpar}
        className={`inline-flex min-h-11 items-center text-[13px] underline decoration-1 underline-offset-4 hover:decoration-2 ${FOCO}`}
      >
        Limpar tudo
      </Link>
    </div>
  );
}
