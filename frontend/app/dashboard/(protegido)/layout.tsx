import type { ReactNode } from "react";
import { exigirAdminNoPainel } from "@/lib/conta/painel-servidor";

/**
 * A cerca do painel — e o motivo de ela morar num LAYOUT.
 *
 * O QUE ESTAVA ERRADO ANTES. O guard vivia na página do catch-all, e
 * `/dashboard/entrar` escapava dele por precedência de rota (estática vence
 * catch-all). Funcionava, mas a mesma precedência vale para qualquer arquivo
 * criado amanhã: um `app/dashboard/relatorios/page.tsx` nasceria PÚBLICO — sem
 * guard, sem aviso e sem teste vermelho. O padrão estava invertido, e a falha
 * seria por omissão, que é a que ninguém revisa.
 *
 * AGORA O PADRÃO É "PROTEGIDO". Todo arquivo dentro de `(protegido)/` herda este
 * layout e, com ele, a checagem. Sair da cerca exige criar a rota dentro de
 * `(publico)/`, que é uma palavra que aparece no diff e que ninguém escreve por
 * distração. Route group não muda URL nenhuma: `(protegido)/[[...rota]]`
 * continua servindo `/dashboard`, e `(publico)/entrar` continua servindo
 * `/dashboard/entrar`.
 *
 * `layout.tsx` E NÃO `template.tsx`: layout é o que envolve TODAS as rotas do
 * grupo, incluindo as que ainda não existem. É o default que se queria.
 *
 * OS DOIS BURACOS QUE ESTE LAYOUT NÃO TAPA, escritos porque o nome do grupo
 * promete demais.
 *
 * **Route Handler não passa por layout.** Um `(protegido)/exportar/route.ts`
 * nasceria ABERTO apesar de morar dentro de `(protegido)` — layouts envolvem
 * páginas, não handlers.
 *
 * **Server Action também não**, e este é pior porque é invisível: a ação POSTa
 * para a própria rota, EXECUTA, e só então a página re-renderiza — momento em
 * que este layout finalmente chama `exigirAdminNoPainel`. A checagem roda
 * DEPOIS de a ação ter gravado no banco. E o painel novo é feito de ações.
 *
 * Nos dois casos, quem escreve o arquivo tem de chamar `exigirAdminEmAcao()`
 * (de `lib/conta/painel-servidor.ts`) na PRIMEIRA linha, antes de ler o corpo e
 * antes de tocar no banco. O teste de inventário em
 * `lib/conta/painel-servidor.test.ts` lê o diretório e fica VERMELHO se algum
 * `route.ts` ou algum arquivo com `"use server"` — sob `/dashboard` ou sob
 * `lib/painel/` — não chamar a função. A regra deixou de ser "não existe
 * nenhum": proibir era proibir o painel de funcionar.
 *
 * O `?de=` É SEMPRE `/dashboard`, E ISSO NÃO É PROVISÓRIO. Um layout não recebe
 * os `params` do catch-all abaixo dele, e não há cabeçalho de caminho para
 * consultar: o Next APAGA o `Next-Url` de toda requisição que não seja de rota
 * de interceptação (`base-server.js`, `setVaryHeader`), e este projeto não tem
 * nenhuma. Houve aqui uma tentativa de ler esse cabeçalho; era código morto e
 * foi removida. A rota exata continua chegando pelo outro anel — o
 * `AdminRoutes`, no cliente, manda `location.pathname + location.search`, que é
 * o caso da sessão que morre com o painel já aberto. Quem chega por favorito
 * frio volta para a raiz do painel e navega dali.
 */
export default async function LayoutProtegidoDoPainel({
  children,
}: {
  children: ReactNode;
}) {
  await exigirAdminNoPainel("/dashboard");
  return <>{children}</>;
}
