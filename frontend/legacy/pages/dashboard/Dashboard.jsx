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
        {/* Marca do painel: era o logo da Shopnaw, a loja de camisetas de onde
            este codigo veio. Servido de /public pelo mesmo Next que serve a
            ilha, entao caminho absoluto basta — sem import estatico. */}
        <div className="logoContent" onClick={() => navigate("/dashboard")}>
          <img src="/logo-canastra.png" alt="Café Canastra" />
        </div>

        {/* navigate("/site") apontava para uma rota que nao existe em roteador
            nenhum — nem nesta ilha, nem no App Router do Next. O clique nao
            saia do painel. A vitrine e "/" e mora FORA da ilha, entao a saida
            precisa ser navegacao dura. */}
        <span
          className="backShop"
          onClick={() => window.location.assign("/")}
        >
          {" "}
          <FaArrowLeft /> Voltar para a loja
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
