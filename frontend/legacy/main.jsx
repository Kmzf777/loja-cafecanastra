import { StrictMode, lazy } from "react";
import { createRoot } from "react-dom/client";
import { GlobalStyle } from "./globalStyle/GlobalStyle.jsx";
import ProductProvider from "./contexts/productContext/productContextProvider.jsx";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import PromotionsProvider from "./contexts/promotionsContext/promotionsContextProvider.jsx";
import AuthProvider from "./contexts/loginContext/authContextProvider.jsx";
import ConfigProvider from "./contexts/configContext/configContextProvider.jsx";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import CookieConsent from "react-cookie-consent";
import Load from "./load.jsx";

const App = lazy(() => import("./App.jsx"));
const Home = lazy(() => import("./pages/home/Home.jsx"));
const Site = lazy(() => import("./pages/site/Site.jsx"));
const Dashboard = lazy(() => import("./pages/dashboard/Dashboard.jsx"));
const Login = lazy(() => import("./pages/login/Login.jsx"));
const SignUp = lazy(() => import("./pages/signUp/SignUp.jsx"));
const Cart = lazy(() => import("./pages/Cart/Cart.jsx"));
const ProductPage = lazy(
  () => import("./pages/eachProductPage/ProductPage.jsx"),
);
const Checkout = lazy(() => import("./pages/Checkout/Checkout.jsx"));
const Success = lazy(() => import("./pages/Checkout/Success.jsx"));
const MyOrders = lazy(() => import("./pages/Account/MyOrders.jsx"));
const ForgotPassword = lazy(() => import("./pages/Account/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/Account/ResetPassword"));
const VerifyEmail = lazy(() => import("./pages/Account/VerifyEmail.jsx"));
const TermsOfUse = lazy(() => import("./pages/Institutional/TermsOfUse.jsx"));
const PrivacyPolicy = lazy(
  () => import("./pages/Institutional/PrivacyPolicy.jsx"),
);
const NotFound = lazy(() => import("./pages/NotFound/NotFound"));
const HomeDashboard = lazy(
  () => import("./components/DashboardSection/Home/HomeDashboard.jsx"),
);
const Form = lazy(
  () => import("./components/DashboardSection/GProducts/form/Form.jsx"),
);
const AddedShirts = lazy(
  () =>
    import("./components/DashboardSection/GProducts/addedShirts/AddedShirts.jsx"),
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
const PrivateRoutes = lazy(() => import("./routes/PrivateRoutes.jsx"));
const AdminRoutes = lazy(() => import("./routes/AdminRoutes.jsx"));

const router = createBrowserRouter([
  {
    path: "/site",
    element: Load(App),
    children: [
      {
        path: "/site",
        element: Load(Site),
      },
      {
        path: "/site/product/:name/:id",
        element: Load(ProductPage),
      },
    ],
  },
  {
    path: "/checkout/carrinho",
    element: Load(Cart),
  },
  // --- ROTAS PROTEGIDAS ---
  {
    element: Load(PrivateRoutes),
    children: [
      {
        path: "/checkout",
        element: Load(Checkout),
      },
      {
        path: "/checkout/success",
        element: Load(Success),
      },
      {
        path: "/account/orders",
        element: Load(MyOrders),
      },
    ],
  },
  // ----------------
  {
    path: "/account/login",
    element: Load(Login),
  },
  {
    path: "/account/cadastro",
    element: Load(SignUp),
  },
  {
    path: "/account/verify-email",
    element: Load(VerifyEmail),
  },
  {
    path: "/account/forgot-password",
    element: Load(ForgotPassword),
  },
  {
    path: "/account/reset-password",
    element: Load(ResetPassword),
  },
  {
    path: "/",
    element: Load(Home),
  },
  {
    path: "/termos-de-uso",
    element: Load(TermsOfUse),
  },
  {
    path: "/politica-de-privacidade",
    element: Load(PrivacyPolicy),
  },
  // --- ROTAS PROTEGIDAS ---
  {
    element: Load(AdminRoutes),
    children: [
      {
        path: "/dashboard",
        element: Load(Dashboard),
        children: [
          {
            index: true,
            element: Load(HomeDashboard),
          },
          {
            path: "/dashboard/products/addProduct",
            element: Load(Form),
          },
          {
            path: "/dashboard/products/addedProducts",
            element: Load(AddedShirts),
          },
          {
            path: "/dashboard/orders",
            element: Load(Orders),
          },
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
        ],
      },
    ],
  },

  // ----------------
  {
    path: "*",
    element: Load(NotFound),
  },
]);

createRoot(document.getElementById("root")).render(
  <StrictMode>
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
            <CookieConsent
              location="bottom"
              buttonText="Aceitar e Fechar"
              cookieName="shopnaw_cookie_consent"
              style={{ background: "#82858b", fontSize: "14px" }}
              buttonStyle={{
                background: "#fff",
                color: "#82858b",
                fontSize: "13px",
                borderRadius: "5px",
                padding: "10px 20px",
              }}
              expires={150}
            >
              Este site utiliza cookies para melhorar a experiência do usuário e
              gerenciar o funcionamento da loja.{" "}
              <a
                href="/politica-de-privacidade"
                style={{ color: "#fff", textDecoration: "underline" }}
              >
                Leia nossa política
              </a>
              .
            </CookieConsent>
          </ProductProvider>
        </PromotionsProvider>
      </AuthProvider>
    </ConfigProvider>
  </StrictMode>,
);
