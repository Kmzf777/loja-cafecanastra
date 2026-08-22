"use client";

import Link from "next/link";
import { useSacola } from "@/lib/sacola/sacola";
import type { Dicionario } from "@/lib/i18n/dicionario";

/**
 * As seis palavras que este componente usa — e SÓ elas.
 *
 * O tipo é derivado do dicionário com `Pick`, então continua amarrado a ele:
 * renomear `nav.sacolaVazia` quebra o build aqui. O que se evita é passar o
 * objeto `Dicionario` inteiro por uma fronteira de cliente — tudo que atravessa
 * essa fronteira é SERIALIZADO no payload da rota, e o Cabeçalho renderiza este
 * componente DUAS vezes por página (barra e telefone). Seriam alguns KB de RSC
 * por navegação para mostrar duas palavras.
 */
export type RotulosDeAtalho = Pick<
  Dicionario["nav"],
  "conta" | "minhaConta" | "sacola" | "sacolaVazia"
> &
  Pick<Dicionario["comum"], "item" | "itens">;

/**
 * A sacola do estetica.md §5.8, que desenha o cluster da direita como
 * `⌕ ⊙ 🛒2` — glifo com a contagem colada, e não a palavra por extenso.
 *
 * Traço de 1,5px em `currentColor`, viewBox de 20, igual à lupa da busca que
 * mora no Cabeçalho: as duas são o mesmo desenho de linha.
 */
function GlifoSacola() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d="M3.9 6.4h12.2l-.85 10.2a1 1 0 0 1-1 .9H5.75a1 1 0 0 1-1-.9L3.9 6.4Z" />
      <path d="M7.3 8.4V5.6a2.7 2.7 0 0 1 5.4 0v2.8" />
    </svg>
  );
}

/**
 * Sacola e conta no cabeçalho.
 *
 * Ilha client dentro de um header que é Server Component. A separação é
 * deliberada: o contador da sacola depende de estado do navegador, mas o resto
 * do header (logo, navegação, menu em <details>) continua fora do bundle de JS,
 * que é o que o comentário no topo de Cabecalho.tsx protege.
 *
 * Antes desta peça não havia link para entrar em lugar nenhum da vitrine: as
 * rotas /account e /account/login existiam e só eram alcançadas por quem
 * digitasse a URL ou fosse empurrado pelo guard do painel.
 *
 * OS DOIS DESTINOS NÃO PASSAM POR `href()` DE PROPÓSITO, e não é esquecimento
 * da costura: `/account` e `/sacola` são transacionais, vivem fora do
 * `[locale]`, e o próprio `href()` os devolveria crus. Escrevê-los diretos
 * poupa a quem lê a pergunta "por que este link ignora o idioma".
 *
 * O TEXTO vem do dicionário por prop, e não de um `dicionario(locale)` aqui
 * dentro: este é um Client Component, e importar o dicionário inteiro num
 * bundle de navegador para usar seis chaves seria pagar três idiomas em toda
 * rota. O Cabeçalho já é servidor e passa só o recorte (`RotulosDeAtalho`).
 */
