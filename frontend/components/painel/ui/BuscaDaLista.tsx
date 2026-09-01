"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { montarUrl } from "@/lib/painel/filtros";
import { Botao } from "./Botao";
import { Campo } from "./Campo";
import { ETIQUETA } from "./estilos";

/**
 * A caixa de busca de uma lista do painel — R1, e a ÚNICA ilha de cliente das
 * telas de lista.
 *
 * TUDO O MAIS É SERVIDOR: tabela, chips, abas de status e paginação são HTML
 * renderizado com os dados dentro, e todo controle de filtro é um `<a href>`.
 * Só a busca precisa de JavaScript, e precisa por uma razão concreta: o campo
 * tem estado enquanto se digita, e o que se digita não deve virar navegação a
 * cada tecla.
 *
 * POR QUE NÃO UM `<form method="GET">` PURO, QUE DISPENSARIA A ILHA. Ele
 * funcionaria — e faria um recarregamento COMPLETO da página a cada busca,
 * perdendo a posição de rolagem e o cache de rota do Next. `router.push` navega
 * pelo App Router, que troca só o conteúdo. É a diferença entre uma ferramenta
 * de trabalho e um site de 2005 para quem busca vinte vezes por dia (R1: "um
 * clique extra 200× por dia é imposto diário" — e um recarregamento é pior que
 * um clique).
 *
 * A BUSCA SÓ SAI NO SUBMIT, e não a cada tecla. Um "busca conforme digita" sem
 * debounce dispara uma requisição por letra; com debounce, dispara navegação
 * enquanto a pessoa ainda está formando a palavra, e o histórico do navegador
 * enche de estados intermediários — o botão Voltar passa a andar letra por
 * letra. No painel, onde se busca por nome inteiro e por documento colado, o
 * Enter é o gesto certo.
 *
 * ELA É GENÉRICA, E A GENERALIDADE TEM UM LIMITE PRECISO: a ilha monta a URL
 * sozinha, então precisa receber o resto do estado da tela como DADO
 * (`outrosParametros`), nunca como função. Props de Server Component para
 * Client Component atravessam serializadas — um `href: (q) => string` daria o
 * erro mais confuso do App Router ("Functions cannot be passed directly to
 * Client Components"), e o conserto seria justamente este.
 */
export function BuscaDaLista({
  base,
  buscaAtual,
  outrosParametros = {},
  rotulo,
  placeholder,
  ajuda,
}: {
  /** A rota da lista, sem query string. */
  base: string;
  /** O `?q=` que está na URL agora. */
  buscaAtual: string;
  /**
   * O resto do estado que precisa SOBREVIVER à busca — status, aba, o que for.
   *
   * A PÁGINA NÃO ENTRA AQUI, E ISSO É DELIBERADO: buscar estando na página 4 e
   * continuar na 4 é o jeito mais rápido de uma busca com resultados parecer
   * vazia. Quem chama simplesmente não passa `pagina`, e ela volta para 1.
   */
  outrosParametros?: Record<string, string | undefined>;
  rotulo: string;
  placeholder?: string;
  ajuda?: string;
}) {
  const router = useRouter();

  /**
   * O ESTADO LOCAL SE RENDE À URL — o padrão de "ajustar estado quando a prop
   * muda", sem `useEffect` e sem `key`.
   *
   * O caso é o "Limpar tudo" dos chips: ele é um `<a>`, navega para a lista sem
   * `?q=`, e o Server Component re-renderiza com `buscaAtual = ""`. Sem esta
   * reconciliação, o campo continuaria mostrando "maria" com o chip já removido
   * e a tabela já completa — a tela se contradizendo em três lugares. O mesmo
   * vale para o botão Voltar do navegador.
   *
   * NÃO É `useEffect` porque efeito roda DEPOIS da pintura: haveria um quadro
   * com o valor velho. E NÃO É `key` no pai (que remontaria a ilha) porque
   * remontar tira o FOCO do campo logo depois de a pessoa apertar Enter — que é
   * exatamente quando ela quer refinar a busca.
   */
  const [digitado, setDigitado] = useState(buscaAtual);
  const [buscaDaUrl, setBuscaDaUrl] = useState(buscaAtual);
  if (buscaAtual !== buscaDaUrl) {
    setBuscaDaUrl(buscaAtual);
    setDigitado(buscaAtual);
  }

  function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    router.push(
      montarUrl(base, { ...outrosParametros, q: digitado.trim() || undefined }),
    );
  }

  return (
    /*
      É um `<form>` de verdade, com `role="search"`: o Enter dentro do campo
      submete de graça (comportamento do HTML, não código nosso), e o leitor de
      tela ganha um marco de navegação "busca" para saltar direto até aqui.
    */
    <form role="search" onSubmit={buscar} className="flex flex-wrap items-start gap-3">
      <Campo
        /*
          R1: A BUSCA É SEMPRE VISÍVEL, NUNCA ATRÁS DE UM ÍCONE. É a ação mais
          frequente de uma tela de lista — é por ela que se chega a quem está no
          telefone —, e escondê-la atrás de uma lupa que abre um campo cobra um
          clique a cada uso.
        */
        rotulo={rotulo}
        // `type="search"` e não `text`: o navegador oferece o "x" de limpar
        // nativo e o teclado do celular traz a tecla de busca.
        type="search"
        name="q"
        value={digitado}
        onChange={(evento) => setDigitado(evento.target.value)}
        placeholder={placeholder}
        ajuda={ajuda}
        className="min-w-0 flex-1 basis-72"
      />
      {/*
        O BOTÃO EXISTE MESMO COM O ENTER FUNCIONANDO. Nem todo mundo sabe que
        Enter busca — e num campo solto, sem botão, a tela não diz o que fazer
        depois de digitar. `type="submit"` explícito porque o <Botao> desta casa
        tem `type="button"` por padrão, de propósito (ver o comentário dele).

        O ESPAÇADOR ACIMA DELE ESPELHA A ESTRUTURA DO <Campo> — `flex-col
        gap-1.5` com uma linha de rótulo na mesma tipografia. É o que faz o
        botão nascer alinhado com o INPUT, e não com o rótulo nem com a linha de
        ajuda embaixo. A alternativa seria um `mt-[26px]` medido a olho, que
        quebra no dia em que a fonte da interface mudar de métrica — e quebra em
        silêncio, porque ninguém revisa alinhamento de um pixel.
      */}
      <div className="flex flex-col gap-1.5">
        <span aria-hidden="true" className={`text-[11px] ${ETIQUETA} invisible`}>
          Buscar
        </span>
        <Botao type="submit" variante="secundaria">
          Buscar
        </Botao>
      </div>
    </form>
  );
}
