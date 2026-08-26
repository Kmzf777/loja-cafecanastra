"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Botao } from "@/components/painel/ui/Botao";
import { Campo } from "@/components/painel/ui/Campo";
import { ETIQUETA } from "@/components/painel/ui/estilos";
import { urlDaTela } from "@/lib/painel/clientes/clientes.logica";

/**
 * A caixa de busca — a ÚNICA ilha de cliente desta tela.
 *
 * TUDO O MAIS É SERVIDOR: a tabela, os chips, a paginação e o rodapé de
 * contagem são HTML renderizado com os dados dentro, e os controles de filtro
 * são `<a href>`. Só a busca precisa de JavaScript, e precisa por uma razão
 * concreta: o campo tem estado enquanto se digita, e o que se digita não deve
 * virar navegação a cada tecla.
 *
 * POR QUE NÃO UM `<form method="GET">` PURO, QUE DISPENSARIA A ILHA. Ele
 * funcionaria — e faria um recarregamento COMPLETO da página a cada busca,
 * perdendo a posição de rolagem e o cache de rota do Next. `router.push` navega
 * pelo App Router, que troca só o conteúdo. É a diferença entre uma tela de
 * trabalho e um site de 2005 para quem busca vinte vezes por dia (R1: "um
 * clique extra 200× por dia é imposto diário" — e um recarregamento é pior que
 * um clique).
 *
 * A BUSCA SÓ SAI NO SUBMIT, e não a cada tecla. Um "busca conforme digita" sem
 * debounce dispara uma requisição por letra; com debounce, dispara navegação
 * enquanto a pessoa ainda está formando a palavra, e o histórico do navegador
 * enche de estados intermediários — o botão Voltar passa a andar letra por
 * letra. No painel, onde a busca é por nome inteiro e por CPF colado, o Enter é
 * o gesto certo.
 */
export function BuscaDeClientes({ buscaAtual }: { buscaAtual: string }) {
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
    // A PÁGINA VOLTA PARA 1. Buscar estando na página 4 e continuar na 4 é o
    // jeito mais rápido de uma busca com resultados parecer vazia.
    router.push(urlDaTela({ busca: digitado, pagina: 1 }));
  }

  return (
    /*
      É um `<form>` de verdade, com `role="search"`: o Enter dentro do campo
      submete de graça (comportamento do HTML, não código nosso), e o leitor de
      tela ganha um marco de navegação "busca" para saltar direto até aqui.
    */
    <form
      role="search"
      onSubmit={buscar}
      className="flex flex-wrap items-start gap-3"
    >
      <Campo
        /*
          R1: A BUSCA É SEMPRE VISÍVEL, NUNCA ATRÁS DE UM ÍCONE. É a ação mais
          frequente desta tela — é por ela que se chega ao cliente que está no
          telefone —, e escondê-la atrás de uma lupa que abre um campo cobra um
          clique a cada uso.
        */
        rotulo="Buscar cliente"
        // `type="search"` e não `text`: o navegador oferece o "x" de limpar
        // nativo e o teclado do celular traz a tecla de busca.
        type="search"
        name="q"
        value={digitado}
        onChange={(evento) => setDigitado(evento.target.value)}
        placeholder="Nome, e-mail, telefone ou CPF"
        /*
          A AJUDA DIZ O QUE A BUSCA FAZ COM O CPF, e ela existe porque a
          normalização (em `clientes.logica.ts`) é invisível: quem cola um CPF
          pontuado precisa saber que vai funcionar, senão testa uma vez, não
          acha e nunca mais tenta.
        */
        ajuda="O CPF pode ir com ou sem pontuação."
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
