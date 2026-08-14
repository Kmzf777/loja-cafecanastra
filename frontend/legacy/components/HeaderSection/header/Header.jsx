import HamburgerMenu from "../hamburgerMenu/HamburgerMenu";
import {
  HeaderComponent,
  AdminButton,
  ModalOverlay,
  ModalContent,
  ModalActions,
  CancelButton,
  ConfirmButton,
} from "./Header.style";
import LogoShopnaw from "../../../assets/novalogo.jpeg";
import { SlHandbag } from "react-icons/sl";
import { FiLogIn } from "react-icons/fi";
import SearchBar from "../searchBar/SearchBar";
import { Link, useNavigate } from "react-router-dom";
import { useContext, useState } from "react";
import ProductsCart from "../../ProductsCartSection/CartSection/ProductsCart";
import Overlay from "../../Overlay/Overlay";
import Menu from "../menu/Menu";
import authContext from "../../../contexts/loginContext/createAuthContext";
import { CgProfile } from "react-icons/cg";
import { toast } from "react-toastify";
import { API_BASE } from "../../../api";

function Header() {
  const navigate = useNavigate();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isDropdownOpenLogged, setIsDropdownOpenLogged] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const { user, logoutUser, authFetch } = useContext(authContext);

  const handleOpenDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  const handleOpenDropdownLogged = () => {
    setIsDropdownOpenLogged(!isDropdownOpenLogged);
  };

  const toggleCart = () => {
    setIsCartOpen(!isCartOpen);
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
      navigate("/account/login");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleDeleteClick = () => {
    setIsDropdownOpenLogged(false);
    setShowDeleteModal(true);
  };

  const confirmDeleteAccount = async () => {
    try {
      const res = await authFetch(`${API_BASE}/auth/users/me`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success("Sua conta foi excluída com sucesso.");
        setShowDeleteModal(false);
        await logoutUser();
        navigate("/account/login");
      } else {
        const data = await res.json();
        toast.error(data.message || "Erro ao excluir conta.");
        setShowDeleteModal(false);
      }
    } catch (error) {
      console.error("Erro ao excluir conta:", error);
      toast.error("Erro de conexão.");
      setShowDeleteModal(false);
    }
  };

  return (
    <>
      <HeaderComponent
        onMouseLeave={() => {
          setIsDropdownOpen(false);
          setIsDropdownOpenLogged(false);
        }}
      >
        <div className="logoContent" onClick={() => navigate("/site")}>
          <img src={LogoShopnaw} alt="Logo-Shopnaw" />
        </div>
        <SearchBar />
        <div className="nav-menu">
          <SlHandbag className="icon" onClick={toggleCart} />
          <ProductsCart isCartOpen={isCartOpen} setIsCartOpen={setIsCartOpen} />
          {isCartOpen && (
            <Overlay isCartOpen={isCartOpen} setIsCartOpen={setIsCartOpen} />
          )}

          {user == null ? (
            <FiLogIn
              onClick={handleOpenDropdown}
              style={{ position: "relative" }}
              className="icon"
            />
          ) : (
            <CgProfile
              onClick={handleOpenDropdownLogged}
              style={{ position: "relative" }}
              className="icon"
            />
          )}

          <HamburgerMenu />

          {user == null ? (
            <div
              style={{
                position: "absolute",
                opacity: `${isDropdownOpen ? "1" : "0"}`,
                visibility: `${isDropdownOpen ? "visible" : "hidden"}`,
              }}
              className="dropDownAccount"
            >
              <button onClick={() => navigate("/account/login")}>Entrar</button>

              <div className="signUp">
                <p>Não possui conta?</p>
                <Link to="/account/cadastro">
                  <span>Cadastrar</span>
                </Link>
              </div>
            </div>
          ) : (
            <div
              style={{
                position: "absolute",
                opacity: `${isDropdownOpenLogged ? "1" : "0"}`,
                visibility: `${isDropdownOpenLogged ? "visible" : "hidden"}`,
              }}
              className="dropDownLogout"
            >
              <span>Olá, {user.name.split(" ")[0]}!</span>
              <button
                id="myOrdersBtn"
                onClick={() => {
                  navigate("/account/orders");
                  setIsDropdownOpenLogged(false);
                }}
              >
                Meus Pedidos
              </button>
              <button id="logoutBtn" onClick={handleLogout}>
                Sair
              </button>
              <button id="removeAccountBtn" onClick={handleDeleteClick}>
                Excluir conta
              </button>
            </div>
          )}

          {user && user.role === "admin" && (
            <AdminButton onClick={() => navigate("/dashboard")}>
              Painel Admin
            </AdminButton>
          )}
        </div>
      </HeaderComponent>
      <Menu />

      {showDeleteModal && (
        <ModalOverlay onClick={() => setShowDeleteModal(false)}>
          <ModalContent onClick={(e) => e.stopPropagation()}>
            <h3>Excluir Conta?</h3>
            <p>
              Tem certeza que deseja excluir sua conta permanentemente? Seu
              histórico de compras e dados serão apagados.
            </p>
            <ModalActions>
              <CancelButton onClick={() => setShowDeleteModal(false)}>
                Cancelar
              </CancelButton>
              <ConfirmButton onClick={confirmDeleteAccount}>
                Sim, excluir
              </ConfirmButton>
            </ModalActions>
          </ModalContent>
        </ModalOverlay>
      )}
    </>
  );
}

export default Header;
