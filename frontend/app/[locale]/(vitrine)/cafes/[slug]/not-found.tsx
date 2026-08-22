import { listarLotes } from "@/lib/catalogo/repositorio";
import { CardCafe } from "@/components/catalogo/CardCafe";
import { BotaoLink } from "@/components/ui/Botao";

/**
 * estetica.md §11 — a tela de erro explica e resolve, nunca pede desculpa e
 * nunca e so "404". Aqui ela oferece saida: os cafes que existem.
 *
 * SEM IDIOMA, E ISSO É LIMITAÇÃO DO APP ROUTER: um `not-found.tsx` é chamado
 * pelo `notFound()` e NÃO recebe `params` — não há como saber se a pessoa veio
 * de `/cafes/x`, `/en/cafes/x` ou `/es/cafes/x`. O link de saída aponta para o
 * catálogo em português, que existe nos três casos; o rewrite do middleware
 * cuida do resto. Traduzir esta tela pede outra estratégia (um `error.tsx`
 * cliente, que lê a URL), e isso é decisão da onda de tradução.
 */
export default async function LoteNaoEncontrado() {
  const sugestoes = (await listarLotes({ soDisponiveis: true }, "relevancia")).slice(0, 4);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-16 md:px-10 md:py-24">
      <p className="font-dado text-[13px] uppercase tracking-[0.1em] text-fuligem-55">
        404
      </p>
      <h1 className="mt-4 max-w-[20ch] font-titulo text-[clamp(2.5rem,5vw,3.75rem)] leading-[1.05]">
        Esse café não está no catálogo.
      </h1>
      <p className="mt-5 max-w-[56ch] text-[17px] leading-relaxed text-fuligem-80">
        Pode ser um lote que já acabou — torramos em quantidade pequena e alguns
        saem de linha. Estes estão disponíveis agora.
      </p>
      <div className="mt-8">
        <BotaoLink href="/cafes" variante="primario">
          Ver todos os cafés
        </BotaoLink>
      </div>

      <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {sugestoes.map((lote) => (
          <CardCafe key={lote.slug} lote={lote} />
        ))}
      </div>
    </div>
  );
}
