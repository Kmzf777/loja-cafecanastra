import {
  AccountButton,
  ContainerSidebar,
  Content,
  FooterMenuAside,
  Option,
  SelectDown,
  SelectDownOptions,
  SubTitle,
} from "./Sidebar.style";
import { IoMdClose } from "react-icons/io";
import PropTypes from "prop-types";
import { IoIosArrowForward } from "react-icons/io";
import { IoIosArrowDown } from "react-icons/io";
import { CgProfile } from "react-icons/cg";
import { useContext, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import productContext from "../../../contexts/productContext/createProductContext";
import fetchDataForm from "../../../api";
import authContext from "../../../contexts/loginContext/createAuthContext";

function Sidebar({ isOpen, active }) {
  const [categories, setCategories] = useState([]);
  const [sizes, setSizes] = useState([]);
  const [isSelectCategoryDown, setIsSelectCategoryDown] = useState(false);
  const [isSelectSizeDown, setIsSelectSizeDown] = useState(false);
  const { updateProductList } = useContext(productContext);
  const { user, logoutUser } = useContext(authContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }

    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [catRes, sizeRes] = await Promise.all([
          fetchDataForm("/options?type=category", "GET"),
          fetchDataForm("/options?type=size", "GET"),
        ]);

        const catData = await catRes.json();
        const sizeData = await sizeRes.json();

        setCategories(catData);
        setSizes(sizeData);
      } catch (error) {
        console.error("Erro ao carregar categorias/tamanhos:", error);
      }
    };

    fetchOptions();
  }, []);

  const handleClickFilter = async (type, value) => {
    const queryParams = new URLSearchParams(searchParams);
    queryParams.set(type, value);

    setSearchParams(queryParams.toString());
    updateProductList(queryParams.toString());
    active(false);
  };

  const clearFilters = () => {
    setSearchParams("");
    updateProductList("");
    active(false);
  };

  const handleSelectCategoryDown = () => {
    setIsSelectCategoryDown(!isSelectCategoryDown);
  };

  const handleSelectSizeDown = () => {
    setIsSelectSizeDown(!isSelectSizeDown);
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
      navigate("/account/login");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <ContainerSidebar isOpen={isOpen}>
      <IoMdClose onClick={() => active(false)} />
      <Content>
        <h2>Buscar por:</h2>
        <SelectDown>
          <SubTitle onClick={handleSelectCategoryDown}>
            <span>Categoria</span>
            {isSelectCategoryDown ? <IoIosArrowDown /> : <IoIosArrowForward />}
          </SubTitle>

          {isSelectCategoryDown && (
            <SelectDownOptions>
              {categories.map((category) => {
                return (
                  <Option
                    className="category"
                    key={category.id}
                    onClick={() =>
                      handleClickFilter("category", category.value)
                    }
                    style={{
                      fontWeight:
                        searchParams.get("category") === category.value
                          ? "600"
                          : "400",
                      color:
                        searchParams.get("category") === category.value
                          ? "#000"
                          : "#7b7b7b",
                    }}
                  >
                    {category.value}
                  </Option>
                );
              })}
            </SelectDownOptions>
          )}
        </SelectDown>

        <SelectDown>
          <SubTitle onClick={handleSelectSizeDown}>
            <span>Tamanho</span>
            {isSelectSizeDown ? <IoIosArrowDown /> : <IoIosArrowForward />}
          </SubTitle>

          {isSelectSizeDown && (
            <SelectDownOptions>
              {sizes.map((size) => {
                return (
                  <Option
                    className="size"
                    key={size.id}
                    onClick={() => handleClickFilter("size", size.value)}
                    style={{
                      fontWeight:
                        searchParams.get("size") === size.value ? "600" : "400",
                      color:
                        searchParams.get("size") === size.value
                          ? "#000"
                          : "#7b7b7b",
                    }}
                  >
                    {size.value}
                  </Option>
                );
              })}
            </SelectDownOptions>
          )}
        </SelectDown>
      </Content>

      <FooterMenuAside>
        {user && user.role === "admin" && (
          <AccountButton
            onClick={() => {
              navigate("/dashboard");
              active(false);
            }}
            style={{
              marginBottom: "10px",
              backgroundColor: "#333",
              color: "#fff",
              border: "none",
            }}
          >
            <span>Painel Admin</span>
          </AccountButton>
        )}

        {user == null ? (
          <AccountButton onClick={() => navigate("/account/login")}>
            <CgProfile />
            <span>Minha conta</span>
          </AccountButton>
        ) : (
          <AccountButton onClick={handleLogout}>
            <CgProfile />
            <span>Sair</span>
          </AccountButton>
        )}

        {(searchParams.get("category") || searchParams.get("size")) && (
          <div onClick={clearFilters}>
            <Option id="clear-filters">Limpar Filtros</Option>
          </div>
        )}
      </FooterMenuAside>
    </ContainerSidebar>
  );
}

export default Sidebar;

Sidebar.propTypes = {
  isOpen: PropTypes.bool,
  active: PropTypes.func,
};
