import type { Metadata } from "next";
import { IlhaDoPainel } from "./PainelLegado";

/**
 * O painel.
 *
 * ESTA PÁGINA ERA `"use client"` e montava a ilha legada com `ssr: false`, o que
 * significa que qualquer visitante ANÔNIMO recebia o pacote inteiro do painel e
 * só descobria que não podia entrar depois de baixá-lo, executá-lo e ir ao
 * GoTrue perguntar. O código do painel, sua estrutura e a superfície de API que
 * ele conhece eram públicos.
 *
 * NÃO HÁ CHECAGEM AQUI, E ISSO É DE PROPÓSITO. Ela está em
 * `(protegido)/layout.tsx`, que envolve esta página e qualquer outra que venha a
 * existir no grupo. Repetir a checagem aqui custaria uma segunda ida ao GoTrue e
 * ao PostgREST por requisição, e — pior — criaria a impressão de que uma página
 * do grupo precisa se proteger sozinha. A que fosse criada sem a linha copiada
 * nasceria aberta, que é exatamente o buraco que o layout fechou.
 *
 * O layout é renderizado ANTES dos filhos: se ele chama `redirect()`, esta
 * função nem executa. Não há janela em que a ilha seja emitida sem autorização.
 */
export const metadata: Metadata = {
  title: "Painel",
  // O painel não é conteúdo — é ferramenta de trabalho atrás de senha.
  // `app/robots.ts` já manda Disallow em /dashboard; isto é a segunda camada,
  // para o crawler que ignora o robots.txt mas respeita a meta tag.
  robots: { index: false, follow: false },
};

export default function PaginaDoPainel() {
  return <IlhaDoPainel />;
}
