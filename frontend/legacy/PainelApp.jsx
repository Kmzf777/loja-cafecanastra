"use client";

import { lazy } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import { GlobalStyle } from "./globalStyle/GlobalStyle.jsx";
import ConfigProvider from "./contexts/configContext/configContextProvider.jsx";
import AuthProvider from "./contexts/loginContext/authContextProvider.jsx";
import PromotionsProvider from "./contexts/promotionsContext/promotionsContextProvider.jsx";
import ProductProvider from "./contexts/productContext/productContextProvider.jsx";
import Load from "./load.jsx";

const Dashboard = lazy(() => import("./pages/dashboard/Dashboard.jsx"));
const AdminRoutes = lazy(() => import("./routes/AdminRoutes.jsx"));
const HomeDashboard = lazy(
  () => import("./components/DashboardSection/Home/HomeDashboard.jsx"),
);
const Form = lazy(
  () => import("./components/DashboardSection/GProducts/form/Form.jsx"),
);
const AddedProducts = lazy(
  () =>
    import("./components/DashboardSection/GProducts/addedProducts/AddedProducts.jsx"),
);
const Orders = lazy(
  () => import("./components/DashboardSection/Orders/Orders.jsx"),
);
const RegisteredClients = lazy(
  () =>
    import("./components/DashboardSection/Clients/RegisteredClients/RegisteredClients.jsx"),
);
const UpdateInfo = lazy(
  () =>
    import("./components/DashboardSection/Settings/UpdateShopInfo/UpdateInfo.jsx"),
);
const ManageCategories = lazy(
  () =>
    import("./components/DashboardSection/Settings/ManageCategories/ManageCategories.jsx"),
);
const PromotionsManager = lazy(
  () =>
    import("./components/DashboardSection/Settings/OffersAndCupons/PromotionsManager.jsx"),
);
const CuponsManager = lazy(
  () =>
    import("./components/DashboardSection/Settings/Cupons/CuponsManager.jsx"),
);
const AvaliacoesManager = lazy(
  () =>
    import("./components/DashboardSection/Avaliacoes/AvaliacoesManager.jsx"),
);
const AssinaturasManager = lazy(
  () =>
    import("./components/DashboardSection/Assinaturas/AssinaturasManager.jsx"),
);
const BlingManager = lazy(
  () => import("./components/DashboardSection/Bling/BlingManager.jsx"),
);

/**
 * ONDE ESTE SPA MORA — e por que a regra deste bloco se inverteu.
 *
 * O QUE ESTAVA ESCRITO AQUI ANTES, e continua verdadeiro como fisica: "NAO usar
 * basename: '/dashboard'. O painel legado navega por links ABSOLUTOS
 * ('/dashboard/orders' em MenuAside.jsx, navigate('/dashboard') em
 * Dashboard.jsx). O react-router prefixa o basename tambem em paths absolutos,
 * o que geraria '/dashboard/dashboard/orders'". Isso NAO mudou — foi medido de
 * novo com o react-router 7.2.0 instalado, e o teste ao lado
 * (`PainelApp.rotas.test.ts`) o registra: com `path: "/dashboard/orders"` e
 * basename, quem casa e a URL DOBRADA, e a bonita nao casa.
 *
 * O QUE MUDOU FOI A PREMISSA. Aquele comentario terminava dizendo "a rota
 * catch-all do Next (app/dashboard/[[...rota]]) serve qualquer URL sob
 * /dashboard" — e era exatamente ai que estava o preco escondido: um catch-all
 * na RAIZ do grupo protegido e o dono de tudo que ainda nao tem pasta propria,
 * e o painel novo nasce criando pasta atras de pasta (`pedidos/`, `produtos/`,
 * `descontos/`…). O catch-all desceu para `(protegido)/legado/[[...rota]]`, e
 * com ele o SPA inteiro desceu para `/dashboard/legado`.
 *
 * ENTAO O BASENAME PASSOU A SER OBRIGATORIO, E COM ELE OS PATHS RELATIVOS. As
 * duas coisas andam juntas e nao ha meio-termo: com basename, o react-router
 * tira o prefixo da URL antes de casar e o poe de volta ao gerar todo href. Um
 * basename com os paths absolutos antigos serviria `/dashboard/legado/dashboard/orders`
 * — funcionaria, e seria uma URL que ninguem consegue ler nem digitar.
 *
 * O PRECO QUE O COMENTARIO ANTIGO EVITAVA FOI PAGO AGORA: os 14 links absolutos
 * de `MenuAside.jsx`, `Dashboard.jsx`, `AddedProducts.jsx` e `Form.jsx` viraram
 * relativos ao basename. E so isso — nenhum componente mudou de comportamento.
 *
 * O que NAO virou relativo, e nao pode virar: `AdminRoutes.jsx` navega para
 * `/dashboard/entrar` e `/account` com `window.location`, que sao rotas do App
 * Router do Next e nao do roteador desta ilha. Caminho de navegador nao conhece
 * basename nenhum.
 */
const router = createBrowserRouter(
  [
    {
      element: Load(AdminRoutes),
      children: [
        {
          path: "/",
          element: Load(Dashboard),
          children: [
            { index: true, element: Load(HomeDashboard) },
            { path: "products/addProduct", element: Load(Form) },
            {
              path: "products/addedProducts",
              element: Load(AddedProducts),
            },
            { path: "orders", element: Load(Orders) },
            {
              path: "clients/registeredClients",
              element: Load(RegisteredClients),
            },
            {
              path: "settings/updateShopInfo",
              element: Load(UpdateInfo),
            },
            {
              path: "settings/manageCategories",
              element: Load(ManageCategories),
            },
            {
              path: "settings/offers",
              element: Load(PromotionsManager),
            },
            {
              path: "settings/cupons",
              element: Load(CuponsManager),
            },
            {
              path: "avaliacoes",
              element: Load(AvaliacoesManager),
            },
            {
              path: "assinaturas",
              element: Load(AssinaturasManager),
            },
            {
              path: "bling",
              element: Load(BlingManager),
            },
          ],
        },
      ],
    },
  ],
  { basename: "/dashboard/legado" },
);

export default function PainelApp() {
  return (
    <>
      <ToastContainer
        position="top-right"
        autoClose={2000}
        hideProgressBar
        newestOnTop={false}
        closeOnClick
        style={{ zIndex: 999999 }}
      />

      <ConfigProvider>
        <AuthProvider>
          <PromotionsProvider>
            <ProductProvider>
              <GlobalStyle />
              <RouterProvider router={router} />
            </ProductProvider>
          </PromotionsProvider>
        </AuthProvider>
      </ConfigProvider>
    </>
  );
}
