import Image from "next/image";
import Link from "next/link";
import { Serra } from "@/components/marca/Serra";
import { dicionario, type Dicionario } from "@/lib/i18n/dicionario";
import { href } from "@/lib/i18n/rotas";
import type { Locale } from "@/lib/i18n/tipos";
import { buscarBarraDeAviso } from "@/lib/vitrine/heroi";
import {
  AtalhosDoCliente,
  type RotulosDeAtalho,
} from "./AtalhosDoCliente";
import { AvisoFreteGratis } from "./AvisoFreteGratis";
import { SeletorDeIdiomaDaPagina } from "./SeletorDeIdiomaDaPagina";

/**
 * estetica.md §5.8 e §10.
 *
 * Mobile-first: a navegacao nasce como acordeao em tela cheia e so vira barra
 * horizontal a partir de `xl`. O §10 pede exatamente isso ("Mega menu ->
 * acordeao em tela cheia").
 *
 * POR QUE `xl` (1280px) E NAO `md` (768px), QUE ERA O CORTE ATE A ONDA 4.
 * A barra ganhou duas coisas nesta onda: o quarto item de navegacao
 * (`/historia`) e o seletor de idioma. Em ingles — que e o idioma mais largo
 * dos tres, porque "SUBSCRIPTION" e "OUR STORY" nao encurtam — a barra pede
 * cerca de 1.185px: 150 de logo + 417 de navegacao + 176 de busca + 142 de
 * atalhos + 132 de seletor + 80 de respiro lateral + os vaos. Em 768px isso
 * nao cabe de jeito nenhum, e o que acontece quando nao cabe e sempre o mesmo:
 * o campo de busca encolhe ate virar um retangulo mudo e a navegacao aperta os
 * alvos de toque abaixo dos 44px do §10. O estetica.md ja dizia que desktop
 * comeca em 1200px; o corte em `md` e que era otimista.
 *
 * A PARCELA DE "ATALHOS" ENCOLHEU DEPOIS DESSA MEDICAO e o corte nao muda. A
 * sacola deixou de escrever a palavra e virou o mesmo quadrado de 44px do
 * telefone, entao os 142px viraram 123 (75 da conta + 4 de vao + 44) — e, o
 * que importa mais, deixaram de variar com o idioma. Sao ~19px a menos numa
 * barra que ja sobrava 95px no corte de 1280 e faltaria 142 no de 1024: nao e
 * folga que compre um breakpoint, e sim margem contra o proximo item que
 * alguem quiser pendurar aqui.
 *
 * Entre 768px e 1280px o acordeao e a navegacao — e ele nao e um consolo: cabe
 * tudo (busca, quatro links, idioma), com linha de 64px e alvo de sobra. De
 * quebra, some um defeito antigo: a altura do painel e `100dvh - 72px`, e o
 * cabecalho so passa de 72px agora que o acordeao ja saiu de cena.
 *
 * O menu usa <details>/<summary>, nao estado de React. Tres razoes: funciona
 * com JS desabilitado (§12), ja vem com semantica de expandido/recolhido e
 * navegacao por teclado, e mantem o Cabecalho como Server Component — o header
 * nao entra no bundle de JS da rota.
 *
 * TODO CAMINHO PASSA POR `href(locale, ...)`. Antes desta onda o `NAV` e o
 * logo eram caminhos crus, entao em `/en/cafes` o menu devolvia a pessoa para
 * o portugues — o site tinha tres idiomas e uma navegacao so.
 *
 * LARGURA DO LOGO: o ativo e 3508x2481. Sem `w-[...]` explicito no <img>, o
 * flex do header passa a ser dimensionado pela largura intrinseca da imagem e
 * o documento inteiro estoura 3.126px em mobile — `max-width:100%` nao salva,
 * porque a referencia dele e o pai, que por sua vez depende do filho. Por isso
 * a largura e fixada aqui, e a altura acompanha.
 */

