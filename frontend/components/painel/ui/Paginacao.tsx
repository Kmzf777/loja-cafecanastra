import Link from "next/link";

import {
  SALTO,
  intervaloDaPagina,
  reguaDePaginas,
  type ItemDaRegua,
} from "@/lib/painel/paginacao";
import { ETIQUETA, FOCO } from "./estilos";

/**
 * A paginação do painel — R17: "paginação, nunca scroll infinito".
 *
 * O PORQUÊ, DA PESQUISA: painel é TAREFA, não descoberta. Scroll infinito serve
 * a quem folheia sem destino; quem trabalha precisa poder dizer "estava na
 * página 3", voltar a ela depois do detalhe, mandá-la por mensagem e imprimir a
 * mesma lista amanhã. Nada disso existe sem uma página numerada.
 *
 * SÃO LINKS, E NÃO BOTÕES — e é isso que faz R2 sair de graça.
 *
 * Cada página é um `<a href>` de verdade, para uma URL que já carrega busca,
 * filtro e número. Consequências que um `onClick` com estado local não tem:
 * o botão direito abre em outra aba; o Voltar do navegador volta uma página da
 * LISTA; o F5 devolve a mesma tela; e um leitor de tela anuncia "link", que é o
 * que de fato acontece. Um `<button onClick>` daria um controle que promete
 * navegação e não deixa rastro nenhum.
 *
 * NÃO É `"use client"`: sem estado, sem evento, sem hook. Ela renderiza no
 * servidor junto com a tabela, e a página inteira continua sendo HTML antes de
 * qualquer JavaScript — que é o padrão da spec §2.3.
 *
 * A TABELA NÃO SABE PAGINAR e a paginação não sabe buscar: quem monta o `href`
 * é a tela, porque só ela conhece os outros parâmetros que precisam sobreviver
 * à troca de página. Uma paginação que montasse a URL sozinha apagaria o filtro
 * ao virar a página — que é o defeito que o R3 chama de "filtro esquecido lido
 * como sumiu meu pedido", pelo avesso.
 */
