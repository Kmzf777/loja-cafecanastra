/**
 * Chamadas do painel legado à API Express — hoje só uma REEXPORTAÇÃO.
 *
 * O painel legado sai na Onda 6. Até lá ele usa o transporte novo, para não
 * existirem duas cópias da regra de renovação de sessão divergindo em silêncio.
 * As três regras (token lido a cada chamada; só 401 renova, e só se o token
 * mudou; nenhum cabeçalho fora dos três do CORS) e os onze testes que as provam
 * mudaram para `lib/painel/transporte.ts` e `lib/painel/transporte.test.ts`.
 *
 * O QUE ESTE ARQUIVO GUARDA DE HISTÓRIA, E QUE NÃO CABE NO MÓDULO NOVO:
 *
 *   `/csrf-token` SUMIU na Task 6 — e este arquivo era o ponto mais afiado da
 *   Task 5. O `getCsrfToken()` antigo LANÇAVA quando a resposta não era ok, e
 *   ele era a PRIMEIRA linha de `fetchDataForm`. Com a rota devolvendo 404,
 *   nenhum formulário do painel chegava a emitir requisição nenhuma — nem os
 *   que não tinham nada a ver com CSRF (o catálogo, as categorias, a
 *   configuração da loja). Uma rota de autenticação apagada derrubava telas de
 *   LEITURA. É por isso que o transporte novo não tem passo nenhum antes do
 *   `fetch`, e que o teste "não busca /csrf-token em lugar nenhum" continua
 *   valendo lá.
 *
 * `chamarApi` tem a mesma assinatura de `fetchDataForm(caminho, método, corpo)`
 * — os vinte e um pontos de chamada seguem sem edição. A única diferença é o
 * padrão do método (era "POST", é "GET"), e nenhum dos chamadores deste painel
 * o omite.
 */
import { authFetch, chamarApi, BASE_DA_API } from "../lib/painel/transporte";

export const API_BASE = BASE_DA_API;
export { authFetch };
export default chamarApi;
