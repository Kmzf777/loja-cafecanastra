"use client";

import { usePathname } from "next/navigation";
import type { Lote } from "@/lib/catalogo/tipos";
import { traduzirLote } from "@/lib/catalogo/produtos";
import { BotaoLink } from "@/components/ui/Botao";
import { Serra } from "@/components/marca/Serra";
import { dicionario } from "@/lib/i18n/dicionario";
import { caminhoSemLocale, href, localeDaRota } from "@/lib/i18n/rotas";
import type { Locale } from "@/lib/i18n/tipos";
import { CardCafe } from "./CardCafe";

/**
 * O corpo da tela de 404 — a do café que não existe E a de qualquer endereço
 * que não existe. estetica.md §11: a tela de erro explica e resolve, nunca é
 * só "404" e nunca pede desculpa.
 *
 * ELA ATENDE OS DOIS CASOS DE PROPÓSITO, E ISSO É CONSEQUÊNCIA DE ONDE ELA É
 * MONTADA. `app/not-found.tsx` é a rede que pega TUDO que não casou com rota
 * nenhuma — inclusive `/cafes/slug-inexistente`, porque o
 * `dynamicParams = false` da PDP responde 404 antes de entrar no segmento e
 * portanto nunca alcança o `not-found.tsx` que vive ao lado dela. Duas telas
 * separadas obrigariam a rede de cima a escolher uma frase errada para metade
 * dos visitantes; uma tela só, que lê o caminho, acerta as duas.
 *
 * ANTES ELA SE CHAMAVA `<CafeNaoEncontrado>` e era CÓDIGO MORTO: o único
 * arquivo que a renderizava — `app/[locale]/(vitrine)/cafes/[slug]/
 * not-found.tsx` — é inalcançável para slug inventado, pela mesma razão acima.
 *
 * POR QUE ELA É CLIENTE, E É A ÚNICA RAZÃO. Um `not-found.tsx` NÃO recebe
 * `params`, e o de raiz nem sequer vive dentro do segmento `[locale]`. Medido
 * neste app, em `next dev`, com uma sonda em `app/not-found.tsx`:
 *
 *   - `headers()` do servidor traz `host`, `user-agent`, `accept` e os
 *     `x-forwarded-*` — NENHUM cabeçalho com o caminho pedido. O servidor não
 *     tem como saber que idioma 404-ou;
 *   - `usePathname()` numa ilha client devolve `/en/cafes/nao-existe`, o
 *     endereço real, e devolve isso TAMBÉM no HTML do servidor.
 *
 * Ou seja: o cliente é a única fonte, e ela é confiável dos dois lados do
 * rewrite do middleware — `/cafes/x` e `/pt/cafes/x` respondem `pt`,
 * `/en/cafes/x` responde `en`. O texto não muda entre servidor e cliente,
 * então não há hidratação divergente (ver a nota do `connection()` em
 * `app/not-found.tsx`, que é o que mantém isso verdadeiro em produção).
 *
 * A BUSCA DAS SUGESTÕES FICOU NO SERVIDOR, e isso é de propósito: elas vêm de
 * `listarLotes({ soDisponiveis: true })`, que lê o estoque ao vivo. Trazer a
 * busca para cá obrigaria a cair no estoque do JSON, e a frase "estes estão
 * disponíveis agora" viraria uma afirmação que a página não pode sustentar.
 */

/**
 * O texto do 404 GENÉRICO — o de `/rota-que-nao-existe`, que não é café
 * nenhum.
 *
 * ESTAS TRÊS FRASES DEVIAM ESTAR EM `lib/i18n/dicionario.ts`, sob
 * `naoEncontrado: { titulo, texto }`, ao lado de `pdp.naoEncontrado`. Elas
 * estão aqui porque aquele arquivo pertence a outra frente desta mesma onda e
 * está sendo escrito em paralelo — mexer nele agora perderia trabalho alheio.
 * É dívida com destino escrito, não uma segunda fonte de tradução por
 * escolha: no dia em que as chaves subirem, esta tabela SAI e o componente
 * passa a ler `d.naoEncontrado`, exatamente como já lê `d.pdp.naoEncontrado`
 * logo abaixo.
 *
 * A trava de tipo que o dicionário tem — chave faltando quebra o build — vale
 * aqui também, pelo `Record<Locale, …>`: um idioma novo em `LOCALES` não
 * compila até ganhar o texto.
 */
