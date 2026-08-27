"use client";

import * as Radix from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { ETIQUETA, FOCO } from "./estilos";

/**
 * O diálogo de CONFIRMAÇÃO do painel — e a fronteira exata do que ele serve.
 *
 * R26 manda que o DETALHE de um registro abra em painel lateral NÃO-MODAL, com
 * próximo e anterior: um modal cobre os dados de referência que a pessoa
 * precisa consultar justamente enquanto decide. Este componente é o outro caso
 * — a pergunta curta que precisa de uma resposta antes de qualquer outra coisa
 * acontecer: "vai mudar 23 pedidos, e cada um envia e-mail", "o arquivo leva
 * CPF de todo mundo", "qual é o código de rastreio?".
 *
 * Aí o modal é a forma certa, e por um motivo de acessibilidade e não de
 * estética: a decisão é bloqueante de verdade, então o foco DEVE ficar preso,
 * o Escape DEVE cancelar e o resto da página DEVE sair da ordem de leitura do
 * leitor de tela. Escrever isso à mão é o que o `ModalOverlay` de `Orders.jsx`
 * fazia — com um `useRef` para o `onClose` e um efeito que devolvia o foco ao
 * gatilho, tudo comentado porque tinha sido difícil de acertar.
 *
 * O RADIX FAZ AS QUATRO COISAS, e é por isso que ele está aqui em vez de mais
 * cem linhas de efeito: prisão de foco, devolução do foco a quem abriu,
 * `Escape`, `aria-modal` e `aria-labelledby` ligados sozinhos. O que o painel
 * põe por cima é só a pele — filete de 1px, canto reto, zero sombra.
 *
 * NÃO É O `Dialog` DO SHADCN. A proibição da spec §2.7 é sobre os COMPONENTES
 * prontos do shadcn (`components/ui/dialog`), que trazem junto o raio, a sombra
 * e a paleta neutra de outro sistema. O Radix é a biblioteca de primitivas SEM
 * estilo sobre a qual o shadcn é construído — é dependência declarada deste
 * projeto desde a Onda 1, e usá-la é o oposto de colar tema alheio.
 */
export function Dialogo({
  aberto,
  aoMudar,
  titulo,
  descricao,
  children,
  acoes,
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  titulo: string;
  /** A frase que carrega a CONSEQUÊNCIA — R12. "Tem certeza?" não informa
   *  nada e treina a clicar em OK. */
  descricao?: ReactNode;
  children?: ReactNode;
  /** Os botões do rodapé. Quem chama os monta porque é quem sabe qual é a
   *  ação primária e se ela é destrutiva. */
  acoes: ReactNode;
}) {
  return (
    <Radix.Root open={aberto} onOpenChange={aoMudar}>
      {/* O PORTAL SÓ EXISTE COM O DIÁLOGO ABERTO. O Radix já esconde o conteúdo
          fechado, mas a árvore de `Presence` continua montada — e ela usa
          `useLayoutEffect`, que num render de servidor (o `renderToStaticMarkup`
          dos testes, e a renderização das rotas do painel) avisa em cada
          montagem que "useLayoutEffect does nothing on the server". Um aviso
          repetido em toda tela é como se para de ler avisos. */}
      {aberto && (
      <Radix.Portal>
        {/* Fuligem a 40%: o fundo escurece o bastante para dizer "isto está
            suspenso" sem apagar o que está por baixo — a pessoa ainda lê o
            pedido que está confirmando. Sem `backdrop-blur`, que borraria
            justamente esse texto. */}
        <Radix.Overlay className="fixed inset-0 z-40 bg-fuligem/40" />
        <Radix.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(32rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-cx border border-fuligem-20 bg-cal-puro p-5 ${FOCO}`}
        >
          <Radix.Title className={`text-xs ${ETIQUETA} text-fuligem`}>
            {titulo}
          </Radix.Title>

          {descricao ? (
            <Radix.Description className="mt-3 max-w-[60ch] text-[13px] text-fuligem-55">
              {descricao}
            </Radix.Description>
          ) : (
            /* O Radix avisa no console quando falta descrição. Dizer
               explicitamente que não há é melhor do que o aviso — e força
               quem escrever um diálogo sem consequência a notar a ausência. */
            <Radix.Description className="sr-only">
              {titulo}
            </Radix.Description>
          )}

          {children && <div className="mt-4">{children}</div>}

          {/*
            AS AÇÕES FICAM À DIREITA E A PRIMÁRIA POR ÚLTIMO — a ordem de leitura
            do português é a mesma da varredura visual, e o último elemento antes
            da borda é onde o polegar chega primeiro no celular.

            R11 ("destrutivo longe da confirmação") é responsabilidade de quem
            monta `acoes`: o botão que confirma o estrago vem com a variante
            destrutiva e o "Cancelar" fica entre ele e o resto da tela.
          */}
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            {acoes}
          </div>
        </Radix.Content>
      </Radix.Portal>
      )}
    </Radix.Root>
  );
}