/**
 * Os quatro destinos da navegacao, em caminho CANONICO (sempre em portugues,
 * sempre sem prefixo). Quem prefixa e o `href()`.
 *
 * `/bio` fica FORA de proposito: e endereco de perfil de Instagram, alcancado
 * por link direto, e um quinto item espremeria a barra que ja esta no limite.
 * `/rastreabilidade` tambem fica fora — ela e um link externo para a base do
 * Cerrado Mineiro, e vive no rodape, onde as verificacoes de origem cabem sem
 * competir com o caminho de venda.
 */
function navegacao(d: Dicionario) {
  return [
    { caminho: "/cafes", rotulo: d.nav.cafes },
    { caminho: "/clube", rotulo: d.nav.assinatura },
    { caminho: "/a-serra", rotulo: d.nav.aSerra },
    { caminho: "/historia", rotulo: d.nav.historia },
  ];
}

/**
 * Caixa de busca — form GET puro para /cafes?q=…, submit nativo.
 *
 * Progressive enhancement de graça: sem JS o navegador monta a querystring e a
 * PLP (Server Component) filtra no servidor. Nenhum estado, nenhum onChange —
 * e o Cabecalho continua Server Component. O `id` distingue as duas instâncias
 * (barra desktop e painel mobile) para o htmlFor não duplicar, e o `rotulo`
 * distingue os dois landmarks `role="search"` para o leitor de tela — dois
 * landmarks iguais na mesma página obrigam a visitar ambos para saber qual é.
 *
 * O `action` passa pelo `href()` como qualquer link: em `/en` o resultado da
 * busca tem de cair em `/en/cafes`, senao pesquisar e um jeito de sair do
 * idioma sem perceber.
 */
function FormBusca({
  id,
  locale,
  d,
  className = "",
  noMenu = false,
}: {
  id: string;
  locale: Locale;
  d: Dicionario;
  className?: string;
  noMenu?: boolean;
}) {
  return (
    <form
      action={href(locale, "/cafes")}
      method="get"
      role="search"
      aria-label={noMenu ? d.nav.buscarNoMenu : d.nav.buscar}
      className={`flex items-stretch ${className}`}
    >
      <label htmlFor={id} className="sr-only">
        {d.nav.buscar}
      </label>
      <input
        id={id}
        type="search"
        name="q"
        placeholder={d.nav.buscar}
        autoComplete="off"
        className="h-11 w-full min-w-0 border border-r-0 border-fuligem-20 bg-cal-puro px-3 text-[14px] placeholder:text-fuligem-55 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      />
      <button
        type="submit"
        aria-label={d.nav.buscar}
        className="flex h-11 w-11 shrink-0 items-center justify-center border border-fuligem-20 text-fuligem-55 transition-colors hover:border-fuligem hover:text-fuligem focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
      >
        <svg
          viewBox="0 0 20 20"
          aria-hidden
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <circle cx="9" cy="9" r="6" />
          <path d="m13.5 13.5 4.5 4.5" />
        </svg>
      </button>
    </form>
  );
}

function Logo({ locale, d }: { locale: Locale; d: Dicionario }) {
  return (
    <Link
      href={href(locale, "/")}
      // O nome do link é o nome da marca mais o destino, traduzido.
      // `comum.voltarAoInicio` existia no dicionário sem nenhum consumidor —
      // este é o consumidor certo, porque é literalmente o que o link faz.
      aria-label={`Café Canastra — ${d.comum.voltarAoInicio}`}
      className="flex shrink-0 items-center focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
    >
      <Image
        src="/logo-canastra.png"
        // O `alt` VEM DO DICIONÁRIO. A regra antiga ("não se traduz, porque
        // descreve o lockup impresso") confundia transcrição com descrição: o
        // `alt` é o que a pessoa que não enxerga ouve, e ela ouve no idioma
        // da página. Aqui o nome acessível do link já vem do `aria-label`
        // acima; no rodapé a mesma marca aparece FORA de link, e lá este
        // texto é o único que existe — por isso os dois leem a mesma chave.
        alt={d.comum.logoAlt}
        width={3508}
        height={2481}
        priority
        sizes="(min-width: 1280px) 150px, 108px"
        className="h-auto w-[108px] object-contain xl:w-[150px]"
      />
    </Link>
  );
}