export function AtalhosDoCliente({
  r,
  variante = "barra",
}: {
  /** Os rótulos, já no idioma da página. */
  r: RotulosDeAtalho;
  /**
   * Qual das duas barras está pedindo os atalhos.
   *
   * `"barra"` é o cabeçalho de desktop (a partir de `xl`), onde cabe a palavra
   * por extenso e cabe também o atalho da conta ao lado.
   *
   * `"telefone"` é a barra de 360px, e ela É OUTRO DESENHO — não o mesmo
   * encolhido —, porque a marcação por extenso NÃO CABIA. Medido em Chromium
   * a 360x800, com a Archivo de verdade, na barra montada do Cabeçalho:
   *
   *   ANTES, com a palavra "SACOLA" e a contagem no fluxo:
   *     sacola vazia → a barra fecha em 344px (16px de calha, que é o `px-4`);
   *     1 item       → fecha em 353px, 7px de calha;
   *     12 itens     → fecha em 362px: `scrollWidth` 362 numa viewport de 360,
   *                    ou seja 2px de ROLAGEM HORIZONTAL no documento inteiro.
   *   O cluster da direita media 213px com 1 item e 222px com 12 — contra os
   *   328px que o `px-4` deixa para logo (108, `shrink-0`) mais vão. Quebrava
   *   no estado normal de quem está comprando, não num caso de canto.
   *
   *   DEPOIS, com o glifo e a contagem fora do fluxo:
   *     o cluster mede 147px (44 da sacola + 12 de vão + 91 do Menu) em
   *     QUALQUER estado e nos TRÊS idiomas, e a barra fecha em 344px sempre.
   *     O conteúdo mínimo da linha é 108 + 16 de vão + 147 = 271px dentro dos
   *     328 disponíveis: 57px de folga que já não dependem do que a pessoa
   *     colocou na sacola.
   *
   * A RAIZ DO DEFEITO ERA ESSA DEPENDÊNCIA. A contagem entrava no fluxo
   * (`gap-2` mais `min-w-5 px-1.5`: 28px que só existem quando há item) numa
   * linha em que nada podia encolher — o logo é `shrink-0` e as duas caixas da
   * direita são palavra única, logo `min-content`. Trocar `px-4` por mais
   * calha não resolveria: só adiaria o estouro para o oitavo item.
   *
   * O DESENHO NÃO É INVENÇÃO PARA CABER: o estetica.md §5.8 já desenha o
   * cluster da direita como `⌕ ⊙ 🛒2` — glifos com a contagem colada. A barra
   * de telefone passou a ser a que o documento sempre descreveu.
   *
   * A CONTA NÃO VOLTA À BARRA DE TELEFONE, e agora por outro motivo. Antes era
   * "não cabe" — a palavra "CONTA" custava 75px numa linha que já estourava.
   * Hoje caberia, e fica fora por hierarquia: a sacola é o que a pessoa
   * procura em toda visita, a conta é prateleira secundária e vive no
   * acordeão, a um toque, com o rótulo por extenso. Os 57px de folga existem
   * para absorver idioma mais largo e a barra de rolagem do sistema, não para
   * um terceiro destino.
   */
  variante?: "barra" | "telefone";
}) {
  const { quantidadeTotal } = useSacola();

  // O rótulo acessível carrega a contagem: o número ao lado do texto é visual,
  // e sem isto o leitor de tela anuncia só "Sacola". No telefone ele é o ÚNICO
  // texto da sacola — o glifo é `aria-hidden`.
  const rotuloDaSacola =
    quantidadeTotal > 0
      ? `${r.sacola} · ${quantidadeTotal} ${quantidadeTotal === 1 ? r.item : r.itens}`
      : r.sacolaVazia;

  if (variante === "telefone") {
    return (
      <Link
        href="/sacola"
        aria-label={rotuloDaSacola}
        className="relative flex size-11 shrink-0 items-center justify-center border border-fuligem-20 transition-colors hover:border-fuligem focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      >
        <GlifoSacola />
        {quantidadeTotal > 0 ? (
          // FORA DO FLUXO, e é o conserto: pendurada no canto do quadrado, a
          // contagem não empurra nada. Ela transborda para o vão que a separa
          // do Menu — medido em 360px, a contagem termina em 244px e o filete
          // do Menu começa em 253px, 9px de ar com dois dígitos —, e nunca
          // para dentro da calha da direita, porque quem fecha a barra é o
          // Menu, não a sacola.
          <span
            aria-hidden
            className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center bg-vermelho px-1 font-dado text-[10px] leading-4 text-white"
          >
            {quantidadeTotal}
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Link
        href="/account"
        aria-label={r.minhaConta}
        className="flex h-11 items-center px-3 text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors hover:text-vermelho focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      >
        {r.conta}
      </Link>

      <Link
        href="/sacola"
        aria-label={rotuloDaSacola}
        className="flex h-11 items-center gap-2 border border-fuligem-20 px-3 text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors hover:border-fuligem focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      >
        {r.sacola}
        {quantidadeTotal > 0 ? (
          <span
            aria-hidden
            className="inline-flex min-w-5 items-center justify-center bg-vermelho px-1.5 font-dado text-[11px] leading-5 text-white"
          >
            {quantidadeTotal}
          </span>
        ) : null}
      </Link>
    </div>
  );
}
