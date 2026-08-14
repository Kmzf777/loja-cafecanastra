import { Outlet } from "react-router-dom";
import Header from "./components/HeaderSection/header/Header";
import { useContext, useEffect } from "react";
import productContext from "./contexts/productContext/createProductContext";
import Loading from "./components/Loading/Loading";
import SearchProductProvider from "./contexts/searchProduct/searchProductProvider";
import AnnouncementBar from "./components/AnnouncementBar/AnnouncementBar";
import Footer from "./components/Footer/Footer";
import FloatingWhatsApp from "./components/FloatingWhatsApp/FloatingWhatsApp";

function App() {
  const { updateProductList, isLoading } = useContext(productContext);

  useEffect(() => {
    updateProductList();
  }, [updateProductList]);

  return (
    <SearchProductProvider>
      <div
        style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}
      >
        <AnnouncementBar />
        <Header />

        {isLoading ? <Loading /> : <Outlet />}

        <Footer />
        <FloatingWhatsApp />
      </div>
    </SearchProductProvider>
  );
}

export default App;