/**
 * A BARRA DE AVISO PASSOU A LER O BANCO — e é por isso que este componente
 * virou `async`.
 *
 * `canastra.config_loja.barra_de_aviso` existe desde a 0005, o Express a expoe
 * como `announcement_bar` e o painel legado a edita ha anos. Esta barra sempre
 * leu o DICIONARIO: o gestor salvava o aviso e nada acontecia em lugar nenhum.
 * Era um campo write-only, e o spec §1 o registra ao lado dos dois banners.
 *
 * Agora ela le `canastra.vitrine_texto` com a chave `barra_aviso`, e o
 * dicionario virou o PISO — banco vazio, coluna nula, campo em branco ou API
 * fora do ar e a barra continua dizendo exatamente o que dizia antes.
 *
 * `async` NAO TIRA PAGINA NENHUMA DO BUILD: `buscarBarraDeAviso` e `fetch` com
 * `next: { revalidate }`, a unica leitura que sobrevive a geracao estatica.
 * Nenhum `cookies()`, `headers()` ou `searchParams` entra aqui — seria derrubar
 * as tres homes E as quinze PDPs de uma vez, porque este cabecalho esta em
 * TODAS elas.
 */
export async function Cabecalho({ locale }: { locale: Locale }) {
  const d = dicionario(locale);
  const nav = navegacao(d);

  const barra = await buscarBarraDeAviso(locale, {
    texto: d.barra.torradoSobDemanda,
    // Sem piso: a barra nunca teve link. Vazio significa "nao desenhe o link",
    // e e o estado normal — quem preenche os dois campos e o painel.
    rotuloBotao: "",
    destino: "",
  });

  /**
   * O recorte do dicionário que atravessa a fronteira de cliente. Montado uma
   * vez porque o <AtalhosDoCliente> é renderizado duas — barra e telefone — e
   * tudo que passa por essa fronteira vai serializado no payload da rota.
   */
  const atalhos: RotulosDeAtalho = {
    conta: d.nav.conta,
    minhaConta: d.nav.minhaConta,
    sacola: d.nav.sacola,
    sacolaVazia: d.nav.sacolaVazia,
    item: d.comum.item,
    itens: d.comum.itens,
  };

  return (
    <header>
      {/* Barra de aviso — §5.8 */}
      <div className="bg-fuligem text-cal">
        <p className="mx-auto flex min-h-9 max-w-[1440px] flex-wrap items-center justify-center gap-x-3 gap-y-0.5 px-4 py-2 text-center font-dado text-[10px] leading-tight tracking-[0.04em] sm:text-[11px] md:px-10">
          <span>{barra.texto}</span>
          {/* O LINK SO EXISTE COM OS DOIS CAMPOS. `validar()` no painel ja
              recusa rotulo sem destino; aqui a guarda e a segunda, para o que
              tiver entrado por SQL. Ele e inline dentro da frase, e nao um
              botao de 44px: a barra tem 36px de altura por desenho (§5.8), e
              engorda-la para caber um alvo de toque empurraria o cabecalho
              inteiro para baixo em toda pagina da loja. */}
          {barra.rotuloBotao && barra.destino && (
            <Link
              href={
                barra.destino.startsWith("/")
                  ? href(locale, barra.destino)
                  : barra.destino
              }
              className="underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cal"
            >
              {barra.rotuloBotao}
            </Link>
          )}
          {/* O piso do frete grátis vem de GET /config e pode mudar sem
              deploy — só este trecho é ilha client; o separador vai junto
              porque a promessa inteira some quando o admin a desliga. */}
          <AvisoFreteGratis rotulo={d.barra.freteGratisAcimaDe} />
        </p>
      </div>

      <div className="sticky top-0 z-40 border-b border-fuligem-20 bg-cal">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between gap-4 px-4 xl:h-[92px] xl:px-10">
          <Logo locale={locale} d={d} />

          {/* Navegacao de desktop — só a partir de `xl`, ver a nota do topo. */}
          <div className="hidden items-center gap-6 xl:flex 2xl:gap-8">
            <nav aria-label={d.nav.principal}>
              <ul className="flex items-center gap-6 2xl:gap-8">
                {nav.map((item) => (
                  <li key={item.caminho}>
                    {/* `flex h-11 items-center` só para o alvo de toque: os
                        links da barra tinham 14px de altura — a altura da
                        própria letra —, e o §10 pede 44px. Em largura já
                        passavam ("CAFÉS", o mais curto, mede 52px), e a
                        barra tem 92px, então o alvo cresce sem mover nada. */}
                    <Link
                      href={href(locale, item.caminho)}
                      className="flex h-11 items-center text-[13px] font-semibold uppercase tracking-[0.12em] transition-colors hover:text-vermelho focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho"
                    >
                      {item.rotulo}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <FormBusca
              id="busca-desktop"
              locale={locale}
              d={d}
              className="w-44 2xl:w-56"
            />
            <AtalhosDoCliente r={atalhos} />
            <SeletorDeIdiomaDaPagina
              id="idioma-desktop"
              locale={locale}
              variante="barra"
            />
          </div>

          {/* Em mobile a sacola fica FORA do acordeao: é o atalho que a pessoa
              mais procura e não pode depender de abrir o menu antes. Ela vem
              em GLIFO, com a contagem pendurada no canto, e é isso que devolve
              a barra de 360px para dentro da tela em todos os estados de
              sacola. A medição está no <AtalhosDoCliente>. Hoje o desenho da
              sacola é o mesmo nas duas barras; `variante="telefone"` decide
              só uma coisa — a conta não entra aqui, ela vive no acordeão,
              logo abaixo.

              `gap-3` E NÃO `gap-2`: a contagem é `absolute` e transborda uns
              3px à direita do quadrado da sacola. Com 8px de vão sobrariam 5px
              até o filete do Menu; com 12px, os 9px medidos. */}
          <div className="flex items-center gap-3 xl:hidden">
            <AtalhosDoCliente r={atalhos} variante="telefone" />

            {/* Acordeao de mobile — sem JS. O `xl:hidden` mora só no <div>
                pai, que já esconde tudo isto no desktop. */}
            <details className="group [&[open]_.rotulo-abrir]:hidden [&[open]_.rotulo-fechar]:inline">
              {/* SEM `aria-label`: o nome acessível vem do texto visível, que
                  troca de "Menu" para "Fechar" quando o painel abre. Um
                  aria-label fixo em "Abrir menu" sobrepõe o texto e passa a
                  mentir na metade dos estados. */}
              <summary className="flex h-11 min-w-11 cursor-pointer list-none items-center gap-2 border border-fuligem-20 px-3 text-[12px] font-semibold uppercase tracking-[0.12em] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-vermelho">
                <span aria-hidden className="flex w-4 flex-col gap-[3px]">
                  <span className="h-px w-full bg-fuligem" />
                  <span className="h-px w-full bg-fuligem" />
                  <span className="h-px w-full bg-fuligem" />
                </span>
                <span className="rotulo-abrir">{d.nav.menu}</span>
                <span className="rotulo-fechar hidden">{d.nav.fechar}</span>
              </summary>

              {/* Painel ancorado ao proprio header (`top-full`), e nao a
                  viewport: a barra de aviso muda de altura quando o texto
                  quebra em telas estreitas, entao qualquer deslocamento fixo
                  erraria.

                  MOBILE-FIRST NO SENTIDO LITERAL: em 360px o painel e a tela
                  inteira (`inset-x-0`), porque nao ha outro lugar para ele. A
                  partir de `sm` ele encosta a direita e vira gaveta de 420px —
                  a mesma largura da gaveta da sacola do §5.9 —, senao entre
                  600px e 1280px uma folha em branco de 1.200px de largura
                  serviria quatro linhas de texto. */}
              <nav
                aria-label={d.nav.principal}
                className="absolute inset-x-0 top-full z-50 flex h-[calc(100dvh-72px)] flex-col overflow-y-auto border-t border-fuligem-20 bg-cal sm:inset-x-auto sm:right-0 sm:w-[420px] sm:border-l"
              >
                {/* A busca abre o painel: quem toca em "Menu" no celular esta
                    procurando alguma coisa — o campo vem antes dos links. */}
                <div className="border-b border-fuligem-20 px-4 py-4">
                  <FormBusca
                    id="busca-mobile"
                    locale={locale}
                    d={d}
                    noMenu
                  />
                </div>
                <ul className="flex flex-col">
                  {nav.map((item) => (
                    <li key={item.caminho} className="border-b border-fuligem-20">
                      <Link
                        href={href(locale, item.caminho)}
                        className="flex min-h-[64px] items-center justify-between px-5 text-[20px] font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-vermelho"
                      >
                        {item.rotulo}
                        <span aria-hidden className="font-dado text-fuligem-55">
                          →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>

                {/* A conta, que saiu da barra de 360px para o documento parar
                    de rolar de lado. Vem depois dos destinos de catálogo e em
                    corpo menor de propósito: é a prateleira secundária do
                    menu, não um quinto café. O caminho é cru porque
                    `/account` é transacional e vive fora do `[locale]` — o
                    próprio `href()` o devolveria assim. */}
                <Link
                  href="/account"
                  className="flex min-h-[56px] items-center justify-between border-b border-fuligem-20 px-5 text-[13px] font-semibold uppercase tracking-[0.12em] text-fuligem-55 transition-colors hover:text-fuligem focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-vermelho"
                >
                  {d.nav.minhaConta}
                  <span aria-hidden className="font-dado text-fuligem-20">
                    →
                  </span>
                </Link>

                {/* O seletor de idioma entra AQUI, e não na barra de cima, em
                    telefone. A barra de 360px passou a sobrar 57px depois que
                    a sacola virou glifo — e o seletor não é um botão: são TRÊS
                    destinos lado a lado, 130px medidos na variante "barra".
                    Não cabe, e não é por pouco. Aqui ele tem linha própria,
                    alvo de sobra e o idioma por extenso; a variante "painel"
                    já traz o filete que continua o ritmo das linhas do menu. */}
                <SeletorDeIdiomaDaPagina id="idioma-mobile" locale={locale} />

                {/* mt-auto empurra a assinatura para o rodape do painel: o
                    menu ocupa a tela inteira, entao o espaco vazio fica no
                    meio e nao entre o ultimo link e a serra. */}
                <div className="mt-auto px-4 pb-10 pt-8">
                  <Serra
                    aria-hidden
                    className="h-10 w-full text-fuligem-20"
                    strokeWidth={1.5}
                  />
                  {/* Nome próprio de lugar: não se traduz em idioma nenhum. */}
                  <p className="mt-6 font-dado text-[11px] uppercase tracking-[0.1em] text-fuligem-55">
                    Serra da Canastra · Minas Gerais
                  </p>
                </div>
              </nav>
            </details>
          </div>
        </div>

        <Serra
          aria-hidden
          className="h-1.5 w-full text-fuligem-20"
          strokeWidth={1}
        />
      </div>
    </header>
  );
}
