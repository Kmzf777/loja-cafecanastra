import type { ReactNode } from "react";
import { exigirAdminNoPainel } from "@/lib/conta/painel-servidor";
import { AnelDeSessao } from "@/components/painel/casca/AnelDeSessao";
import { MenuLateral } from "@/components/painel/casca/MenuLateral";

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
 * distração. Route group não muda URL nenhuma: `(protegido)/page.tsx` serve
 * `/dashboard`, `(protegido)/legado/[[...rota]]` serve `/dashboard/legado/…`, e
 * `(publico)/entrar` continua servindo `/dashboard/entrar`.
 *
 * (Este parágrafo dizia que `(protegido)/[[...rota]]` servia `/dashboard`, e era
 * verdade até a Onda 1 do painel novo. O catch-all do painel legado DESCEU para
 * `legado/`: enquanto ele estiver na raiz do grupo, é ele o dono de tudo que
 * ainda não tem pasta própria, e cada tela nova das ondas seguintes teria de
 * disputar rota com ele.)
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
 * O `?de=` DESTE ANEL É SEMPRE `/dashboard`, E ISSO NÃO É PROVISÓRIO. Um layout
 * não recebe os `params` do catch-all abaixo dele, e não há cabeçalho de caminho
 * para consultar: o Next APAGA o `Next-Url` de toda requisição que não seja de
 * rota de interceptação (`base-server.js`, `setVaryHeader`), e este projeto não
 * tem nenhuma. Houve aqui uma tentativa de ler esse cabeçalho; era código morto
 * e foi removida. A rota exata chega pelo OUTRO anel — o `<AnelDeSessao>` logo
 * abaixo, que roda no navegador e manda `location.pathname + location.search`,
 * que é o caso da sessão que morre com o painel já aberto. Quem chega por
 * favorito frio volta para a raiz do painel e navega dali.
 *
 * (Este parágrafo dizia `AdminRoutes`, o guard do painel legado. Ele só era
 * montado dentro da ilha `/dashboard/legado/*`, então as telas novas nunca
 * tiveram esse anel — o texto prometia uma cobertura que não existia. O
 * `<AnelDeSessao>` é o anel próprio do painel novo.)
 */
/**
 * A CASCA, acrescentada na Onda 1 — e o que ela liga.
 *
 * `.painel` NÃO É DECORAÇÃO: é o gancho da tipografia e da DENSIDADE definidas
 * em `globals.css`. Sem esta classe o painel sai na fonte do sistema e, o que
 * mais se nota, em 16px — os 14px do R22 vêm daqui, e são eles que fazem caber
 * na tela a quantidade de linha que um painel administrativo precisa mostrar.
 *
 * ELA JÁ CARREGOU MAIS QUE ISSO: até a Onda 7 era também o gancho de um reset
 * escrito à mão, porque o preflight do Tailwind não podia ser global — o painel
 * LEGADO em styled-components dependia dos defaults do navegador e se desfazia
 * com ele. Apagado o legado, o preflight voltou a ser global e o reset saiu
 * daqui. É o mesmo mecanismo que `.vitrine` usa do outro lado, e pelo mesmo
 * motivo: cada metade do site tem a sua voz, e a voz não é reset.
 *
 * O MENU MORA AQUI, e não em cada página, pela mesma razão que a checagem: o
 * que envolve toda rota do grupo — inclusive as que ainda não existem — é o
 * layout. Uma tela nova nasce com navegação por herança, sem ninguém lembrar
 * de importá-la.
 *
 * O PULO PARA O CONTEÚDO é a contrapartida de ter treze links antes do
 * primeiro parágrafo: sem ele, quem navega por teclado ou por leitor de tela
 * atravessa a barra inteira a cada troca de tela. `focus:` e não
 * `focus-visible:` de propósito — este link só é alcançável por teclado, então
 * "recebeu foco" e "foi tabulado até aqui" são a mesma coisa.
 *
 * O `<main id="conteudo">` fica NESTE arquivo e não nas páginas: é o alvo do
 * pulo, e um alvo que cada página precisa lembrar de declarar é um alvo que um
 * dia falta. Consequência para quem escrever tela nova: a página renderiza o
 * <Cabecalho> e o conteúdo direto, SEM abrir outro <main>.
 */
export default async function LayoutProtegidoDoPainel({
  children,
}: {
  children: ReactNode;
}) {
  const { userId } = await exigirAdminNoPainel("/dashboard");
  return (
    <div className="painel flex min-h-screen flex-col md:flex-row">
      {/*
        O SEGUNDO ANEL, e ele mora no layout pela mesma razão que a checagem: é o
        que envolve toda rota do grupo, inclusive as que ainda não existem. Uma
        tela nova nasce guardada nos dois anéis por herança, sem ninguém lembrar.

        Não desenha nada — é `null` no DOM. Fica no topo da árvore, antes do
        pulo, porque a ordem visual não lhe diz respeito e porque um componente
        invisível no meio do conteúdo é um componente que alguém move sem querer.
      */}
      <AnelDeSessao userIdDoServidor={userId} />
      <a
        href="#conteudo"
        className="sr-only rounded-cx bg-fuligem px-4 py-3 text-cal focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50"
      >
        Pular para o conteúdo
      </a>
      <MenuLateral />
      <main id="conteudo" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
