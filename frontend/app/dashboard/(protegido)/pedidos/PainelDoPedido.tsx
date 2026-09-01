"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { urlDoPedido, type PedidoDoPainel } from "@/lib/painel/pedidos/pedidos.logica";

import { DetalheDoPedido } from "./DetalheDoPedido";

/**
 * O PAINEL LATERAL DO R26 — não-modal, com próximo e anterior.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ELE É O MAIOR GANHO OPERACIONAL DESTA TELA.
 *
 * Triar quarenta pedidos com um modal é: abrir, ler, fechar, abrir o seguinte,
 * ler, fechar — dois cliques por pedido só para trocar de pedido. Com o painel
 * lateral são doze cliques no total: um para entrar na fila e um por pedido no
 * "próximo". É literalmente a diferença que a pesquisa mede.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * E POR QUE ELE NÃO É MODAL.
 *
 * "modal cobre os dados de referência que a pessoa precisa consultar". Ao
 * decidir se despacha o pedido de alguém, o gestor olha os OUTROS pedidos da
 * mesma pessoa na lista, o total do dia, o pedido de cima que já saiu. Um modal
 * apaga tudo isso e obriga a fechar, olhar e reabrir.
 *
 * Não ser modal tem consequências técnicas, e as três estão implementadas
 * abaixo pelo lado certo:
 *
 *  - SEM prisão de foco e SEM `aria-modal`. O Tab sai do painel e volta para a
 *    tabela, que continua operável. Um `aria-modal="true"` aqui MENTIRIA para o
 *    leitor de tela, dizendo que o resto da página saiu da árvore quando ele
 *    continua ali — e é uma mentira que quem não vê a tela não tem como
 *    conferir.
 *  - SEM fundo escurecido. Escurecer é a gramática do modal; aqui a separação é
 *    o filete de 1px e o papel mais claro, como em toda superfície do painel.
 *  - O FOCO ENTRA no painel quando ele abre (senão o teclado continuaria na
 *    tabela, e o conteúdo novo estaria fora de alcance) e VOLTA ao gatilho
 *    quando ele fecha — isso é responsabilidade de quem abriu, e está em
 *    `ListaDePedidos`.
 *
 * `role="complementary"` e não `dialog`: é uma região da página, ao lado da
 * lista. O nome acessível carrega o número do pedido, para quem saltar entre
 * marcos saber em qual pedido caiu.
 */
