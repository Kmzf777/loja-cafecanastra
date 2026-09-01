import Link from "next/link";

import { ETIQUETA, FOCO } from "@/components/painel/ui/estilos";
import { FILTROS_DA_FILA, chaveDaFilaValida } from "@/lib/painel/bling/contrato";
import {
  urlDaTela,
  type EstadoDosPedidos,
} from "@/lib/painel/pedidos/pedidos.logica";

/**
 * O id do rótulo é uma CONSTANTE e não um `useId()` porque este é um Server
 * Component: `useId` é hook, e virar ilha de cliente só para gerar um id
 * custaria JavaScript numa tela que não precisa de nenhum. O preço é que o
 * componente só pode aparecer uma vez por página — o que é verdade por desenho:
 * ele é O recorte fiscal desta tela, não um controle reutilizável.
 */
const ID_DO_ROTULO = "recorte-fiscal-dos-pedidos";

/**
 * O RECORTE DE ESTADO FISCAL — os cinco filtros da fila do Bling, na tela.
 *
 * O QUE ELE CONSERTA. `FILTROS_DA_FILA` existe desde a portagem do contrato do
 * Bling, com cinco perguntas e cinco frases de vazio, testadas — e sem NENHUM
 * consumidor. O painel novo oferecia uma delas ("sem NF-e autorizada", pela aba
 * salva); "sem pedido de venda" e "sem rastreio" simplesmente deixaram de
 * existir para o gestor quando a fila do Bling legada saiu do caminho. São
 * exatamente as duas perguntas de quem vai despachar: o que ainda não virou
 * pedido de venda no ERP, e o que saiu sem código de rastreio.
 *
 * SÃO LINKS, COMO AS ABAS — o mesmo motivo do `AbasSalvas`: cada recorte é uma
 * URL de verdade (R2), então dá para favoritar "os sem rastreio", colar no
 * WhatsApp do conferente e voltar com o botão Voltar. E, como lá, NÃO é
 * `role="tablist"`: o padrão ARIA de abas promete troca de conteúdo sem sair da
 * página e navegação por setas, e aqui cada clique NAVEGA.
 *
 * ELE É MAIS QUIETO QUE AS ABAS, DE PROPÓSITO. As abas salvas definem em que
 * FILA o gestor está trabalhando; este é um refinamento dentro dela. O aceso
 * ganha por PESO e por filete — nunca pelo preenchimento preto, que fica
 * reservado à linha de cima. Duas fileiras de botões pretos na mesma tela
 * disputariam a atenção e nenhuma das duas diria onde a pessoa está.
 *
 * A PÁGINA VOLTA PARA 1 a cada troca: o recorte muda quantas linhas sobram, e
 * continuar na página 4 é o jeito mais rápido de um filtro com resultados
 * parecer vazio. Busca, status e período são preservados — o recorte refina o
 * que já estava filtrado, não recomeça.
 */
export function FiltroDaFila({ estado }: { estado: EstadoDosPedidos }) {
  /*
    "QUALQUER ESTADO" NÃO É O FILTRO "TODOS", e os dois precisam existir lado a
    lado porque significam coisas diferentes. Desligado é a lista do servidor
    inteira, com pedido não pago e tudo; "Todos os pedidos pagos" é o recorte da
    fila, que já derruba quem não pagou. Ter só um dos dois esconderia metade do
    trabalho de quem cobra PIX, ou tiraria do gestor a visão da fila completa.

    `chaveDaFilaValida` no meio do caminho não é cerimônia: `FILTROS_DA_FILA` é
    `Object.freeze` de literais, e o TypeScript alarga `chave` para `string` —
    passar por ela é o que estreita para a união que `urlDaTela` aceita, sem um
    `as` que calaria o compilador em vez de convencê-lo.
  */
  const opcoes: { chave: EstadoDosPedidos["fila"]; rotulo: string }[] = [
    { chave: "", rotulo: "Qualquer estado" },
    ...FILTROS_DA_FILA.map((filtro) => ({
      chave: chaveDaFilaValida(filtro.chave),
      rotulo: filtro.rotulo,
    })),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {/*
        `aria-labelledby` e não `aria-label`, pela mesma razão dos grupos do menu
        lateral: o título JÁ ESTÁ na tela, e repeti-lo numa string separada cria
        a segunda cópia que um dia discorda da primeira.
      */}
      <p className={`text-[11px] ${ETIQUETA} text-fuligem-55`} id={ID_DO_ROTULO}>
        Estado no Bling
      </p>
      <nav
        aria-labelledby={ID_DO_ROTULO}
        className="flex flex-wrap items-center gap-1"
      >
        {opcoes.map((opcao) => {
          const acesa = opcao.chave === estado.fila;
          return (
            <Link
              key={opcao.chave || "qualquer"}
              href={urlDaTela({ ...estado, fila: opcao.chave, pagina: 1 })}
              /* `aria-current="page"` é o sinal que o leitor de tela anuncia sem
                 depender do peso da fonte, que quem não enxerga não recebe. */
              aria-current={acesa ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-bt border px-3 text-[13px] transition-colors ${FOCO} ${
                acesa
                  ? "border-fuligem bg-cal font-semibold text-fuligem"
                  : "border-fuligem-20 text-fuligem-55 hover:border-fuligem hover:bg-cal hover:text-fuligem"
              }`}
            >
              {opcao.rotulo}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
