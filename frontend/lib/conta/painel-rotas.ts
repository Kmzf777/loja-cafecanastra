/**
 * Os três endereços da cerca do painel — num módulo que NÃO importa nada.
 *
 * POR QUE ELES SAÍRAM DE `painel-servidor.ts`. O painel tem dois anéis de
 * guarda, e os dois precisam mandar a pessoa para os MESMOS dois lugares: o de
 * servidor (`painel-servidor.ts`, que decide antes de emitir a página) e o de
 * cliente (`components/painel/casca/AnelDeSessao.tsx`, que percebe a sessão
 * morrer com a tela já aberta). Duas cópias do endereço é como os dois anéis
 * passam a discordar — um manda para `/dashboard/entrar` e o outro para
 * `/dashboard/login` que alguém renomeou, e o segundo caso só aparece na noite
 * em que a sessão de alguém expira.
 *
 * E ELE NÃO PODE SER `painel-servidor.ts`. Aquele arquivo importa
 * `next/navigation` e `lib/supabase/servidor.ts`, que por sua vez importa
 * `next/headers` — código que só existe no servidor. Um componente de cliente
 * que importasse a constante de lá arrastaria a cadeia inteira para o bundle e
 * quebraria a compilação com um erro sobre `next/headers` que não diz nada
 * sobre a constante que se queria. Este módulo é texto puro de propósito: ele
 * atravessa a fronteira sem levar nada junto.
 */

/** Onde o painel começa. */
export const RAIZ_DO_PAINEL = "/dashboard";

/** A porta de entrada do painel — a única rota sob /dashboard fora da cerca. */
export const ROTA_DE_ENTRADA = "/dashboard/entrar";

/**
 * Para onde vai quem ESTÁ logado e não é gestor.
 *
 * A própria conta, e não o formulário de login: a pessoa entrou com a senha
 * certa, e devolvê-la ao login seria pedir que digitasse de novo o que já
 * funcionou. O `?painel=negado` é lido por `app/(transacional)/account/page.tsx`,
 * que explica por que o painel não abriu — sem ele a pessoa cairia na conta
 * sem entender o que aconteceu com o clique que ela deu.
 */
export const ROTA_DE_CONTA_NEGADA = "/account?painel=negado";

/**
 * A entrada do painel com o `?de=` — para voltar à rota que a pessoa tentou
 * abrir, em vez de despejá-la na raiz depois de ela digitar a senha.
 *
 * O `encodeURIComponent` não é enfeite: a rota carrega a query da tela
 * (`/dashboard/pedidos?status=aprovado&pagina=2`), e sem escapar o `&` o
 * segundo parâmetro viraria parâmetro da PÁGINA DE ENTRADA. Do outro lado,
 * `destinoDoPainel` (em `painel-servidor.ts`) recusa tudo o que não for um
 * caminho interno sob `/dashboard` — parâmetro de URL nunca vira destino
 * direto, e aqui a senha em questão é a do gestor.
 */
export function destinoDeEntrada(rotaPedida: string): string {
  return `${ROTA_DE_ENTRADA}?de=${encodeURIComponent(rotaPedida)}`;
}
