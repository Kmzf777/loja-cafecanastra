import type { Metadata } from "next";
import { IlhaDoPainel } from "./PainelLegado";

/**
 * O painel ANTIGO, agora servido em `/dashboard/legado/…`.
 *
 * ELE DESCEU DA RAIZ NA ONDA 1 DO PAINEL NOVO, e o motivo é de roteamento e não
 * de organização: um catch-all na raiz de `(protegido)` é o dono de toda URL do
 * grupo que ainda não tem pasta própria. Com o painel novo criando uma pasta por
 * tela ao longo de seis ondas, cada tela nova teria de disputar rota com ele.
 * Aqui embaixo o legado segue inteiro e não compete com nada.
 *
 * O `basename` do `createBrowserRouter` em `legacy/PainelApp.jsx` acompanhou a
 * mudança, e TEM de acompanhar: sem ele o SPA procura rotas sob `/dashboard`,
 * não casa nenhuma e cai na tela "Unexpected Application Error / 404 Not Found"
 * do react-router — que é uma pendência já registrada neste projeto, em
 * `docs/superpowers/plans/baseline-painel.md`.
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
  // "Painel antigo" e nao "Painel": desde que a raiz virou o painel novo,
  // as duas telas convivem, e duas abas com o mesmo titulo sao duas abas
  // que o gestor troca no escuro.
  title: "Painel antigo",
  // O painel não é conteúdo — é ferramenta de trabalho atrás de senha.
  // `app/robots.ts` já manda Disallow em /dashboard; isto é a segunda camada,
  // para o crawler que ignora o robots.txt mas respeita a meta tag.
  robots: { index: false, follow: false },
};

export default function PaginaDoPainelLegado() {
  return <IlhaDoPainel />;
}
