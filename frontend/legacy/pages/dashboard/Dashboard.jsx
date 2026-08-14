import LogoShopnaw from "../../assets/novalogo.jpeg";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import MenuAside from "../../components/DashboardSection/MenuAside/MenuAside";
import {
  DashboardContainer,
  ContainerHamburger,
  ContentWrapper,
  SectionDashboard,
  HeaderComponent,
} from "./Dashboard.style";
import { useEffect, useState } from "react";
import { RxHamburgerMenu } from "react-icons/rx";
import Overlay from "../../components/Overlay/Overlay";
import { FaArrowLeft } from "react-icons/fa";

function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
  };

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <DashboardContainer>
      <HeaderComponent>
        <div className="logoContent" onClick={() => navigate("/dashboard")}>
          <img src={LogoShopnaw} alt="Logo-Shopnaw" />
        </div>

        <span className="backShop" onClick={() => navigate("/site")}>
          {" "}
          <FaArrowLeft /> Volar para loja
        </span>

        <ContainerHamburger>
          {menuOpen && (
            <Overlay menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
          )}
          <RxHamburgerMenu onClick={toggleMenu} />
        </ContainerHamburger>
      </HeaderComponent>
      <SectionDashboard>
        <MenuAside isOpen={menuOpen} />
        <ContentWrapper>
          <Outlet />
        </ContentWrapper>
      </SectionDashboard>
    </DashboardContainer>
  );
}

export default Dashboard;
