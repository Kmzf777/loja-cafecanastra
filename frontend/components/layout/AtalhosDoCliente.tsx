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
      // O `group-hover` levanta o glifo 1px dentro do quadrado parado. É o
      // único movimento da peça e ele existe porque, sem rótulo escrito, o
      // ícone precisa responder ao ponteiro para se anunciar clicável — a
      // troca de cor do filete sozinha é discreta demais para o alvo de 44px.
      className="size-5 transition-transform duration-200 ease-canastra group-hover:-translate-y-px"
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
 * O selo de contagem — o número pendurado no canto da sacola.
 *
 * FORA DO FLUXO, e isso é o conserto de um defeito antigo: pendurado no canto
 * do quadrado, o número não empurra nada. Só a borda DIREITA está ancorada
 * (`-right-1`), então ele cresce para a ESQUERDA, por cima do próprio glifo —
 * de um para dois dígitos a barra não se mexe um pixel. Medido em 360px: o
 * selo termina em 244px e o filete do Menu começa em 253px.
 *
 * QUADRADO, VERMELHO E EM MARTIAN MONO, e não a pílula redonda de sempre: o
 * estetica.md §4.1/§4.2 não tem raio (`--radius-cx: 0`) e reserva a mono para
 * número e código. Vermelho sobre branco dá 5,8:1, dentro do §4.1. O que sai
 * disso é um carimbo de lote na quina do pacote, que é o que a marca inteira
 * já faz — e não o widget genérico de e-commerce.
 *
 * O CONTORNO EM CAL é o que separa o carimbo do filete que ele cobre. Sem ele
 * a linha `fuligem-20` da caixa entra no vermelho e o selo parece impresso na
 * borda; com 2px de cal ele passa a estar POR CIMA. `outline` e não `border`
 * porque contorno não entra no box model — a caixa do número não muda.
 *
 * `99+` PORQUE TRÊS DÍGITOS NÃO SÃO CONTAGEM, SÃO ERRO DE ESTOQUE: crescendo
 * para a esquerda, "127" cobriria o glifo inteiro e a sacola viraria um
 * retângulo vermelho sem desenho. O rótulo acessível continua dizendo o número
 * de verdade — quem ouve não perde nada, quem enxerga não perde o ícone.
 *
 * A ANIMAÇÃO É DISPARADA PELA `key`. Trocar a chave faz o React desmontar e
 * remontar o <span>, e uma keyframe CSS recomeça do zero em elemento novo — é
 * assim que o selo dá o pulo a cada item somado, sem `useState`, sem `useRef`
 * e sem efeito. O bloco `prefers-reduced-motion` do globals.css já a anula
 * para quem pediu movimento reduzido.
 */
function SeloDeContagem({ quantidade }: { quantidade: number }) {
  return (
    <span
      key={quantidade}
      aria-hidden
      className="selo-sacola absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center bg-vermelho px-1 font-dado text-[10px] leading-4 text-white outline-2 outline-cal"
    >
      {quantidade > 99 ? "99+" : quantidade}
    </span>
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
   * A SACOLA É A MESMA NAS DUAS: quadrado de 44px, glifo e selo no canto. A
   * variante decide UMA coisa só — se o atalho da conta aparece ao lado.
   *
   * Nem sempre foi assim. Até aqui, `"barra"` (o cabeçalho de desktop, a partir
   * de `xl`) escrevia "SACOLA" por extenso com a contagem colada ao rótulo, e
   * só `"telefone"` usava o glifo. As duas razões de unificar:
   *
   * 1. É O QUE O DOCUMENTO SEMPRE DESENHOU. O estetica.md §5.8 mostra o
   *    cluster da direita como `⌕ ⊙ 🛒2` — glifos com a contagem colada, em
   *    desktop. A barra de desktop é que estava fora do desenho.
   *
   * 2. A CAIXA DEIXA DE DEPENDER DO IDIOMA. Por extenso, a sacola media 106px
   *    em português, 102 em espanhol e 90 em inglês, mais 28px quando havia
   *    item; em glifo são 44px fixos, nos três idiomas e em qualquer estado.
   *    Isso devolve ~90px à barra de 1280px, que é exatamente onde o
   *    comentário do topo do Cabecalho.tsx conta os pixels um a um para
   *    justificar o corte do acordeão em `xl`.
   *
   * O CUSTO É REAL E ESTÁ PAGO: o rótulo visível some, então o nome acessível
   * do link passa a vir inteiro do `aria-label` — que já carrega a contagem por
   * extenso ("Sacola · 3 itens"), coisa que o número solto ao lado da palavra
   * nunca disse a quem só ouve.
   *
   * `"telefone"` é a barra de 360px, e ela já era outro desenho — não o mesmo
   * encolhido —, porque a marcação por extenso NÃO CABIA. Medido em Chromium a
   * 360x800, com a Archivo de verdade, na barra montada do Cabeçalho:
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
   * A RAIZ DAQUELE DEFEITO ERA ESSA DEPENDÊNCIA. A contagem entrava no fluxo
   * (`gap-2` mais `min-w-5 px-1.5`: 28px que só existem quando há item) numa
   * linha em que nada podia encolher — o logo é `shrink-0` e as duas caixas da
   * direita são palavra única, logo `min-content`. Trocar `px-4` por mais
   * calha não resolveria: só adiaria o estouro para o oitavo item.
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

  // O rótulo acessível é o ÚNICO texto da sacola nas duas variantes — o glifo é
  // `aria-hidden` e o selo também. Sem isto o leitor de tela anuncia um link
  // sem nome; com a contagem dentro dele, anuncia o mesmo que o olho vê.
  const rotuloDaSacola =
    quantidadeTotal > 0
      ? `${r.sacola} · ${quantidadeTotal} ${quantidadeTotal === 1 ? r.item : r.itens}`
      : r.sacolaVazia;

  // Um só desenho, montado uma vez e usado nas duas variantes: é a garantia de
  // que a barra de 1280px e a de 360px não voltam a divergir por descuido.
  const sacola = (
    <Link
      href="/sacola"
      aria-label={rotuloDaSacola}
      // `group` para o glifo poder reagir ao hover do quadrado (ver GlifoSacola).
      // `relative` para o selo se pendurar no canto. `cal-puro` é meio tom acima
      // do `cal` da barra: o quadrado acende sem virar botão colorido.
      className="group relative flex size-11 shrink-0 items-center justify-center border border-fuligem-20 transition-colors hover:border-fuligem hover:bg-cal-puro focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
    >
      <GlifoSacola />
      {quantidadeTotal > 0 ? <SeloDeContagem quantidade={quantidadeTotal} /> : null}
    </Link>
  );

  if (variante === "telefone") {
    return sacola;
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

      {sacola}
    </div>
  );
}