export function Paginacao({
  pagina,
  totalPaginas,
  porPagina,
  total,
  href,
  rotuloDoItem,
  className = "",
}: {
  pagina: number;
  totalPaginas: number;
  porPagina: number;
  total: number;
  /** A URL de uma página, com todo o resto do estado já dentro. */
  href: (pagina: number) => string;
  /** "cliente", "assinatura" — entra no "1–20 de 134 clientes" e no aria-label. */
  rotuloDoItem: { singular: string; plural: string };
  className?: string;
}) {
  const { inicio, fim } = intervaloDaPagina(pagina, porPagina, total);
  const regua = reguaDePaginas(pagina, totalPaginas);
  const nome = total === 1 ? rotuloDoItem.singular : rotuloDoItem.plural;

  return (
    <nav
      /* `aria-label` porque a tela pode ter mais de uma região de navegação (o
         menu lateral é outra), e "navegação" repetido não distingue nada. */
      aria-label={`Páginas de ${rotuloDoItem.plural}`}
      className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-fuligem-20 px-5 py-3 ${className}`}
    >
      {/*
        A CONTAGEM VEM PRIMEIRO, e não é enfeite: sem ela o gestor não tem como
        saber se o filtro pegou tudo, e a única forma de descobrir o tamanho da
        fila seria clicar até o fim. Os números vão em `data-dado` — R23, para
        comparar por posição entre uma visita e outra.
      */}
      <p className="text-[13px] text-fuligem-55">
        {total > 0 ? (
          <>
            <span data-dado>
              {inicio}–{fim}
            </span>{" "}
            de <span data-dado>{total}</span> {nome}
          </>
        ) : (
          <>Nenhum resultado</>
        )}
      </p>

      {/*
        UMA PÁGINA SÓ NÃO GANHA RÉGUA. Desenhar "‹ 1 ›" com as duas setas
        desativadas é oferecer três controles que não fazem nada — e um controle
        inerte ensina que os controles desta tela podem ser inertes.
      */}
      {totalPaginas > 1 && (
        <ul className="flex flex-wrap items-center gap-1">
          <li>
            <Passo
              href={href(pagina - 1)}
              habilitado={pagina > 1}
              rotulo="Anterior"
              seta="‹"
              ladoDaSeta="antes"
            />
          </li>

          {regua.map((item, indice) => (
            <li key={item === SALTO ? `${SALTO}-${indice}` : item}>
              <Numero item={item} atual={pagina} href={href} />
            </li>
          ))}

          <li>
            <Passo
              href={href(pagina + 1)}
              habilitado={pagina < totalPaginas}
              rotulo="Próxima"
              seta="›"
              ladoDaSeta="depois"
            />
          </li>
        </ul>
      )}
    </nav>
  );
}

/**
 * A caixa de um destino da régua.
 *
 * `min-h-11 min-w-11` são os 44px do R22 — "comprima o padding da célula, nunca
 * o alvo de toque". A densidade do painel sai da linha da tabela; o número da
 * página é um alvo que o dedo tem de acertar de primeira, e errá-lo custa uma
 * navegação inteira.
 */
const CAIXA_DA_PAGINA =
  `inline-flex min-h-11 min-w-11 items-center justify-center rounded-bt px-2 text-[13px] ${FOCO}`;

function Numero({
  item,
  atual,
  href,
}: {
  item: ItemDaRegua;
  atual: number;
  href: (pagina: number) => string;
}) {
  if (item === SALTO) {
    return (
      /*
        O salto NÃO é link e NÃO é botão: ele não leva a lugar nenhum, é a marca
        de que há páginas entre uma e outra. `aria-hidden` porque "reticências"
        anunciado no meio de uma lista de páginas é ruído — a informação real
        (quantas páginas existem) já está no "1–20 de 134" ao lado.
      */
      <span
        aria-hidden="true"
        className="inline-flex min-h-11 items-center justify-center px-1 text-fuligem-55"
      >
        …
      </span>
    );
  }

  if (item === atual) {
    return (
      /*
        A PÁGINA ATUAL NÃO É UM LINK PARA ELA MESMA. Um link que não sai do
        lugar é o controle mais frustrante que existe, e `aria-current="page"` é
        exatamente o que o leitor de tela usa para dizer "você está aqui" — sem
        depender do fundo preto, que quem não enxerga não recebe.

        O fundo é fuligem sólido, o mesmo peso do botão primário: numa régua de
        números iguais, o "onde estou" precisa ganhar por PESO e não por matiz,
        que é a mesma decisão do <Botao> (spec §2.5 — cor escassa).
      */
      <span
        aria-current="page"
        data-dado
        className={`${CAIXA_DA_PAGINA} bg-fuligem font-medium text-cal`}
      >
        {item}
      </span>
    );
  }

  return (
    <Link
      href={href(item)}
      data-dado
      className={`${CAIXA_DA_PAGINA} border border-fuligem-20 transition-colors hover:border-fuligem hover:bg-cal`}
    >
      {item}
    </Link>
  );
}

/**
 * "Anterior" e "Próxima".
 *
 * NO LIMITE ELES SOMEM DA ÁRVORE DE FOCO, e não viram um `<a>` cinza. Um link
 * desativado por CSS continua sendo tabulável e continua navegando — desativar
 * pela aparência é a forma mais comum de fazer a tela mentir para o teclado.
 * Como `<span aria-hidden>`, ele guarda o espaço na régua (para os números não
 * dançarem de posição na primeira e na última página) e desaparece para quem
 * navega sem olhar.
 */
function Passo({
  href,
  habilitado,
  rotulo,
  seta,
  ladoDaSeta,
}: {
  href: string;
  habilitado: boolean;
  rotulo: string;
  seta: string;
  ladoDaSeta: "antes" | "depois";
}) {
  const conteudo = (
    <>
      {ladoDaSeta === "antes" && <span aria-hidden="true">{seta}</span>}
      <span className={`text-[11px] ${ETIQUETA}`}>{rotulo}</span>
      {ladoDaSeta === "depois" && <span aria-hidden="true">{seta}</span>}
    </>
  );

  if (!habilitado) {
    return (
      <span
        aria-hidden="true"
        className={`${CAIXA_DA_PAGINA} gap-1.5 text-fuligem-20`}
      >
        {conteudo}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={`${CAIXA_DA_PAGINA} gap-1.5 border border-fuligem-20 transition-colors hover:border-fuligem hover:bg-cal`}
    >
      {conteudo}
    </Link>
  );
}
