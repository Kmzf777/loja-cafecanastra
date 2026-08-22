import { listarLotes } from "@/lib/catalogo/repositorio";
import { CafeNaoEncontrado } from "@/components/catalogo/CafeNaoEncontrado";

/**
 * A tela de slug que não existe.
 *
 * ESTE ARQUIVO FICOU SÓ COM A BUSCA, e a divisão é a resposta a uma limitação
 * real do App Router: `not-found.tsx` não recebe `params`, logo não tem como
 * saber se a pessoa veio de `/cafes/x`, `/en/cafes/x` ou `/es/cafes/x`. Quem
 * descobre o idioma é `<CafeNaoEncontrado>`, pelo caminho da URL — o
 * comentário lá explica por que aquilo precisa ser cliente.
 *
 * A busca fica AQUI porque `listarLotes({ soDisponiveis: true })` lê o estoque
 * ao vivo do repositório, e é ela que sustenta a frase da tela: os cafés
 * oferecidos como saída estão de pé agora.
 */
export default async function LoteNaoEncontrado() {
  const sugestoes = (
    await listarLotes({ soDisponiveis: true }, "relevancia")
  ).slice(0, 4);

  return <CafeNaoEncontrado sugestoes={sugestoes} />;
}
