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

// NAO usar `basename: "/dashboard"`. O painel legado navega por links
// ABSOLUTOS ("/dashboard/orders" em MenuAside.jsx, navigate("/dashboard") em
// Dashboard.jsx). O react-router prefixa o basename tambem em paths absolutos,
// o que geraria "/dashboard/dashboard/orders" e quebraria o menu inteiro.
// Mantendo os paths absolutos identicos aos de main.jsx, o painel funciona sem
// precisar editar nenhum componente legado. A rota catch-all do Next
// (app/dashboard/[[...rota]]) serve qualquer URL sob /dashboard.
const router = createBrowserRouter([
  {
    element: Load(AdminRoutes),
    children: [
      {
        path: "/dashboard",
        element: Load(Dashboard),
        children: [
          { index: true, element: Load(HomeDashboard) },
          { path: "/dashboard/products/addProduct", element: Load(Form) },
          {
            path: "/dashboard/products/addedProducts",
            element: Load(AddedProducts),
          },
          { path: "/dashboard/orders", element: Load(Orders) },
          {
            path: "/dashboard/clients/registeredClients",
            element: Load(RegisteredClients),
          },
          {
            path: "/dashboard/settings/updateShopInfo",
            element: Load(UpdateInfo),
          },
          {
            path: "/dashboard/settings/manageCategories",
            element: Load(ManageCategories),
          },
          {
            path: "/dashboard/settings/offers",
            element: Load(PromotionsManager),
          },
          {
            path: "/dashboard/settings/cupons",
            element: Load(CuponsManager),
          },
        ],
      },
    ],
  },
]);

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
