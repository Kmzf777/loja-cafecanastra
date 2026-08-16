import { useContext, useEffect } from "react";
import { Outlet } from "react-router-dom";
import authContext from "../contexts/loginContext/createAuthContext";
import Loading from "../components/Loading/Loading";

/**
 * Guard do painel.
 *
 * POR QUE NAO USA <Navigate>
 * Este componente roda dentro de uma ilha client-only: o `createBrowserRouter`
 * de `legacy/PainelApp.jsx` so conhece as rotas sob `/dashboard`. Um
 * `<Navigate to="/account/login">` pede ao react-router para casar uma rota que
 * NAO existe no roteador dele, e o resultado era a tela de erro padrao
 * ("Unexpected Application Error / 404 Not Found") em vez do login — registrado
 * como pendencia 2 em docs/superpowers/plans/baseline-painel.md.
 *
 * `/account/login` e `/` sao rotas do App Router do Next, fora da ilha. Sair
 * dela exige navegacao "dura" (window.location), que descarta o bundle do
 * painel e deixa o Next servir a pagina.
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
      // em vez de despeja-la na home depois de entrar.
      const destino = window.location.pathname + window.location.search;
      window.location.replace(`/account/login?de=${encodeURIComponent(destino)}`);
      return;
    }
    if (semPermissao) {
      // Logado, mas cliente: o painel nao e para ele. Vai para a conta, que
      // explica quem esta logado, e nao para uma home muda.
      window.location.replace("/account");
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
