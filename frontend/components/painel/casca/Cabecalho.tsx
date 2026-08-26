import type { ReactNode } from "react";
import { ETIQUETA } from "../ui/estilos";
import { BotaoDeSair } from "./BotaoDeSair";

/**
 * O cabeçalho de toda tela do painel.
 *
 * NÃO É `"use client"`. A única coisa interativa aqui é o botão de sair, e ele
 * é uma ilha de dez linhas — arrastar o cabeçalho inteiro para o cliente por
 * causa de um `onClick` é como as telas de um painel de Server Components vão
 * virando um SPA sem que ninguém tenha decidido isso (spec §2.3: "ilha cliente
 * só onde há interação real").
 *
 * A AÇÃO PRIMÁRIA TEM UM LUGAR, E É SEMPRE O MESMO — R18. Ela entra pela prop
 * `acao` e sai no canto superior direito do bloco do título, em toda tela, com
 * ou sem conteúdo. É por isso que a prop existe em vez de cada página desenhar
 * o seu botão onde couber: "Novo produto" na direita numa tela e embaixo da
 * lista na outra é o que faz o gestor procurar o botão toda vez.
 *
 * QUEM ESTÁ LOGADO FICA VISÍVEL, e não escondido atrás de um avatar. Esta
 * instância do Supabase é COMPARTILHADA com outros projetos e mais de uma
 * pessoa da casa tem conta; saber em nome de quem se está prestes a cancelar um
 * pedido é informação de operação, não enfeite de perfil. O e-mail vem pronto
 * de quem renderiza a página — este componente não vai à rede.
 *
 * A FAIXA DA CONTA VEM ACIMA DO TÍTULO, e não ao lado dele, porque as duas
 * coisas mudam em ritmos diferentes: o título é da PÁGINA e troca a cada
 * navegação; a conta é da SESSÃO e não troca nunca. Misturá-las na mesma linha
 * faria a ação primária dançar de posição conforme o tamanho do e-mail — que é
 * justamente o que o R18 proíbe.
 */
export function Cabecalho({
  titulo,
  descricao,
  acao,
  email,
}: {
  titulo: string;
  /** Uma frase, no máximo. Se precisar de duas, é conteúdo da tela, não do
   *  cabeçalho. `62ch` é a medida de leitura do estetica.md §4.2. */
  descricao?: string;
  acao?: ReactNode;
  /** `null` quando não se sabe — e aí não se inventa nada no lugar. */
  email?: string | null;
}) {
  return (
    <header
      /* `sticky`: a ação primária e o botão de sair não podem sumir quando se
         desce uma tabela de mil pedidos. `z-20` fica acima da <Tabela>, que
         gruda o próprio <thead>. */
      className="sticky top-0 z-20 border-b border-fuligem-20 bg-cal"
    >
      <div className="flex min-h-11 flex-wrap items-center justify-end gap-x-3 border-b border-fuligem-20 px-5">
        {email && (
          <p className="min-w-0 truncate text-[12px] text-fuligem-55">
            <span className={`text-[10px] ${ETIQUETA}`}>Conectado como </span>
            {email}
          </p>
        )}
        <BotaoDeSair />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-4">
        <div className="min-w-0">
          {/*
            O <h1> é ARCHIVO, e não a Redaction dos títulos da loja: o
            estetica.md §4.2 só libera a serifada a partir de 40px, "abaixo
            disso a degradação de impressão vira sujeira" — e um título de 40px
            num painel come a tela que deveria mostrar a fila de trabalho.

            Ele também NÃO é caixa alta. A voz da etiqueta já está em uso nos
            títulos de <Ficha>, nos cabeçalhos de tabela e nos selos; se o h1
            também fosse um carimbo, a tela inteira teria um nível só de
            hierarquia. Caixa baixa em 20px contra caixa alta em 12px é a
            diferença que faz o olho achar o topo da página de primeira.
          */}
          <h1 className="text-[20px] font-semibold leading-tight tracking-[-0.01em]">
            {titulo}
          </h1>
          {descricao && (
            <p className="mt-1 max-w-[62ch] text-fuligem-55">{descricao}</p>
          )}
        </div>

        {/* O lugar da ação primária. O <div> fica na árvore mesmo vazio: é o
            que garante que ela nasça sempre no mesmo ponto da grade. */}
        <div className="flex shrink-0 items-center gap-2">{acao}</div>
      </div>
    </header>
  );
}