export function PainelDoPedido({
  pedido,
  blingLigado,
  posicao,
  quantos,
  temAnterior,
  temProximo,
  aoAnterior,
  aoProximo,
  aoFechar,
  aoAtualizarPedido,
}: {
  pedido: PedidoDoPainel;
  blingLigado: boolean | null;
  posicao: number;
  quantos: number;
  temAnterior: boolean;
  temProximo: boolean;
  aoAnterior: () => void;
  aoProximo: () => void;
  aoFechar: () => void;
  aoAtualizarPedido: (orderId: string, parcial: PedidoDoPainel) => void;
}) {
  const caixa = useRef<HTMLElement | null>(null);

  /**
   * O `Escape` FECHA, e o `onFechar` vive num ref pelo mesmo motivo que o
   * `ModalOverlay` do painel legado já documentava: com a função na lista de
   * dependências, cada re-render do pai (que passa arrow function nova)
   * removeria e recolocaria o listener — e, num efeito com limpeza, isso
   * significa desmontar e remontar o comportamento a cada tecla digitada em
   * qualquer campo do painel.
   */
  const fecharRef = useRef(aoFechar);
  fecharRef.current = aoFechar;

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") fecharRef.current();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, []);

  /**
   * O FOCO ENTRA UMA VEZ, na abertura — e não a cada "próximo".
   *
   * A lista de dependências é vazia de propósito: o componente continua montado
   * quando o gestor anda pela fila, e roubar o foco a cada troca faria o botão
   * "Próximo" perder o foco logo depois de ser clicado, quebrando a navegação
   * por teclado justamente no gesto que este painel existe para acelerar.
   */
  useEffect(() => {
    caixa.current?.focus();
  }, []);

  return (
    <aside
      ref={caixa}
      tabIndex={-1}
      role="complementary"
      aria-label={`Detalhe do pedido, ${posicao} de ${quantos}`}
      /*
        DUAS FORMAS, UMA SÓ NATUREZA.

        Abaixo de `xl` não há largura para dividir, então ele é uma folha
        ancorada à direita — ainda SEM fundo escurecido e SEM prender o foco,
        porque continua não sendo modal: a tabela por baixo segue operável.

        De `xl` para cima ele DIVIDE a linha com a tabela e gruda na viewport,
        para o "próximo" continuar ao alcance depois de rolar cem linhas. O
        `top-36` são 144px, que é a altura do <Cabecalho> sticky (a faixa da
        conta, 44px, mais o bloco de título com `py-4`): sem esse recuo o painel
        pararia ATRÁS do cabeçalho, que tem `z-20`, e a própria barra de
        navegação dele ficaria escondida. Um recuo a mais só abre uma folga; um
        a menos esconde o controle mais usado da tela.
      */
      className={`
        fixed inset-y-0 right-0 z-30 w-[min(28rem,100vw)] overflow-y-auto
        border-l border-fuligem-20 bg-cal-puro
        xl:sticky xl:inset-auto xl:top-36 xl:z-0 xl:max-h-[calc(100vh-10rem)]
        xl:w-[26rem] xl:shrink-0 xl:rounded-cx xl:border
        ${FOCO}
      `}
    >
      {/* A BARRA DE NAVEGAÇÃO GRUDA NO TOPO do painel: numa ficha de pedido
          longa (endereço, Bling, quinze itens), o "próximo" tem de estar sempre
          ao alcance — senão a triagem volta a exigir uma rolagem por pedido. */}
      <div className="sticky top-0 z-10 flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-fuligem-20 bg-cal-puro px-5 py-2">
        <p className={`text-[10px] ${ETIQUETA} text-fuligem-55`}>
          <span data-dado>{posicao}</span> de <span data-dado>{quantos}</span> nesta
          página
        </p>

        <div className="flex items-center gap-1">
          <PassoDaFila
            rotulo="Pedido anterior"
            seta="↑"
            habilitado={temAnterior}
            aoClicar={aoAnterior}
          />
          <PassoDaFila
            rotulo="Próximo pedido"
            seta="↓"
            habilitado={temProximo}
            aoClicar={aoProximo}
          />
          <button
            type="button"
            onClick={aoFechar}
            aria-label="Fechar o detalhe"
            className={`inline-flex min-h-11 min-w-11 items-center justify-center text-fuligem-55 transition-colors hover:text-fuligem ${FOCO}`}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      </div>

      <DetalheDoPedido
        // A `key` remonta o corpo ao trocar de pedido, e isso é o que impede o
        // defeito mais silencioso desta tela: o `<select>` de status guarda
        // estado local, e sem a remontagem o valor escolhido para o pedido A
        // apareceria selecionado ao chegar no pedido B.
        key={pedido.order_id}
        pedido={pedido}
        blingLigado={blingLigado}
        aoAtualizarPedido={aoAtualizarPedido}
      />

      <div className="border-t border-fuligem-20 px-5 py-4">
        {/* A ROTA PRÓPRIA CONTINUA EXISTINDO, e o link para ela fica aqui: é o
            endereço que se cola num chamado ou se manda para o contador. O
            painel lateral é o caminho de TRIAGEM; o deep-link é o caminho de
            REFERÊNCIA, e os dois convivem sobre o mesmo detalhe. */}
        <Link
          href={urlDoPedido(pedido.order_id)}
          className={`inline-flex min-h-11 items-center text-[13px] underline decoration-1 underline-offset-4 hover:decoration-2 ${FOCO}`}
        >
          Abrir este pedido em página própria
        </Link>
      </div>
    </aside>
  );
}

function PassoDaFila({
  rotulo,
  seta,
  habilitado,
  aoClicar,
}: {
  rotulo: string;
  seta: string;
  habilitado: boolean;
  aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      disabled={!habilitado}
      // O nome acessível é a FRASE ("Próximo pedido"), não a seta: "seta para
      // baixo" não diz para onde se vai.
      aria-label={rotulo}
      title={rotulo}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-bt border border-fuligem-20 transition-colors hover:border-fuligem hover:bg-cal disabled:cursor-not-allowed disabled:opacity-40 ${FOCO}`}
    >
      <span aria-hidden="true">{seta}</span>
    </button>
  );
}
