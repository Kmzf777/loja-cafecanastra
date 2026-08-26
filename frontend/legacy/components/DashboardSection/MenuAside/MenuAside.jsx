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
} from "lucide-react";
import PropTypes from "prop-types";
import { useEffect } from "react";

/**
 * OS `to` DESTE MENU SAO RELATIVOS AO BASENAME, e nao ao dominio.
 *
 * `to={"/orders"}` gera o href `/dashboard/legado/orders`, porque o
 * `createBrowserRouter` de `legacy/PainelApp.jsx` roda com
 * `basename: "/dashboard/legado"` e o react-router poe o prefixo de volta em
 * todo href que gera. Eles eram absolutos (`/dashboard/orders`) enquanto o SPA
 * era servido pelo catch-all na RAIZ de `/dashboard`; o catch-all desceu para
 * `legado/` para nao engolir as rotas do painel novo, e o motivo inteiro esta
 * no comentario grande de `PainelApp.jsx`.
 *
 * NAO reescreva nenhum destes para `/dashboard/...` "para ficar igual a URL".
 * Com basename, um path absoluto vira `/dashboard/legado/dashboard/...` — e o
 * teste `legacy/PainelApp.rotas.test.ts` fica vermelho na hora, de proposito.
 */
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
          <Link className="link" to={"/"}>
            <HomeIcon size={18} />
            <li>Home</li>
          </Link>
        </DivMenu>

        {/*--------------------------*/}

        <DivMenu>
          <span>Gestão de produtos</span>
          <Link className="link" to={"/products/addProduct"}>
            <SquarePlus size={18} />
            <li>Cadastrar produto</li>
          </Link>

          <Link className="link" to={"/products/addedProducts"}>
            <FileStack size={18} />
            <li>Produtos cadastrados</li>
          </Link>
        </DivMenu>

        {/*--------------------------*/}

        <DivMenu>
          <span>Gestão de pedidos</span>
          <Link className="link" to={"/orders"}>
            <ShoppingCart size={18} />
            <li>Pedidos realizados</li>
          </Link>

          <Link className="link" to={"/assinaturas"}>
            <Repeat size={18} />
            <li>Assinaturas do Clube</li>
          </Link>

          {/* Bling fica em "Gestão de pedidos" e não numa seção própria: o
              gestor chega aqui vindo de um PEDIDO ("a nota daquela venda não
              saiu"), não de uma vontade de administrar uma integração. Ícone
              de documento porque o que se resolve nesta tela, no dia a dia, é
              nota fiscal. */}
          <Link className="link" to={"/bling"}>
            <FileText size={18} />
            <li>Bling: NF-e e rastreio</li>
          </Link>
        </DivMenu>

        {/*--------------------------*/}

        <DivMenu>
          <span>Gestão de clientes</span>
          <Link className="link" to={"/clients/registeredClients"}>
            <CircleUser size={18} />
            <li>Clientes cadastrados</li>
          </Link>
        </DivMenu>

        {/*--------------------------*/}

        <DivMenu>
          <span>Avaliações</span>
          <Link className="link" to={"/avaliacoes"}>
            <Star size={18} />
            <li>Moderar avaliações</li>
          </Link>
        </DivMenu>

        {/*--------------------------*/}

        <DivMenu>
          <span>Configurações gerais</span>
          <Link className="link" to={"/settings/updateShopInfo"}>
            <Settings size={18} />
            <li>Atualizar informações da loja</li>
          </Link>

          <Link className="link" to={"/settings/manageCategories"}>
            <Settings2 size={18} />
            <li>Gerenciar categorias dos produtos</li>
          </Link>

          <Link className="link" to={"/settings/offers"}>
            <BadgeDollarSign size={18} />
            <li>Promoções</li>
          </Link>

          <Link className="link" to={"/settings/cupons"}>
            <TicketPercent size={18} />
            <li>Cupons de desconto</li>
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