const PAGINA_SUMIDA: Record<Locale, { titulo: string; texto: string }> = {
  pt: {
    titulo: "Essa página não existe.",
    texto:
      "O endereço pode ter mudado, ou nunca existiu. Estes cafés estão disponíveis agora.",
  },
  en: {
    titulo: "That page does not exist.",
    texto:
      "The address may have changed, or it never existed. These coffees are available now.",
  },
  es: {
    titulo: "Esa página no existe.",
    texto:
      "La dirección puede haber cambiado, o nunca existió. Estos cafés están disponibles ahora.",
  },
};

/** `/cafes/qualquer-coisa` é café; `/cafes` e `/qualquer-outra` não são. */
function pediuUmCafe(caminhoCanonico: string): boolean {
  return /^\/cafes\/[^/]+/.test(caminhoCanonico);
}

export function PaginaNaoEncontrada({ sugestoes }: { sugestoes: Lote[] }) {
  const caminho = usePathname() || "/";
  const locale = localeDaRota(caminho);
  const d = dicionario(locale);
  const cafe = pediuUmCafe(caminhoSemLocale(caminho));
  const copy = cafe ? d.pdp.naoEncontrado : PAGINA_SUMIDA[locale];

  // Os lotes chegam do servidor em português — o repositório não sabe o
  // idioma. A tradução do editorial acontece aqui, pelo mesmo `traduzirLote`
  // da PDP e da PLP.
  const lotes = sugestoes.map((lote) => traduzirLote(lote, locale));

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
      {/* §11: número em Martian Mono. É a etiqueta que diz o que aconteceu
          sem gastar a linha do título com "Erro 404". */}
      <p className="font-dado text-[13px] uppercase tracking-[0.1em] text-fuligem-55">
        404
      </p>
      <h1 className="mt-4 max-w-[20ch] font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1.05]">
        {copy.titulo}
      </h1>
      <p className="mt-5 max-w-[56ch] text-[17px] leading-relaxed text-fuligem-80">
        {copy.texto}
      </p>

      {/* AS DUAS PORTAS DE DESTINO. Em 360px elas empilham sozinhas pelo
          `flex-wrap` — cada botão pede ~180px e a calha deixa 328px, então a
          segunda desce em vez de espremer o alvo de toque abaixo dos 48px do
          §5.7.

          TODO `href` PASSA POR `href(locale, …)`. Este era o único lugar da
          vitrine que escrevia o caminho cru: em `/en/cafes/x`, um
          `href="/cafes"` literal jogava a pessoa de volta para o português no
          meio do único gesto que a tela oferecia. */}
      <div className="mt-8 flex flex-wrap gap-3">
        <BotaoLink href={href(locale, "/cafes")} variante="primario">
          {d.comum.verTodosOsCafes}
        </BotaoLink>
        <BotaoLink href={href(locale, "/")} variante="secundario">
          {d.comum.voltarAoInicio}
        </BotaoLink>
      </div>

      {/* A TERCEIRA PORTA: busca. Form GET puro para /cafes?q=…, submit
          nativo — o mesmo desenho do cabeçalho, e pela mesma razão: funciona
          com JS desabilitado (§12), porque quem monta a querystring é o
          navegador e quem filtra é a PLP, no servidor.

          SEM `role="search"`. O cabeçalho já expõe DOIS landmarks de busca
          (barra e painel do acordeão); um terceiro obrigaria o leitor de tela
          a visitar os três para descobrir qual é qual. O campo continua
          nomeado pelo <label>, que é o que a pessoa precisa.

          Em 360px o campo ocupa a calha inteira (`w-full`) e o botão é um
          quadrado de 44px — o piso de alvo de toque do §10; a partir de `sm`
          ele para de esticar e fica com a largura de uma coluna de card. */}
      <form
        action={href(locale, "/cafes")}
        method="get"
        className="mt-6 flex w-full items-stretch sm:max-w-[420px]"
      >
        <label htmlFor="busca-nao-encontrada" className="sr-only">
          {d.nav.buscar}
        </label>
        <input
          id="busca-nao-encontrada"
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

      {/* A grade só existe quando há o que oferecer. Se o estoque ao vivo
          voltar vazio — ou se a leitura falhar e `app/not-found.tsx` cair na
          lista vazia —, a tela continua com as três portas acima em vez de
          exibir um filete decorativo sobre o nada. */}
      {lotes.length > 0 ? (
        <>
          <Serra
            aria-hidden
            className="mt-14 h-1.5 w-full text-fuligem-20"
            strokeWidth={1}
          />
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {lotes.map((lote) => (
              <CardCafe key={lote.slug} lote={lote} locale={locale} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
