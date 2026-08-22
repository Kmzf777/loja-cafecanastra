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
  TicketPercent,
  Star,
  Repeat,
  FileText,
  MessageCircle,
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
          <span>Gestão de produtos</span>
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

          <Link className="link" to={"/dashboard/assinaturas"}>
            <Repeat size={18} />
            <li>Assinaturas do Clube</li>
          </Link>

          {/* Bling fica em "Gestão de pedidos" e não numa seção própria: o
              gestor chega aqui vindo de um PEDIDO ("a nota daquela venda não
              saiu"), não de uma vontade de administrar uma integração. Ícone
              de documento porque o que se resolve nesta tela, no dia a dia, é
              nota fiscal. */}
          <Link className="link" to={"/dashboard/bling"}>
            <FileText size={18} />
            <li>Bling: NF-e e rastreio</li>
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
          <span>Avaliações</span>
          <Link className="link" to={"/dashboard/avaliacoes"}>
            <Star size={18} />
            <li>Moderar avaliações</li>
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

          <Link className="link" to={"/dashboard/settings/cupons"}>
            <TicketPercent size={18} />
            <li>Cupons de desconto</li>
          </Link>

          {/* WhatsApp fica em "Configurações gerais" porque é onde se INSTALA
              a integração (credencial da Meta, interruptores, templates) — o
              gestor vem aqui uma vez para configurar, não todo dia. O `to` é
              identico ao `path` de PainelApp.jsx: sem esse link a tela existe
              e some da navegação, e nenhum teste percebe. */}
          <Link className="link" to={"/dashboard/whatsapp"}>
            <MessageCircle size={18} />
            <li>WhatsApp</li>
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
