import { Link } from "react-router-dom";
import { Aside, ContainerSection, DivMenu } from "./MenuAside.style";
import {
  FileStack,
  HomeIcon,
  SquarePlus,
  ShoppingCart,
  CircleUser,
  Settings,
  Settings2,
  BadgeDollarSign,
} from "lucide-react";
import PropTypes from "prop-types";
import { useEffect } from "react";

function MenuAside({ isOpen }) {
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

  return (
    <Aside isOpen={isOpen}>
      <ContainerSection>
        <DivMenu>
          <Link className="link" to={"/dashboard"}>
            <HomeIcon size={18} />
            <li>Home</li>
          </Link>
        </DivMenu>

        {/*--------------------------*/}

        <DivMenu>
          <span>Gestão de protudos</span>
          <Link className="link" to={"/dashboard/products/addProduct"}>
            <SquarePlus size={18} />
            <li>Cadastrar produto</li>
          </Link>

          <Link className="link" to={"/dashboard/products/addedProducts"}>
            <FileStack size={18} />
            <li>Produtos cadastrados</li>
          </Link>
        </DivMenu>

        {/*--------------------------*/}

        <DivMenu>
          <span>Gestão de pedidos</span>
          <Link className="link" to={"/dashboard/orders"}>
            <ShoppingCart size={18} />
            <li>Pedidos realizados</li>
          </Link>
        </DivMenu>

        {/*--------------------------*/}

        <DivMenu>
          <span>Gestão de clientes</span>
          <Link className="link" to={"/dashboard/clients/registeredClients"}>
            <CircleUser size={18} />
            <li>Clientes cadastrados</li>
          </Link>
        </DivMenu>

        {/*--------------------------*/}

        <DivMenu>
          <span>Configurações gerais</span>
          <Link className="link" to={"/dashboard/settings/updateShopInfo"}>
            <Settings size={18} />
            <li>Atualizar informações da loja</li>
          </Link>

          <Link className="link" to={"/dashboard/settings/manageCategories"}>
            <Settings2 size={18} />
            <li>Gerenciar categorias dos produtos</li>
          </Link>

          <Link className="link" to={"/dashboard/settings/offers"}>
            <BadgeDollarSign size={18} />
            <li>Promoções</li>
          </Link>
        </DivMenu>
      </ContainerSection>
    </Aside>
  );
}

MenuAside.propTypes = {
  isOpen: PropTypes.bool,
};

export default MenuAside;
