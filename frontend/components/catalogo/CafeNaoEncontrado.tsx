"use client";

import { usePathname } from "next/navigation";
import type { Lote } from "@/lib/catalogo/tipos";
import { traduzirLote } from "@/lib/catalogo/produtos";
import { BotaoLink } from "@/components/ui/Botao";
import { dicionario } from "@/lib/i18n/dicionario";
import { href, localeDaRota } from "@/lib/i18n/rotas";
import { CardCafe } from "./CardCafe";

/**
 * O corpo da tela de café inexistente — estetica.md §11: a tela de erro
 * explica e resolve, nunca é só "404" e nunca pede desculpa. Aqui ela oferece
 * a saída que existe: os cafés que estão de pé agora.
 *
 * POR QUE ELA É CLIENTE, E É A ÚNICA RAZÃO. Um `not-found.tsx` é chamado pelo
 * `notFound()` e NÃO recebe `params` — o segmento `[locale]` da rota não chega
 * lá, e por isso a tela ficou em português nos três idiomas desde que a
 * vitrine foi traduzida. `usePathname()` é a saída que a própria documentação
 * do App Router indica para o caso, e ela funciona nos dois lados do rewrite
 * do middleware: `/cafes/x` e `/pt/cafes/x` respondem `pt`, `/en/cafes/x`
 * responde `en`. O texto não muda entre servidor e cliente, então não há
 * hidratação divergente.
 *
 * A BUSCA DAS SUGESTÕES FICOU NO SERVIDOR, e isso é de propósito: elas vêm de
 * `listarLotes({ soDisponiveis: true })`, que lê o estoque ao vivo. Trazer a
 * busca para cá obrigaria a cair no estoque do JSON, e a frase "estes estão
 * disponíveis agora" viraria uma afirmação que a página não pode sustentar.
 */
export function CafeNaoEncontrado({ sugestoes }: { sugestoes: Lote[] }) {
  const locale = localeDaRota(usePathname());
  const d = dicionario(locale);
  // Os lotes chegam do servidor em português — o repositório não sabe o
  // idioma. A tradução do editorial acontece aqui, pelo mesmo `traduzirLote`
  // da PDP e da PLP.
  const lotes = sugestoes.map((lote) => traduzirLote(lote, locale));

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
      <p className="font-dado text-[13px] uppercase tracking-[0.1em] text-fuligem-55">
        404
      </p>
      <h1 className="mt-4 max-w-[20ch] font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1.05]">
        {d.pdp.naoEncontrado.titulo}
      </h1>
      <p className="mt-5 max-w-[56ch] text-[17px] leading-relaxed text-fuligem-80">
        {d.pdp.naoEncontrado.texto}
      </p>
      <div className="mt-8">
        {/* O ÚNICO LINK INTERNO DA VITRINE QUE ESCREVIA O CAMINHO CRU. Em
            `/en/cafes/x`, um `href="/cafes"` literal jogava a pessoa de volta
            para o português no meio do único gesto que a tela oferece. */}
        <BotaoLink href={href(locale, "/cafes")} variante="primario">
          {d.comum.verTodosOsCafes}
        </BotaoLink>
      </div>

      <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {lotes.map((lote) => (
          <CardCafe key={lote.slug} lote={lote} locale={locale} />
        ))}
      </div>
    </div>
  );
}
