import { listarLotes } from "@/lib/catalogo/repositorio";
import { PaginaNaoEncontrada } from "@/components/catalogo/PaginaNaoEncontrada";

/**
 * A tela do café que saiu do catálogo DEPOIS do build.
 *
 * QUAL É EXATAMENTE O CASO QUE CHEGA AQUI, porque é mais estreito do que o
 * nome do arquivo sugere. Slug inventado (`/cafes/nao-existe`) NÃO chega: a
 * página ao lado declara `dynamicParams = false` e o Next responde 404 antes
 * de entrar neste segmento — quem pega aquilo é `app/not-found.tsx`, a rede de
 * raiz, e o comentário de lá explica o mecanismo. O que sobra para cá é o
 * `notFound()` de dentro da PDP: o slug ESTAVA no `generateStaticParams` do
 * build, a página revalida a cada hora (`revalidate = 3600`), e nessa
 * revalidação `obterLote` já não acha o lote — lote que acabou e saiu do
 * repositório. O caminho é real e é justamente onde a moldura no idioma certo
 * importa, porque aqui o layout do `[locale]` já rodou.
 *
 * A BUSCA FICA AQUI, e não no componente, porque `listarLotes({ soDisponiveis:
 * true })` lê o estoque ao vivo do repositório — é ela que sustenta a frase da
 * tela: os cafés oferecidos como saída estão de pé agora. Quem descobre o
 * idioma é `<PaginaNaoEncontrada>`, pelo caminho da URL; o comentário de lá
 * explica por que aquilo precisa ser cliente.
 */
export default async function LoteNaoEncontrado() {
  const sugestoes = (
    await listarLotes({ soDisponiveis: true }, "relevancia")
  ).slice(0, 4);

  return <PaginaNaoEncontrada sugestoes={sugestoes} />;
}
