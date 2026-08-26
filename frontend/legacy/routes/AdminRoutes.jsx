import { useContext, useEffect } from "react";
import { Outlet } from "react-router-dom";
import authContext from "../contexts/loginContext/createAuthContext";
import Loading from "../components/Loading/Loading";

/**
 * Guard do painel — o SEGUNDO anel.
 *
 * O PRIMEIRO ANEL AGORA E DE SERVIDOR: `lib/conta/painel-servidor.ts`, chamado
 * pelo layout de `app/dashboard/(protegido)/` antes de qualquer byte desta ilha
 * ser emitido. (Ele era chamado pela pagina do catch-all, que morava na raiz do
 * grupo; na Onda 1 do painel novo o catch-all desceu para
 * `(protegido)/legado/[[...rota]]/page.tsx` e a checagem ja tinha subido para o
 * layout, que cobre as rotas que ainda nem existem.) Quem chega aqui ja passou
 * por la. Entao por que este arquivo continua existindo?
 *
 * PORQUE A SESSAO PODE MORRER COM O PAINEL JA ABERTO. O guard de servidor roda
 * uma vez, na requisicao que serviu a pagina; depois disso o painel e um SPA e
 * nenhum Server Component roda de novo. Um gestor que deixa a aba aberta a noite
 * inteira, ou que sai da conta em outra aba, continuaria vendo a interface do
 * painel — com toda chamada de API respondendo 401 em silencio. Este anel e
 * quem percebe.
 *
 * NAO REMOVA UM PELO OUTRO. O de servidor impede que o pacote do painel chegue a
 * um anonimo; este impede que a tela do painel siga de pe depois que o acesso
 * acabou. Sao dois problemas diferentes.
 *
 * POR QUE NAO USA <Navigate>
 * Este componente roda dentro de uma ilha client-only: o `createBrowserRouter`
 * de `legacy/PainelApp.jsx` so conhece as rotas sob `/dashboard/legado` (era
 * `/dashboard` ate o catch-all descer para `legado/`). Um
 * `<Navigate to="/dashboard/entrar">` pede ao react-router para casar uma rota
 * que NAO existe no roteador dele (a entrada e uma rota do App Router, nao da
 * ilha), e o resultado era a tela de erro padrao ("Unexpected Application Error
 * / 404 Not Found") em vez do login — registrado como pendencia 2 em
 * docs/superpowers/plans/baseline-painel.md.
 *
 * `/dashboard/entrar` e `/account` sao rotas do App Router do Next, fora da
 * ilha. Sair dela exige navegacao "dura" (window.location), que descarta o
 * bundle do painel e deixa o Next servir a pagina.
 *
 * O redirecionamento vai num efeito, e nao no corpo do render, porque mexer em
 * window.location durante o render e efeito colateral: em StrictMode o React
 * renderiza duas vezes e a navegacao dispararia duas.
 */
const AdminRoutes = () => {
  const { user, initialized } = useContext(authContext);

  const semSessao = initialized && !user;
  const semPermissao = initialized && !!user && user.role !== "admin";

  useEffect(() => {
    if (semSessao) {
      // `?de=` devolve a pessoa para a rota do painel que ela tentou abrir,
      // em vez de despeja-la na home depois de entrar. O destino e sempre um
      // caminho sob /dashboard/legado (este componente so roda dentro da ilha),
      // e `destinoDoPainel` do outro lado aceita qualquer caminho sob
      // /dashboard — entao a mudanca de casa do SPA nao o afeta.
      // `location.pathname` e o caminho do NAVEGADOR: ele ja vem com o
      // basename, e nao passa pelo react-router.
      const destino = window.location.pathname + window.location.search;
      window.location.replace(
        `/dashboard/entrar?de=${encodeURIComponent(destino)}`,
      );
      return;
    }
    if (semPermissao) {
      // Logado, mas cliente: o painel nao e para ele. Vai para a conta, que
      // explica quem esta logado, e nao para uma home muda. O `?painel=negado`
      // e o mesmo que o guard de servidor usa — a pagina da conta le o
      // parametro e diz por que o painel nao abriu.
      window.location.replace("/account?painel=negado");
    }
  }, [semSessao, semPermissao]);

  // Enquanto a sessao e verificada — e durante o instante entre disparar o
  // redirecionamento e o browser sair da pagina — a tela e a de carregamento.
  // Devolver null aqui faria o painel piscar branco antes de navegar.
  if (!initialized || semSessao || semPermissao) {
    return <Loading />;
  }

  return <Outlet />;
};

export default AdminRoutes;
